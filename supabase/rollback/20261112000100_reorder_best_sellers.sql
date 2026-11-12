BEGIN;
DROP FUNCTION public.get_session_reorder_items(uuid);
DROP FUNCTION public.get_menu_best_sellers(uuid);
DROP FUNCTION public.set_menu_best_seller_settings(uuid,boolean,uuid[]);
DROP FUNCTION public.get_menu_best_seller_settings(uuid);
DROP INDEX public.menu_best_sellers_items_idx;
DROP INDEX public.menu_session_reorder_idx;
DROP INDEX public.menu_best_sellers_orders_idx;
DROP TABLE public.menu_best_seller_settings;
CREATE OR REPLACE FUNCTION public.create_totem_order(p_token text,p_items jsonb,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_device uuid;v_tenant uuid;v_label text;v_existing uuid;v_order uuid;
 v_item jsonb;v_pid uuid;v_qty integer;v_name text;v_price numeric(10,2);
 v_total numeric(10,2):=0;v_notes text;v_timeout integer;v_provider text;v_result jsonb;
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
 CREATE TEMP TABLE IF NOT EXISTS _totem_order_lines(product_id uuid,product_name text,quantity integer,unit_price numeric(10,2),total_price numeric(10,2),notes text) ON COMMIT DROP;
 DELETE FROM _totem_order_lines;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF jsonb_typeof(v_item)<>'object' THEN RAISE EXCEPTION 'INVALID_TOTEM_ORDER' USING ERRCODE='22023'; END IF;
  BEGIN v_pid:=(v_item->>'productId')::uuid;v_qty:=(v_item->>'quantity')::integer;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_TOTEM_ORDER' USING ERRCODE='22023'; END;
  IF v_qty IS NULL OR v_qty NOT BETWEEN 1 AND 99 THEN RAISE EXCEPTION 'INVALID_TOTEM_ORDER' USING ERRCODE='22023'; END IF;
  v_notes:=nullif(btrim(coalesce(v_item->>'notes','')),'');
  IF length(coalesce(v_notes,''))>200 THEN RAISE EXCEPTION 'INVALID_TOTEM_ORDER' USING ERRCODE='22023'; END IF;
  v_name:=NULL;v_price:=NULL;
  SELECT name,price INTO v_name,v_price FROM public.products WHERE id=v_pid AND tenant_id=v_tenant AND is_active;
  IF v_name IS NULL OR v_price IS NULL THEN RAISE EXCEPTION 'INVALID_TOTEM_ORDER: produto indisponível' USING ERRCODE='22023'; END IF;
  INSERT INTO _totem_order_lines VALUES(v_pid,v_name,v_qty,v_price,v_qty*v_price,v_notes);
  v_total:=v_total+v_qty*v_price;
 END LOOP;
 SELECT coalesce(timeout_seconds,240),coalesce(provider,'manual') INTO v_timeout,v_provider
 FROM public.totem_payment_settings WHERE tenant_id=v_tenant;
 v_timeout:=coalesce(v_timeout,240);v_provider:=coalesce(v_provider,'manual');
 -- All automated terminal adapters are disabled until an authenticated backend exists.
 IF v_provider<>'manual' THEN v_provider:='manual'; END IF;
 INSERT INTO public.orders(tenant_id,customer_name,customer_phone,delivery_address,subtotal,delivery_fee,discount,total_amount,payment_method,payment_status,fulfillment_type,status,notes,origin,totem_device_id,idempotency_key,awaiting_online_payment)
 VALUES(v_tenant,'Totem','-','Totem do salão',v_total,0,0,v_total,'CASH','PENDING','PICKUP','PENDING','Aguardando pagamento na maquininha','direct',v_device,p_idempotency_key,true)
 RETURNING id INTO v_order;
 INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price,notes)
 SELECT v_order,product_id,product_name,quantity,unit_price,total_price,notes FROM _totem_order_lines;
 INSERT INTO public.totem_payment_attempts(tenant_id,order_id,device_id,provider,amount,expires_at)
 VALUES(v_tenant,v_order,v_device,v_provider,v_total,now()+make_interval(secs=>v_timeout));
 RETURN public._totem_payment_response(v_order,v_device,v_tenant)||jsonb_build_object('idempotent',false);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
