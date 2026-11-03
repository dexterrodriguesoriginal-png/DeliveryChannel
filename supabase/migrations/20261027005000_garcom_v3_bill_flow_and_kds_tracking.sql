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


DO $active$
DECLARE v_sig text; v_def text;
BEGIN
 FOREACH v_sig IN ARRAY ARRAY['public._tenant_module_disable_blockers(uuid,text)','public.call_waiter(uuid,text)','public.request_bill(uuid,text,integer)','public.remove_service_fee(uuid,text)','public._dining_tables_rotate_guard()','public._responsible_session(uuid)','public.enter_table(text,text,text)','public.join_with_code(text,text,text,text)','public.staff_reset_tab_holder(uuid)','public.staff_open_tab(uuid)','public.staff_create_holder_code(uuid)','public.release_empty_tab(uuid,text)','public.resolve_table_invite(text,text)'] LOOP
  v_def:=pg_get_functiondef(v_sig::regprocedure);
  v_def:=replace(v_def,$s$'OPEN', 'BILL_REQUESTED'$s$,$s$'OPEN', 'BILL_REQUESTED', 'WAITER_AUTHORIZED', 'AWAITING_PAYMENT'$s$);
  v_def:=replace(v_def,$s$'OPEN','BILL_REQUESTED'$s$,$s$'OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT'$s$);
  EXECUTE v_def;
 END LOOP;
END $active$;

-- ---------------------------------------------------------------------------
-- 2. Correção de criação de garçom (A1): isenção de aceite de termos do cliente para garçons criados pelo dono
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._legal_signup_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(NEW.raw_app_meta_data->>'waiter_tenant_id','') ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' THEN
    IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = (NEW.raw_app_meta_data->>'waiter_tenant_id')::uuid) THEN
      RETURN NEW;
    END IF;
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
  IF COALESCE(NEW.raw_app_meta_data->>'waiter_tenant_id','') ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' THEN
    IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = (NEW.raw_app_meta_data->>'waiter_tenant_id')::uuid) THEN
      RETURN NEW;
    END IF;
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

  IF public._dine_in_config(v_tab.tenant_id) IS NULL THEN RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.'; END IF;
  IF v_tab.status <> 'BILL_REQUESTED' THEN
    RAISE EXCEPTION 'INVALID_STATE: a comanda não está em estado para autorização.';
  END IF;

  UPDATE public.dining_tabs
  SET status = 'WAITER_AUTHORIZED',
      waiter_authorized_by = auth.uid(),
      waiter_authorized_at = now()
  WHERE id = p_tab_id AND tenant_id = v_tab.tenant_id;

  PERFORM public._tab_access_log(v_tab.tenant_id, p_tab_id, 'WAITER_AUTHORIZED_TO_CLOSE', 'STAFF', auth.uid(), NULL,
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
    IF NOT public._tab_can_collect(p_tab_id, auth.uid()) THEN
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

  IF EXISTS (SELECT 1 FROM public.tab_pix_charges c WHERE c.tenant_id=v_tenant AND c.tab_id=p_tab_id AND c.status IN ('creating','pending')) THEN
    RAISE EXCEPTION 'PIX_NOT_CONFIRMED: cancele o Pix pendente antes de confirmar outro pagamento.' USING ERRCODE='P0402';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tab_payments tp WHERE tp.tenant_id=v_tenant AND tp.tab_id=p_tab_id) THEN
    RAISE EXCEPTION 'PAYMENT_ALREADY_RECORDED: pagamento já registrado; confira a conta.';
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
    IF v_method IS NULL OR v_amount IS NULL OR v_method NOT IN ('CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'PIX', 'CAIXA') OR v_amount <= 0
       OR v_change < 0 OR (v_method <> 'CASH' AND v_change <> 0) THEN
      RAISE EXCEPTION 'INVALID_PAYMENT: forma ou valor de pagamento inválido.';
    END IF;

    -- A5: Regra crítica: se o pagamento for PIX, ele SÓ pode fechar se o Pix estiver pago/confirmado!
    IF v_method = 'PIX' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.tab_pix_charges c
        WHERE c.tab_id = p_tab_id AND c.tenant_id = v_tenant
          AND c.status = 'paid' AND c.paid_at IS NOT NULL
          AND NOT c.needs_review AND c.amount_cents = v_total_cents
          AND v_amount = v_total_cents AND jsonb_array_length(p_payments)=1
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
    IF v_charge.status NOT IN ('creating','pending') THEN
      UPDATE public.dining_tabs SET status=CASE WHEN waiter_authorized_at IS NOT NULL AND waiter_authorized_by IS NOT NULL THEN 'WAITER_AUTHORIZED' ELSE 'BILL_REQUESTED' END WHERE id=v_charge.tab_id AND tenant_id=v_charge.tenant_id AND status='AWAITING_PAYMENT' AND NOT EXISTS (SELECT 1 FROM public.tab_pix_charges c WHERE c.tenant_id=v_charge.tenant_id AND c.tab_id=v_charge.tab_id AND c.status IN ('creating','pending'));
    END IF;
    RETURN jsonb_build_object('status', v_charge.status, 'closed', false, 'needs_review', false);
  END IF;
  IF v_charge.provider_payment_id IS NULL OR p_confirmation ->> 'providerPaymentId' IS DISTINCT FROM v_charge.provider_payment_id
     OR p_confirmation ->> 'orderId' IS DISTINCT FROM ('tab:' || v_charge.tab_id::text)
     OR p_confirmation ->> 'currency' IS DISTINCT FROM 'BRL'
     OR (p_confirmation ->> 'amountCents')::integer IS DISTINCT FROM v_charge.amount_cents THEN
    RAISE EXCEPTION 'Confirmação não corresponde à cobrança.';
  END IF;

  v_total := public._tab_total_cents(v_charge.tenant_id, v_charge.tab_id);
  IF v_charge.status = 'pending' AND v_tab.status = 'AWAITING_PAYMENT' AND v_total = v_charge.amount_cents
     AND NOT EXISTS (SELECT 1 FROM public.tab_payments tp WHERE tp.tenant_id = v_charge.tenant_id AND tp.tab_id = v_charge.tab_id) THEN
    -- Record provider confirmation before the close guard checks the payment ledger.
    UPDATE public.tab_pix_charges SET status='paid', paid_at=now(), needs_review=false WHERE id=p_id AND tenant_id=v_charge.tenant_id;
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
          'confirmedAt', (SELECT min(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'CONFIRMED'),
          'preparingAt', (SELECT min(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'PREPARING'),
          'readyAt', (SELECT min(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'READY'),
          'servedAt', (SELECT min(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'OUT_FOR_DELIVERY'),
          'deliveredAt', (SELECT min(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'DELIVERED'),
          'queuePosition', CASE WHEN o.status IN ('PENDING', 'CONFIRMED', 'PREPARING') THEN (
            SELECT count(*) + 1 FROM public.orders act
            WHERE act.tenant_id = tb.tenant_id
              AND act.status IN ('PENDING', 'CONFIRMED', 'PREPARING')
              AND (act.created_at, act.id) < (o.created_at, o.id)
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
    ) FROM public.dining_tabs tb JOIN public.dining_tables dt ON dt.id = tb.table_id AND dt.tenant_id=tb.tenant_id
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

-- 10. A comanda, e não uma configuração global, autoriza a cobrança pelo garçom.
CREATE FUNCTION public._waiter_serves_tab(p_tab uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.dining_tabs tb
  JOIN public.tenant_users tu ON tu.tenant_id=tb.tenant_id AND tu.user_id=p_user AND tu.status='ACTIVE' AND tu.role_id='WAITER'
  JOIN public.tenants t ON t.id=tb.tenant_id AND t.status='ACTIVE'
  WHERE tb.id=p_tab AND public._dine_in_config(tb.tenant_id) IS NOT NULL AND COALESCE((public._dine_in_config(tb.tenant_id)->>'salon_open')::boolean,true)
   AND NOT EXISTS (SELECT 1 FROM public.waiter_profiles wp WHERE wp.tenant_id=tb.tenant_id AND wp.user_id=p_user AND NOT wp.active)
   AND (EXISTS (SELECT 1 FROM public.waiter_table_assignments a WHERE a.tenant_id=tb.tenant_id AND a.table_id=tb.table_id AND a.waiter_id=p_user)
    OR (NOT EXISTS (SELECT 1 FROM public.waiter_table_assignments a WHERE a.tenant_id=tb.tenant_id AND a.table_id=tb.table_id)
     AND (tb.waiter_id IS NULL OR tb.waiter_id=p_user OR NOT EXISTS (
      SELECT 1 FROM public.tenant_users w WHERE w.tenant_id=tb.tenant_id AND w.user_id=tb.waiter_id AND w.role_id='WAITER' AND w.status='ACTIVE'))))
 );
$$;
REVOKE ALL ON FUNCTION public._waiter_serves_tab(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public._tab_can_collect(p_tab uuid,p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.dining_tabs tb JOIN public.tenant_users tu ON tu.tenant_id=tb.tenant_id AND tu.user_id=p_user AND tu.status='ACTIVE'
  JOIN public.tenants t ON t.id=tb.tenant_id AND t.status='ACTIVE'
  WHERE tb.id=p_tab AND public._dine_in_config(tb.tenant_id) IS NOT NULL AND COALESCE((public._dine_in_config(tb.tenant_id)->>'salon_open')::boolean,true) AND (
   tu.role_id='OWNER' OR (tu.role_id IN ('MANAGER','CASHIER') AND COALESCE(public._dine_in_config(tb.tenant_id)->'close_roles','["OWNER","MANAGER","CASHIER"]'::jsonb) ? tu.role_id)
   OR (tu.role_id='WAITER' AND tb.status IN ('WAITER_AUTHORIZED','AWAITING_PAYMENT','CLOSED') AND tb.waiter_authorized_at IS NOT NULL AND tb.waiter_authorized_by IS NOT NULL AND public._waiter_serves_tab(p_tab,p_user)))
 );
$$;
REVOKE ALL ON FUNCTION public._tab_can_collect(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._tab_pix_staff(p_user uuid,p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM public.tenant_users tu JOIN public.tenants t ON t.id=tu.tenant_id
  WHERE tu.tenant_id=p_tenant AND tu.user_id=p_user AND tu.status='ACTIVE' AND t.status='ACTIVE'
   AND tu.role_id IN ('OWNER','MANAGER','CASHIER','WAITER'));
$$;

CREATE OR REPLACE FUNCTION public.reserve_tab_pix(p_tab uuid,p_user uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tab public.dining_tabs; v_total integer; v_charge public.tab_pix_charges; v_claimed boolean:=false; v_slug text; v_label text;
BEGIN
 SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id=p_tab FOR UPDATE;
 IF NOT FOUND OR NOT public._tab_can_collect(p_tab,p_user) THEN RAISE EXCEPTION 'Acesso negado: garçom precisa de autorização para esta conta.' USING ERRCODE='42501'; END IF;
 IF v_tab.status NOT IN ('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT') THEN RAISE EXCEPTION 'Comanda encerrada.'; END IF;
 IF NOT public._rate_limit_hit('tab_pix_create',public._sha256_hex(p_tab::text),v_tab.tenant_id,10,600) THEN RAISE EXCEPTION 'Muitas tentativas de gerar o PIX. Aguarde.'; END IF;
 IF EXISTS (SELECT 1 FROM public.tab_payments tp WHERE tp.tenant_id=v_tab.tenant_id AND tp.tab_id=p_tab) THEN RAISE EXCEPTION 'Comanda com pagamento registrado.'; END IF;
 v_total:=public._tab_total_cents(v_tab.tenant_id,p_tab);
 IF v_total<=0 THEN RAISE EXCEPTION 'Comanda sem itens para cobrar.'; END IF;
 SELECT * INTO v_charge FROM public.tab_pix_charges c WHERE c.tenant_id=v_tab.tenant_id AND c.tab_id=p_tab AND c.status IN ('creating','pending') FOR UPDATE;
 IF FOUND THEN
  IF v_charge.status='pending' AND v_charge.expires_at IS NOT NULL AND v_charge.expires_at<=now() THEN
   UPDATE public.tab_pix_charges SET status='expired',brcode=NULL WHERE id=v_charge.id AND tenant_id=v_tab.tenant_id; v_charge:=NULL;
  ELSIF v_charge.amount_cents<>v_total THEN
   UPDATE public.tab_pix_charges SET status='cancelled',raw_status='total_changed',brcode=NULL WHERE id=v_charge.id AND tenant_id=v_tab.tenant_id; v_charge:=NULL;
  ELSIF v_charge.status='creating' AND (v_charge.lease_until IS NULL OR v_charge.lease_until<=now()) THEN
   UPDATE public.tab_pix_charges SET lease_until=now()+interval '45 seconds' WHERE id=v_charge.id AND tenant_id=v_tab.tenant_id RETURNING * INTO v_charge; v_claimed:=true;
  END IF;
 END IF;
 IF v_charge.id IS NULL THEN
  INSERT INTO public.tab_pix_charges(tenant_id,tab_id,amount_cents,lease_until,created_by)
  VALUES(v_tab.tenant_id,p_tab,v_total,now()+interval '45 seconds',p_user) RETURNING * INTO v_charge; v_claimed:=true;
 END IF;
 UPDATE public.dining_tabs SET status='AWAITING_PAYMENT' WHERE id=p_tab AND tenant_id=v_tab.tenant_id;
 SELECT t.slug INTO v_slug FROM public.tenants t WHERE t.id=v_tab.tenant_id;
 SELECT dt.label INTO v_label FROM public.dining_tables dt WHERE dt.id=v_tab.table_id AND dt.tenant_id=v_tab.tenant_id;
 RETURN jsonb_build_object('charge',to_jsonb(v_charge)-'lease_until'-'created_by','claimed',v_claimed,'slug',v_slug,'table_label',v_label);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_tab_pix(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_tab_pix(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_tab_pix_charge(p_tab uuid,p_user uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tab public.dining_tabs; v_charge public.tab_pix_charges;
BEGIN
 SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id=p_tab;
 IF NOT FOUND OR NOT public._tab_can_collect(p_tab,p_user) THEN RAISE EXCEPTION 'Acesso negado.' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_charge FROM public.tab_pix_charges c WHERE c.tab_id=p_tab AND c.tenant_id=v_tab.tenant_id ORDER BY c.created_at DESC,c.id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('charge',to_jsonb(v_charge)-'lease_until'-'created_by','tab_status',v_tab.status,'slug',(SELECT t.slug FROM public.tenants t WHERE t.id=v_tab.tenant_id));
END;
$$;
REVOKE ALL ON FUNCTION public.get_tab_pix_charge(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_tab_pix_charge(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_tab_pix(p_tab uuid,p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tab public.dining_tabs;
BEGIN
 SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id=p_tab FOR UPDATE;
 IF NOT FOUND OR NOT public._tab_can_collect(p_tab,p_user) THEN RAISE EXCEPTION 'Acesso negado.' USING ERRCODE='42501'; END IF;
 UPDATE public.tab_pix_charges SET status='cancelled',raw_status='staff_cancelled',brcode=NULL,lease_until=NULL
 WHERE tab_id=p_tab AND tenant_id=v_tab.tenant_id AND status IN ('creating','pending');
 UPDATE public.dining_tabs SET status=CASE WHEN waiter_authorized_at IS NOT NULL AND waiter_authorized_by IS NOT NULL THEN 'WAITER_AUTHORIZED' ELSE 'BILL_REQUESTED' END
 WHERE id=p_tab AND tenant_id=v_tab.tenant_id AND status='AWAITING_PAYMENT';
 PERFORM public._tab_access_log(v_tab.tenant_id,p_tab,'PIX_CANCELLED','STAFF',p_user,NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_tab_pix(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_tab_pix(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_tab_pix_charge(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tab uuid; v_tenant uuid;
BEGIN
 SELECT c.tab_id,c.tenant_id INTO v_tab,v_tenant FROM public.tab_pix_charges c WHERE c.id=p_id;
 PERFORM 1 FROM public.dining_tabs tb WHERE tb.id=v_tab AND tb.tenant_id=v_tenant FOR UPDATE;
 UPDATE public.tab_pix_charges SET status='failed',lease_until=NULL,brcode=NULL WHERE id=p_id AND tenant_id=v_tenant AND status='creating';
 IF FOUND AND NOT EXISTS(SELECT 1 FROM public.tab_pix_charges c WHERE c.tenant_id=v_tenant AND c.tab_id=v_tab AND c.status IN ('creating','pending')) THEN
  UPDATE public.dining_tabs SET status=CASE WHEN waiter_authorized_at IS NOT NULL AND waiter_authorized_by IS NOT NULL THEN 'WAITER_AUTHORIZED' ELSE 'BILL_REQUESTED' END
  WHERE id=v_tab AND tenant_id=v_tenant AND status='AWAITING_PAYMENT';
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fail_tab_pix_charge(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_tab_pix_charge(uuid) TO service_role;

-- Defesa adicional ao RPC: nenhuma atualização consegue encerrar uma conta devedora.
CREATE FUNCTION public._garcom_v3_tab_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_total integer; v_paid bigint; v_pix bigint;
BEGIN
 IF OLD.status IN ('CLOSED','CANCELLED') AND NEW.status IS DISTINCT FROM OLD.status THEN
  RAISE EXCEPTION 'TAB_CLOSED: esta comanda não pode ser reaberta.';
 END IF;
 IF (NEW.service_fee_removed,NEW.service_fee_percent) IS DISTINCT FROM (OLD.service_fee_removed,OLD.service_fee_percent)
  AND EXISTS(SELECT 1 FROM public.tab_pix_charges c WHERE c.tenant_id=OLD.tenant_id AND c.tab_id=OLD.id AND c.status IN ('creating','pending')) THEN
  RAISE EXCEPTION 'TAB_PAYMENT_IN_PROGRESS: cancele a cobrança antes de alterar o total.';
 END IF;
 IF NEW.status='CANCELLED' AND OLD.status<>'CANCELLED' AND public._tab_total_cents(OLD.tenant_id,OLD.id)>0 THEN
  RAISE EXCEPTION 'PAYMENT_REQUIRED: conta com consumo só encerra após pagamento.';
 END IF;
 IF NEW.status='CLOSED' AND OLD.status<>'CLOSED' THEN
  v_total:=public._tab_total_cents(OLD.tenant_id,OLD.id);
  SELECT COALESCE(sum(tp.amount_cents),0),COALESCE(sum(tp.amount_cents) FILTER(WHERE tp.method='PIX'),0) INTO v_paid,v_pix
   FROM public.tab_payments tp WHERE tp.tenant_id=OLD.tenant_id AND tp.tab_id=OLD.id;
  IF v_total<=0 OR v_paid<>v_total THEN RAISE EXCEPTION 'PAYMENT_REQUIRED: pagamento integral confirmado é obrigatório.' USING ERRCODE='P0402'; END IF;
  IF v_pix>0 AND NOT EXISTS(SELECT 1 FROM public.tab_pix_charges c WHERE c.tenant_id=OLD.tenant_id AND c.tab_id=OLD.id AND c.status='paid' AND c.paid_at IS NOT NULL AND NOT c.needs_review AND c.amount_cents=v_pix) THEN
   RAISE EXCEPTION 'PIX_NOT_CONFIRMED: pagamento Pix ainda não confirmado.' USING ERRCODE='P0402';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._garcom_v3_tab_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER garcom_v3_tab_guard BEFORE UPDATE ON public.dining_tabs FOR EACH ROW EXECUTE FUNCTION public._garcom_v3_tab_guard();

CREATE FUNCTION public._garcom_v3_order_total_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tab public.dining_tabs;
BEGIN
 IF TG_OP='UPDATE' AND OLD.fulfillment_type='DINE_IN' AND OLD.tab_id IS NOT NULL
  AND (NEW.tenant_id,NEW.tab_id,NEW.fulfillment_type) IS DISTINCT FROM (OLD.tenant_id,OLD.tab_id,OLD.fulfillment_type) THEN
  RAISE EXCEPTION 'INVALID_INPUT: pedido de mesa não pode trocar de comanda.';
 END IF;
 IF NEW.fulfillment_type<>'DINE_IN' OR NEW.tab_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id=NEW.tab_id AND tb.tenant_id=NEW.tenant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TAB_NOT_FOUND: comanda não encontrada.'; END IF;
 IF TG_OP='INSERT' THEN
  IF v_tab.status<>'OPEN' THEN RAISE EXCEPTION 'TAB_PAYMENT_IN_PROGRESS: a conta foi solicitada; chame um atendente.'; END IF;
 ELSIF (NEW.subtotal,NEW.status='CANCELLED') IS DISTINCT FROM (OLD.subtotal,OLD.status='CANCELLED') THEN
  IF v_tab.status IN ('CLOSED','CANCELLED','AWAITING_PAYMENT') OR EXISTS(SELECT 1 FROM public.tab_pix_charges c WHERE c.tab_id=v_tab.id AND c.tenant_id=v_tab.tenant_id AND c.status IN ('creating','pending')) THEN
   RAISE EXCEPTION 'TAB_PAYMENT_IN_PROGRESS: cancele a cobrança antes de alterar o total.';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._garcom_v3_order_total_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER garcom_v3_order_total_guard BEFORE INSERT OR UPDATE OF tenant_id,tab_id,fulfillment_type,subtotal,status ON public.orders FOR EACH ROW EXECUTE FUNCTION public._garcom_v3_order_total_guard();

-- Revogar o vínculo remove também a presença/atribuições antigas, sem tocar em outras lojas.
CREATE FUNCTION public._garcom_v3_membership_revoked() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.role_id='WAITER' AND (NEW.status<>'ACTIVE' OR NEW.role_id<>'WAITER') THEN
  UPDATE public.waiter_profiles SET active=false WHERE tenant_id=OLD.tenant_id AND user_id=OLD.user_id AND active;
  DELETE FROM public.waiter_table_assignments WHERE tenant_id=OLD.tenant_id AND waiter_id=OLD.user_id;
  DELETE FROM public.waiter_table_helpers WHERE tenant_id=OLD.tenant_id AND waiter_id=OLD.user_id;
  DELETE FROM public.waiter_presence WHERE tenant_id=OLD.tenant_id AND user_id=OLD.user_id;
  UPDATE public.waiter_calls SET escalated_at=now(),accepted_by=NULL,accepted_at=NULL
   WHERE tenant_id=OLD.tenant_id AND status='OPEN' AND (assigned_to=OLD.user_id OR accepted_by=OLD.user_id);
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._garcom_v3_membership_revoked() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER garcom_v3_membership_revoked AFTER UPDATE OF role_id,status ON public.tenant_users FOR EACH ROW EXECUTE FUNCTION public._garcom_v3_membership_revoked();

CREATE FUNCTION public._garcom_v3_call_accepted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.accepted_by IS NOT NULL AND NEW.accepted_by IS DISTINCT FROM OLD.accepted_by THEN
  UPDATE public.dining_tabs tb SET waiter_id=NEW.accepted_by
   WHERE tb.id=NEW.tab_id AND tb.tenant_id=NEW.tenant_id AND (tb.waiter_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.tenant_users tu WHERE tu.tenant_id=tb.tenant_id AND tu.user_id=tb.waiter_id AND tu.role_id='WAITER' AND tu.status='ACTIVE'));
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._garcom_v3_call_accepted() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER garcom_v3_call_accepted AFTER UPDATE OF accepted_by ON public.waiter_calls FOR EACH ROW EXECUTE FUNCTION public._garcom_v3_call_accepted();

-- Realtime público só transporta um sinal da própria comanda. A fila vem do RPC, sem pedidos de terceiros.
CREATE TABLE public.dining_tracking_revisions(
 tenant_id uuid NOT NULL,tab_id uuid PRIMARY KEY,revision timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,tab_id) REFERENCES public.dining_tabs(tenant_id,id) ON DELETE CASCADE
);
ALTER TABLE public.dining_tracking_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dining_tracking_revisions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.dining_tracking_revisions TO anon,authenticated;
GRANT ALL ON public.dining_tracking_revisions TO service_role;
CREATE FUNCTION public._can_read_dining_tracking(p_tenant uuid,p_tab uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.has_tenant_scoped_role(p_tenant,ARRAY['OWNER','MANAGER','CASHIER','WAITER']) OR EXISTS(
  SELECT 1 FROM public.tab_sessions ts WHERE ts.tenant_id=p_tenant AND ts.tab_id=p_tab AND ts.auth_user_id=auth.uid()
   AND ((ts.ended_at IS NULL AND ts.expires_at>now()) OR (ts.ended_reason='TAB_CLOSED' AND ts.ended_at>now()-interval '2 hours'))
 );
$$;
REVOKE ALL ON FUNCTION public._can_read_dining_tracking(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._can_read_dining_tracking(uuid,uuid) TO anon,authenticated;
CREATE POLICY dining_tracking_own ON public.dining_tracking_revisions FOR SELECT TO anon,authenticated
 USING(public._can_read_dining_tracking(tenant_id,tab_id));
INSERT INTO public.dining_tracking_revisions(tenant_id,tab_id) SELECT tenant_id,id FROM public.dining_tabs;
CREATE FUNCTION public._garcom_v3_tracking_signal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='dining_tabs' THEN
  INSERT INTO public.dining_tracking_revisions(tenant_id,tab_id,revision) VALUES(NEW.tenant_id,NEW.id,clock_timestamp()) ON CONFLICT(tab_id) DO UPDATE SET revision=EXCLUDED.revision;
 ELSE
  INSERT INTO public.dining_tracking_revisions(tenant_id,tab_id,revision)
   SELECT tb.tenant_id,tb.id,clock_timestamp() FROM public.dining_tabs tb WHERE tb.tenant_id=NEW.tenant_id AND tb.status IN ('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT')
   ON CONFLICT(tab_id) DO UPDATE SET revision=EXCLUDED.revision;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._garcom_v3_tracking_signal() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER garcom_v3_tab_tracking AFTER INSERT OR UPDATE OF status ON public.dining_tabs FOR EACH ROW EXECUTE FUNCTION public._garcom_v3_tracking_signal();
CREATE TRIGGER garcom_v3_order_tracking AFTER INSERT OR UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public._garcom_v3_tracking_signal();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.dining_tracking_revisions; END IF;
END $$;
CREATE INDEX orders_active_queue_v3 ON public.orders(tenant_id,created_at,id) WHERE status IN ('PENDING','CONFIRMED','PREPARING');
CREATE UNIQUE INDEX dining_tabs_one_active_table_v3 ON public.dining_tabs(tenant_id,table_id) WHERE mode='TABLE' AND status IN ('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT');

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
    IF v_role IS NULL OR v_role NOT IN ('OWNER','MANAGER','OPERATOR','CASHIER','DELIVERY_MANAGER','WAITER') THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END IF;

    IF v_role='WAITER' AND (v_order.fulfillment_type<>'DINE_IN' OR NOT public._waiter_serves_tab(v_order.tab_id,auth.uid())) THEN
      RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE='42501';
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
                 OR (v_order.status = 'READY' AND v_new = 'DELIVERED' AND v_order.fulfillment_type = 'PICKUP')
                 OR (v_order.fulfillment_type='DINE_IN' AND (v_order.status,v_new) IN (('READY','OUT_FOR_DELIVERY'),('OUT_FOR_DELIVERY','DELIVERED')));
        ELSIF v_role='WAITER' THEN
            v_ok := v_order.fulfillment_type='DINE_IN' AND (v_order.status,v_new) IN (('READY','OUT_FOR_DELIVERY'),('OUT_FOR_DELIVERY','DELIVERED'));
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
    IF v_new = 'OUT_FOR_DELIVERY' AND v_order.fulfillment_type='DELIVERY' THEN
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
  WHERE ts.id = p_session_id AND ts.auth_user_id = auth.uid() AND ts.expires_at > now() AND ts.ended_at IS NULL AND ts.approved_at IS NOT NULL
    AND tb.status IN ('OPEN', 'BILL_REQUESTED', 'WAITER_AUTHORIZED', 'AWAITING_PAYMENT')
  FOR UPDATE OF tb;
  IF v_tab IS NULL THEN
    RAISE EXCEPTION 'TAB_NOT_FOUND: comanda não encontrada.' USING ERRCODE = '42501';
  END IF;
  IF public._tenant_role_of_caller(v_tenant)='WAITER' THEN RAISE EXCEPTION 'FORBIDDEN: garçom não pode iniciar o fechamento da conta.' USING ERRCODE='42501'; END IF;
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
COMMIT;
