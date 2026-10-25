-- Proposal only. Do not apply automatically. Rollback: supabase/rollback/20261024003900_store_online_payments_down.sql
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE public.store_payment_accounts (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('mercadopago','pagbank','infinitepay','manual_pix')),
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected','disconnected','error')),
  account_label text NOT NULL DEFAULT '' CHECK (char_length(account_label) <= 80),
  is_primary boolean NOT NULL DEFAULT false,
  accepts_pix boolean NOT NULL DEFAULT true,
  accepts_card boolean NOT NULL DEFAULT false,
  connected_at timestamptz,
  PRIMARY KEY (tenant_id, provider),
  CHECK (provider <> 'manual_pix' OR NOT accepts_card),
  CHECK (NOT is_primary OR status = 'connected')
);
CREATE UNIQUE INDEX store_payment_accounts_one_primary ON public.store_payment_accounts(tenant_id) WHERE is_primary;
ALTER TABLE public.store_payment_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_accounts_staff ON public.store_payment_accounts FOR SELECT TO authenticated
 USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER']));
REVOKE ALL ON public.store_payment_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.store_payment_accounts TO authenticated;
GRANT ALL ON public.store_payment_accounts TO service_role;

-- AES-256-GCM ciphertext; key exists only in the Express runtime, never in SQL or the browser.
CREATE TABLE private.store_payment_credentials (
  tenant_id uuid NOT NULL,
  provider text NOT NULL,
  ciphertext text NOT NULL,
  refresh_until timestamptz,
  PRIMARY KEY (tenant_id,provider),
  FOREIGN KEY (tenant_id,provider) REFERENCES public.store_payment_accounts(tenant_id,provider) ON DELETE CASCADE
);
CREATE TABLE private.payment_oauth_states (
  state_hash text PRIMARY KEY,
  ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);
ALTER TABLE private.store_payment_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.payment_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.store_payment_credentials, private.payment_oauth_states FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  provider text NOT NULL CHECK (provider IN ('mercadopago','pagbank','infinitepay','manual_pix')),
  provider_payment_id text,
  method text NOT NULL CHECK (method IN ('pix','card')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','pending','awaiting_confirmation','paid','failed','expired')),
  raw_status text,
  paid_at timestamptz,
  application_fee numeric(12,2) CHECK (application_fee IS NULL OR application_fee = 0),
  brcode text,
  checkout_url text,
  expires_at timestamptz,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id),
  CHECK (provider <> 'manual_pix' OR method = 'pix')
);
CREATE INDEX order_payments_tenant_status ON public.order_payments(tenant_id,status);
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
-- Customers use the authenticated Express endpoint with order ownership checks. No public payment-row access.
CREATE POLICY order_payments_staff ON public.order_payments FOR SELECT TO authenticated
 USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER','CASHIER']));
REVOKE ALL ON public.order_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_payments TO authenticated;
GRANT ALL ON public.order_payments TO service_role;

-- Keep the original PagBank signing token per charge: OAuth refresh must not invalidate webhooks.
CREATE TABLE private.order_payment_webhook_tokens (
 payment_id uuid PRIMARY KEY REFERENCES public.order_payments(id) ON DELETE CASCADE,
 ciphertext text NOT NULL
);
ALTER TABLE private.order_payment_webhook_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.order_payment_webhook_tokens FROM PUBLIC, anon, authenticated, service_role;

-- Only this SECURITY DEFINER gateway can touch private ciphertext. No secret data in error messages.
CREATE FUNCTION public.payment_secret(p_op text, p_tenant uuid DEFAULT NULL, p_provider text DEFAULT NULL,
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
REVOKE ALL ON FUNCTION public.payment_secret(text,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_secret(text,uuid,text,text,text) TO service_role;

CREATE FUNCTION public.configure_store_payment(p_user uuid, p_membership uuid, p_provider text, p_changes jsonb) RETURNS void
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
REVOKE ALL ON FUNCTION public.configure_store_payment(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_store_payment(uuid,uuid,text,jsonb) TO service_role;

CREATE FUNCTION public.reserve_order_payment(p_order uuid,p_user uuid,p_provider text,p_method text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.orders%ROWTYPE; v_payment public.order_payments%ROWTYPE;
BEGIN
 SELECT * INTO v_order FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR NOT (EXISTS(SELECT 1 FROM public.customers c WHERE c.id=v_order.customer_id AND c.tenant_id=v_order.tenant_id AND c.user_id=p_user)
  OR EXISTS(SELECT 1 FROM public.tenant_users tu WHERE tu.tenant_id=v_order.tenant_id AND tu.user_id=p_user AND tu.status='ACTIVE' AND tu.role_id IN ('OWNER','MANAGER','CASHIER')))
 THEN RAISE EXCEPTION 'Pedido indisponível.' USING ERRCODE='42501'; END IF;
 IF v_order.status='CANCELLED' OR v_order.payment_status IN ('PAID','REFUNDED') THEN RAISE EXCEPTION 'Pedido não aceita pagamento.'; END IF;
 SELECT * INTO v_payment FROM public.order_payments WHERE order_id=p_order;
 IF FOUND THEN
  IF v_payment.provider<>p_provider OR v_payment.method<>p_method THEN RAISE EXCEPTION 'Este pedido já tem um pagamento em andamento.'; END IF;
  IF v_payment.status <> 'creating' OR v_payment.lease_until > now() THEN
   RETURN jsonb_build_object('payment',to_jsonb(v_payment),'claimed',false);
  END IF;
  -- InfinitePay does not document an idempotency key: never silently create a second link.
  IF p_provider='infinitepay' THEN RAISE EXCEPTION 'Confira o pagamento com a loja antes de tentar novamente.'; END IF;
  UPDATE public.order_payments SET lease_until=now()+interval '45 seconds' WHERE id=v_payment.id RETURNING * INTO v_payment;
  RETURN jsonb_build_object('payment',to_jsonb(v_payment),'claimed',true);
 END IF;
 PERFORM 1 FROM public.tenants t WHERE t.id=v_order.tenant_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=v_order.tenant_id AND t.status='ACTIVE') OR NOT EXISTS(
   SELECT 1 FROM public.store_payment_accounts a WHERE a.tenant_id=v_order.tenant_id AND a.provider=p_provider AND a.status='connected'
    AND CASE WHEN p_method='pix' THEN a.accepts_pix WHEN p_method='card' THEN a.accepts_card ELSE false END)
 THEN RAISE EXCEPTION 'Forma de pagamento indisponível.'; END IF;
 IF (p_method='pix' AND v_order.payment_method<>'PIX') OR (p_method='card' AND v_order.payment_method<>'CREDIT_CARD')
 THEN RAISE EXCEPTION 'Forma de pagamento incompatível com o pedido.'; END IF;
 INSERT INTO public.order_payments(order_id,tenant_id,provider,method,amount,lease_until)
  VALUES(p_order,v_order.tenant_id,p_provider,p_method,v_order.total_amount,now()+interval '45 seconds') RETURNING * INTO v_payment;
 UPDATE public.orders SET payment_status='PENDING',updated_at=now() WHERE id=p_order AND payment_status='PAYMENT_ON_DELIVERY';
 RETURN jsonb_build_object('payment',to_jsonb(v_payment),'claimed',true);
END; $$;
REVOKE ALL ON FUNCTION public.reserve_order_payment(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_order_payment(uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.save_order_charge(p_id uuid,p_charge jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 UPDATE public.order_payments SET provider_payment_id=p_charge->>'providerPaymentId',brcode=p_charge->>'brcode',
  checkout_url=p_charge->>'checkoutUrl',expires_at=(p_charge->>'expiresAt')::timestamptz,
  status=CASE WHEN (p_charge->>'manualConfirmation')::boolean THEN 'awaiting_confirmation' ELSE 'pending' END,
  lease_until=NULL WHERE id=p_id AND status='creating';
END; $$;
REVOKE ALL ON FUNCTION public.save_order_charge(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_order_charge(uuid,jsonb) TO service_role;

CREATE FUNCTION public.confirm_order_payment(p_id uuid,p_confirmation jsonb,p_manual_user uuid DEFAULT NULL) RETURNS void
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
REVOKE ALL ON FUNCTION public.confirm_order_payment(uuid,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order_payment(uuid,jsonb,uuid) TO service_role;

CREATE FUNCTION public.manual_order_payment_brcode(p_order uuid) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_code text;
BEGIN
 SELECT public._pix_brcode(s.pix_key,s.pix_merchant_name,s.pix_merchant_city,o.total_amount,
  upper(left(replace(o.id::text,'-',''),25))) INTO v_code FROM public.orders o
 JOIN public.tenant_payment_settings s ON s.tenant_id=o.tenant_id AND s.pix_enabled WHERE o.id=p_order;
 IF v_code IS NULL THEN RAISE EXCEPTION 'Configure a chave PIX da loja.'; END IF;
 RETURN v_code;
END; $$;
REVOKE ALL ON FUNCTION public.manual_order_payment_brcode(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manual_order_payment_brcode(uuid) TO service_role;

-- Close ALL old entry points, including update_order_payment_status and direct staff UPDATE.
-- Browser/API callers can never mark a provider-confirmed order paid, even by calling a legacy RPC.
CREATE FUNCTION public.guard_online_payment_status() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.payment_status IS DISTINCT FROM OLD.payment_status AND EXISTS(
  SELECT 1 FROM public.order_payments p WHERE p.order_id=OLD.id) THEN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'Use a confirmação segura do pagamento.' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_online_payment_status() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_online_payment_status BEFORE UPDATE OF payment_status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public.guard_online_payment_status();
COMMIT;
