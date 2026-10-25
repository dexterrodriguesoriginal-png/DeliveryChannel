-- Review only; never apply automatically. Removed links/secrets cannot be reconstructed.
BEGIN;
DROP TRIGGER IF EXISTS payment_store_erasure ON public.tenants;
DROP TRIGGER IF EXISTS payment_disconnect_guard ON public.store_payment_accounts;
DROP TRIGGER IF EXISTS payment_customer_request_erasure ON public.customer_account_deletion_requests;
DROP TRIGGER IF EXISTS payment_auth_user_erasure ON auth.users;
DROP TRIGGER IF EXISTS payment_customer_row_erasure ON public.customers;
DROP TRIGGER IF EXISTS payment_privacy_guard ON public.order_payments;
DROP FUNCTION IF EXISTS public.anonymize_expired_payments(integer);
DROP FUNCTION IF EXISTS public.complete_store_payment_connection(uuid,uuid,text,text,bigint);
DROP FUNCTION IF EXISTS public._payment_store_erasure();
DROP FUNCTION IF EXISTS public._payment_disconnect_guard();
DROP FUNCTION IF EXISTS public._payment_customer_erasure();
DROP FUNCTION IF EXISTS public._erase_customer_payment_links(uuid);
DROP FUNCTION IF EXISTS public._payment_privacy_guard();
DROP FUNCTION IF EXISTS public._payment_status_safe(text);
DROP TABLE IF EXISTS private.payment_erased_orders;
-- Keep nullable links and ON DELETE SET NULL: undoing anonymization or deleting fiscal records is unsafe.
ALTER TABLE public.order_payments DROP COLUMN retain_until, DROP COLUMN anonymized_at;
ALTER TABLE public.store_payment_accounts DROP COLUMN connection_version;
DELETE FROM private.payment_oauth_states;
ALTER TABLE private.payment_oauth_states DROP COLUMN tenant_id,DROP COLUMN provider;
CREATE OR REPLACE FUNCTION public._legal_version() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT '2026-10-24.1'::text $$;
REVOKE ALL ON FUNCTION public._legal_version() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.configure_store_payment(p_user uuid, p_membership uuid, p_provider text, p_changes jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid;
BEGIN
 SELECT tu.tenant_id INTO v_tenant FROM public.tenant_users tu JOIN public.tenants t ON t.id=tu.tenant_id
  WHERE tu.id=p_membership AND tu.user_id=p_user AND tu.status='ACTIVE' AND tu.role_id IN ('OWNER','MANAGER') AND t.status='ACTIVE';
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'Acesso negado.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenants t WHERE t.id=v_tenant FOR UPDATE;
 IF p_changes->>'status'='disconnected' THEN
   IF EXISTS(SELECT 1 FROM public.order_payments p WHERE p.tenant_id=v_tenant AND p.provider=p_provider
    AND p.status IN ('creating','pending')) THEN RAISE EXCEPTION 'Aguarde os pagamentos pendentes antes de desconectar.'; END IF;
 END IF;
 IF (p_changes->>'is_primary')::boolean THEN
  UPDATE public.store_payment_accounts SET is_primary=false WHERE tenant_id=v_tenant;
 END IF;
 INSERT INTO public.store_payment_accounts(tenant_id,provider,status,account_label,is_primary,accepts_pix,accepts_card,connected_at)
  VALUES(v_tenant,p_provider,coalesce(p_changes->>'status','disconnected'),coalesce(p_changes->>'account_label',''),
   coalesce((p_changes->>'is_primary')::boolean,false),coalesce((p_changes->>'accepts_pix')::boolean,true),
   coalesce((p_changes->>'accepts_card')::boolean,false),CASE WHEN p_changes->>'status'='connected' THEN now() END)
 ON CONFLICT(tenant_id,provider) DO UPDATE SET
  status=coalesce(p_changes->>'status',store_payment_accounts.status),
  account_label=coalesce(p_changes->>'account_label',store_payment_accounts.account_label),
  is_primary=CASE WHEN p_changes->>'status'='disconnected' THEN false ELSE coalesce((p_changes->>'is_primary')::boolean,store_payment_accounts.is_primary) END,
  accepts_pix=coalesce((p_changes->>'accepts_pix')::boolean,store_payment_accounts.accepts_pix),
  accepts_card=coalesce((p_changes->>'accepts_card')::boolean,store_payment_accounts.accepts_card),
  connected_at=CASE WHEN p_changes->>'status'='connected' THEN now() ELSE store_payment_accounts.connected_at END;
END; $$;

CREATE OR REPLACE FUNCTION public.payment_secret(p_op text, p_tenant uuid DEFAULT NULL, p_provider text DEFAULT NULL,
 p_key text DEFAULT NULL, p_ciphertext text DEFAULT NULL) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_value text;
BEGIN
 IF p_op = 'get' THEN
   SELECT c.ciphertext INTO v_value FROM private.store_payment_credentials c WHERE c.tenant_id=p_tenant AND c.provider=p_provider;
 ELSIF p_op = 'set' THEN
   INSERT INTO private.store_payment_credentials(tenant_id,provider,ciphertext) VALUES(p_tenant,p_provider,p_ciphertext)
    ON CONFLICT(tenant_id,provider) DO UPDATE SET ciphertext=excluded.ciphertext,refresh_until=NULL;
 ELSIF p_op = 'refresh_claim' THEN
   UPDATE private.store_payment_credentials SET refresh_until=now()+interval '30 seconds'
    WHERE tenant_id=p_tenant AND provider=p_provider AND (refresh_until IS NULL OR refresh_until<now()) RETURNING ciphertext INTO v_value;
 ELSIF p_op = 'refresh_release' THEN
   UPDATE private.store_payment_credentials SET refresh_until=NULL WHERE tenant_id=p_tenant AND provider=p_provider;
 ELSIF p_op = 'delete' THEN
   DELETE FROM private.store_payment_credentials c WHERE c.tenant_id=p_tenant AND c.provider=p_provider;
 ELSIF p_op = 'webhook_get' THEN
   SELECT c.ciphertext INTO v_value FROM private.order_payment_webhook_tokens c WHERE c.payment_id=p_key::uuid;
 ELSIF p_op = 'webhook_set' THEN
   INSERT INTO private.order_payment_webhook_tokens(payment_id,ciphertext) VALUES(p_key::uuid,p_ciphertext)
    ON CONFLICT(payment_id) DO UPDATE SET ciphertext=excluded.ciphertext;
 ELSIF p_op = 'state_put' THEN
   DELETE FROM private.payment_oauth_states s WHERE s.expires_at < now();
   INSERT INTO private.payment_oauth_states(state_hash,ciphertext) VALUES(p_key,p_ciphertext);
 ELSIF p_op = 'state_take' THEN
   DELETE FROM private.payment_oauth_states s WHERE s.state_hash=p_key AND s.expires_at > now() RETURNING s.ciphertext INTO v_value;
 ELSE RAISE EXCEPTION 'Operação inválida.'; END IF;
 RETURN v_value;
END; $$;

CREATE OR REPLACE FUNCTION public.confirm_order_payment(p_id uuid,p_confirmation jsonb,p_manual_user uuid DEFAULT NULL) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_payment public.order_payments%ROWTYPE; v_order public.orders%ROWTYPE; v_order_id uuid;
BEGIN
 SELECT order_id INTO v_order_id FROM public.order_payments WHERE id=p_id;
 SELECT * INTO v_order FROM public.orders WHERE id=v_order_id FOR UPDATE;
 SELECT * INTO v_payment FROM public.order_payments WHERE id=p_id FOR UPDATE;
 IF v_payment.id IS NULL THEN RAISE EXCEPTION 'Pagamento indisponível.'; END IF;
 IF v_payment.status='paid' THEN RETURN; END IF;
 IF v_order.status='CANCELLED' OR v_order.payment_status IN ('PAID','REFUNDED') OR v_payment.amount<>v_order.total_amount
 THEN RAISE EXCEPTION 'Pedido não aceita confirmação.'; END IF;
 IF p_manual_user IS NOT NULL THEN
  IF v_payment.provider NOT IN ('manual_pix','infinitepay') OR v_payment.status<>'awaiting_confirmation' OR NOT EXISTS(
   SELECT 1 FROM public.tenant_users tu JOIN public.tenants t ON t.id=tu.tenant_id
   WHERE tu.tenant_id=v_payment.tenant_id AND tu.user_id=p_manual_user AND tu.status='ACTIVE' AND tu.role_id IN ('OWNER','MANAGER','CASHIER') AND t.status='ACTIVE')
  THEN RAISE EXCEPTION 'Confirmação manual não permitida.' USING ERRCODE='42501'; END IF;
 ELSE
  IF v_payment.provider NOT IN ('mercadopago','pagbank') OR (p_confirmation->>'currency') IS DISTINCT FROM 'BRL'
   OR (p_confirmation->>'orderId') IS DISTINCT FROM v_payment.order_id::text
   OR (p_confirmation->>'amountCents')::numeric IS DISTINCT FROM (v_order.total_amount*100)
   OR coalesce((p_confirmation->>'paid')::boolean,false) IS NOT TRUE
   OR nullif(p_confirmation->>'providerPaymentId','') IS NULL
  THEN RAISE EXCEPTION 'Confirmação do provedor inválida.'; END IF;
 END IF;
 UPDATE public.order_payments SET status='paid',paid_at=now(),raw_status=CASE WHEN p_manual_user IS NOT NULL THEN 'manual_confirmed' ELSE left(p_confirmation->>'rawStatus',80) END,
  provider_payment_id=coalesce(p_confirmation->>'providerPaymentId',provider_payment_id) WHERE id=p_id;
 UPDATE public.orders SET payment_status='PAID',updated_at=now() WHERE id=v_payment.order_id;
 PERFORM public.log_audit_event('ONLINE_PAYMENT_CONFIRMED','orders',
  CASE WHEN p_manual_user IS NULL THEN 'Confirmação consultada no provedor' ELSE 'Confirmação manual: '||p_manual_user::text END,
  v_payment.order_id::text,'PENDING','PAID',v_payment.tenant_id);
END; $$;
COMMIT;
