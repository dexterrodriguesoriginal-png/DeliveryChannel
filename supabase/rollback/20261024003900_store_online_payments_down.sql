-- Review data retention/reconciliation before a rollback. Never run automatically.
BEGIN;
DROP TRIGGER IF EXISTS guard_online_payment_status ON public.orders;
DROP FUNCTION IF EXISTS public.guard_online_payment_status();
DROP FUNCTION IF EXISTS public.manual_order_payment_brcode(uuid);
DROP FUNCTION IF EXISTS public.confirm_order_payment(uuid,jsonb,uuid);
DROP FUNCTION IF EXISTS public.save_order_charge(uuid,jsonb);
DROP FUNCTION IF EXISTS public.reserve_order_payment(uuid,uuid,text,text);
DROP FUNCTION IF EXISTS public.configure_store_payment(uuid,uuid,text,jsonb);
DROP FUNCTION IF EXISTS public.payment_secret(text,uuid,text,text,text);
DROP TABLE IF EXISTS private.order_payment_webhook_tokens;
DROP TABLE IF EXISTS public.order_payments;
DROP TABLE IF EXISTS private.payment_oauth_states;
DROP TABLE IF EXISTS private.store_payment_credentials;
DROP TABLE IF EXISTS public.store_payment_accounts;
-- Preserve private: other features already use this schema.
COMMIT;
