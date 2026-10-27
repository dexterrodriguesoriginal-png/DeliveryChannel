-- Reverts 20261027004800_mesas_holder_lock_empty_cancel_waiter_rls.sql
-- Restores the exact functions from 20261027004700_mesas_access.sql and drops the new RPCs, WAITER RLS policies, and invite columns without losing tab/order/session/audit data.
BEGIN;

DROP POLICY IF EXISTS "order_items_waiter_select" ON public.order_items;
DROP POLICY IF EXISTS "orders_waiter_select" ON public.orders;
DROP POLICY IF EXISTS "products_waiter_select" ON public.products;
DROP POLICY IF EXISTS "categories_waiter_select" ON public.categories;
DROP POLICY IF EXISTS "tenant_themes_waiter_select" ON public.tenant_themes;
DROP POLICY IF EXISTS "tenant_settings_waiter_select" ON public.tenant_settings;
DROP POLICY IF EXISTS "tenants_waiter_select" ON public.tenants;

DROP FUNCTION IF EXISTS public.resolve_table_invite(text, text);
DROP FUNCTION IF EXISTS public.release_empty_tab(uuid, text);
DROP FUNCTION IF EXISTS public.staff_create_holder_code(uuid);

UPDATE public.dining_tab_invites
SET revoked_at = COALESCE(revoked_at, now())
WHERE purpose = 'HOLDER' AND revoked_at IS NULL;

ALTER TABLE public.dining_tab_invites
  DROP COLUMN IF EXISTS created_by_staff,
  DROP COLUMN IF EXISTS purpose;

CREATE OR REPLACE FUNCTION public.enter_table(p_qr_token text, p_display_name text, p_device_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_table public.dining_tables;
  v_config jsonb;
  v_mode text;
  v_fee numeric := 0;
  v_release boolean;
  v_tab public.dining_tabs;
  v_sid uuid;
  v_claim boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: entre na sua conta para abrir a mesa.' USING ERRCODE = '42501';
  END IF;
  IF NOT public._customer_identified() THEN
    RAISE EXCEPTION 'IDENTIFICATION_REQUIRED: entre ou cadastre-se para abrir a mesa.' USING ERRCODE = '42501';
  END IF;
  v_name := btrim(COALESCE(p_display_name, ''));
  IF length(v_name) NOT BETWEEN 1 AND 80 OR p_device_id IS NULL OR length(p_device_id) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'INVALID_INPUT: informe seu nome.';
  END IF;
  IF NOT public._rate_limit_hit('table_enter', public._sha256_hex(v_user::text), NULL, 40, 600) THEN
    RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas. Aguarde alguns minutos ou chame um atendente.';
  END IF;
  SELECT dt.* INTO v_table
  FROM public.dining_tables dt
  JOIN public.tenants t ON t.id = dt.tenant_id AND t.status = 'ACTIVE'
  WHERE dt.qr_token = p_qr_token AND dt.active
  FOR UPDATE OF dt;
  IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_UNAVAILABLE: salão indisponível.'; END IF;
  v_config := public._dine_in_config(v_table.tenant_id);
  IF v_config IS NULL THEN RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.'; END IF;
  v_mode := CASE WHEN v_config ->> 'mode' = 'INDIVIDUAL' THEN 'INDIVIDUAL' ELSE 'TABLE' END;

  -- Reopening the browser (or another phone) restores the tab: the session belongs to the customer account.
  SELECT ts.id INTO v_sid
  FROM public.tab_sessions ts
  JOIN public.dining_tabs tb ON tb.id = ts.tab_id AND tb.tenant_id = ts.tenant_id
  WHERE ts.tenant_id = v_table.tenant_id AND ts.auth_user_id = v_user AND ts.ended_at IS NULL AND ts.expires_at > now()
    AND tb.status IN ('OPEN','BILL_REQUESTED') AND tb.table_id = v_table.id
  ORDER BY ts.expires_at DESC LIMIT 1;
  IF v_sid IS NOT NULL THEN RETURN public._table_access_payload(v_sid); END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenant_settings s WHERE s.tenant_id = v_table.tenant_id AND s.is_open)
     AND COALESCE((SELECT (tm.config ->> 'salon_open')::boolean FROM public.tenant_modules tm
                   WHERE tm.tenant_id = v_table.tenant_id AND tm.module_key = 'dine_in'), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'STORE_CLOSED: o salão está fechado no momento.';
  END IF;
  IF public._qr_paused(v_table.tenant_id, v_table.id) THEN
    RAISE EXCEPTION 'QR_PAUSED: o pedido pelo QR está pausado. Chame um atendente.';
  END IF;

  IF v_mode = 'TABLE' THEN
    SELECT tb.* INTO v_tab FROM public.dining_tabs tb
    WHERE tb.tenant_id = v_table.tenant_id AND tb.table_id = v_table.id AND tb.status IN ('OPEN','BILL_REQUESTED')
    ORDER BY tb.opened_at DESC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      IF v_tab.holder_claimable AND v_tab.responsible_user_id IS NULL AND v_tab.status = 'OPEN' THEN
        v_claim := true;
      ELSE
        RETURN jsonb_build_object('state', 'IN_USE', 'tableLabel', v_table.label,
          'storeName', (SELECT COALESCE(th.store_name, t.name) FROM public.tenants t
                        LEFT JOIN public.tenant_themes th ON th.tenant_id = t.id WHERE t.id = v_table.tenant_id));
      END IF;
    END IF;
  END IF;

  v_release := public._release_required(v_table.tenant_id);
  IF v_tab.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.tenant_modules tm WHERE tm.tenant_id = v_table.tenant_id
               AND tm.module_key = 'service_fee' AND tm.enabled) THEN
      v_fee := COALESCE((SELECT NULLIF(tm.config ->> 'percent', '')::numeric
        FROM public.tenant_modules tm WHERE tm.tenant_id = v_table.tenant_id AND tm.module_key = 'service_fee'), 10);
    END IF;
    INSERT INTO public.dining_tabs (tenant_id, mode, table_id, service_fee_percent, responsible_user_id, responsible_since)
    VALUES (v_table.tenant_id, v_mode, v_table.id, v_fee, v_user, now()) RETURNING * INTO v_tab;
  ELSIF v_claim THEN
    UPDATE public.dining_tabs SET responsible_user_id = v_user, responsible_since = now(), holder_claimable = false
    WHERE id = v_tab.id RETURNING * INTO v_tab;
  END IF;

  SELECT ts.id INTO v_sid FROM public.tab_sessions ts
  WHERE ts.tenant_id = v_tab.tenant_id AND ts.tab_id = v_tab.id AND ts.auth_user_id = v_user
  ORDER BY ts.expires_at DESC LIMIT 1;
  IF v_sid IS NULL THEN
    INSERT INTO public.tab_sessions (tenant_id, tab_id, auth_user_id, display_name, device_id, approved_by, approved_at, expires_at, joined_via)
    VALUES (v_tab.tenant_id, v_tab.id, v_user, v_name, p_device_id, NULL,
            CASE WHEN v_release THEN NULL ELSE now() END, now() + interval '12 hours', 'QR')
    RETURNING id INTO v_sid;
  ELSE
    UPDATE public.tab_sessions SET expires_at = now() + interval '12 hours', ended_at = NULL, ended_reason = NULL,
      approved_at = CASE WHEN v_release THEN NULL ELSE now() END, approved_by = NULL, display_name = v_name, joined_via = 'QR'
    WHERE id = v_sid;
  END IF;
  PERFORM public._tab_access_log(v_tab.tenant_id, v_tab.id, CASE WHEN v_claim THEN 'RESPONSIBLE_CLAIMED' ELSE 'RESPONSIBLE_ASSIGNED' END,
                                 'CUSTOMER', v_sid, v_sid);
  RETURN public._table_access_payload(v_sid);
END;
$$;
REVOKE ALL ON FUNCTION public.enter_table(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enter_table(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.join_with_code(p_qr_token text, p_code text, p_display_name text, p_device_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_code text;
  v_table public.dining_tables;
  v_tab public.dining_tabs;
  v_inv public.dining_tab_invites;
  v_sid uuid;
BEGIN
  IF v_user IS NULL OR NOT public._customer_identified() THEN
    RAISE EXCEPTION 'IDENTIFICATION_REQUIRED: entre ou cadastre-se para entrar na mesa.' USING ERRCODE = '42501';
  END IF;
  v_name := btrim(COALESCE(p_display_name, ''));
  IF length(v_name) NOT BETWEEN 1 AND 80 OR p_device_id IS NULL OR length(p_device_id) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'INVALID_INPUT: informe seu nome.';
  END IF;
  SELECT dt.* INTO v_table FROM public.dining_tables dt
  JOIN public.tenants t ON t.id = dt.tenant_id AND t.status = 'ACTIVE'
  WHERE dt.qr_token = p_qr_token AND dt.active FOR UPDATE OF dt;
  IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_UNAVAILABLE: salão indisponível.'; END IF;
  IF NOT public._rate_limit_hit('invite_try_user', public._sha256_hex(v_user::text), v_table.tenant_id, 6, 600)
     OR NOT public._rate_limit_hit('invite_try_table', public._sha256_hex(v_table.id::text), v_table.tenant_id, 30, 600)
     OR NOT public._rate_limit_hit('invite_try_tenant', public._sha256_hex(v_table.tenant_id::text), v_table.tenant_id, 300, 600) THEN
    RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas de código. Aguarde alguns minutos ou chame um atendente.';
  END IF;
  IF public._dine_in_config(v_table.tenant_id) IS NULL THEN RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.'; END IF;
  IF public._qr_paused(v_table.tenant_id, v_table.id) THEN
    RAISE EXCEPTION 'QR_PAUSED: o pedido pelo QR está pausado. Chame um atendente.';
  END IF;
  SELECT tb.* INTO v_tab FROM public.dining_tabs tb
  WHERE tb.tenant_id = v_table.tenant_id AND tb.table_id = v_table.id AND tb.status = 'OPEN'
  ORDER BY tb.opened_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'FREE', 'tableLabel', v_table.label); END IF;
  SELECT ts.id INTO v_sid FROM public.tab_sessions ts
  WHERE ts.tenant_id = v_tab.tenant_id AND ts.tab_id = v_tab.id AND ts.auth_user_id = v_user AND ts.ended_at IS NULL AND ts.expires_at > now();
  IF v_sid IS NOT NULL THEN RETURN public._table_access_payload(v_sid); END IF;

  -- A wrong code must NOT raise: an exception rolls the transaction back and would erase the attempt counter above.
  v_code := upper(regexp_replace(COALESCE(p_code, ''), '[\s-]', '', 'g'));
  IF v_code !~ '^[A-Z2-9]{6}$' THEN RETURN jsonb_build_object('state', 'INVALID_CODE'); END IF;
  SELECT i.* INTO v_inv FROM public.dining_tab_invites i
  WHERE i.tenant_id = v_tab.tenant_id AND i.tab_id = v_tab.id AND i.code = v_code
    AND i.revoked_at IS NULL AND i.expires_at > now() AND i.uses < i.max_uses
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'INVALID_CODE'); END IF;

  SELECT ts.id INTO v_sid FROM public.tab_sessions ts
  WHERE ts.tenant_id = v_tab.tenant_id AND ts.tab_id = v_tab.id AND ts.auth_user_id = v_user
  ORDER BY ts.expires_at DESC LIMIT 1;
  IF v_sid IS NULL THEN
    INSERT INTO public.tab_sessions (tenant_id, tab_id, auth_user_id, display_name, device_id, approved_by, approved_at, expires_at, joined_via)
    VALUES (v_tab.tenant_id, v_tab.id, v_user, v_name, p_device_id, NULL, now(), now() + interval '12 hours', 'INVITE')
    RETURNING id INTO v_sid;
  ELSE
    UPDATE public.tab_sessions SET expires_at = now() + interval '12 hours', ended_at = NULL, ended_reason = NULL,
      approved_at = now(), approved_by = NULL, display_name = v_name, joined_via = 'INVITE'
    WHERE id = v_sid;
  END IF;
  UPDATE public.dining_tab_invites SET uses = uses + 1 WHERE id = v_inv.id;
  PERFORM public._tab_access_log(v_tab.tenant_id, v_tab.id, 'GUEST_JOINED', 'CUSTOMER', v_sid, v_sid, jsonb_build_object('invite_id', v_inv.id));
  RETURN public._table_access_payload(v_sid);
END;
$$;
REVOKE ALL ON FUNCTION public.join_with_code(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_with_code(text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_tab_invite(p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_s public.tab_sessions; v_i public.dining_tab_invites;
BEGIN
  v_s := public._responsible_session(p_session_id);
  SELECT i.* INTO v_i FROM public.dining_tab_invites i
  WHERE i.tenant_id = v_s.tenant_id AND i.tab_id = v_s.tab_id AND i.revoked_at IS NULL AND i.expires_at > now() AND i.uses < i.max_uses
  ORDER BY i.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('code', v_i.code, 'expiresAt', v_i.expires_at, 'uses', v_i.uses);
END;
$$;
REVOKE ALL ON FUNCTION public.get_tab_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tab_invite(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_session(p_session_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_s public.tab_sessions; v_tab public.dining_tabs;
BEGIN
  SELECT ts.* INTO v_s FROM public.tab_sessions ts WHERE ts.id = p_session_id;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_s.tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para recusar esta sessão.' USING ERRCODE = '42501';
  END IF;
  SELECT tb.* INTO v_tab FROM public.dining_tabs tb WHERE tb.id = v_s.tab_id AND tb.tenant_id = v_s.tenant_id FOR UPDATE;
  IF v_tab.status NOT IN ('OPEN') OR v_s.ended_at IS NOT NULL OR v_s.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'SESSION_EXPIRED: esta pessoa já foi liberada ou a sessão terminou.';
  END IF;
  PERFORM public._end_session(v_s.id, 'REJECTED');
  PERFORM public._tab_access_log(v_s.tenant_id, v_s.tab_id, 'SESSION_REJECTED', 'STAFF', auth.uid(), v_s.id);
  IF v_tab.responsible_user_id = v_s.auth_user_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.tenant_id = v_tab.tenant_id AND o.tab_id = v_tab.id)
       AND NOT EXISTS (SELECT 1 FROM public.tab_sessions x WHERE x.tab_id = v_tab.id AND x.tenant_id = v_tab.tenant_id AND x.ended_at IS NULL AND x.expires_at > now()) THEN
      UPDATE public.dining_tabs SET status = 'CANCELLED', closed_at = now() WHERE id = v_tab.id AND tenant_id = v_tab.tenant_id;
    ELSE
      UPDATE public.dining_tabs SET responsible_user_id = NULL, holder_claimable = true WHERE id = v_tab.id AND tenant_id = v_tab.tenant_id;
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.reject_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_session(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_reset_tab_holder(p_tab_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_tab public.dining_tabs; v_sid uuid;
BEGIN
  SELECT tb.* INTO v_tab FROM public.dining_tabs tb WHERE tb.id = p_tab_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_tab.tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para alterar o responsável.' USING ERRCODE = '42501';
  END IF;
  IF v_tab.status NOT IN ('OPEN') THEN RAISE EXCEPTION 'TAB_CLOSED: comanda encerrada.'; END IF;
  FOR v_sid IN SELECT ts.id FROM public.tab_sessions ts
               WHERE ts.tenant_id = v_tab.tenant_id AND ts.tab_id = v_tab.id AND ts.auth_user_id = v_tab.responsible_user_id AND ts.ended_at IS NULL LOOP
    PERFORM public._end_session(v_sid, 'STAFF_RESET');
  END LOOP;
  UPDATE public.dining_tabs SET responsible_user_id = NULL, responsible_since = NULL, holder_claimable = true
  WHERE id = v_tab.id AND tenant_id = v_tab.tenant_id;
  UPDATE public.dining_tab_invites SET revoked_at = now() WHERE tenant_id = v_tab.tenant_id AND tab_id = v_tab.id AND revoked_at IS NULL;
  PERFORM public._tab_access_log(v_tab.tenant_id, v_tab.id, 'HOLDER_RESET', 'STAFF', auth.uid(), NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_reset_tab_holder(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_reset_tab_holder(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mesas_qr_capabilities() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT jsonb_build_object('version', 2, 'qr_pause', true, 'tab_pix', true, 'table_name_rule', true,
                                'table_access', true, 'waiter_app', true); $$;
GRANT EXECUTE ON FUNCTION public.mesas_qr_capabilities() TO anon;

COMMIT;
