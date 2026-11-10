-- Entrega 3: etapa segura de pagamento presencial do totem (sem TEF).
-- Estados de pedido: PENDING/PENDING = aguardando pagamento; CONFIRMED/PAID = aprovado.
BEGIN;

CREATE TABLE IF NOT EXISTS public.totem_payment_settings (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
 provider text NOT NULL DEFAULT 'manual' CHECK (provider IN ('manual','mercadopago_point','pagbank','infinitepay')),
 timeout_seconds integer NOT NULL DEFAULT 240 CHECK (timeout_seconds BETWEEN 120 AND 300),
 auto_print_totem boolean NOT NULL DEFAULT false,
 auto_print_store boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.totem_payment_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
 device_id uuid NOT NULL REFERENCES public.totem_devices(id),
 provider text NOT NULL CHECK (provider IN ('manual','mercadopago_point','pagbank','infinitepay')),
 status text NOT NULL DEFAULT 'awaiting' CHECK (status IN ('awaiting','approved','expired','cancelled','declined')),
 amount numeric(10,2) NOT NULL CHECK (amount >= 0),
 expires_at timestamptz NOT NULL,
 approved_at timestamptz,
 approved_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_totem_attempts_tenant_status ON public.totem_payment_attempts(tenant_id,status,expires_at);
ALTER TABLE public.totem_payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.totem_payment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.totem_payment_settings,public.totem_payment_attempts FROM PUBLIC,anon,authenticated,service_role;

-- Only genuine paid totem orders may acquire a pickup code. Existing non-totem flows unchanged.
CREATE OR REPLACE FUNCTION public._orders_pickup_arrival_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.fulfillment_type='PICKUP' AND NEW.status NOT IN ('DELIVERED','CANCELLED')
    AND (NEW.totem_device_id IS NULL OR (NEW.payment_status='PAID' AND NEW.status IN ('CONFIRMED','PREPARING','READY'))) THEN
   INSERT INTO public.pickup_arrivals(order_id,tenant_id,pickup_code)
   VALUES(NEW.id,NEW.tenant_id,public._new_pickup_code(NEW.tenant_id))
   ON CONFLICT(order_id) DO NOTHING;
 END IF;
 IF TG_OP='UPDATE' AND NEW.status IN ('DELIVERED','CANCELLED') AND OLD.status IS DISTINCT FROM NEW.status THEN
   UPDATE public.pickup_arrivals SET closed_at=coalesce(closed_at,now()) WHERE order_id=NEW.id;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_totem_arrival_payment_approved ON public.orders;
CREATE TRIGGER trg_totem_arrival_payment_approved AFTER UPDATE OF payment_status ON public.orders
 FOR EACH ROW WHEN (NEW.totem_device_id IS NOT NULL AND NEW.payment_status='PAID')
 EXECUTE FUNCTION public._orders_pickup_arrival_sync();

-- Prevent staff, legacy payment RPCs or the totem from marking an unpaid totem order paid.
CREATE OR REPLACE FUNCTION public._totem_payment_transition_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.totem_device_id IS NOT NULL AND NEW.payment_status IS DISTINCT FROM OLD.payment_status
    AND NEW.payment_status='PAID'
    AND current_setting('dc.totem_approve_order',true) IS DISTINCT FROM OLD.id::text THEN
   RAISE EXCEPTION 'TOTEM_PAYMENT_FORBIDDEN: use o fluxo de aprovação do servidor.' USING ERRCODE='42501';
 END IF;
 IF OLD.totem_device_id IS NOT NULL AND OLD.payment_status<>'PAID' AND NEW.status NOT IN ('PENDING','CANCELLED')
    AND current_setting('dc.totem_approve_order',true) IS DISTINCT FROM OLD.id::text THEN
   RAISE EXCEPTION 'TOTEM_PAYMENT_REQUIRED' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_totem_payment_transition_guard ON public.orders;
CREATE TRIGGER zz_totem_payment_transition_guard BEFORE UPDATE OF status,payment_status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._totem_payment_transition_guard();

CREATE OR REPLACE FUNCTION public._totem_approve_payment(p_order uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; a public.totem_payment_attempts%ROWTYPE; v_code text;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 SELECT * INTO a FROM public.totem_payment_attempts WHERE order_id=p_order FOR UPDATE;
 IF o.id IS NULL OR a.id IS NULL OR o.tenant_id<>a.tenant_id OR o.totem_device_id<>a.device_id THEN
  RAISE EXCEPTION 'TOTEM_ORDER_NOT_FOUND' USING ERRCODE='42501';
 END IF;
 IF a.status='approved' AND o.payment_status='PAID' THEN
  SELECT pickup_code INTO v_code FROM public.pickup_arrivals WHERE order_id=p_order;
  RETURN jsonb_build_object('ok',true,'orderId',p_order,'pickupCode',v_code,'idempotent',true);
 END IF;
 IF a.status<>'awaiting' OR a.expires_at<=now() OR o.status='CANCELLED' OR o.payment_status<>'PENDING' THEN
  RAISE EXCEPTION 'TOTEM_PAYMENT_EXPIRED_OR_CANCELLED' USING ERRCODE='42501';
 END IF;
 PERFORM set_config('dc.totem_approve_order',p_order::text,true);
 UPDATE public.orders SET payment_status='PAID',status='CONFIRMED',updated_at=now() WHERE id=p_order;
 PERFORM set_config('dc.totem_approve_order','',true);
 UPDATE public.totem_payment_attempts SET status='approved',approved_at=now(),approved_by=p_actor,updated_at=now() WHERE id=a.id;
 SELECT pickup_code INTO v_code FROM public.pickup_arrivals WHERE order_id=p_order;
 IF v_code IS NULL THEN RAISE EXCEPTION 'TOTEM_PICKUP_CODE_MISSING'; END IF;
 INSERT INTO public.order_status_history(order_id,status,note,changed_by)
 VALUES(p_order,'CONFIRMED','Pagamento presencial aprovado','totem-payment');
 RETURN jsonb_build_object('ok',true,'orderId',p_order,'pickupCode',v_code,'idempotent',false);
END $$;

-- The same order is returned on retry, always scoped to the original device.
CREATE OR REPLACE FUNCTION public._totem_payment_response(p_order uuid,p_device uuid,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; a public.totem_payment_attempts%ROWTYPE; v_code text; v_status text;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order AND tenant_id=p_tenant AND totem_device_id=p_device;
 SELECT * INTO a FROM public.totem_payment_attempts WHERE order_id=p_order AND tenant_id=p_tenant AND device_id=p_device;
 IF o.id IS NULL OR a.id IS NULL THEN RAISE EXCEPTION 'TOTEM_ORDER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF a.status='awaiting' AND a.expires_at<=now() THEN
   UPDATE public.totem_payment_attempts SET status='expired',updated_at=now() WHERE id=a.id AND status='awaiting';
   UPDATE public.orders SET status='CANCELLED',updated_at=now() WHERE id=p_order AND status<>'CANCELLED' AND payment_status<>'PAID';
   v_status:='expired';
 ELSE
   v_status:=a.status;
 END IF;
 IF o.payment_status='PAID' AND v_status='approved' THEN
   SELECT pickup_code INTO v_code FROM public.pickup_arrivals WHERE order_id=p_order AND closed_at IS NULL;
 END IF;
 RETURN jsonb_strip_nulls(jsonb_build_object(
   'ok',true,'orderId',p_order,'total',o.total_amount,
   'paymentStatus',CASE WHEN v_status='approved' THEN 'PAID' WHEN v_status='awaiting' THEN 'PENDING' ELSE upper(v_status) END,
   'paymentLabel',CASE WHEN v_status='awaiting' THEN 'Pague na maquininha ao lado' WHEN v_status='approved' THEN 'Pagamento aprovado' ELSE 'Pagamento não concluído' END,
   'pickupCode',v_code,
   'autoPrint',coalesce((SELECT auto_print_totem FROM public.totem_payment_settings WHERE tenant_id=p_tenant),false),
   'expiresAt',a.expires_at));
END $$;

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
  IF v_qty NOT BETWEEN 1 AND 99 THEN RAISE EXCEPTION 'INVALID_TOTEM_ORDER' USING ERRCODE='22023'; END IF;
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
 INSERT INTO public.orders(tenant_id,customer_name,customer_phone,delivery_address,subtotal,delivery_fee,discount,total_amount,payment_method,payment_status,fulfillment_type,status,notes,origin,totem_device_id,idempotency_key)
 VALUES(v_tenant,'Totem','-','Totem do salão',v_total,0,0,v_total,'CASH','PENDING','PICKUP','PENDING','Aguardando pagamento na maquininha','direct',v_device,p_idempotency_key)
 RETURNING id INTO v_order;
 INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price,notes)
 SELECT v_order,product_id,product_name,quantity,unit_price,total_price,notes FROM _totem_order_lines;
 INSERT INTO public.totem_payment_attempts(tenant_id,order_id,device_id,provider,amount,expires_at)
 VALUES(v_tenant,v_order,v_device,v_provider,v_total,now()+make_interval(secs=>v_timeout));
 RETURN public._totem_payment_response(v_order,v_device,v_tenant)||jsonb_build_object('idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.get_totem_payment_status(p_token text,p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_device uuid;v_tenant uuid;v_label text;
BEGIN
 SELECT d.o_device,d.o_tenant,d.o_label INTO v_device,v_tenant,v_label FROM public._totem_device_ok(p_token) d;
 IF NOT public._rate_limit_hit('totem_payment_status',v_device::text,v_tenant,90,300) THEN
  RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='P0001';
 END IF;
 RETURN public._totem_payment_response(p_order_id,v_device,v_tenant);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_totem_payment(p_token text,p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_device uuid;v_tenant uuid;v_label text;v_row public.totem_payment_attempts%ROWTYPE;
BEGIN
 SELECT d.o_device,d.o_tenant,d.o_label INTO v_device,v_tenant,v_label FROM public._totem_device_ok(p_token) d;
 SELECT * INTO v_row FROM public.totem_payment_attempts
 WHERE order_id=p_order_id AND device_id=v_device AND tenant_id=v_tenant FOR UPDATE;
 IF v_row.id IS NULL THEN RAISE EXCEPTION 'TOTEM_ORDER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF v_row.status='approved' THEN RAISE EXCEPTION 'TOTEM_ALREADY_PAID' USING ERRCODE='42501'; END IF;
 UPDATE public.totem_payment_attempts SET status='cancelled',updated_at=now() WHERE id=v_row.id AND status='awaiting';
 UPDATE public.orders SET status='CANCELLED',updated_at=now() WHERE id=p_order_id AND payment_status<>'PAID' AND status<>'CANCELLED';
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.confirm_manual_totem_payment(p_order_id uuid,p_terminal text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tenant uuid;v_role text;v_result jsonb;v_provider text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT tenant_id,provider INTO v_tenant,v_provider FROM public.totem_payment_attempts WHERE order_id=p_order_id;
 IF v_tenant IS NULL OR v_provider<>'manual' THEN RAISE EXCEPTION 'TOTEM_ORDER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 v_role:=public._tenant_role_of_caller(v_tenant);
 IF v_role NOT IN ('OWNER','MANAGER','CASHIER') OR v_role IS NULL THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 v_result:=public._totem_approve_payment(p_order_id,auth.uid());
 PERFORM public.log_audit_event('TOTEM_MANUAL_PAYMENT','orders',
   'Confirmação presencial no PDV' || CASE WHEN nullif(btrim(coalesce(p_terminal,'')),'') IS NOT NULL THEN ' - terminal: ' || left(regexp_replace(p_terminal,'[^a-zA-Z0-9_-]','','g'),32) ELSE '' END,p_order_id::text,'PENDING','PAID',v_tenant);
 RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.get_totem_payment_settings(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role text;
BEGIN
 v_role:=public._tenant_role_of_caller(p_tenant);
 IF v_role NOT IN ('OWNER','MANAGER') OR v_role IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('provider',coalesce((SELECT provider FROM public.totem_payment_settings WHERE tenant_id=p_tenant),'manual'),
 'timeoutSeconds',coalesce((SELECT timeout_seconds FROM public.totem_payment_settings WHERE tenant_id=p_tenant),240),
 'autoPrintTotem',coalesce((SELECT auto_print_totem FROM public.totem_payment_settings WHERE tenant_id=p_tenant),false),
 'autoPrintStore',coalesce((SELECT auto_print_store FROM public.totem_payment_settings WHERE tenant_id=p_tenant),false));
END $$;

CREATE OR REPLACE FUNCTION public.set_totem_payment_settings(p_tenant uuid,p_provider text,p_timeout_seconds integer,p_auto_print_totem boolean,p_auto_print_store boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role text;
BEGIN
 v_role:=public._tenant_role_of_caller(p_tenant);
 IF v_role NOT IN ('OWNER','MANAGER') OR v_role IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_provider NOT IN ('manual','mercadopago_point','pagbank','infinitepay') OR p_timeout_seconds NOT BETWEEN 120 AND 300 THEN
  RAISE EXCEPTION 'INVALID_TOTEM_SETTINGS' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.totem_payment_settings(tenant_id,provider,timeout_seconds,auto_print_totem,auto_print_store,updated_at)
 VALUES(p_tenant,p_provider,p_timeout_seconds,coalesce(p_auto_print_totem,false),coalesce(p_auto_print_store,false),now())
 ON CONFLICT(tenant_id) DO UPDATE SET provider=excluded.provider,timeout_seconds=excluded.timeout_seconds,
 auto_print_totem=excluded.auto_print_totem,auto_print_store=excluded.auto_print_store,updated_at=now();
 RETURN public.get_totem_payment_settings(p_tenant);
END $$;

CREATE OR REPLACE FUNCTION public.list_pending_totem_payments(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role text;v_result jsonb;
BEGIN
 v_role:=public._tenant_role_of_caller(p_tenant);
 IF v_role IS NULL OR v_role NOT IN ('OWNER','MANAGER','OPERATOR','CASHIER') THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('orderId',o.id,'total',o.total_amount,
  'createdAt',a.created_at,'expiresAt',a.expires_at,'status',a.status)
  ORDER BY a.created_at DESC),'[]'::jsonb) INTO v_result
 FROM public.totem_payment_attempts a JOIN public.orders o ON o.id=a.order_id AND o.tenant_id=a.tenant_id
 WHERE a.tenant_id=p_tenant AND a.provider='manual' AND a.status='awaiting'
 AND a.expires_at>now() AND o.payment_status='PENDING' AND o.status='PENDING';
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public._orders_pickup_arrival_sync(),public._totem_payment_transition_guard(),
 public._totem_approve_payment(uuid,uuid),public._totem_payment_response(uuid,uuid,uuid),
 public.create_totem_order(text,jsonb,uuid),public.get_totem_payment_status(text,uuid),
 public.cancel_totem_payment(text,uuid),public.confirm_manual_totem_payment(uuid,text),
 public.get_totem_payment_settings(uuid),public.set_totem_payment_settings(uuid,text,integer,boolean,boolean),public.list_pending_totem_payments(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_totem_order(text,jsonb,uuid),
 public.get_totem_payment_status(text,uuid),public.cancel_totem_payment(text,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_manual_totem_payment(uuid,text),
 public.get_totem_payment_settings(uuid),public.set_totem_payment_settings(uuid,text,integer,boolean,boolean),public.list_pending_totem_payments(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
