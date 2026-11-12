-- Item 2: ranking público agregado e repetição restrita à sessão autenticada.
BEGIN;
CREATE TABLE public.menu_best_seller_settings (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
 enabled boolean NOT NULL DEFAULT true,
 product_ids uuid[] NOT NULL DEFAULT '{}',
 CHECK(cardinality(product_ids)<=3)
);
ALTER TABLE public.menu_best_seller_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_best_seller_settings FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX menu_best_sellers_orders_idx ON public.orders(tenant_id,created_at,id)
 WHERE status NOT IN ('CANCELLED','CANCELLED_BY_CUSTOMER','REFUNDED')
 AND payment_status<>'REFUNDED' AND (payment_status='PAID' OR status='DELIVERED');
CREATE INDEX menu_session_reorder_idx ON public.orders(tenant_id,ordered_by_session_id,tab_id,created_at);
CREATE INDEX menu_best_sellers_items_idx ON public.order_items(order_id,product_id) INCLUDE(quantity);

CREATE FUNCTION public.get_menu_best_seller_settings(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR coalesce(public._tenant_role_of_caller(p_tenant),'') NOT IN ('OWNER','MANAGER') THEN
  RAISE EXCEPTION 'FORBIDDEN: sem permissão para editar os destaques.' USING ERRCODE='42501';
 END IF;
 RETURN coalesce((SELECT jsonb_build_object('enabled',enabled,'productIds',product_ids)
 FROM public.menu_best_seller_settings WHERE tenant_id=p_tenant),'{"enabled":true,"productIds":[]}'::jsonb);
END $$;
CREATE FUNCTION public.set_menu_best_seller_settings(p_tenant uuid,p_enabled boolean,p_products uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.get_menu_best_seller_settings(p_tenant);
 IF p_enabled IS NULL OR p_products IS NULL OR cardinality(p_products)>3
 OR cardinality(p_products)<>(SELECT count(DISTINCT id) FROM unnest(p_products) id)
 OR EXISTS(SELECT 1 FROM unnest(p_products) u(id) WHERE NOT EXISTS(
 SELECT 1 FROM public.products p WHERE p.id=u.id AND p.tenant_id=p_tenant)) THEN
  RAISE EXCEPTION 'INVALID_PRODUCTS: escolha até três produtos desta loja.';
 END IF;
 INSERT INTO public.menu_best_seller_settings VALUES(p_tenant,p_enabled,p_products)
 ON CONFLICT(tenant_id) DO UPDATE SET enabled=EXCLUDED.enabled,product_ids=EXCLUDED.product_ids;
END $$;
-- Consulta leve com índices por loja/data e itens; retorna somente UUID e posição.
CREATE FUNCTION public.get_menu_best_sellers(p_tenant uuid)
RETURNS TABLE(product_id uuid,"position" integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH config AS (
 SELECT coalesce(s.enabled,true) enabled,coalesce(s.product_ids,'{}'::uuid[]) pins
 FROM public.tenants t LEFT JOIN public.menu_best_seller_settings s ON s.tenant_id=t.id
 WHERE t.id=p_tenant AND t.status='ACTIVE'
 ), ranked AS (
 SELECT i.product_id,sum(i.quantity) quantity
 FROM public.orders o JOIN public.order_items i ON i.order_id=o.id
 JOIN public.products p ON p.id=i.product_id AND p.tenant_id=o.tenant_id
 WHERE o.tenant_id=p_tenant AND o.created_at>=now()-interval '30 days' AND o.created_at<=now()
 AND o.status NOT IN ('CANCELLED','CANCELLED_BY_CUSTOMER','REFUNDED')
 AND o.payment_status<>'REFUNDED' AND (o.payment_status='PAID' OR o.status='DELIVERED')
 AND EXISTS(SELECT 1 FROM config WHERE enabled AND cardinality(pins)=0)
 GROUP BY i.product_id
 ), chosen AS (
 SELECT r.product_id,row_number() OVER(ORDER BY quantity DESC,r.product_id)::integer pos FROM ranked r
 UNION ALL
 SELECT p.id,u.ord::integer FROM config c CROSS JOIN LATERAL unnest(c.pins) WITH ORDINALITY u(id,ord)
 JOIN public.products p ON p.id=u.id AND p.tenant_id=p_tenant WHERE c.enabled
 ) SELECT c.product_id,c.pos FROM chosen c WHERE c.pos<=3 ORDER BY c.pos;
$$;

CREATE FUNCTION public.get_session_reorder_items(p_session uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.tab_sessions;
BEGIN
 SELECT * INTO s FROM public.tab_sessions ts WHERE ts.id=p_session AND ts.auth_user_id=auth.uid()
 AND ts.approved_at IS NOT NULL AND ts.ended_at IS NULL AND ts.expires_at>now();
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.dining_tabs t WHERE t.id=s.tab_id AND t.tenant_id=s.tenant_id AND t.status='OPEN') THEN
  RAISE EXCEPTION 'FORBIDDEN: sessão expirada ou não autorizada.' USING ERRCODE='42501';
 END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
 'optionLabels',coalesce((SELECT jsonb_agg(x.group_name_snapshot || ': ' || x.option_name_snapshot ORDER BY x.option_id) FROM public.order_item_options x WHERE x.order_item_id=i.id AND x.tenant_id=s.tenant_id),'[]'::jsonb),
 'id',i.id,'productId',i.product_id,'name',i.product_name,'quantity',i.quantity,'notes',coalesce(i.notes,''),
 'options',coalesce((SELECT jsonb_agg(jsonb_build_object('groupId',x.group_id,'optionId',x.option_id,'qty',x.qty,'fraction',x.fraction) ORDER BY x.option_id)
 FROM public.order_item_options x WHERE x.order_item_id=i.id AND x.tenant_id=s.tenant_id),'[]'::jsonb)) ORDER BY o.created_at DESC,i.id)
 FROM public.orders o JOIN public.order_items i ON i.order_id=o.id
 WHERE o.tenant_id=s.tenant_id AND o.tab_id=s.tab_id AND o.ordered_by_session_id=s.id
 AND o.status NOT IN ('CANCELLED','CANCELLED_BY_CUSTOMER','REFUNDED')),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_menu_best_seller_settings(uuid),public.set_menu_best_seller_settings(uuid,boolean,uuid[]),public.get_menu_best_sellers(uuid),public.get_session_reorder_items(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_menu_best_sellers(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_menu_best_seller_settings(uuid),public.set_menu_best_seller_settings(uuid,boolean,uuid[]),public.get_session_reorder_items(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.create_totem_order(p_token text,p_items jsonb,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_device uuid;v_tenant uuid;v_label text;v_existing uuid;v_order uuid;
 v_item jsonb;v_pid uuid;v_qty integer;v_name text;v_price numeric(10,2);
 v_total numeric(10,2):=0;v_notes text;v_timeout integer;v_provider text;v_result jsonb;
 v_lines jsonb:='[]'::jsonb;v_line record;
BEGIN
 SELECT d.o_device,d.o_tenant,d.o_label INTO v_device,v_tenant,v_label FROM public._totem_device_ok(p_token) d;
 IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'INVALID_TOTEM_ORDER: chave obrigatória' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_tenant::text),pg_catalog.hashtext(p_idempotency_key::text));
 SELECT id INTO v_existing FROM public.orders WHERE tenant_id=v_tenant AND totem_device_id=v_device AND idempotency_key=p_idempotency_key LIMIT 1;
 IF v_existing IS NOT NULL THEN
  v_result:=public._totem_payment_response(v_existing,v_device,v_tenant);
  RETURN v_result||jsonb_build_object('idempotent',true);
 END IF;
 IF NOT public._rate_limit_hit('totem_order_device',v_device::text,v_tenant,12,300) THEN
  RAISE EXCEPTION 'RATE_LIMITED: muitos pedidos' USING ERRCODE='P0001';
 END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'INVALID_TOTEM_ORDER: 1 a 50 itens' USING ERRCODE='22023';
 END IF;
 -- Price each cart line separately: repeated configurations may have different notes.
 -- Keep intermediates local to this invocation of the SECURITY DEFINER function.
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'productId' LOOP
  SELECT * INTO v_line FROM public._price_items(v_tenant,jsonb_build_array(v_item),true);
  IF v_line.r_quantity>99 OR length(coalesce(v_line.r_notes,''))>200 THEN
   RAISE EXCEPTION 'INVALID_TOTEM_ORDER: quantidade ou observação inválida' USING ERRCODE='22023';
  END IF;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
   'product_id',v_line.r_product_id,'product_name',v_line.r_name,'quantity',v_line.r_quantity,
   'unit_price',v_line.r_unit_price,'notes',v_line.r_notes,'input',v_item));
  v_total:=v_total+v_line.r_quantity*v_line.r_unit_price;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(v_lines) l(product_id uuid,quantity integer)
 JOIN public.products p ON p.id=l.product_id AND p.tenant_id=v_tenant
 GROUP BY p.id,p.stock_quantity HAVING sum(l.quantity)>p.stock_quantity) THEN
  RAISE EXCEPTION 'OUT_OF_STOCK: item indisponível na quantidade solicitada.';
 END IF;
 SELECT coalesce(timeout_seconds,240),coalesce(provider,'manual') INTO v_timeout,v_provider
 FROM public.totem_payment_settings WHERE tenant_id=v_tenant;
 v_timeout:=coalesce(v_timeout,240);v_provider:=coalesce(v_provider,'manual');
 -- All automated terminal adapters are disabled until an authenticated backend exists.
 IF v_provider<>'manual' THEN v_provider:='manual'; END IF;
 INSERT INTO public.orders(tenant_id,customer_name,customer_phone,delivery_address,subtotal,delivery_fee,discount,total_amount,payment_method,payment_status,fulfillment_type,status,notes,origin,totem_device_id,idempotency_key,awaiting_online_payment)
 VALUES(v_tenant,'Totem','-','Totem do salão',v_total,0,0,v_total,'CASH','PENDING','PICKUP','PENDING','Aguardando pagamento na maquininha','direct',v_device,p_idempotency_key,true)
 RETURNING id INTO v_order;
 FOR v_item IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
  -- The snapshot trigger must see only this line, including identical options
  -- repeated with different notes or configurations with the same price.
  PERFORM set_config('app.product_option_items',jsonb_build_array(v_item->'input')::text,true);
  PERFORM set_config('app.product_option_used','[]',true);
  INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price,notes)
  VALUES(v_order,(v_item->>'product_id')::uuid,v_item->>'product_name',(v_item->>'quantity')::integer,
   (v_item->>'unit_price')::numeric,(v_item->>'quantity')::integer*(v_item->>'unit_price')::numeric,v_item->>'notes');
 END LOOP;
 PERFORM set_config('app.product_option_items','',true);
 PERFORM set_config('app.product_option_used','',true);
 INSERT INTO public.totem_payment_attempts(tenant_id,order_id,device_id,provider,amount,expires_at)
 VALUES(v_tenant,v_order,v_device,v_provider,v_total,now()+make_interval(secs=>v_timeout));
 RETURN public._totem_payment_response(v_order,v_device,v_tenant)||jsonb_build_object('idempotent',false);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
