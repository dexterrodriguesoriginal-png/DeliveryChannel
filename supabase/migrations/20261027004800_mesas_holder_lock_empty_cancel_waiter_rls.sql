-- Mesas e QR Code — Trava de segurança do responsável ("Trocar responsável" com código único de 5 min),
-- liberação de mesa aberta sem consumo (R$ 0,00), pré-visualização segura de convite e RLS do papel WAITER.
-- Forward migration. Revert: supabase/rollback/20261027004800_mesas_holder_lock_empty_cancel_waiter_rls_down.sql
-- Requires: 20261027004700_mesas_access.sql
BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.dining_tab_invites') IS NULL OR to_regclass('public.tab_access_events') IS NULL
     OR to_regprocedure('public.enter_table(text,text,text)') IS NULL
     OR to_regprocedure('public.join_with_code(text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK 20261027004800: aplique antes a migration 20261027004700_mesas_access.';
  END IF;
  IF to_regprocedure('public.staff_create_holder_code(uuid)') IS NOT NULL
     OR to_regprocedure('public.release_empty_tab(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK 20261027004800: objetos já existem.';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Colunas aditivas em dining_tab_invites para suportar código de troca de responsável (uso único, 5 min)
-- ---------------------------------------------------------------------------
ALTER TABLE public.dining_tab_invites
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'GUEST' CHECK (purpose IN ('GUEST', 'HOLDER')),
  ADD COLUMN IF NOT EXISTS created_by_staff uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Nenhuma comanda ocupada deve ficar auto-reivindicável por desconhecidos lendo o QR da mesa.
UPDATE public.dining_tabs SET holder_claimable = false WHERE holder_claimable = true;

-- ---------------------------------------------------------------------------
-- 2. Parte A: Mesa ocupada sem responsável fica TRAVADA (nunca auto-reivindicável no QR da mesa)
-- ---------------------------------------------------------------------------
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

  -- Se o cliente já tem sessão viva nesta comanda, restaura normalmente.
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

  -- Em modo TABLE, qualquer comanda aberta (mesmo sem responsável ou R$ 0 aberta pelo garçom) está TRAVADA:
  -- ninguém assume sozinho lendo o QR da mesa. Só entra com convite válido ou código de troca do garçom.
  IF v_mode = 'TABLE' THEN
    SELECT tb.* INTO v_tab FROM public.dining_tabs tb
    WHERE tb.tenant_id = v_table.tenant_id AND tb.table_id = v_table.id AND tb.status IN ('OPEN','BILL_REQUESTED')
    ORDER BY tb.opened_at DESC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      RETURN jsonb_build_object('state', 'IN_USE', 'tableLabel', v_table.label,
        'storeName', (SELECT COALESCE(th.store_name, t.name) FROM public.tenants t
                      LEFT JOIN public.tenant_themes th ON th.tenant_id = t.id WHERE t.id = v_table.tenant_id));
    END IF;
  END IF;

  v_release := public._release_required(v_table.tenant_id);
  IF EXISTS (SELECT 1 FROM public.tenant_modules tm WHERE tm.tenant_id = v_table.tenant_id
             AND tm.module_key = 'service_fee' AND tm.enabled) THEN
    v_fee := COALESCE((SELECT NULLIF(tm.config ->> 'percent', '')::numeric
      FROM public.tenant_modules tm WHERE tm.tenant_id = v_table.tenant_id AND tm.module_key = 'service_fee'), 10);
  END IF;
  INSERT INTO public.dining_tabs (tenant_id, mode, table_id, service_fee_percent, responsible_user_id, responsible_since, holder_claimable)
  VALUES (v_table.tenant_id, v_mode, v_table.id, v_fee, v_user, now(), false) RETURNING * INTO v_tab;

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
  PERFORM public._tab_access_log(v_tab.tenant_id, v_tab.id, 'RESPONSIBLE_ASSIGNED', 'CUSTOMER', v_sid, v_sid);
  RETURN public._table_access_payload(v_sid);
END;
$$;
REVOKE ALL ON FUNCTION public.enter_table(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enter_table(text, text, text) TO authenticated;

-- Recusar sessão do responsável: se não há pedidos nem outras sessões, cancela a comanda;
-- caso contrário, deixa sem responsável e TRAVADA (holder_claimable = false).
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
    IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.tenant_id = v_tab.tenant_id AND o.tab_id = v_tab.id AND o.status <> 'CANCELLED')
       AND NOT EXISTS (SELECT 1 FROM public.tab_sessions x WHERE x.tab_id = v_tab.id AND x.tenant_id = v_tab.tenant_id AND x.ended_at IS NULL AND x.expires_at > now()) THEN
      UPDATE public.dining_tabs SET status = 'CANCELLED', closed_at = now() WHERE id = v_tab.id AND tenant_id = v_tab.tenant_id;
    ELSE
      UPDATE public.dining_tabs SET responsible_user_id = NULL, responsible_since = NULL, holder_claimable = false
      WHERE id = v_tab.id AND tenant_id = v_tab.tenant_id;
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.reject_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_session(uuid) TO authenticated;

-- Legado: staff_reset_tab_holder também deixa a mesa TRAVADA (holder_claimable = false), nunca aberta a estranhos.
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
  IF v_tab.status NOT IN ('OPEN', 'BILL_REQUESTED') THEN RAISE EXCEPTION 'TAB_CLOSED: comanda encerrada.'; END IF;
  FOR v_sid IN SELECT ts.id FROM public.tab_sessions ts
               WHERE ts.tenant_id = v_tab.tenant_id AND ts.tab_id = v_tab.id AND ts.auth_user_id = v_tab.responsible_user_id AND ts.ended_at IS NULL LOOP
    PERFORM public._end_session(v_sid, 'STAFF_RESET');
  END LOOP;
  UPDATE public.dining_tabs SET responsible_user_id = NULL, responsible_since = NULL, holder_claimable = false
  WHERE id = v_tab.id AND tenant_id = v_tab.tenant_id;
  UPDATE public.dining_tab_invites SET revoked_at = now() WHERE tenant_id = v_tab.tenant_id AND tab_id = v_tab.id AND revoked_at IS NULL;
  PERFORM public._tab_access_log(v_tab.tenant_id, v_tab.id, 'HOLDER_RESET', 'STAFF', auth.uid(), NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_reset_tab_holder(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_reset_tab_holder(uuid) TO authenticated;

-- Novo fluxo seguro: "Trocar responsável" gera um QR / código de 6 caracteres de USO ÚNICO que expira em 5 minutos
-- e fica somente na tela da equipe (dono, gerente, garçom ou caixa).
CREATE OR REPLACE FUNCTION public.staff_create_holder_code(p_tab_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tab public.dining_tabs;
  v_table public.dining_tables;
  v_slug text;
  v_sid uuid;
  v_code text;
  v_exp timestamptz;
  v_try integer := 0;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_staff_user uuid;
BEGIN
  SELECT tb.* INTO v_tab FROM public.dining_tabs tb WHERE tb.id = p_tab_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_tab.tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para trocar o responsável desta mesa.' USING ERRCODE = '42501';
  END IF;
  IF v_tab.status NOT IN ('OPEN', 'BILL_REQUESTED') THEN
    RAISE EXCEPTION 'TAB_CLOSED: comanda encerrada.';
  END IF;
  SELECT dt.* INTO v_table FROM public.dining_tables dt WHERE dt.id = v_tab.table_id AND dt.tenant_id = v_tab.tenant_id;
  SELECT t.slug INTO v_slug FROM public.tenants t WHERE t.id = v_tab.tenant_id;

  -- Encerra a sessão do responsável anterior (celular perdido / troca presencial) e trava a mesa até o código ser lido.
  IF v_tab.responsible_user_id IS NOT NULL THEN
    FOR v_sid IN SELECT ts.id FROM public.tab_sessions ts
                 WHERE ts.tenant_id = v_tab.tenant_id AND ts.tab_id = v_tab.id AND ts.auth_user_id = v_tab.responsible_user_id AND ts.ended_at IS NULL LOOP
      PERFORM public._end_session(v_sid, 'STAFF_RESET');
    END LOOP;
  END IF;

  UPDATE public.dining_tabs
  SET responsible_user_id = NULL, responsible_since = NULL, holder_claimable = false
  WHERE id = v_tab.id AND tenant_id = v_tab.tenant_id;

  UPDATE public.dining_tab_invites
  SET revoked_at = now()
  WHERE tenant_id = v_tab.tenant_id AND tab_id = v_tab.id AND revoked_at IS NULL;

  SELECT u.id INTO v_staff_user FROM public.users u WHERE u.id = auth.uid();
  v_exp := now() + interval '5 minutes';

  LOOP
    v_bytes := extensions.gen_random_bytes(6);
    v_code := '';
    FOR i IN 0..5 LOOP
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    END LOOP;
    BEGIN
      INSERT INTO public.dining_tab_invites (tenant_id, tab_id, code, created_by_session, created_by_staff, expires_at, max_uses, purpose)
      VALUES (v_tab.tenant_id, v_tab.id, v_code, NULL, v_staff_user, v_exp, 1, 'HOLDER');
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_try := v_try + 1;
      IF v_try > 5 THEN RAISE EXCEPTION 'Não foi possível gerar o código. Tente novamente.'; END IF;
    END;
  END LOOP;

  PERFORM public._tab_access_log(v_tab.tenant_id, v_tab.id, 'HOLDER_CODE_CREATED', 'STAFF', auth.uid(), NULL,
    jsonb_build_object('ttl_minutes', 5, 'max_uses', 1));

  RETURN jsonb_build_object(
    'code', v_code,
    'expiresAt', v_exp,
    'qrToken', v_table.qr_token,
    'tableLabel', v_table.label,
    'tenantSlug', v_slug
  );
END;
$$;
REVOKE ALL ON FUNCTION public.staff_create_holder_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_create_holder_code(uuid) TO authenticated;

-- get_tab_invite do cliente responsável só retorna convites de convidados (purpose = 'GUEST').
CREATE OR REPLACE FUNCTION public.get_tab_invite(p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_s public.tab_sessions; v_i public.dining_tab_invites;
BEGIN
  v_s := public._responsible_session(p_session_id);
  SELECT i.* INTO v_i FROM public.dining_tab_invites i
  WHERE i.tenant_id = v_s.tenant_id AND i.tab_id = v_s.tab_id AND i.purpose = 'GUEST'
    AND i.revoked_at IS NULL AND i.expires_at > now() AND i.uses < i.max_uses
  ORDER BY i.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('code', v_i.code, 'expiresAt', v_i.expires_at, 'uses', v_i.uses);
END;
$$;
REVOKE ALL ON FUNCTION public.get_tab_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tab_invite(uuid) TO authenticated;

-- join_with_code: suporta tanto o convite do responsável (purpose = 'GUEST') quanto o código único da equipe
-- para assumir como responsável (purpose = 'HOLDER').
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
  v_old_resp uuid;
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
  WHERE tb.tenant_id = v_table.tenant_id AND tb.table_id = v_table.id AND tb.status IN ('OPEN', 'BILL_REQUESTED')
  ORDER BY tb.opened_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'FREE', 'tableLabel', v_table.label); END IF;

  v_code := upper(regexp_replace(COALESCE(p_code, ''), '[\s-]', '', 'g'));
  IF v_code ~ '^[A-Z2-9]{6}$' THEN
    SELECT i.* INTO v_inv FROM public.dining_tab_invites i
    WHERE i.tenant_id = v_tab.tenant_id AND i.tab_id = v_tab.id AND i.code = v_code
      AND i.revoked_at IS NULL AND i.expires_at > now() AND i.uses < i.max_uses
    FOR UPDATE;
  END IF;

  -- Se o cliente já tem sessão ativa na comanda e NÃO está usando um código HOLDER válido, devolve a sessão atual (idempotente).
  SELECT ts.id INTO v_sid FROM public.tab_sessions ts
  WHERE ts.tenant_id = v_tab.tenant_id AND ts.tab_id = v_tab.id AND ts.auth_user_id = v_user AND ts.ended_at IS NULL AND ts.expires_at > now()
  ORDER BY ts.expires_at DESC LIMIT 1;
  IF v_sid IS NOT NULL AND (v_inv.id IS NULL OR v_inv.purpose <> 'HOLDER') THEN
    RETURN public._table_access_payload(v_sid);
  END IF;

  IF v_inv.id IS NULL THEN
    RETURN jsonb_build_object('state', 'INVALID_CODE');
  END IF;

  -- Convite de convidado só funciona com comanda OPEN; código de responsável (HOLDER) funciona em OPEN ou BILL_REQUESTED.
  IF v_inv.purpose = 'GUEST' AND v_tab.status <> 'OPEN' THEN
    RETURN jsonb_build_object('state', 'INVALID_CODE');
  END IF;

  IF v_inv.purpose = 'HOLDER' THEN
    v_old_resp := v_tab.responsible_user_id;
    IF v_old_resp IS NOT NULL AND v_old_resp IS DISTINCT FROM v_user THEN
      PERFORM public._end_session(ts.id, 'STAFF_RESET') FROM public.tab_sessions ts
      WHERE ts.tenant_id = v_tab.tenant_id AND ts.tab_id = v_tab.id AND ts.auth_user_id = v_old_resp AND ts.ended_at IS NULL;
    END IF;
    UPDATE public.dining_tabs
    SET responsible_user_id = v_user, responsible_since = now(), holder_claimable = false
    WHERE id = v_tab.id AND tenant_id = v_tab.tenant_id;

    SELECT ts.id INTO v_sid FROM public.tab_sessions ts
    WHERE ts.tenant_id = v_tab.tenant_id AND ts.tab_id = v_tab.id AND ts.auth_user_id = v_user
    ORDER BY ts.expires_at DESC LIMIT 1;
    IF v_sid IS NULL THEN
      INSERT INTO public.tab_sessions (tenant_id, tab_id, auth_user_id, display_name, device_id, approved_by, approved_at, expires_at, joined_via)
      VALUES (v_tab.tenant_id, v_tab.id, v_user, v_name, p_device_id, v_inv.created_by_staff, now(), now() + interval '12 hours', 'STAFF')
      RETURNING id INTO v_sid;
    ELSE
      UPDATE public.tab_sessions SET expires_at = now() + interval '12 hours', ended_at = NULL, ended_reason = NULL,
        approved_at = now(), approved_by = COALESCE(v_inv.created_by_staff, approved_by), display_name = v_name, joined_via = 'STAFF'
      WHERE id = v_sid;
    END IF;
    -- Uso único: consome e revoga imediatamente.
    UPDATE public.dining_tab_invites SET uses = uses + 1, revoked_at = now() WHERE id = v_inv.id;
    PERFORM public._tab_access_log(v_tab.tenant_id, v_tab.id, 'RESPONSIBLE_CLAIMED', 'CUSTOMER', v_sid, v_sid,
      jsonb_build_object('invite_id', v_inv.id, 'staff_id', v_inv.created_by_staff));
    RETURN public._table_access_payload(v_sid);
  END IF;

  -- Fluxo padrão de convidado (purpose = 'GUEST')
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

-- ---------------------------------------------------------------------------
-- 3. Parte D: Liberar mesa aberta sem consumo (R$ 0,00 e sem pedidos)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_empty_tab(p_tab_id uuid, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tab public.dining_tabs;
  v_reason text := left(btrim(COALESCE(p_reason, '')), 120);
BEGIN
  SELECT tb.* INTO v_tab FROM public.dining_tabs tb WHERE tb.id = p_tab_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_tab.tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para liberar esta mesa.' USING ERRCODE = '42501';
  END IF;
  IF v_tab.status NOT IN ('OPEN', 'BILL_REQUESTED') THEN
    RAISE EXCEPTION 'TAB_CLOSED: esta comanda já foi encerrada.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.tenant_id = v_tab.tenant_id AND o.tab_id = v_tab.id
      AND o.fulfillment_type = 'DINE_IN' AND o.status <> 'CANCELLED'
  ) OR public._tab_total_cents(v_tab.tenant_id, v_tab.id) > 0 THEN
    RAISE EXCEPTION 'TAB_HAS_ORDERS: esta comanda possui pedidos ativos; use o fechamento de conta.';
  END IF;

  -- O trigger dining_tabs_close_sessions encerra automaticamente todas as tab_sessions e revoga convites.
  UPDATE public.dining_tabs
  SET status = 'CANCELLED', closed_at = now(), holder_claimable = false
  WHERE id = v_tab.id AND tenant_id = v_tab.tenant_id;

  UPDATE public.waiter_calls
  SET status = 'CANCELLED',
      handled_by = (SELECT u.id FROM public.users u WHERE u.id = auth.uid()),
      handled_at = now()
  WHERE tenant_id = v_tab.tenant_id AND tab_id = v_tab.id AND status = 'OPEN';

  PERFORM public._tab_access_log(
    v_tab.tenant_id,
    v_tab.id,
    'TAB_RELEASED_EMPTY',
    'STAFF',
    auth.uid(),
    NULL,
    CASE WHEN v_reason <> '' THEN jsonb_build_object('reason', v_reason) ELSE '{}'::jsonb END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.release_empty_tab(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_empty_tab(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Parte F: Pré-visualização pública segura do link de convite (&convite=CODIGO)
-- Permite abrir direto a tela de boas-vindas "<Responsável> convidou você para a Mesa X · <Loja>"
-- antes mesmo do login, nunca caindo em "Esta mesa já está em uso".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_table_invite(p_qr_token text, p_code text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_table public.dining_tables;
  v_tenant public.tenants;
  v_theme public.tenant_themes;
  v_tab public.dining_tabs;
  v_inv public.dining_tab_invites;
  v_code text;
  v_resp_name text;
BEGIN
  IF p_qr_token IS NULL OR length(p_qr_token) NOT BETWEEN 8 AND 128 THEN
    RETURN jsonb_build_object('available', false, 'valid', false);
  END IF;
  IF NOT public._rate_limit_hit('table_qr_resolve_ip', public._request_ip_hash(), NULL, 300, 60)
     OR NOT public._rate_limit_hit('table_qr_resolve_token', public._sha256_hex(p_qr_token), NULL, 120, 60) THEN
    RAISE EXCEPTION 'RATE_LIMITED: muitas consultas. Tente novamente em instantes.';
  END IF;

  SELECT dt.* INTO v_table
  FROM public.dining_tables dt
  WHERE dt.qr_token = p_qr_token AND dt.active
    AND public._dine_in_config(dt.tenant_id) IS NOT NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('available', false, 'valid', false);
  END IF;

  SELECT t.* INTO v_tenant FROM public.tenants t WHERE t.id = v_table.tenant_id AND t.status = 'ACTIVE';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('available', false, 'valid', false);
  END IF;

  SELECT th.* INTO v_theme FROM public.tenant_themes th WHERE th.tenant_id = v_tenant.id;

  v_code := upper(regexp_replace(COALESCE(p_code, ''), '[\s-]', '', 'g'));
  IF v_code !~ '^[A-Z2-9]{6}$' THEN
    RETURN jsonb_build_object(
      'available', true,
      'valid', false,
      'tenantSlug', v_tenant.slug,
      'storeName', COALESCE(v_theme.store_name, v_tenant.name),
      'logoUrl', v_theme.logo_url,
      'primaryColor', v_theme.primary_color,
      'tableLabel', v_table.label
    );
  END IF;

  SELECT tb.* INTO v_tab
  FROM public.dining_tabs tb
  WHERE tb.tenant_id = v_table.tenant_id AND tb.table_id = v_table.id AND tb.status IN ('OPEN', 'BILL_REQUESTED')
  ORDER BY tb.opened_at DESC LIMIT 1;

  IF FOUND THEN
    SELECT i.* INTO v_inv
    FROM public.dining_tab_invites i
    WHERE i.tenant_id = v_tab.tenant_id AND i.tab_id = v_tab.id AND i.code = v_code
      AND i.revoked_at IS NULL AND i.expires_at > now() AND i.uses < i.max_uses
      AND (i.purpose = 'HOLDER' OR v_tab.status = 'OPEN')
    LIMIT 1;
  END IF;

  IF v_inv.id IS NULL THEN
    RETURN jsonb_build_object(
      'available', true,
      'valid', false,
      'tenantSlug', v_tenant.slug,
      'storeName', COALESCE(v_theme.store_name, v_tenant.name),
      'logoUrl', v_theme.logo_url,
      'primaryColor', v_theme.primary_color,
      'tableLabel', v_table.label
    );
  END IF;

  IF v_inv.purpose = 'HOLDER' THEN
    v_resp_name := 'Equipe da loja';
  ELSE
    SELECT x.display_name INTO v_resp_name
    FROM public.tab_sessions x
    WHERE x.tab_id = v_tab.id AND x.tenant_id = v_tab.tenant_id
      AND (x.id = v_inv.created_by_session OR x.auth_user_id = v_tab.responsible_user_id)
    ORDER BY x.expires_at DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'valid', true,
    'purpose', v_inv.purpose,
    'tenantSlug', v_tenant.slug,
    'storeName', COALESCE(v_theme.store_name, v_tenant.name),
    'logoUrl', v_theme.logo_url,
    'primaryColor', v_theme.primary_color,
    'tableLabel', v_table.label,
    'responsibleName', COALESCE(NULLIF(btrim(v_resp_name), ''), 'Responsável')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_table_invite(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_table_invite(text, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Parte H: RLS de leitura para o papel WAITER (/garcom)
-- Garante que um usuário com vínculo WAITER ativo possa ler os dados da loja,
-- configurações, tema, cardápio e rodadas de salão (DINE_IN) sem cair em "Salão desligado".
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenants_waiter_select" ON public.tenants;
CREATE POLICY "tenants_waiter_select" ON public.tenants
  FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(id, ARRAY['WAITER']));

DROP POLICY IF EXISTS "tenant_settings_waiter_select" ON public.tenant_settings;
CREATE POLICY "tenant_settings_waiter_select" ON public.tenant_settings
  FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['WAITER']));

DROP POLICY IF EXISTS "tenant_themes_waiter_select" ON public.tenant_themes;
CREATE POLICY "tenant_themes_waiter_select" ON public.tenant_themes
  FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['WAITER']));

DROP POLICY IF EXISTS "categories_waiter_select" ON public.categories;
CREATE POLICY "categories_waiter_select" ON public.categories
  FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['WAITER']));

DROP POLICY IF EXISTS "products_waiter_select" ON public.products;
CREATE POLICY "products_waiter_select" ON public.products
  FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['WAITER']));

DROP POLICY IF EXISTS "orders_waiter_select" ON public.orders;
CREATE POLICY "orders_waiter_select" ON public.orders
  FOR SELECT TO authenticated
  USING (fulfillment_type = 'DINE_IN' AND public.has_tenant_scoped_role(tenant_id, ARRAY['WAITER']));

DROP POLICY IF EXISTS "order_items_waiter_select" ON public.order_items;
CREATE POLICY "order_items_waiter_select" ON public.order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = public.order_items.order_id
        AND o.fulfillment_type = 'DINE_IN'
        AND public.has_tenant_scoped_role(o.tenant_id, ARRAY['WAITER'])
    )
  );

CREATE OR REPLACE FUNCTION public.mesas_qr_capabilities() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT jsonb_build_object('version', 3, 'qr_pause', true, 'tab_pix', true, 'table_name_rule', true,
                                'table_access', true, 'waiter_app', true,
                                'holder_code', true, 'empty_release', true, 'invite_preview', true); $$;
GRANT EXECUTE ON FUNCTION public.mesas_qr_capabilities() TO anon, authenticated;

COMMIT;
