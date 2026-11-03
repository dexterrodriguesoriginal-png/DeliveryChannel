-- Rollback: 20261027005000_garcom_v3_bill_flow_and_kds_tracking_down.sql
-- Rollback Garçom v3. Confirmações de pagamento e auditoria existentes são preservadas.
BEGIN;
DROP TRIGGER IF EXISTS garcom_v3_tab_guard ON public.dining_tabs;
DROP TRIGGER IF EXISTS garcom_v3_order_total_guard ON public.orders;
DROP TRIGGER IF EXISTS garcom_v3_membership_revoked ON public.tenant_users;
DROP TRIGGER IF EXISTS garcom_v3_call_accepted ON public.waiter_calls;
DROP TRIGGER IF EXISTS garcom_v3_tab_tracking ON public.dining_tabs;
DROP TRIGGER IF EXISTS garcom_v3_order_tracking ON public.orders;
DROP TABLE IF EXISTS public.dining_tracking_revisions;
DROP INDEX IF EXISTS public.orders_active_queue_v3;
DROP INDEX IF EXISTS public.dining_tabs_one_active_table_v3;
DROP FUNCTION IF EXISTS public._garcom_v3_tab_guard();
DROP FUNCTION IF EXISTS public._garcom_v3_order_total_guard();
DROP FUNCTION IF EXISTS public._garcom_v3_membership_revoked();
DROP FUNCTION IF EXISTS public._garcom_v3_call_accepted();
DROP FUNCTION IF EXISTS public._garcom_v3_tracking_signal();
DROP FUNCTION IF EXISTS public._can_read_dining_tracking(uuid,uuid);
DROP FUNCTION IF EXISTS public._tab_can_collect(uuid,uuid);
DROP FUNCTION IF EXISTS public._waiter_serves_tab(uuid,uuid);


-- 1. Restaurar status de dining_tabs
UPDATE public.dining_tabs SET status = 'BILL_REQUESTED' WHERE status IN ('WAITER_AUTHORIZED', 'AWAITING_PAYMENT');
ALTER TABLE public.dining_tabs DROP CONSTRAINT IF EXISTS dining_tabs_status_check;
ALTER TABLE public.dining_tabs ADD CONSTRAINT dining_tabs_status_check
  CHECK (status IN ('OPEN', 'BILL_REQUESTED', 'CLOSED', 'CANCELLED'));

ALTER TABLE public.dining_tabs DROP COLUMN IF EXISTS waiter_authorized_by;
ALTER TABLE public.dining_tabs DROP COLUMN IF EXISTS waiter_authorized_at;


-- 2. Remover authorize_waiter_to_close
DROP FUNCTION IF EXISTS public.authorize_waiter_to_close(uuid);

-- 3. Restaurar staff_request_bill (versão 4700)
CREATE OR REPLACE FUNCTION public.staff_request_bill(p_tab_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_tab public.dining_tabs;
BEGIN
  SELECT tb.* INTO v_tab FROM public.dining_tabs tb WHERE tb.id = p_tab_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_tab.tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para pedir a conta.' USING ERRCODE = '42501';
  END IF;
  IF public._dine_in_config(v_tab.tenant_id) IS NULL THEN RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.'; END IF;
  IF v_tab.status NOT IN ('OPEN','BILL_REQUESTED') THEN RAISE EXCEPTION 'TAB_CLOSED: comanda encerrada.'; END IF;
  UPDATE public.dining_tabs SET status = 'BILL_REQUESTED' WHERE id = v_tab.id AND tenant_id = v_tab.tenant_id AND status = 'OPEN';
  PERFORM public._tab_access_log(v_tab.tenant_id, v_tab.id, 'BILL_REQUESTED_BY_STAFF', 'STAFF', auth.uid(), NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_request_bill(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_request_bill(uuid) TO authenticated;

-- 4. Restaurar close_tab (versão 0027)
CREATE OR REPLACE FUNCTION public.close_tab(p_tab_id uuid, p_payments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant uuid;
  v_role text;
  v_config jsonb;
  v_tab public.dining_tabs;
  v_subtotal numeric;
  v_fee numeric;
  v_total_cents integer;
  v_paid integer;
  v_payment jsonb;
  v_method text;
  v_amount integer;
  v_change integer;
BEGIN
  SELECT tb.* INTO v_tab FROM public.dining_tabs tb WHERE tb.id = p_tab_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TAB_NOT_FOUND: comanda não encontrada.'; END IF;
  v_tenant := v_tab.tenant_id;
  v_role := public._tenant_role_of_caller(v_tenant);
  IF auth.uid() IS NULL OR COALESCE(v_role, '') NOT IN ('OWNER', 'MANAGER', 'CASHIER', 'WAITER') THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para encerrar a conta.' USING ERRCODE = '42501';
  END IF;
  v_config := public._dine_in_config(v_tenant);
  IF v_config IS NULL THEN RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.'; END IF;
  -- Owner always may close; everyone else must be in close_roles (default OWNER, MANAGER, CASHIER).
  IF v_role <> 'OWNER' AND NOT (COALESCE(v_config -> 'close_roles', '["OWNER","MANAGER","CASHIER"]'::jsonb) ? v_role) THEN
    RAISE EXCEPTION 'FORBIDDEN: seu papel não está autorizado a encerrar contas.' USING ERRCODE = '42501';
  END IF;
  IF v_tab.status NOT IN ('OPEN', 'BILL_REQUESTED') THEN
    RAISE EXCEPTION 'TAB_CLOSED: esta conta já foi encerrada.';
  END IF;
  IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'PAYMENT_REQUIRED: informe ao menos um pagamento.';
  END IF;
  SELECT COALESCE(sum(o.subtotal), 0) INTO v_subtotal FROM public.orders o
  WHERE o.tenant_id = v_tenant AND o.tab_id = p_tab_id AND o.fulfillment_type = 'DINE_IN' AND o.status <> 'CANCELLED';
  v_fee := CASE WHEN v_tab.service_fee_removed THEN 0 ELSE round(v_subtotal * v_tab.service_fee_percent / 100, 2) END;
  v_total_cents := round((v_subtotal + v_fee) * 100)::integer;
  SELECT sum((p.value ->> 'amount_cents')::integer) INTO v_paid FROM jsonb_array_elements(p_payments) p;
  IF v_paid IS DISTINCT FROM v_total_cents THEN
    RAISE EXCEPTION 'PAYMENT_TOTAL_MISMATCH: pagamentos devem totalizar R$ %.', (v_total_cents::numeric / 100);
  END IF;
  FOR v_payment IN SELECT value FROM jsonb_array_elements(p_payments) LOOP
    v_method := v_payment ->> 'method';
    v_amount := (v_payment ->> 'amount_cents')::integer;
    v_change := COALESCE((v_payment ->> 'change_given_cents')::integer, 0);
    IF v_method NOT IN ('CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'PIX', 'CAIXA') OR v_amount <= 0
       OR v_change < 0 OR (v_method <> 'CASH' AND v_change <> 0) OR v_change > v_amount THEN
      RAISE EXCEPTION 'INVALID_PAYMENT: forma ou valor de pagamento inválido.';
    END IF;
    INSERT INTO public.tab_payments (tenant_id, tab_id, method, amount_cents, change_given_cents, received_by)
    VALUES (v_tenant, p_tab_id, v_method, v_amount, v_change, auth.uid());
  END LOOP;
  UPDATE public.dining_tabs SET status = 'CLOSED', closed_at = now()
  WHERE id = p_tab_id AND tenant_id = v_tenant;
  UPDATE public.waiter_calls SET status = 'HANDLED', handled_by = auth.uid(), handled_at = now()
  WHERE tenant_id = v_tenant AND tab_id = p_tab_id AND status = 'OPEN';
  INSERT INTO public.tab_events (tenant_id, tab_id, event_type, actor_id, details)
  VALUES (v_tenant, p_tab_id, 'TAB_CLOSED', auth.uid(), jsonb_build_object('total_cents', v_total_cents, 'service_fee', v_fee));
END;
$$;
REVOKE ALL ON FUNCTION public.close_tab(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_tab(uuid, jsonb) TO authenticated;

-- 5. Restaurar confirm_tab_pix (versão 4600)
CREATE OR REPLACE FUNCTION public.confirm_tab_pix(p_id uuid, p_confirmation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
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

-- 6. Restaurar list_team_directory (versão 4900)
CREATE OR REPLACE FUNCTION public.list_team_directory(p_tenant uuid) RETURNS TABLE (
  id uuid, user_id uuid, role_id text, status text, created_at timestamptz,
  name text, email text, phone text, username text, photo_url text, waiter_active boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_tenant_scoped_role(p_tenant, ARRAY['OWNER', 'MANAGER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para ver a equipe.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT tu.id, tu.user_id, tu.role_id::text, tu.status::text, tu.created_at,
         u.name::text,
         CASE WHEN wp.user_id IS NOT NULL THEN COALESCE(wp.contact_email, '') ELSE COALESCE(u.email, '')::text END,
         COALESCE(wp.phone, u.phone)::text, wp.username, wp.photo_url, wp.active
  FROM public.tenant_users tu
  JOIN public.users u ON u.id = tu.user_id
  LEFT JOIN public.waiter_profiles wp ON wp.user_id = tu.user_id AND wp.tenant_id = tu.tenant_id
  WHERE tu.tenant_id = p_tenant
  ORDER BY tu.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.list_team_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_team_directory(uuid) TO authenticated;

-- 7. Restaurar get_my_tab (versão 4700)
CREATE OR REPLACE FUNCTION public.get_my_tab(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_s public.tab_sessions; v_tab uuid; v_tenant uuid; v_resp boolean;
BEGIN
  SELECT ts.* INTO v_s FROM public.tab_sessions ts
  WHERE ts.id = p_session_id AND ts.auth_user_id = auth.uid()
    AND (ts.expires_at > now() OR (ts.ended_at IS NOT NULL AND ts.ended_at > now() - interval '2 hours'));
  IF NOT FOUND THEN RAISE EXCEPTION 'TAB_NOT_FOUND: comanda não encontrada.' USING ERRCODE = '42501'; END IF;
  v_tab := v_s.tab_id; v_tenant := v_s.tenant_id;
  IF public._dine_in_config(v_tenant) IS NULL THEN
    RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.';
  END IF;
  -- Removed / rejected / reset: tell the customer why, with no tab data.
  IF v_s.ended_at IS NOT NULL AND v_s.ended_reason IS DISTINCT FROM 'TAB_CLOSED' THEN
    RETURN jsonb_build_object('ended', true, 'endedReason', v_s.ended_reason,
      'me', jsonb_build_object('sessionId', v_s.id, 'ended', true, 'endedReason', v_s.ended_reason));
  END IF;
  IF v_s.ended_at IS NULL AND v_s.expires_at < now() + interval '6 hours' THEN
    UPDATE public.tab_sessions SET expires_at = now() + interval '12 hours' WHERE id = v_s.id;
  END IF;
  SELECT tb.responsible_user_id = v_s.auth_user_id INTO v_resp FROM public.dining_tabs tb WHERE tb.id = v_tab AND tb.tenant_id = v_tenant;
  RETURN (
    SELECT jsonb_build_object(
      'tabId', tb.id, 'status', tb.status, 'mode', tb.mode, 'tableLabel', dt.label,
      'serviceFeePercent', tb.service_fee_percent, 'serviceFeeRemoved', tb.service_fee_removed,
      'me', jsonb_build_object('sessionId', v_s.id, 'role', CASE WHEN COALESCE(v_resp, false) THEN 'RESPONSIBLE' ELSE 'GUEST' END,
        'approved', v_s.approved_at IS NOT NULL, 'displayName', v_s.display_name,
        'ended', v_s.ended_at IS NOT NULL, 'endedReason', v_s.ended_reason),
      'responsibleName', (SELECT x.display_name FROM public.tab_sessions x
                          WHERE x.tab_id = tb.id AND x.tenant_id = tb.tenant_id AND x.auth_user_id = tb.responsible_user_id
                          ORDER BY x.expires_at DESC LIMIT 1),
      'members', CASE WHEN COALESCE(v_resp, false) AND v_s.ended_at IS NULL THEN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('sessionId', x.id, 'displayName', x.display_name,
          'role', CASE WHEN x.auth_user_id = tb.responsible_user_id THEN 'RESPONSIBLE' ELSE 'GUEST' END,
          'approved', x.approved_at IS NOT NULL, 'joinedVia', x.joined_via, 'since', x.created_at) ORDER BY x.created_at, x.id)
        FROM public.tab_sessions x
        WHERE x.tab_id = tb.id AND x.tenant_id = tb.tenant_id AND x.ended_at IS NULL AND x.expires_at > now()), '[]'::jsonb)
        ELSE '[]'::jsonb END,
      'rounds', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'orderId', o.id, 'orderNumber', o.order_number, 'roundNo', o.round_no, 'status', o.status,
          'customerName', o.customer_name, 'subtotal', o.subtotal, 'createdAt', o.created_at,
          'mine', o.ordered_by_session_id = v_s.id,
          'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'name', oi.product_name, 'quantity', oi.quantity, 'unitPrice', oi.unit_price,
            'totalPrice', oi.total_price, 'station', oi.station
          ) ORDER BY oi.id) FROM public.order_items oi WHERE oi.order_id = o.id), '[]'::jsonb)
        ) ORDER BY o.round_no) FROM public.orders o
        WHERE o.tab_id = tb.id AND o.tenant_id = tb.tenant_id AND o.fulfillment_type = 'DINE_IN'
      ), '[]'::jsonb),
      'subtotal', COALESCE((SELECT sum(o.subtotal) FROM public.orders o
        WHERE o.tab_id = tb.id AND o.tenant_id = tb.tenant_id AND o.fulfillment_type = 'DINE_IN'
          AND o.status <> 'CANCELLED'), 0)
    ) FROM public.dining_tabs tb JOIN public.dining_tables dt ON dt.id = tb.table_id
    WHERE tb.id = v_tab AND tb.tenant_id = v_tenant
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_tab(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_tab(uuid) TO anon, authenticated;

-- 8. Restaurar _legal_signup_check e _legal_signup_record (versão 0037)
CREATE OR REPLACE FUNCTION public._legal_signup_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.raw_app_meta_data->>'provider' = 'email' THEN
   IF NEW.raw_user_meta_data->>'legal_accepted' IS DISTINCT FROM 'true'
    OR NEW.raw_user_meta_data->>'legal_version' IS DISTINCT FROM public._legal_version()
    OR COALESCE(NEW.raw_user_meta_data->>'legal_audience','') NOT IN ('owner','customer')
   THEN RAISE EXCEPTION 'Aceite obrigatório dos termos atuais.' USING ERRCODE = '22023'; END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._legal_signup_check() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._legal_signup_record() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.raw_app_meta_data->>'provider' = 'email' THEN
 INSERT INTO public.legal_acceptances(user_id,audience,version)
 VALUES(NEW.id,NEW.raw_user_meta_data->>'legal_audience',public._legal_version()) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._legal_signup_record() FROM PUBLIC, anon, authenticated;

-- 9. Restaurar waiter_v2_capabilities (versão 4900)
CREATE OR REPLACE FUNCTION public.waiter_v2_capabilities() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT jsonb_build_object('version', 1, 'username_login', true, 'modes', jsonb_build_array('FREE', 'FIXED', 'CENTRAL'),
                                'report', true, 'my_waiter', true); $$;
REVOKE ALL ON FUNCTION public.waiter_v2_capabilities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waiter_v2_capabilities() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public._tab_pix_staff(p_user uuid, p_tenant uuid) RETURNS boolean
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
CREATE OR REPLACE FUNCTION public.reserve_tab_pix(p_tab uuid, p_user uuid) RETURNS jsonb
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
CREATE OR REPLACE FUNCTION public.get_tab_pix_charge(p_tab uuid, p_user uuid) RETURNS jsonb
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
CREATE OR REPLACE FUNCTION public.cancel_tab_pix(p_tab uuid, p_user uuid) RETURNS void
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
CREATE OR REPLACE FUNCTION public.fail_tab_pix_charge(p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.tab_pix_charges SET status = 'failed', lease_until = NULL, brcode = NULL
  WHERE id = p_id AND status = 'creating';
$$;
CREATE OR REPLACE FUNCTION public.update_order_status(p_order_id uuid, p_new_status text, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_order RECORD;
    v_role TEXT;
    v_new TEXT := upper(btrim(COALESCE(p_new_status, '')));
    v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
    v_actor TEXT;
    v_ok BOOLEAN := false;
    v_restocked INT := 0;
BEGIN
    PERFORM public._assert_online_payment_ready(p_order_id);
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE = '42501';
    END IF;
    IF v_new NOT IN ('PENDING','CONFIRMED','PREPARING','READY','WAITING_FOR_DRIVER','OUT_FOR_DELIVERY','DELIVERED','CANCELLED') THEN
        RAISE EXCEPTION 'INVALID_STATUS: status "%" inválido.', p_new_status;
    END IF;
    IF v_note IS NOT NULL AND length(v_note) > 500 THEN
        RAISE EXCEPTION 'INVALID_NOTE: nota com mais de 500 caracteres.';
    END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END IF;

    IF v_new='OUT_FOR_DELIVERY' AND v_order.fulfillment_type='DELIVERY' THEN
        RAISE EXCEPTION 'PICKUP_CODE_REQUIRED: peça o código ao entregador e confirme a retirada.';
    END IF;
    v_role := public._tenant_role_of_caller(v_order.tenant_id);
    IF v_role IS NULL OR v_role NOT IN ('OWNER','MANAGER','OPERATOR','CASHIER','DELIVERY_MANAGER') THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END IF;

    IF v_order.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'ORDER_CANCELLED_IS_FINAL: pedido cancelado não pode ser reaberto.' USING ERRCODE = '42501';
    END IF;
    IF v_order.status = v_new THEN
        RAISE EXCEPTION 'STATUS_UNCHANGED: o pedido já está em %.', v_new;
    END IF;

    IF v_new = 'CANCELLED' THEN
        IF v_note IS NULL THEN
            RAISE EXCEPTION 'NOTE_REQUIRED: informe o motivo do cancelamento.';
        END IF;
        IF v_role IN ('OWNER','MANAGER') THEN
            v_ok := true;
        ELSIF v_role IN ('OPERATOR','CASHIER') AND v_order.status IN ('PENDING','CONFIRMED') THEN
            v_ok := true;
        END IF;
    ELSIF public._status_rank(v_new) > public._status_rank(v_order.status) THEN
        IF v_role IN ('OWNER','MANAGER') THEN
            v_ok := true;
        ELSIF v_role IN ('OPERATOR','CASHIER') THEN
            v_ok := (v_order.status, v_new) IN (('PENDING','CONFIRMED'), ('CONFIRMED','PREPARING'), ('PREPARING','READY'))
                 OR (v_order.status = 'READY' AND v_new = 'WAITING_FOR_DRIVER' AND v_order.fulfillment_type = 'DELIVERY')
                 OR (v_order.status = 'READY' AND v_new = 'DELIVERED' AND v_order.fulfillment_type = 'PICKUP');
        ELSIF v_role = 'DELIVERY_MANAGER' THEN
            v_ok := (v_order.status, v_new) IN (('WAITING_FOR_DRIVER','OUT_FOR_DELIVERY'), ('OUT_FOR_DELIVERY','DELIVERED'));
        END IF;
    END IF;
    -- retrocesso de status nunca é permitido

    IF NOT v_ok THEN
        RAISE EXCEPTION 'TRANSITION_FORBIDDEN: papel % não pode mudar o pedido de % para %.', v_role, v_order.status, v_new
            USING ERRCODE = '42501';
    END IF;

    -- 1600: entrega marcada pela loja sem código do cliente = override manual com motivo e auditoria.
    IF v_new = 'DELIVERED' AND v_order.fulfillment_type = 'DELIVERY' THEN
        IF v_note IS NULL THEN
            RAISE EXCEPTION 'NOTE_REQUIRED: informe o motivo para concluir a entrega sem o código do cliente.';
        END IF;
        PERFORM public.log_audit_event('DELIVERY_OVERRIDE_NO_CODE', 'orders', 'Entrega concluída pela loja sem código: ' || v_note,
            p_order_id::text, v_order.status::text, 'DELIVERED', v_order.tenant_id);
    END IF;
    -- 2100: retirada com fila de chegada ativa: concluir sem o código do cliente = override com motivo e auditoria.
    IF v_new = 'DELIVERED' AND v_order.fulfillment_type = 'PICKUP'
       AND EXISTS (SELECT 1 FROM public.pickup_arrivals a WHERE a.order_id = p_order_id AND a.handed_over_at IS NULL) THEN
        IF v_note IS NULL THEN
            RAISE EXCEPTION 'PICKUP_CODE_REQUIRED: confirme a retirada com o código do cliente (ou informe o motivo).';
        END IF;
        PERFORM public.log_audit_event('PICKUP_OVERRIDE_NO_CODE', 'orders', 'Retirada concluída sem código: ' || v_note,
            p_order_id::text, v_order.status::text, 'DELIVERED', v_order.tenant_id);
    END IF;
    SELECT COALESCE(NULLIF(u.name, ''), u.email, 'Equipe') INTO v_actor FROM public.users u WHERE u.id = auth.uid();
    v_actor := COALESCE(v_actor, 'Equipe') || ' (' || v_role || ')';

    UPDATE public.orders SET status = v_new, updated_at = now(),
        delivered_at = CASE WHEN v_new = 'DELIVERED' THEN now() ELSE delivered_at END,
        picked_up_at = CASE WHEN v_new = 'OUT_FOR_DELIVERY' THEN COALESCE(picked_up_at, now()) ELSE picked_up_at END
    WHERE id = p_order_id;
    -- 1600: saída marcada pela loja também gera o código de entrega do cliente.
    IF v_new = 'OUT_FOR_DELIVERY' THEN
        UPDATE public.order_handoff_codes SET pickup_confirmed_at = COALESCE(pickup_confirmed_at, now()),
               delivery_code = COALESCE(delivery_code, public._handoff_code()) WHERE order_id = p_order_id;
    END IF;

    IF v_new = 'CANCELLED' THEN
        v_restocked := public._restock_order_items(p_order_id, v_actor);
    END IF;

    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (p_order_id, v_new, COALESCE(v_note, 'Status alterado para ' || v_new), v_actor);

    RETURN jsonb_build_object('order_id', p_order_id, 'previous_status', v_order.status, 'status', v_new,
                              'restocked_products', v_restocked);
END;
$$;
CREATE OR REPLACE FUNCTION public.request_bill(
  p_session_id uuid,
  p_choice text DEFAULT NULL,
  p_cash_tendered_cents integer DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant uuid;
  v_tab uuid;
  v_service_fee_percent numeric;
  v_service_fee_removed boolean;
  v_call uuid;
  v_subtotal numeric;
  v_total_cents integer;
BEGIN
  IF p_choice IS NOT NULL AND p_choice NOT IN ('CAIXA', 'CARD', 'CASH', 'PIX') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_CHOICE: forma de pagamento inválida.';
  END IF;

  SELECT ts.tenant_id, ts.tab_id, tb.service_fee_percent, tb.service_fee_removed
  INTO v_tenant, v_tab, v_service_fee_percent, v_service_fee_removed
  FROM public.tab_sessions ts
  JOIN public.dining_tabs tb ON tb.id = ts.tab_id AND tb.tenant_id = ts.tenant_id
  WHERE ts.id = p_session_id AND ts.auth_user_id = auth.uid() AND ts.expires_at > now()
    AND tb.status IN ('OPEN', 'BILL_REQUESTED')
  FOR UPDATE OF tb;
  IF v_tab IS NULL THEN
    RAISE EXCEPTION 'TAB_NOT_FOUND: comanda não encontrada.' USING ERRCODE = '42501';
  END IF;
  IF public._dine_in_config(v_tenant) IS NULL THEN
    RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.';
  END IF;

  SELECT COALESCE(sum(o.subtotal), 0)
  INTO v_subtotal
  FROM public.orders o
  WHERE o.tenant_id = v_tenant AND o.tab_id = v_tab
    AND o.fulfillment_type = 'DINE_IN' AND o.status <> 'CANCELLED';
  v_total_cents := round((
    v_subtotal + CASE WHEN v_service_fee_removed THEN 0
                      ELSE round(v_subtotal * v_service_fee_percent / 100, 2) END
  ) * 100)::integer;

  IF p_choice = 'CASH'
     AND (p_cash_tendered_cents IS NULL OR p_cash_tendered_cents < v_total_cents) THEN
    RAISE EXCEPTION 'CASH_TENDER_TOO_LOW: valor em dinheiro inferior ao total da conta.';
  END IF;

  UPDATE public.dining_tabs SET status = 'BILL_REQUESTED'
  WHERE id = v_tab AND tenant_id = v_tenant AND status = 'OPEN';
  INSERT INTO public.waiter_calls (
    tenant_id, tab_id, type, payment_choice, cash_tendered_cents
  )
  VALUES (v_tenant, v_tab, 'BILL', p_choice, p_cash_tendered_cents)
  RETURNING id INTO v_call;
  RETURN v_call;
END;
$$;
DO $active$
DECLARE v_sig text; v_def text;
BEGIN
 FOREACH v_sig IN ARRAY ARRAY['public._tenant_module_disable_blockers(uuid,text)','public.call_waiter(uuid,text)','public.request_bill(uuid,text,integer)','public.remove_service_fee(uuid,text)','public._dining_tables_rotate_guard()','public._responsible_session(uuid)','public.enter_table(text,text,text)','public.join_with_code(text,text,text,text)','public.staff_reset_tab_holder(uuid)','public.staff_open_tab(uuid)','public.staff_create_holder_code(uuid)','public.release_empty_tab(uuid,text)','public.resolve_table_invite(text,text)'] LOOP
  v_def:=pg_get_functiondef(v_sig::regprocedure);
  v_def:=replace(v_def,$s$'OPEN', 'BILL_REQUESTED', 'WAITER_AUTHORIZED', 'AWAITING_PAYMENT'$s$,$s$'OPEN', 'BILL_REQUESTED'$s$);
  v_def:=replace(v_def,$s$'OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT'$s$,$s$'OPEN','BILL_REQUESTED'$s$);
  EXECUTE v_def;
 END LOOP;
END $active$;

COMMIT;
