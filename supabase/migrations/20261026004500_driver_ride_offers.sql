-- Ofertas não atribuem pedidos. Nenhum backfill: corridas em andamento mantêm seus códigos.
BEGIN;
ALTER TABLE public.tenant_settings ADD COLUMN driver_offer_timeout_seconds integer NOT NULL DEFAULT 60
 CHECK (driver_offer_timeout_seconds BETWEEN 20 AND 300);
CREATE TABLE public.order_driver_offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 order_id uuid NOT NULL REFERENCES public.orders(id),
 driver_user_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'OFFERED' CHECK (status IN ('OFFERED','ACCEPTED','DECLINED','EXPIRED','CANCELLED')),
 offered_by uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 responded_at timestamptz
);
CREATE UNIQUE INDEX order_driver_offers_live_order ON public.order_driver_offers(order_id) WHERE status='OFFERED';
CREATE UNIQUE INDEX order_driver_offers_live_driver ON public.order_driver_offers(driver_user_id) WHERE status='OFFERED';
CREATE INDEX order_driver_offers_order_history ON public.order_driver_offers(tenant_id,order_id,created_at DESC);
CREATE INDEX order_driver_offers_expiry ON public.order_driver_offers(expires_at) WHERE status='OFFERED';
ALTER TABLE public.order_driver_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_driver_offers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.order_driver_offers TO authenticated;
CREATE POLICY order_driver_offers_select ON public.order_driver_offers FOR SELECT TO authenticated USING (
 public._pr_b_staff(tenant_id,ARRAY['OWNER','MANAGER','OPERATOR','CASHIER','DELIVERY_MANAGER'])
 OR (driver_user_id=auth.uid() AND public._pr_b_staff(tenant_id,ARRAY['DRIVER'])));

-- Uma única definição da elegibilidade e da ordem: última corrida, nulos primeiro, id.
CREATE FUNCTION public._driver_offer_queue(p_tenant uuid,p_order uuid DEFAULT NULL)
RETURNS TABLE(id uuid,user_id uuid,name text,last_ride timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT d.id,d.user_id,split_part(d.full_name,' ',1),
 (SELECT max(coalesce(o.delivered_at,o.driver_accepted_at,o.created_at)) FROM public.orders o WHERE NOT o.awaiting_online_payment AND o.tenant_id=p_tenant AND o.driver_id=d.user_id) AS last_ride
 FROM public.drivers d JOIN public.tenants t ON t.id=d.tenant_id AND t.status='ACTIVE'
 WHERE d.tenant_id=p_tenant AND d.approval_status='APPROVED' AND d.status='AVAILABLE'
 AND EXISTS(SELECT 1 FROM public.tenant_users u WHERE u.tenant_id=p_tenant AND u.user_id=d.user_id AND u.role_id='DRIVER' AND u.status='ACTIVE')
 AND NOT EXISTS(SELECT 1 FROM public.orders o WHERE NOT o.awaiting_online_payment AND o.driver_id=d.user_id AND o.status IN ('READY','WAITING_FOR_DRIVER','OUT_FOR_DELIVERY'))
 AND NOT EXISTS(SELECT 1 FROM public.order_driver_offers f WHERE f.driver_user_id=d.user_id AND f.status='OFFERED')
 AND (p_order IS NULL OR NOT EXISTS(SELECT 1 FROM public.order_driver_offers f WHERE f.order_id=p_order AND f.driver_user_id=d.user_id AND f.status IN ('DECLINED','EXPIRED')))
 ORDER BY last_ride NULLS FIRST,d.id;
$$;
CREATE OR REPLACE FUNCTION public.get_dispatch_queue(p_tenant_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public._pr_b_staff(p_tenant_id,ARRAY['OWNER','MANAGER','DELIVERY_MANAGER']) THEN RAISE EXCEPTION 'FORBIDDEN: acesso não permitido.' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('mode',(SELECT dispatch_mode FROM public.tenant_settings WHERE tenant_id=p_tenant_id),
 'timeoutSeconds',(SELECT driver_offer_timeout_seconds FROM public.tenant_settings WHERE tenant_id=p_tenant_id),
 'drivers',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.last_ride NULLS FIRST,q.id),'[]') FROM public._driver_offer_queue(p_tenant_id) q));
END $$;
CREATE FUNCTION public.set_driver_offer_timeout(p_tenant_id uuid,p_seconds integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public._pr_b_staff(p_tenant_id,ARRAY['OWNER','MANAGER']) THEN RAISE EXCEPTION 'FORBIDDEN: acesso não permitido.' USING ERRCODE='42501'; END IF;
 IF p_seconds IS NULL OR p_seconds NOT BETWEEN 20 AND 300 THEN RAISE EXCEPTION 'INVALID_TIMEOUT: informe entre 20 e 300 segundos.'; END IF;
 UPDATE public.tenant_settings SET driver_offer_timeout_seconds=p_seconds WHERE tenant_id=p_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'SETTINGS_NOT_FOUND: configuração não encontrada.'; END IF;
END $$;

-- Interna: sempre pedido → entregador → oferta. Chamada também pelo cron, sem impersonar staff.
CREATE FUNCTION public._create_driver_offer(p_order uuid,p_driver uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; d public.drivers; s public.tenant_settings; v_id uuid; v_expires timestamptz;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR o.status<>'READY' OR o.fulfillment_type<>'DELIVERY' OR o.driver_id IS NOT NULL THEN
  RETURN jsonb_build_object('success',false,'error','ORDER_NOT_READY'); END IF;
 IF o.awaiting_online_payment THEN RETURN jsonb_build_object('success',false,'error','PAYMENT_REQUIRED'); END IF;
 IF EXISTS(SELECT 1 FROM public.order_driver_offers WHERE order_id=p_order AND status='OFFERED') THEN
  RETURN jsonb_build_object('success',false,'error','OFFER_ALREADY_EXISTS'); END IF;
 SELECT * INTO s FROM public.tenant_settings WHERE tenant_id=o.tenant_id;
 IF s.dispatch_mode='AUTO_QUEUE' THEN
  SELECT driver.* INTO d FROM public._driver_offer_queue(o.tenant_id,p_order) q
  JOIN public.drivers driver ON driver.id=q.id
  ORDER BY q.last_ride NULLS FIRST,q.id LIMIT 1 FOR UPDATE OF driver SKIP LOCKED;
 ELSE
  IF p_driver IS NULL THEN RETURN jsonb_build_object('success',false,'error','DRIVER_REQUIRED'); END IF;
  SELECT * INTO d FROM public.drivers WHERE user_id=p_driver AND tenant_id=o.tenant_id FOR UPDATE;
 END IF;
 IF d.id IS NULL THEN RETURN jsonb_build_object('success',false,'error',CASE WHEN s.dispatch_mode='AUTO_QUEUE' THEN 'NO_DRIVER_IN_QUEUE' ELSE 'DRIVER_NOT_FOUND' END); END IF;
 -- Revalidar depois de obter o lock, inclusive vínculo e reservas feitas por outra transação.
 IF NOT EXISTS(SELECT 1 FROM public._driver_offer_queue(o.tenant_id,CASE WHEN s.dispatch_mode='AUTO_QUEUE' THEN p_order END) q WHERE q.id=d.id) THEN
  IF s.dispatch_mode='AUTO_QUEUE' THEN RETURN public._create_driver_offer(p_order); END IF;
  RETURN jsonb_build_object('success',false,'error','DRIVER_BUSY'); END IF;
 v_expires:=clock_timestamp()+make_interval(secs=>s.driver_offer_timeout_seconds);
 BEGIN
  INSERT INTO public.order_driver_offers(tenant_id,order_id,driver_user_id,offered_by,expires_at)
  VALUES(o.tenant_id,p_order,d.user_id,auth.uid(),v_expires) RETURNING id INTO v_id;
 EXCEPTION WHEN unique_violation THEN
  -- Outra loja pode ter reservado o mesmo usuário em outro vínculo de motorista.
  IF s.dispatch_mode='AUTO_QUEUE' THEN RETURN public._create_driver_offer(p_order); END IF;
  RETURN jsonb_build_object('success',false,'error','DRIVER_BUSY');
 END;
 INSERT INTO public.order_status_history(order_id,status,note,changed_by,created_at)
 VALUES(p_order,'DRIVER_OFFERED','Procurando entregador','Loja',clock_timestamp());
 PERFORM public.log_audit_event('DRIVER_OFFERED','orders','Chamada enviada ao entregador',p_order::text,NULL,NULL,o.tenant_id);
 RETURN jsonb_build_object('success',true,'offered',true,'offerId',v_id,'expiresAt',v_expires);
END $$;

CREATE FUNCTION public._advance_driver_offer(p_order uuid,p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; result jsonb; title text;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR o.status<>'READY' OR o.driver_id IS NOT NULL OR o.awaiting_online_payment THEN RETURN; END IF;
 title:=CASE WHEN p_status='DECLINED' THEN 'Entregador recusou' ELSE 'Entregador não respondeu' END;
 INSERT INTO public.order_status_history(order_id,status,note,changed_by,created_at)
 VALUES(p_order,'DRIVER_OFFER_'||p_status,title,'Sistema',clock_timestamp());
 IF (SELECT dispatch_mode FROM public.tenant_settings WHERE tenant_id=o.tenant_id)='AUTO_QUEUE' THEN
  result:=public._create_driver_offer(p_order);
  IF result->>'error'='NO_DRIVER_IN_QUEUE' THEN
   title:='Nenhum entregador aceitou';
   INSERT INTO public.order_status_history(order_id,status,note,changed_by,created_at)
   VALUES(p_order,'DRIVER_QUEUE_EMPTY',title,'Sistema',clock_timestamp());
  END IF;
 END IF;
 -- Usa o tipo de notificação de pedido existente, sem alterar a retenção ou o histórico.
 INSERT INTO public.owner_notifications(tenant_id,kind,ref_id,title) VALUES(o.tenant_id,'ORDER_MESSAGE',p_order,title);
END $$;

CREATE FUNCTION public.expire_driver_offers() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o record; f record; n integer:=0;
BEGIN
 -- SKIP LOCKED evita esperar um pedido já em aceite/cancelamento por outra sessão.
 FOR o IN SELECT ord.id FROM public.orders ord WHERE EXISTS(
  SELECT 1 FROM public.order_driver_offers x WHERE x.order_id=ord.id AND x.status='OFFERED' AND x.expires_at<=clock_timestamp())
  ORDER BY ord.id FOR UPDATE OF ord SKIP LOCKED LOOP
  SELECT * INTO f FROM public.order_driver_offers WHERE order_id=o.id AND status='OFFERED' AND expires_at<=clock_timestamp();
  IF NOT FOUND THEN CONTINUE; END IF;
  -- O lock do entregador vem antes do lock/UPDATE da oferta, assim como no aceite.
  PERFORM 1 FROM public.drivers WHERE tenant_id=f.tenant_id AND user_id=f.driver_user_id FOR UPDATE;
  UPDATE public.order_driver_offers SET status='EXPIRED',responded_at=clock_timestamp()
   WHERE id=f.id AND status='OFFERED' AND expires_at<=clock_timestamp();
  IF FOUND THEN n:=n+1; PERFORM public._advance_driver_offer(o.id,'EXPIRED'); END IF;
 END LOOP;
 RETURN n;
END $$;
CREATE FUNCTION public.offer_order_to_driver(p_order_id uuid,p_driver_user_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE='42501'; END IF;
 PERFORM public.expire_driver_offers();
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR NOT public._pr_b_staff(o.tenant_id,ARRAY['OWNER','MANAGER','DELIVERY_MANAGER']) THEN
  RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE='42501'; END IF;
 RETURN public._create_driver_offer(p_order_id,p_driver_user_id);
END $$;
CREATE FUNCTION public.driver_respond_offer(p_offer_id uuid,p_accept boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.order_driver_offers; o public.orders; d public.drivers; v_code text; v_previous text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE='42501'; END IF;
 -- Autorizar antes da expiração global e de qualquer acesso ao pedido.
 SELECT * INTO f FROM public.order_driver_offers WHERE id=p_offer_id AND driver_user_id=auth.uid();
 IF NOT FOUND OR NOT public._pr_b_staff(f.tenant_id,ARRAY['DRIVER']) THEN RAISE EXCEPTION 'OFFER_NOT_FOUND: chamada não encontrada.' USING ERRCODE='42501'; END IF;
 PERFORM public.expire_driver_offers();
 SELECT * INTO o FROM public.orders WHERE id=f.order_id FOR UPDATE;
 SELECT * INTO d FROM public.drivers WHERE tenant_id=f.tenant_id AND user_id=auth.uid() FOR UPDATE;
 SELECT * INTO f FROM public.order_driver_offers WHERE id=p_offer_id FOR UPDATE;
 IF NOT public._pr_b_staff(f.tenant_id,ARRAY['DRIVER']) THEN RAISE EXCEPTION 'OFFER_NOT_FOUND: chamada não encontrada.' USING ERRCODE='42501'; END IF;
 IF f.status='EXPIRED' THEN RETURN jsonb_build_object('success',false,'error','OFFER_EXPIRED'); END IF;
 IF f.status<>'OFFERED' THEN RETURN jsonb_build_object('success',false,'error','OFFER_NOT_FOUND'); END IF;
 IF f.expires_at<=clock_timestamp() THEN
  UPDATE public.order_driver_offers SET status='EXPIRED',responded_at=clock_timestamp() WHERE id=f.id;
  PERFORM public._advance_driver_offer(f.order_id,'EXPIRED');
  RETURN jsonb_build_object('success',false,'error','OFFER_EXPIRED');
 END IF;
 IF p_accept IS NULL THEN RAISE EXCEPTION 'INVALID_RESPONSE: informe aceite ou recusa.'; END IF;
 IF o.status<>'READY' OR o.driver_id IS NOT NULL OR o.awaiting_online_payment THEN
  RETURN jsonb_build_object('success',false,'error','ORDER_NOT_READY'); END IF;
 IF NOT p_accept THEN
  UPDATE public.order_driver_offers SET status='DECLINED',responded_at=clock_timestamp() WHERE id=f.id;
  PERFORM public._advance_driver_offer(f.order_id,'DECLINED');
  PERFORM public.log_audit_event('DRIVER_OFFER_DECLINED','orders','Entregador recusou a chamada',o.id::text,NULL,NULL,o.tenant_id);
  RETURN jsonb_build_object('success',true,'accepted',false);
 END IF;
 IF d.id IS NULL OR d.status<>'AVAILABLE' OR d.approval_status<>'APPROVED' OR EXISTS(
  SELECT 1 FROM public.orders WHERE driver_id=auth.uid() AND status IN ('READY','WAITING_FOR_DRIVER','OUT_FOR_DELIVERY')) THEN
  RETURN jsonb_build_object('success',false,'error','DRIVER_BUSY'); END IF;
 SELECT pickup_code INTO v_previous FROM public.order_handoff_codes WHERE order_id=o.id FOR UPDATE;
 LOOP v_code:=public._handoff_code(); EXIT WHEN v_code IS DISTINCT FROM v_previous; END LOOP;
 INSERT INTO public.order_handoff_codes(order_id,tenant_id,pickup_code,pickup_attempts,pickup_confirmed_at)
 VALUES(o.id,o.tenant_id,v_code,0,NULL) ON CONFLICT(order_id) DO UPDATE
 SET pickup_code=excluded.pickup_code,pickup_attempts=0,pickup_confirmed_at=NULL;
 UPDATE public.order_driver_offers SET status='ACCEPTED',responded_at=clock_timestamp() WHERE id=f.id;
 UPDATE public.orders SET driver_id=auth.uid(),driver_accepted_at=clock_timestamp(),status='WAITING_FOR_DRIVER',updated_at=clock_timestamp() WHERE id=o.id;
 UPDATE public.drivers SET status='ON_DELIVERY',updated_at=clock_timestamp() WHERE id=d.id;
 INSERT INTO public.order_status_history(order_id,status,note,changed_by,created_at)
 VALUES(o.id,'DRIVER_ACCEPTED','Entregador aceitou a chamada','Entregador',clock_timestamp());
 PERFORM public.log_audit_event('DRIVER_OFFER_ACCEPTED','orders','Chamada aceita pelo entregador',o.id::text,NULL,NULL,o.tenant_id);
 RETURN jsonb_build_object('success',true,'accepted',true,'orderId',o.id,'orderStatus','WAITING_FOR_DRIVER');
END $$;
CREATE FUNCTION public.get_my_driver_offers() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE='42501'; END IF;
 PERFORM public.expire_driver_offers();
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'tenant_id',f.tenant_id,'order_id',f.order_id,
 'order_number',o.order_number,'store_name',t.name,'neighborhood',coalesce(o.address_details->>'neighborhood','Bairro não informado'),
 'delivery_fee',o.delivery_fee,'expires_at',f.expires_at) ORDER BY f.created_at),'[]')
 FROM public.order_driver_offers f JOIN public.orders o ON o.id=f.order_id AND o.tenant_id=f.tenant_id
 JOIN public.tenants t ON t.id=f.tenant_id WHERE f.driver_user_id=auth.uid() AND f.status='OFFERED'
 AND f.expires_at>clock_timestamp() AND public._pr_b_staff(f.tenant_id,ARRAY['DRIVER'])
 AND EXISTS(SELECT 1 FROM public.drivers d WHERE d.user_id=auth.uid() AND d.tenant_id=f.tenant_id AND d.approval_status='APPROVED' AND d.status='AVAILABLE'));
END $$;
CREATE FUNCTION public.cancel_driver_offer(p_offer_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.order_driver_offers;
BEGIN
 SELECT * INTO f FROM public.order_driver_offers WHERE id=p_offer_id;
 IF NOT FOUND OR NOT public._pr_b_staff(f.tenant_id,ARRAY['OWNER','MANAGER','DELIVERY_MANAGER']) THEN
  RAISE EXCEPTION 'OFFER_NOT_FOUND: chamada não encontrada.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.orders WHERE id=f.order_id FOR UPDATE;
 PERFORM 1 FROM public.drivers WHERE user_id=f.driver_user_id AND tenant_id=f.tenant_id FOR UPDATE;
 UPDATE public.order_driver_offers SET status='CANCELLED',responded_at=clock_timestamp() WHERE id=p_offer_id AND status='OFFERED';
 IF FOUND THEN
  INSERT INTO public.order_status_history(order_id,status,note,changed_by,created_at) VALUES(f.order_id,'DRIVER_OFFER_CANCELLED','Chamada cancelada pela loja','Loja',clock_timestamp());
  PERFORM public.log_audit_event('DRIVER_OFFER_CANCELLED','orders','Chamada cancelada pela loja',f.order_id::text,NULL,NULL,f.tenant_id);
 END IF;
 RETURN jsonb_build_object('success',true);
END $$;
CREATE OR REPLACE FUNCTION public.assign_order_to_driver(p_order_id uuid,p_driver_user_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT public.offer_order_to_driver(p_order_id,p_driver_user_id); $$;
CREATE OR REPLACE FUNCTION public.driver_accept_order(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid;
BEGIN
 SELECT id INTO f FROM public.order_driver_offers WHERE order_id=p_order_id AND driver_user_id=auth.uid() AND status='OFFERED';
 IF f IS NULL THEN RAISE EXCEPTION 'OWNER_DISPATCH_REQUIRED: aguarde a loja chamar você.' USING ERRCODE='42501'; END IF;
 RETURN public.driver_respond_offer(f,true);
END $$;
CREATE FUNCTION public._orders_cancel_driver_offers() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status<>'READY' OR NEW.driver_id IS NOT NULL OR NEW.awaiting_online_payment THEN
  UPDATE public.order_driver_offers SET status='CANCELLED',responded_at=clock_timestamp() WHERE order_id=NEW.id AND status='OFFERED';
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER orders_cancel_driver_offers AFTER UPDATE OF status,driver_id,awaiting_online_payment ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._orders_cancel_driver_offers();

-- Revoga inclusive ACLs herdadas de ALTER DEFAULT PRIVILEGES.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT oid::regprocedure AS sig,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY[
 '_driver_offer_queue','_create_driver_offer','_advance_driver_offer','_orders_cancel_driver_offers',
 'get_dispatch_queue','set_driver_offer_timeout','expire_driver_offers','offer_order_to_driver',
 'driver_respond_offer','get_my_driver_offers','cancel_driver_offer','assign_order_to_driver','driver_accept_order']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.sig);
  IF left(r.proname,1)<>'_' THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.sig);
  ELSE
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role',r.sig);
  END IF;
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.expire_driver_offers() TO service_role;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_driver_offers;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  BEGIN PERFORM cron.schedule('driver-ride-offers-expiry','30 seconds','SELECT public.expire_driver_offers()');
  EXCEPTION WHEN OTHERS THEN PERFORM cron.schedule('driver-ride-offers-expiry','* * * * *','SELECT public.expire_driver_offers()'); END;
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
-- resync
