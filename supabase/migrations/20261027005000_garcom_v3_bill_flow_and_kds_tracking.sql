-- Garçom v3 — fluxo de fechar conta, autorização pelo dono, prevenção de fechamento sem pagamento e acompanhamento de pedidos
-- Migration: 20261027005000_garcom_v3_bill_flow_and_kds_tracking.sql
-- Rollback:  supabase/rollback/20261027005000_garcom_v3_bill_flow_and_kds_tracking_down.sql
BEGIN;

DO $pre$
BEGIN
  IF to_regprocedure('public.waiter_v2_capabilities()') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: migration 20261027004900 (Garçom v2) ausente.';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Estado da mesa/comanda: novo ciclo de vida
-- OPEN -> BILL_REQUESTED -> WAITER_AUTHORIZED -> AWAITING_PAYMENT -> CLOSED
-- ---------------------------------------------------------------------------
ALTER TABLE public.dining_tabs DROP CONSTRAINT IF EXISTS dining_tabs_status_check;
ALTER TABLE public.dining_tabs ADD CONSTRAINT dining_tabs_status_check
  CHECK (status IN ('OPEN', 'BILL_REQUESTED', 'WAITER_AUTHORIZED', 'AWAITING_PAYMENT', 'CLOSED', 'CANCELLED'));

ALTER TABLE public.dining_tabs ADD COLUMN IF NOT EXISTS waiter_authorized_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.dining_tabs ADD COLUMN IF NOT EXISTS waiter_authorized_at timestamptz;

ALTER TABLE public.tab_events DROP CONSTRAINT IF EXISTS tab_events_event_type_check;
ALTER TABLE public.tab_events ADD CONSTRAINT tab_events_event_type_check
  CHECK (event_type IN (
    'SESSION_APPROVED', 'SERVICE_FEE_REMOVED', 'ITEM_CANCELLED', 'DISCOUNT', 'TAB_CLOSED',
    'WAITER_AUTHORIZED_TO_CLOSE', 'BILL_REQUESTED'
  ));

-- ---------------------------------------------------------------------------
-- 2. Correção de criação de garçom (A1): isenção de aceite de termos do cliente para garçons criados pelo dono
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._legal_signup_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.raw_user_meta_data->>'waiter')::boolean IS TRUE OR NEW.raw_app_meta_data ? 'waiter_tenant_id' THEN
    RETURN NEW;
  END IF;
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
  IF (NEW.raw_user_meta_data->>'waiter')::boolean IS TRUE OR NEW.raw_app_meta_data ? 'waiter_tenant_id' THEN
    RETURN NEW;
  END IF;
  IF NEW.raw_app_meta_data->>'provider' = 'email' THEN
    INSERT INTO public.legal_acceptances(user_id,audience,version)
    VALUES(NEW.id,NEW.raw_user_meta_data->>'legal_audience',public._legal_version()) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._legal_signup_record() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. B1: Garçom NÃO pode pedir conta por conta própria. Somente cliente ou dono/gerente/caixa.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_request_bill(p_tab_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_tab public.dining_tabs;
BEGIN
  SELECT tb.* INTO v_tab FROM public.dining_tabs tb WHERE tb.id = p_tab_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_tab.tenant_id, ARRAY['OWNER', 'MANAGER', 'CASHIER']) THEN
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

-- ---------------------------------------------------------------------------
-- 4. B3 & B4: Autorizar garçom a fechar a conta (somente OWNER, MANAGER ou CASHIER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authorize_waiter_to_close(p_tab_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tab public.dining_tabs;
  v_role text;
BEGIN
  SELECT tb.* INTO v_tab FROM public.dining_tabs tb WHERE tb.id = p_tab_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TAB_NOT_FOUND: comanda não encontrada.'; END IF;

  v_role := public._tenant_role_of_caller(v_tab.tenant_id);
  IF auth.uid() IS NULL OR COALESCE(v_role, '') NOT IN ('OWNER', 'MANAGER', 'CASHIER') THEN
    RAISE EXCEPTION 'FORBIDDEN: apenas o dono, gerente ou caixa podem autorizar o garçom.' USING ERRCODE = '42501';
  END IF;

  IF v_tab.status NOT IN ('BILL_REQUESTED', 'OPEN') THEN
    RAISE EXCEPTION 'INVALID_STATE: a comanda não está em estado para autorização.';
  END IF;

  UPDATE public.dining_tabs
  SET status = 'WAITER_AUTHORIZED',
      waiter_authorized_by = auth.uid(),
      waiter_authorized_at = now()
  WHERE id = p_tab_id AND tenant_id = v_tab.tenant_id;

  INSERT INTO public.tab_events (tenant_id, tab_id, event_type, actor_id, details)
  VALUES (v_tab.tenant_id, p_tab_id, 'WAITER_AUTHORIZED_TO_CLOSE', auth.uid(),
          jsonb_build_object('authorized_by', auth.uid(), 'authorized_at', now()));
END;
$$;
REVOKE ALL ON FUNCTION public.authorize_waiter_to_close(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_waiter_to_close(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. A5 & B4: Fechamento final de conta com validação estrita (Garçom só fecha se autorizado; PIX só fecha se pago)
-- ---------------------------------------------------------------------------
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

  -- B4: Garçom SÓ pode fechar se o dono autorizou (WAITER_AUTHORIZED).
  IF v_role = 'WAITER' THEN
    IF v_tab.status <> 'WAITER_AUTHORIZED' THEN
      RAISE EXCEPTION 'WAITER_NOT_AUTHORIZED: garçom não autorizado a fechar esta comanda.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_role <> 'OWNER' AND NOT (COALESCE(v_config -> 'close_roles', '["OWNER","MANAGER","CASHIER"]'::jsonb) ? v_role) THEN
      RAISE EXCEPTION 'FORBIDDEN: seu papel não está autorizado a encerrar contas.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_tab.status NOT IN ('OPEN', 'BILL_REQUESTED', 'WAITER_AUTHORIZED', 'AWAITING_PAYMENT') THEN
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

    -- A5: Regra crítica: se o pagamento for PIX, ele SÓ pode fechar se o Pix estiver pago/confirmado!
    IF v_method = 'PIX' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.tab_pix_charges c
        WHERE c.tab_id = p_tab_id AND c.tenant_id = v_tenant
          AND c.status = 'paid' AND c.paid_at IS NOT NULL
          AND c.amount_cents >= v_amount
      ) THEN
        RAISE EXCEPTION 'PIX_NOT_CONFIRMED: o pagamento via Pix ainda não foi confirmado.' USING ERRCODE = 'P0402';
      END IF;
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

-- ---------------------------------------------------------------------------
-- 6. Confirmação de PIX (Mercado Pago): aceitar fechamento em WAITER_AUTHORIZED e AWAITING_PAYMENT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_tab_pix(p_id uuid, p_confirmation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_charge public.tab_pix_charges;
  v_tab public.dining_tabs;
  v_raw text;
  v_total integer;
  v_closed boolean := false;
  v_reason text := null;
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
  IF v_tab.status IN ('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT') AND v_total = v_charge.amount_cents
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
    v_reason := CASE WHEN v_tab.status NOT IN ('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT') THEN 'Conta já encerrada quando o PIX foi pago'
                     ELSE 'Total da conta mudou depois do PIX' END;
    IF v_tab.status IN ('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT') THEN
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

-- ---------------------------------------------------------------------------
-- 7. A2: Diretório da equipe filtra inativos
-- ---------------------------------------------------------------------------
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
    AND tu.status <> 'INACTIVE'
  ORDER BY tu.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.list_team_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_team_directory(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. C4 & C5: get_my_tab com timestamps da linha do tempo e posição da fila (LGPD compliant)
-- ---------------------------------------------------------------------------
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
      'waiterAuthorized', tb.status = 'WAITER_AUTHORIZED',
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
          'confirmedAt', (SELECT max(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'CONFIRMED'),
          'preparingAt', (SELECT max(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'PREPARING'),
          'readyAt', (SELECT max(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'READY'),
          'deliveredAt', (SELECT max(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'DELIVERED'),
          'queuePosition', CASE WHEN o.status IN ('PENDING', 'CONFIRMED', 'PREPARING') THEN (
            SELECT count(*) + 1 FROM public.orders act
            WHERE act.tenant_id = tb.tenant_id
              AND act.status IN ('PENDING', 'CONFIRMED', 'PREPARING')
              AND act.created_at < o.created_at
          ) ELSE NULL END,
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

-- ---------------------------------------------------------------------------
-- 9. Capabilities v3
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.waiter_v2_capabilities() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT jsonb_build_object(
  'version', 2,
  'username_login', true,
  'modes', jsonb_build_array('FREE', 'FIXED', 'CENTRAL'),
  'report', true,
  'my_waiter', true,
  'bill_flow_v3', true,
  'order_tracking', true
); $$;
REVOKE ALL ON FUNCTION public.waiter_v2_capabilities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waiter_v2_capabilities() TO anon, authenticated;

COMMIT;
