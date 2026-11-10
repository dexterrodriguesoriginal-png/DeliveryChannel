-- Restore the pre-Entrega-3 online payment guard exactly. Does not drop data.
BEGIN;
CREATE OR REPLACE FUNCTION public._online_payment_transition_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_ARGV[0]='status' AND (OLD.awaiting_online_payment OR NEW.awaiting_online_payment) THEN
   IF NEW.status<>'CANCELLED' THEN RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501'; END IF;
   IF current_setting('role',true) NOT IN ('service_role','none') AND NOT EXISTS(
     SELECT 1 FROM public.customers c WHERE c.id=OLD.customer_id AND c.tenant_id=OLD.tenant_id AND c.user_id=auth.uid()) THEN
     RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501';
   END IF;
 END IF;
 IF OLD.awaiting_online_payment AND NEW.payment_status='PAID' THEN
   IF OLD.status='CANCELLED' THEN RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501'; END IF;
   IF current_setting('role',true) NOT IN ('service_role','none')
     AND NOT (public._pr_b_staff(OLD.tenant_id,ARRAY['OWNER','MANAGER']) AND (
 (OLD.payment_method='PIX' AND NOT EXISTS(SELECT 1 FROM public.order_payments p WHERE p.order_id=OLD.id))
 OR EXISTS(SELECT 1 FROM public.order_payments p WHERE p.order_id=OLD.id AND p.tenant_id=OLD.tenant_id
 AND p.provider IN ('manual_pix','infinitepay') AND p.status='paid'))) THEN
     RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501';
   END IF;
   NEW.awaiting_online_payment:=false;
 ELSIF OLD.awaiting_online_payment AND NOT NEW.awaiting_online_payment THEN
   RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501';
 ELSIF NEW.awaiting_online_payment IS DISTINCT FROM OLD.awaiting_online_payment
   AND current_setting('role',true) NOT IN ('service_role','none') THEN
   RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._online_payment_transition_guard() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
