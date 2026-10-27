-- Mesas e QR Code (hardening + PIX por comanda). Additive, idempotent where possible.
-- Proposal only. NOT applied to production by the author. Rollback: supabase/rollback/20261027004600_mesas_qr_down.sql
-- Requires: 20261019002600_dine_in.sql (dining_*, tab_*), 20261024003900_store_online_payments.sql (store_payment_accounts).
-- Does NOT rewrite any existing function: guards are triggers, new behaviour is in new functions.
BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.dining_tables') IS NULL OR to_regclass('public.dining_tabs') IS NULL
     OR to_regclass('public.tab_sessions') IS NULL OR to_regclass('public.tab_payments') IS NULL
     OR to_regclass('public.waiter_calls') IS NULL OR to_regclass('public.store_payment_accounts') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK mesas_qr: aplique antes as migrations de salão (2600) e pagamentos online (3900).';
  END IF;
  IF to_regprocedure('public._rate_limit_hit(text,text,uuid,integer,integer)') IS NULL
     OR to_regprocedure('public._sha256_hex(text)') IS NULL
     OR to_regprocedure('public._tenant_role_of_caller(uuid)') IS NULL
     OR to_regprocedure('public._dine_in_config(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK mesas_qr: helpers de segurança ausentes.';
  END IF;
  IF to_regclass('public.tab_pix_charges') IS NOT NULL OR to_regclass('public.dining_qr_pauses') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK mesas_qr: objetos já existem; estado diferente do auditado.';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Pausa do QR (loja inteira: table_id NULL, ou uma mesa)
-- ---------------------------------------------------------------------------
CREATE TABLE public.dining_qr_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  table_id uuid,
  paused_at timestamptz NOT NULL DEFAULT now(),
  paused_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, table_id) REFERENCES public.dining_tables(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX dining_qr_pauses_store_key ON public.dining_qr_pauses (tenant_id) WHERE table_id IS NULL;
CREATE UNIQUE INDEX dining_qr_pauses_table_key ON public.dining_qr_pauses (tenant_id, table_id) WHERE table_id IS NOT NULL;
ALTER TABLE public.dining_qr_pauses ENABLE ROW LEVEL SECURITY;
CREATE POLICY dining_qr_pauses_staff_read ON public.dining_qr_pauses FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER','WAITER','CASHIER']));
REVOKE ALL ON public.dining_qr_pauses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dining_qr_pauses TO authenticated;
GRANT ALL ON public.dining_qr_pauses TO service_role;

CREATE FUNCTION public._qr_paused(p_tenant uuid, p_table uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.dining_qr_pauses p
                 WHERE p.tenant_id = p_tenant AND (p.table_id IS NULL OR p.table_id = p_table));
$$;
REVOKE ALL ON FUNCTION public._qr_paused(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_dining_qr_pause(p_tenant uuid, p_table uuid, p_paused boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_tenant IS NULL OR p_paused IS NULL
     OR NOT public.has_tenant_scoped_role(p_tenant, ARRAY['OWNER','MANAGER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: somente proprietário ou gerente pode pausar o QR.' USING ERRCODE = '42501';
  END IF;
  IF p_table IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.dining_tables dt WHERE dt.id = p_table AND dt.tenant_id = p_tenant) THEN
    RAISE EXCEPTION 'TABLE_NOT_FOUND: mesa não encontrada.' USING ERRCODE = '42501';
  END IF;
  IF p_paused THEN
    IF p_table IS NULL THEN
      INSERT INTO public.dining_qr_pauses (tenant_id, table_id, paused_by) VALUES (p_tenant, NULL, auth.uid())
      ON CONFLICT (tenant_id) WHERE table_id IS NULL DO NOTHING;
    ELSE
      INSERT INTO public.dining_qr_pauses (tenant_id, table_id, paused_by) VALUES (p_tenant, p_table, auth.uid())
      ON CONFLICT (tenant_id, table_id) WHERE table_id IS NOT NULL DO NOTHING;
    END IF;
  ELSE
    DELETE FROM public.dining_qr_pauses
    WHERE tenant_id = p_tenant AND table_id IS NOT DISTINCT FROM p_table;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_dining_qr_pause(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_dining_qr_pause(uuid, uuid, boolean) TO authenticated;

-- Customer landing: tells the page (before ordering) whether the QR is paused. Reveals nothing for unknown tokens.
CREATE FUNCTION public.get_table_qr_status(p_qr_token text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_tenant uuid; v_table uuid;
BEGIN
  IF p_qr_token IS NULL OR length(p_qr_token) NOT BETWEEN 8 AND 128 THEN
    RETURN jsonb_build_object('found', false, 'paused', false);
  END IF;
  IF NOT public._rate_limit_hit('table_qr_status', public._request_ip_hash(), NULL, 120, 60) THEN
    RAISE EXCEPTION 'RATE_LIMITED: muitas consultas. Tente novamente em instantes.';
  END IF;
  SELECT dt.tenant_id, dt.id INTO v_tenant, v_table FROM public.dining_tables dt WHERE dt.qr_token = p_qr_token AND dt.active;
  IF v_tenant IS NULL THEN RETURN jsonb_build_object('found', false, 'paused', false); END IF;
  RETURN jsonb_build_object('found', true, 'paused', public._qr_paused(v_tenant, v_table));
END;
$$;
REVOKE ALL ON FUNCTION public.get_table_qr_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_table_qr_status(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Guards (triggers) — existing RPCs stay untouched
-- ---------------------------------------------------------------------------
-- 2a. Joining a table by QR: paused QR + abuse limits (staff and service role are exempt).
CREATE FUNCTION public._tab_sessions_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_table uuid;
BEGIN
  IF auth.uid() IS NULL OR public._tenant_role_of_caller(NEW.tenant_id) IS NOT NULL THEN RETURN NEW; END IF;
  SELECT tb.table_id INTO v_table FROM public.dining_tabs tb WHERE tb.id = NEW.tab_id AND tb.tenant_id = NEW.tenant_id;
  IF public._qr_paused(NEW.tenant_id, v_table) THEN
    RAISE EXCEPTION 'QR_PAUSED: o pedido pelo QR está pausado. Chame um atendente.';
  END IF;
  IF NOT public._rate_limit_hit('qr_join_user', public._sha256_hex(auth.uid()::text || ':' || NEW.tenant_id::text), NEW.tenant_id, 15, 600)
     OR NOT public._rate_limit_hit('qr_join_table', public._sha256_hex(v_table::text), NEW.tenant_id, 60, 600)
     OR NOT public._rate_limit_hit('qr_join_tenant', public._sha256_hex(NEW.tenant_id::text), NEW.tenant_id, 600, 600) THEN
    RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas de entrar na mesa. Aguarde alguns minutos ou chame um atendente.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._tab_sessions_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER tab_sessions_guard BEFORE INSERT ON public.tab_sessions
  FOR EACH ROW EXECUTE FUNCTION public._tab_sessions_guard();

-- 2b. Customer rounds: blocked while QR is paused or while the tab has a live PIX charge (total must not move).
-- Defined after tab_pix_charges below (references it at run time only, but keep creation order explicit).

-- 2c. Waiter-call spam (the bell): per tab and per tenant limits for non-staff.
CREATE FUNCTION public._waiter_calls_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR public._tenant_role_of_caller(NEW.tenant_id) IS NOT NULL THEN RETURN NEW; END IF;
  IF NOT public._rate_limit_hit('waiter_call_tab', public._sha256_hex(NEW.tab_id::text), NEW.tenant_id, 12, 600)
     OR NOT public._rate_limit_hit('waiter_call_tenant', public._sha256_hex(NEW.tenant_id::text), NEW.tenant_id, 300, 600) THEN
    RAISE EXCEPTION 'RATE_LIMITED: muitos chamados. O atendente já foi avisado.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._waiter_calls_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER waiter_calls_guard BEFORE INSERT ON public.waiter_calls
  FOR EACH ROW EXECUTE FUNCTION public._waiter_calls_guard();

-- 2d. Table names: 3–15 characters when a name is changed (existing rows are not touched).
CREATE FUNCTION public._dining_tables_name_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF length(btrim(NEW.label)) NOT BETWEEN 3 AND 15 THEN
    RAISE EXCEPTION 'INVALID_TABLE_NAME: o nome da mesa deve ter de 3 a 15 caracteres.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dining_tables_name_guard BEFORE UPDATE OF label ON public.dining_tables
  FOR EACH ROW WHEN (OLD.label IS DISTINCT FROM NEW.label) EXECUTE FUNCTION public._dining_tables_name_guard();

-- 2e. Rotating the QR token invalidates sessions that were never approved by staff (leaked-QR cleanup).
CREATE FUNCTION public._dining_tables_rotate_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.tab_sessions ts SET expires_at = now()
  WHERE ts.tenant_id = NEW.tenant_id AND ts.approved_at IS NULL AND ts.expires_at > now()
    AND ts.tab_id IN (SELECT tb.id FROM public.dining_tabs tb
                      WHERE tb.tenant_id = NEW.tenant_id AND tb.table_id = NEW.id AND tb.status IN ('OPEN','BILL_REQUESTED'));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._dining_tables_rotate_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER dining_tables_rotate_guard AFTER UPDATE OF qr_token ON public.dining_tables
  FOR EACH ROW WHEN (OLD.qr_token IS DISTINCT FROM NEW.qr_token) EXECUTE FUNCTION public._dining_tables_rotate_guard();

-- ---------------------------------------------------------------------------
-- 3. PIX por comanda (Mercado Pago da loja). Only the Express server (service_role) writes.
-- ---------------------------------------------------------------------------
CREATE TABLE public.tab_pix_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tab_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'mercadopago' CHECK (provider = 'mercadopago'),
  provider_payment_id text,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','pending','paid','expired','cancelled','failed')),
  raw_status text,
  brcode text,
  expires_at timestamptz,
  lease_until timestamptz,
  paid_at timestamptz,
  needs_review boolean NOT NULL DEFAULT false,
  review_reason text CHECK (review_reason IS NULL OR char_length(review_reason) <= 120),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id),
  FOREIGN KEY (tenant_id, tab_id) REFERENCES public.dining_tabs(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX tab_pix_charges_one_live ON public.tab_pix_charges (tab_id) WHERE status IN ('creating','pending');
CREATE INDEX tab_pix_charges_tenant_tab ON public.tab_pix_charges (tenant_id, tab_id, created_at DESC);
ALTER TABLE public.tab_pix_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY tab_pix_charges_staff_read ON public.tab_pix_charges FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER','WAITER','CASHIER']));
REVOKE ALL ON public.tab_pix_charges FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tab_pix_charges TO authenticated;
GRANT ALL ON public.tab_pix_charges TO service_role;

-- 2b (cont.) round guard
CREATE FUNCTION public._orders_dine_in_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_table uuid;
BEGIN
  IF auth.uid() IS NULL OR public._tenant_role_of_caller(NEW.tenant_id) IS NOT NULL THEN RETURN NEW; END IF;
  SELECT tb.table_id INTO v_table FROM public.dining_tabs tb WHERE tb.id = NEW.tab_id AND tb.tenant_id = NEW.tenant_id;
  IF public._qr_paused(NEW.tenant_id, v_table) THEN
    RAISE EXCEPTION 'QR_PAUSED: o pedido pelo QR está pausado. Chame um atendente.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tab_pix_charges c
             WHERE c.tab_id = NEW.tab_id AND c.tenant_id = NEW.tenant_id AND c.status IN ('creating','pending')
               AND (c.expires_at IS NULL OR c.expires_at > now())) THEN
    RAISE EXCEPTION 'TAB_PAYMENT_IN_PROGRESS: a conta está em pagamento. Chame um atendente para novos pedidos.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._orders_dine_in_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER orders_dine_in_guard BEFORE INSERT ON public.orders
  FOR EACH ROW WHEN (NEW.fulfillment_type = 'DINE_IN' AND NEW.tab_id IS NOT NULL)
  EXECUTE FUNCTION public._orders_dine_in_guard();

-- Tab total (same formula as close_tab / get_my_tab): internal.
CREATE FUNCTION public._tab_total_cents(p_tenant uuid, p_tab uuid) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_tab public.dining_tabs; v_subtotal numeric; v_fee numeric;
BEGIN
  SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id = p_tab AND tb.tenant_id = p_tenant;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT COALESCE(sum(o.subtotal), 0) INTO v_subtotal FROM public.orders o
  WHERE o.tenant_id = p_tenant AND o.tab_id = p_tab AND o.fulfillment_type = 'DINE_IN' AND o.status <> 'CANCELLED';
  v_fee := CASE WHEN v_tab.service_fee_removed THEN 0 ELSE round(v_subtotal * v_tab.service_fee_percent / 100, 2) END;
  RETURN round((v_subtotal + v_fee) * 100)::integer;
END;
$$;
REVOKE ALL ON FUNCTION public._tab_total_cents(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Staff authorisation for a user id passed by the trusted server (no JWT in the service-role context).
CREATE FUNCTION public._tab_pix_staff(p_user uuid, p_tenant uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_role text; v_config jsonb;
BEGIN
  IF p_user IS NULL THEN RETURN false; END IF;
  SELECT tu.role_id INTO v_role FROM public.tenant_users tu JOIN public.tenants t ON t.id = tu.tenant_id
  WHERE tu.user_id = p_user AND tu.tenant_id = p_tenant AND tu.status = 'ACTIVE' AND t.status = 'ACTIVE' LIMIT 1;
  IF v_role IS NULL OR v_role NOT IN ('OWNER','MANAGER','CASHIER','WAITER') THEN RETURN false; END IF;
  IF v_role = 'WAITER' THEN
    v_config := public._dine_in_config(p_tenant);
    RETURN COALESCE((v_config -> 'close_roles') ? 'WAITER', false);
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public._tab_pix_staff(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.reserve_tab_pix(p_tab uuid, p_user uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tab public.dining_tabs; v_total integer; v_charge public.tab_pix_charges; v_claimed boolean := false;
  v_slug text; v_label text;
BEGIN
  SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id = p_tab FOR UPDATE;
  IF NOT FOUND OR NOT public._tab_pix_staff(p_user, v_tab.tenant_id) THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF public._dine_in_config(v_tab.tenant_id) IS NULL THEN RAISE EXCEPTION 'Salão indisponível.'; END IF;
  IF v_tab.status NOT IN ('OPEN','BILL_REQUESTED') THEN RAISE EXCEPTION 'Comanda encerrada.'; END IF;
  IF NOT public._rate_limit_hit('tab_pix_create', public._sha256_hex(p_tab::text), v_tab.tenant_id, 10, 600) THEN
    RAISE EXCEPTION 'Muitas tentativas de gerar o PIX. Aguarde.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tab_payments tp WHERE tp.tenant_id = v_tab.tenant_id AND tp.tab_id = p_tab) THEN
    RAISE EXCEPTION 'Comanda com pagamento registrado.';
  END IF;
  v_total := public._tab_total_cents(v_tab.tenant_id, p_tab);
  IF v_total <= 0 THEN RAISE EXCEPTION 'Comanda sem itens para cobrar.'; END IF;

  SELECT * INTO v_charge FROM public.tab_pix_charges c WHERE c.tab_id = p_tab AND c.status IN ('creating','pending') FOR UPDATE;
  IF FOUND THEN
    IF v_charge.status = 'pending' AND v_charge.expires_at IS NOT NULL AND v_charge.expires_at <= now() THEN
      UPDATE public.tab_pix_charges SET status = 'expired', brcode = NULL WHERE id = v_charge.id;
      v_charge := NULL;
    ELSIF v_charge.amount_cents <> v_total THEN
      UPDATE public.tab_pix_charges SET status = 'cancelled', raw_status = 'total_changed' WHERE id = v_charge.id;
      v_charge := NULL;
    ELSIF v_charge.status = 'creating' AND (v_charge.lease_until IS NULL OR v_charge.lease_until <= now()) THEN
      UPDATE public.tab_pix_charges SET lease_until = now() + interval '45 seconds' WHERE id = v_charge.id RETURNING * INTO v_charge;
      v_claimed := true;
    END IF;
  END IF;
  IF v_charge.id IS NULL THEN
    INSERT INTO public.tab_pix_charges (tenant_id, tab_id, amount_cents, lease_until, created_by)
    VALUES (v_tab.tenant_id, p_tab, v_total, now() + interval '45 seconds', p_user) RETURNING * INTO v_charge;
    v_claimed := true;
  END IF;
  SELECT t.slug INTO v_slug FROM public.tenants t WHERE t.id = v_tab.tenant_id;
  SELECT dt.label INTO v_label FROM public.dining_tables dt WHERE dt.id = v_tab.table_id AND dt.tenant_id = v_tab.tenant_id;
  RETURN jsonb_build_object('charge', to_jsonb(v_charge) - 'lease_until' - 'created_by', 'claimed', v_claimed,
                            'slug', v_slug, 'table_label', v_label);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_tab_pix(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_tab_pix(uuid, uuid) TO service_role;

CREATE FUNCTION public.save_tab_pix_charge(p_id uuid, p_charge jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.tab_pix_charges SET provider_payment_id = p_charge ->> 'providerPaymentId',
    brcode = p_charge ->> 'brcode', expires_at = (p_charge ->> 'expiresAt')::timestamptz,
    status = 'pending', lease_until = NULL
  WHERE id = p_id AND status = 'creating';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento indisponível.'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.save_tab_pix_charge(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_tab_pix_charge(uuid, jsonb) TO service_role;

-- Marks a charge as failed when the server could not create it at the provider.
CREATE FUNCTION public.fail_tab_pix_charge(p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.tab_pix_charges SET status = 'failed', lease_until = NULL, brcode = NULL
  WHERE id = p_id AND status = 'creating';
$$;
REVOKE ALL ON FUNCTION public.fail_tab_pix_charge(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_tab_pix_charge(uuid) TO service_role;

-- Confirms a PIX confirmed by the provider API (never by the browser). Idempotent. Money received is ALWAYS recorded.
CREATE FUNCTION public.confirm_tab_pix(p_id uuid, p_confirmation jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_charge public.tab_pix_charges; v_tab public.dining_tabs; v_total integer; v_closed boolean := false;
  v_reason text; v_raw text;
BEGIN
  SELECT c.tab_id INTO v_charge.tab_id FROM public.tab_pix_charges c WHERE c.id = p_id;
  IF v_charge.tab_id IS NULL THEN RAISE EXCEPTION 'Pagamento indisponível.'; END IF;
  SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id = v_charge.tab_id FOR UPDATE;
  SELECT * INTO v_charge FROM public.tab_pix_charges c WHERE c.id = p_id FOR UPDATE;
  IF v_charge.status = 'paid' THEN
    RETURN jsonb_build_object('status', 'paid', 'closed', v_tab.status = 'CLOSED', 'needs_review', v_charge.needs_review);
  END IF;
  v_raw := left(COALESCE(p_confirmation ->> 'rawStatus', ''), 40);
  IF COALESCE((p_confirmation ->> 'paid')::boolean, false) IS NOT TRUE THEN
    UPDATE public.tab_pix_charges SET raw_status = v_raw,
      status = CASE WHEN status = 'pending' AND v_raw IN ('rejected','cancelled','canceled','declined') THEN 'failed'
                    WHEN status = 'pending' AND v_raw = 'expired' THEN 'expired' ELSE status END,
      brcode = CASE WHEN v_raw IN ('rejected','cancelled','canceled','declined','expired') THEN NULL ELSE brcode END
    WHERE id = p_id RETURNING * INTO v_charge;
    RETURN jsonb_build_object('status', v_charge.status, 'closed', false, 'needs_review', false);
  END IF;
  IF v_charge.provider_payment_id IS NULL OR p_confirmation ->> 'providerPaymentId' IS DISTINCT FROM v_charge.provider_payment_id
     OR p_confirmation ->> 'orderId' IS DISTINCT FROM ('tab:' || v_charge.tab_id::text)
     OR p_confirmation ->> 'currency' IS DISTINCT FROM 'BRL'
     OR (p_confirmation ->> 'amountCents')::integer IS DISTINCT FROM v_charge.amount_cents THEN
    RAISE EXCEPTION 'Confirmação não corresponde à cobrança.';
  END IF;

  v_total := public._tab_total_cents(v_charge.tenant_id, v_charge.tab_id);
  IF v_tab.status IN ('OPEN','BILL_REQUESTED') AND v_total = v_charge.amount_cents
     AND NOT EXISTS (SELECT 1 FROM public.tab_payments tp WHERE tp.tenant_id = v_charge.tenant_id AND tp.tab_id = v_charge.tab_id) THEN
    INSERT INTO public.tab_payments (tenant_id, tab_id, method, amount_cents, change_given_cents, received_by)
    VALUES (v_charge.tenant_id, v_charge.tab_id, 'PIX', v_charge.amount_cents, 0, NULL);
    UPDATE public.dining_tabs SET status = 'CLOSED', closed_at = now() WHERE id = v_charge.tab_id AND tenant_id = v_charge.tenant_id;
    UPDATE public.waiter_calls SET status = 'HANDLED', handled_at = now()
    WHERE tenant_id = v_charge.tenant_id AND tab_id = v_charge.tab_id AND status = 'OPEN';
    INSERT INTO public.tab_events (tenant_id, tab_id, event_type, actor_id, details)
    VALUES (v_charge.tenant_id, v_charge.tab_id, 'TAB_CLOSED', NULL,
            jsonb_build_object('total_cents', v_total, 'via', 'pix_mercadopago', 'charge_id', v_charge.id));
    v_closed := true;
  ELSE
    v_reason := CASE WHEN v_tab.status NOT IN ('OPEN','BILL_REQUESTED') THEN 'Conta já encerrada quando o PIX foi pago'
                     ELSE 'Total da conta mudou depois do PIX' END;
    IF v_tab.status IN ('OPEN','BILL_REQUESTED') THEN
      INSERT INTO public.waiter_calls (tenant_id, tab_id, type) VALUES (v_charge.tenant_id, v_charge.tab_id, 'HELP');
    END IF;
  END IF;
  UPDATE public.tab_pix_charges SET status = 'paid', paid_at = now(), raw_status = v_raw, brcode = NULL, lease_until = NULL,
    needs_review = NOT v_closed, review_reason = v_reason
  WHERE id = p_id;
  RETURN jsonb_build_object('status', 'paid', 'closed', v_closed, 'needs_review', NOT v_closed);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_tab_pix(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_tab_pix(uuid, jsonb) TO service_role;

-- Latest charge of a tab for a staff user (server passes the verified user id).
CREATE FUNCTION public.get_tab_pix_charge(p_tab uuid, p_user uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_tab public.dining_tabs; v_charge public.tab_pix_charges;
BEGIN
  SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id = p_tab;
  IF NOT FOUND OR NOT public._tab_pix_staff(p_user, v_tab.tenant_id) THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_charge FROM public.tab_pix_charges c WHERE c.tab_id = p_tab ORDER BY c.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('charge', to_jsonb(v_charge) - 'lease_until' - 'created_by',
                            'tab_status', v_tab.status, 'slug', (SELECT t.slug FROM public.tenants t WHERE t.id = v_tab.tenant_id));
END;
$$;
REVOKE ALL ON FUNCTION public.get_tab_pix_charge(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tab_pix_charge(uuid, uuid) TO service_role;

CREATE FUNCTION public.cancel_tab_pix(p_tab uuid, p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tb.tenant_id INTO v_tenant FROM public.dining_tabs tb WHERE tb.id = p_tab;
  IF v_tenant IS NULL OR NOT public._tab_pix_staff(p_user, v_tenant) THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tab_pix_charges SET status = 'cancelled', raw_status = 'staff_cancelled', brcode = NULL, lease_until = NULL
  WHERE tab_id = p_tab AND tenant_id = v_tenant AND status IN ('creating','pending');
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_tab_pix(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_tab_pix(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. LGPD: names are optional in the UI; old table-session names are anonymised on request/schedule.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.anonymize_old_tab_sessions(p_days integer DEFAULT 90) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  IF p_days IS NULL OR p_days < 7 THEN RAISE EXCEPTION 'p_days deve ser >= 7'; END IF;
  UPDATE public.tab_sessions ts SET display_name = 'Cliente', device_id = 'anon-' || replace(ts.id::text, '-', '')
  WHERE ts.expires_at < now() - make_interval(days => p_days)
    AND (ts.display_name <> 'Cliente' OR ts.device_id NOT LIKE 'anon-%')
    AND ts.tab_id IN (SELECT tb.id FROM public.dining_tabs tb WHERE tb.status IN ('CLOSED','CANCELLED'));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.anonymize_old_tab_sessions(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_old_tab_sessions(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Capability probe: the UI shows the new features only when this exists.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.mesas_qr_capabilities() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT jsonb_build_object('version', 1, 'qr_pause', true, 'tab_pix', true, 'table_name_rule', true); $$;
REVOKE ALL ON FUNCTION public.mesas_qr_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesas_qr_capabilities() TO authenticated;

COMMIT;
