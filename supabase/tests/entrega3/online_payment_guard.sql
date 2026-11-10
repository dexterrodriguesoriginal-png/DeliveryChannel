-- Production aa/ab online-payment guards, so the Entrega 3 suite covers the real conflict.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_id uuid;
CREATE TABLE IF NOT EXISTS public.customers(
  id uuid PRIMARY KEY,
  tenant_id uuid,
  user_id uuid
);
CREATE TABLE IF NOT EXISTS public.order_payments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  tenant_id uuid,
  provider text,
  status text
);
CREATE OR REPLACE FUNCTION public._pr_b_staff(p_tenant uuid, p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT public._tenant_role_of_caller(p_tenant) = ANY(p_roles)
$$;
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
DROP TRIGGER IF EXISTS aa_online_payment_transition_guard ON public.orders;
DROP TRIGGER IF EXISTS ab_online_payment_flag_guard ON public.orders;
CREATE TRIGGER aa_online_payment_transition_guard BEFORE UPDATE OF status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._online_payment_transition_guard('status');
CREATE TRIGGER ab_online_payment_flag_guard BEFORE UPDATE OF awaiting_online_payment,payment_status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._online_payment_transition_guard('payment');
