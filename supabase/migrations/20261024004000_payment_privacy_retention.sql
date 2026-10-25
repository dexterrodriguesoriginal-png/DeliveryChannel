-- Proposal only; do not apply automatically. Rollback is separate. Extends 039 without rewriting it.
BEGIN;
ALTER TABLE public.order_payments ALTER COLUMN order_id DROP NOT NULL, ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.order_payments DROP CONSTRAINT order_payments_order_id_fkey, DROP CONSTRAINT order_payments_tenant_id_fkey;
ALTER TABLE public.order_payments ADD CONSTRAINT order_payments_order_id_fkey FOREIGN KEY(order_id) REFERENCES public.orders(id) ON DELETE SET NULL,
 ADD CONSTRAINT order_payments_tenant_id_fkey FOREIGN KEY(tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL,
 ADD COLUMN retain_until timestamptz NOT NULL DEFAULT (now()+interval '5 years'),
 ADD COLUMN anonymized_at timestamptz;
UPDATE public.order_payments SET retain_until=coalesce(paid_at,created_at)+interval '5 years';
CREATE INDEX order_payments_retention ON public.order_payments(retain_until) WHERE anonymized_at IS NULL OR tenant_id IS NOT NULL;
ALTER TABLE public.store_payment_accounts ADD COLUMN connection_version bigint NOT NULL DEFAULT 0;
-- Invalidate outstanding authorizations; they are short-lived and cannot be retroactively tenant-scoped.
DELETE FROM private.payment_oauth_states;
ALTER TABLE private.payment_oauth_states ADD COLUMN tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 ADD COLUMN provider text NOT NULL CHECK(provider IN ('mercadopago','pagbank','infinitepay','manual_pix'));

-- Order-only tombstones prevent relinking an erased order; they contain no payment/customer mapping.
CREATE TABLE private.payment_erased_orders(order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE);
ALTER TABLE private.payment_erased_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.payment_erased_orders FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public._payment_status_safe(p_status text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT CASE WHEN lower(p_status) = ANY(ARRAY['approved','pending','in_process','authorized','in_mediation','rejected','cancelled','refunded','charged_back','paid','in_analysis','declined','canceled','waiting','expired','awaiting_confirmation','manual_confirmed','unknown']) THEN lower(p_status) ELSE 'unknown' END;
$$;
REVOKE ALL ON FUNCTION public._payment_status_safe(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._payment_privacy_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid;
BEGIN
 NEW.retain_until := coalesce(NEW.paid_at,NEW.created_at)+interval '5 years';
 NEW.raw_status := public._payment_status_safe(NEW.raw_status);
 IF NEW.order_id IS NULL OR NEW.tenant_id IS NULL THEN NEW.anonymized_at := coalesce(NEW.anonymized_at,now()); END IF;
 IF TG_OP='UPDATE' AND OLD.anonymized_at IS NOT NULL AND (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.status IS DISTINCT FROM OLD.status OR NEW.order_id IS NOT NULL OR NEW.provider_payment_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Registro financeiro anonimizado é imutável.';
 END IF;
 IF NEW.anonymized_at IS NOT NULL THEN
  NEW.order_id := NULL; NEW.provider_payment_id := NULL; NEW.raw_status := NULL;
  NEW.brcode := NULL; NEW.checkout_url := NULL; NEW.expires_at := NULL; NEW.lease_until := NULL;
  DELETE FROM private.order_payment_webhook_tokens WHERE payment_id=NEW.id;
 ELSIF TG_OP='INSERT' THEN
  PERFORM 1 FROM public.orders o WHERE o.id=NEW.order_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM private.payment_erased_orders e WHERE e.order_id=NEW.order_id) THEN RAISE EXCEPTION 'Pedido indisponível.'; END IF;
  SELECT c.user_id INTO v_user FROM public.orders o JOIN public.customers c ON c.id=o.customer_id AND c.tenant_id=o.tenant_id WHERE o.id=NEW.order_id;
  IF v_user IS NOT NULL THEN
   -- The order lock serializes this check against the erasure hooks.
   PERFORM 1 FROM auth.users u WHERE u.id=v_user;
   IF NOT FOUND OR EXISTS(SELECT 1 FROM public.customer_account_deletion_requests r WHERE r.user_id=v_user AND r.status='PROCESSED')
    THEN RAISE EXCEPTION 'Conta indisponível.' USING ERRCODE='42501'; END IF;
  END IF;
 END IF;
 IF NEW.status IN ('paid','failed','expired') THEN NEW.brcode := NULL; NEW.checkout_url := NULL; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._payment_privacy_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER payment_privacy_guard BEFORE INSERT OR UPDATE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION public._payment_privacy_guard();
-- Canonicalize any previously stored raw statuses; never retain arbitrary provider text.
UPDATE public.order_payments SET raw_status=public._payment_status_safe(raw_status);

CREATE FUNCTION public._erase_customer_payment_links(p_user uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM 1 FROM public.orders o JOIN public.customers c ON c.id=o.customer_id AND c.tenant_id=o.tenant_id WHERE c.user_id=p_user ORDER BY o.id FOR UPDATE OF o;
 INSERT INTO private.payment_erased_orders(order_id) SELECT o.id FROM public.orders o JOIN public.customers c ON c.id=o.customer_id AND c.tenant_id=o.tenant_id WHERE c.user_id=p_user ON CONFLICT DO NOTHING;
 UPDATE public.order_payments p SET order_id=NULL,provider_payment_id=NULL,anonymized_at=now()
  FROM public.orders o JOIN public.customers c ON c.id=o.customer_id AND c.tenant_id=o.tenant_id
  WHERE p.order_id=o.id AND c.user_id=p_user AND p.anonymized_at IS NULL;
END; $$;
REVOKE ALL ON FUNCTION public._erase_customer_payment_links(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public._payment_customer_erasure() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF TG_TABLE_SCHEMA='auth' THEN
  PERFORM public._erase_customer_payment_links(OLD.id); RETURN OLD;
 ELSIF TG_TABLE_NAME='customers' THEN
  IF TG_OP='DELETE' OR (OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
   PERFORM 1 FROM public.orders o WHERE o.customer_id=OLD.id AND o.tenant_id=OLD.tenant_id ORDER BY o.id FOR UPDATE;
   INSERT INTO private.payment_erased_orders(order_id) SELECT o.id FROM public.orders o WHERE o.customer_id=OLD.id AND o.tenant_id=OLD.tenant_id ON CONFLICT DO NOTHING;
   UPDATE public.order_payments p SET order_id=NULL,provider_payment_id=NULL,anonymized_at=now()
    FROM public.orders o WHERE p.order_id=o.id AND o.customer_id=OLD.id AND o.tenant_id=OLD.tenant_id AND p.anonymized_at IS NULL;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 ELSE
  IF NEW.status='PROCESSED' AND NEW.user_id IS NOT NULL THEN PERFORM public._erase_customer_payment_links(NEW.user_id); END IF;
  RETURN NEW;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public._payment_customer_erasure() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER payment_customer_request_erasure AFTER INSERT OR UPDATE OF status ON public.customer_account_deletion_requests
 FOR EACH ROW EXECUTE FUNCTION public._payment_customer_erasure();
CREATE TRIGGER payment_auth_user_erasure BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public._payment_customer_erasure();
CREATE TRIGGER payment_customer_row_erasure BEFORE DELETE OR UPDATE OF user_id ON public.customers FOR EACH ROW EXECUTE FUNCTION public._payment_customer_erasure();
-- Requests already processed before this proposal are included, without changing the existing queue semantics.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT user_id FROM public.customer_account_deletion_requests WHERE status='PROCESSED' AND user_id IS NOT NULL LOOP
  PERFORM public._erase_customer_payment_links(r.user_id);
 END LOOP;
END; $$;

CREATE FUNCTION public._payment_disconnect_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.status='disconnected' THEN
  NEW.connection_version := OLD.connection_version+1;
  DELETE FROM private.store_payment_credentials WHERE tenant_id=OLD.tenant_id AND provider=OLD.provider;
  DELETE FROM private.payment_oauth_states WHERE tenant_id=OLD.tenant_id AND provider=OLD.provider;
  DELETE FROM private.order_payment_webhook_tokens w USING public.order_payments p WHERE w.payment_id=p.id AND p.tenant_id=OLD.tenant_id AND p.provider=OLD.provider;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._payment_disconnect_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER payment_disconnect_guard BEFORE UPDATE OF status ON public.store_payment_accounts FOR EACH ROW EXECUTE FUNCTION public._payment_disconnect_guard();

CREATE FUNCTION public._payment_store_erasure() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.status='INACTIVE' THEN
  DELETE FROM private.store_payment_credentials WHERE tenant_id=OLD.id;
  DELETE FROM private.payment_oauth_states WHERE tenant_id=OLD.id;
  UPDATE public.store_payment_accounts SET status='disconnected',is_primary=false WHERE tenant_id=OLD.id;
  UPDATE public.order_payments SET tenant_id=NULL,order_id=NULL,anonymized_at=coalesce(anonymized_at,now()) WHERE tenant_id=OLD.id;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._payment_store_erasure() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER payment_store_erasure BEFORE DELETE OR UPDATE OF status ON public.tenants FOR EACH ROW EXECUTE FUNCTION public._payment_store_erasure();

CREATE FUNCTION public.complete_store_payment_connection(p_user uuid,p_membership uuid,p_provider text,p_ciphertext text,p_version bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid;
BEGIN
 SELECT tu.tenant_id INTO v_tenant FROM public.tenant_users tu JOIN public.tenants t ON t.id=tu.tenant_id
 WHERE tu.id=p_membership AND tu.user_id=p_user AND tu.status='ACTIVE' AND tu.role_id IN ('OWNER','MANAGER') AND t.status='ACTIVE';
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'Acesso negado.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenants WHERE id=v_tenant FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.store_payment_accounts a WHERE a.tenant_id=v_tenant AND a.provider=p_provider AND a.connection_version=p_version)
  THEN RAISE EXCEPTION 'Conexão expirada; inicie novamente.'; END IF;
 IF p_provider<>'manual_pix' AND nullif(p_ciphertext,'') IS NULL THEN RAISE EXCEPTION 'Credenciais ausentes.'; END IF;
 UPDATE public.store_payment_accounts SET status='connected',connected_at=now(),accepts_pix=true,accepts_card=(p_provider<>'manual_pix'),
  account_label=CASE p_provider WHEN 'mercadopago' THEN 'Conta Mercado Pago' WHEN 'pagbank' THEN 'Conta PagBank' WHEN 'infinitepay' THEN 'Conta InfinitePay' ELSE 'Chave PIX (manual)' END
 WHERE tenant_id=v_tenant AND provider=p_provider;
 IF p_provider<>'manual_pix' THEN
  INSERT INTO private.store_payment_credentials(tenant_id,provider,ciphertext) VALUES(v_tenant,p_provider,p_ciphertext)
   ON CONFLICT(tenant_id,provider) DO UPDATE SET ciphertext=excluded.ciphertext,refresh_until=NULL;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.complete_store_payment_connection(uuid,uuid,text,text,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_store_payment_connection(uuid,uuid,text,text,bigint) TO service_role;

CREATE FUNCTION public.anonymize_expired_payments(p_limit integer DEFAULT 500) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer; v_cleanup integer;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 1000 OR p_limit IS NULL THEN RAISE EXCEPTION 'Lote inválido.'; END IF;
 WITH due AS (SELECT p.id,p.order_id FROM public.order_payments p WHERE (p.anonymized_at IS NULL OR p.tenant_id IS NOT NULL) AND p.retain_until<=statement_timestamp()
  ORDER BY p.retain_until,p.id FOR UPDATE SKIP LOCKED LIMIT p_limit),
 erased_orders AS (INSERT INTO private.payment_erased_orders(order_id) SELECT d.order_id FROM due d WHERE d.order_id IS NOT NULL ON CONFLICT DO NOTHING RETURNING order_id)
 UPDATE public.order_payments p SET order_id=NULL,tenant_id=NULL,anonymized_at=coalesce(p.anonymized_at,now()) FROM due WHERE p.id=due.id;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 WITH expired AS (SELECT p.id FROM public.order_payments p WHERE p.expires_at<=statement_timestamp() AND (p.brcode IS NOT NULL OR p.checkout_url IS NOT NULL)
  FOR UPDATE SKIP LOCKED LIMIT p_limit)
 UPDATE public.order_payments p SET brcode=NULL,checkout_url=NULL FROM expired e WHERE e.id=p.id;
 GET DIAGNOSTICS v_cleanup=ROW_COUNT;
 DELETE FROM private.order_payment_webhook_tokens w USING public.order_payments p WHERE w.payment_id=p.id AND p.status='paid' AND p.paid_at<statement_timestamp()-interval '7 days';
 DELETE FROM private.payment_oauth_states WHERE expires_at<=statement_timestamp();
 RETURN v_count+v_cleanup;
END; $$;
REVOKE ALL ON FUNCTION public.anonymize_expired_payments(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_expired_payments(integer) TO service_role;

CREATE OR REPLACE FUNCTION public._legal_version() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT '2026-10-24.2'::text $$;
REVOKE ALL ON FUNCTION public._legal_version() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.configure_store_payment(p_user uuid, p_membership uuid, p_provider text, p_changes jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid;
BEGIN
 SELECT tu.tenant_id INTO v_tenant FROM public.tenant_users tu JOIN public.tenants t ON t.id=tu.tenant_id
  WHERE tu.id=p_membership AND tu.user_id=p_user AND tu.status='ACTIVE' AND tu.role_id IN ('OWNER','MANAGER') AND t.status='ACTIVE';
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'Acesso negado.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenants t WHERE t.id=v_tenant FOR UPDATE;
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
   UPDATE private.store_payment_credentials c SET ciphertext=p_ciphertext,refresh_until=NULL
    WHERE c.tenant_id=p_tenant AND c.provider=p_provider AND c.ciphertext=p_key
      AND EXISTS(SELECT 1 FROM public.store_payment_accounts a WHERE a.tenant_id=c.tenant_id AND a.provider=c.provider AND a.status='connected');
   IF NOT FOUND THEN RAISE EXCEPTION 'Conexão alterada; conecte novamente.'; END IF;
 ELSIF p_op = 'refresh_claim' THEN
   UPDATE private.store_payment_credentials SET refresh_until=now()+interval '30 seconds'
    WHERE tenant_id=p_tenant AND provider=p_provider AND (refresh_until IS NULL OR refresh_until<now())
    AND EXISTS(SELECT 1 FROM public.store_payment_accounts a WHERE a.tenant_id=p_tenant AND a.provider=p_provider AND a.status='connected') RETURNING ciphertext INTO v_value;
 ELSIF p_op = 'refresh_release' THEN
   UPDATE private.store_payment_credentials SET refresh_until=NULL WHERE tenant_id=p_tenant AND provider=p_provider AND (p_key IS NULL OR ciphertext=p_key);
 ELSIF p_op = 'delete' THEN
   DELETE FROM private.store_payment_credentials c WHERE c.tenant_id=p_tenant AND c.provider=p_provider;
 ELSIF p_op = 'webhook_get' THEN
   SELECT c.ciphertext INTO v_value FROM private.order_payment_webhook_tokens c WHERE c.payment_id=p_key::uuid;
 ELSIF p_op = 'webhook_set' THEN
   IF NOT EXISTS(SELECT 1 FROM public.order_payments p JOIN public.store_payment_accounts a ON a.tenant_id=p.tenant_id AND a.provider=p.provider
    WHERE p.id=p_key::uuid AND p.anonymized_at IS NULL AND a.status='connected') THEN RAISE EXCEPTION 'Pagamento indisponível.'; END IF;
   INSERT INTO private.order_payment_webhook_tokens(payment_id,ciphertext) VALUES(p_key::uuid,p_ciphertext)
    ON CONFLICT(payment_id) DO UPDATE SET ciphertext=excluded.ciphertext;
 ELSIF p_op = 'state_put' THEN
   DELETE FROM private.payment_oauth_states s WHERE s.expires_at < now();
   INSERT INTO private.payment_oauth_states(state_hash,ciphertext,tenant_id,provider) VALUES(p_key,p_ciphertext,p_tenant,p_provider);
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
 IF v_payment.id IS NULL OR v_payment.anonymized_at IS NOT NULL OR v_payment.order_id IS NULL THEN RAISE EXCEPTION 'Pagamento indisponível.'; END IF;
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
  CASE WHEN p_manual_user IS NULL THEN 'Confirmação consultada no provedor' ELSE 'Confirmação manual pela equipe autorizada' END,
  v_payment.order_id::text,'PENDING','PAID',v_payment.tenant_id);
END; $$;
COMMIT;
