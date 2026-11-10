-- Entrega 3 follow-up: the live online-payment guard must honor the
-- transaction-local GUC set by confirm_manual_totem_payment after its
-- OWNER/MANAGER/CASHIER check. Without this, aa_online_payment_transition_guard
-- raises PAYMENT_REQUIRED and the PDV cannot mark a totem order paid.
-- Totem kitchen advances while unpaid raise TOTEM_PAYMENT_REQUIRED (same
-- contract as zz_totem_payment_transition_guard). Non-totem paths are unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION public._online_payment_transition_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('dc.totem_approve_order', true) IS NOT DISTINCT FROM OLD.id::text
    AND OLD.totem_device_id IS NOT NULL
    AND NEW.totem_device_id IS NOT DISTINCT FROM OLD.totem_device_id
    AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
    AND NEW.payment_status='PAID'
    AND NEW.status IN ('CONFIRMED','PREPARING','READY') THEN
   NEW.awaiting_online_payment := false;
   RETURN NEW;
 END IF;
 IF TG_ARGV[0]='status' AND (OLD.awaiting_online_payment OR NEW.awaiting_online_payment) THEN
   IF NEW.status<>'CANCELLED' THEN
     IF OLD.totem_device_id IS NOT NULL THEN
       RAISE EXCEPTION 'TOTEM_PAYMENT_REQUIRED' USING ERRCODE='42501';
     END IF;
     RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501';
   END IF;
   IF current_setting('role',true) NOT IN ('service_role','none') AND NOT EXISTS(
     SELECT 1 FROM public.customers c WHERE c.id=OLD.customer_id AND c.tenant_id=OLD.tenant_id AND c.user_id=auth.uid()) THEN
     RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501';
   END IF;
 END IF;
 IF OLD.awaiting_online_payment AND NEW.payment_status='PAID' THEN
   IF OLD.status='CANCELLED' THEN RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501'; END IF;
   -- Provider charges already require service_role via guard_online_payment_status.
   -- Legacy manual PIX may be confirmed only by an active OWNER/MANAGER.
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
