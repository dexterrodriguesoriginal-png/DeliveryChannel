-- Mesas e QR Code — modelo de acesso à mesa (Responsável, convite, aprovação do garçom, sessões presas à conta).
-- Forward migration. Revert: supabase/rollback/20261027004700_mesas_access_down.sql
-- Requires: 20261027004600_mesas_qr.sql. Additive columns/tables; rewrites 6 functions (precheck compares their body hash with the audited one).
BEGIN;

DO $pre$
DECLARE r record;
BEGIN
  IF to_regprocedure('public.mesas_qr_capabilities()') IS NULL OR to_regprocedure('public._qr_paused(uuid,uuid)') IS NULL
     OR to_regclass('public.tab_sessions') IS NULL OR to_regclass('public.dining_tabs') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK mesas_access: aplique antes a migration 20261027004600 (Mesas e QR Code).';
  END IF;
  IF to_regprocedure('public._rate_limit_hit(text,text,uuid,integer,integer)') IS NULL OR to_regprocedure('public._sha256_hex(text)') IS NULL
     OR to_regprocedure('public._request_ip_hash()') IS NULL OR to_regprocedure('public.has_tenant_scoped_role(uuid,text[])') IS NULL
     OR to_regprocedure('public._tenant_role_of_caller(uuid)') IS NULL OR to_regprocedure('public._dine_in_config(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK mesas_access: helpers de segurança ausentes.';
  END IF;
  IF to_regclass('public.dining_tab_invites') IS NOT NULL OR to_regclass('public.tab_access_events') IS NOT NULL
     OR to_regprocedure('public.enter_table(text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK mesas_access: objetos já existem; estado diferente do auditado.';
  END IF;
  -- Rewritten functions must still be exactly the audited ones (compares the stored body text, independent of server version).
  FOR r IN SELECT * FROM (VALUES
    ('public.open_or_join_tab(text,text,text)', 'f1f6ee77b98651ad8c7c90a5bf144727'),
    ('public.submit_round(jsonb,uuid,uuid,uuid)', 'db329d3639c3b326c4101e5c3f175066'),
    ('public.approve_session(uuid)', 'd7af76980a2bf78668a4f70d82b3facb'),
    ('public.get_my_tab(uuid)', '2bbbb81d8f0f136a808e94ed2b03790e'),
    ('public.resolve_table_qr(text)', '1326f38f7d5abd5d4dc4a24af300f18c'),
    ('public.anonymize_old_tab_sessions(integer)', '562839b61c25b4bf0fc50d3c84ad6e86'),
    ('public.mesas_qr_capabilities()', 'f792645c0702083acf384141ceec1b82')
  ) v(sig, h) LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(r.sig)) IS DISTINCT FROM r.h THEN
      RAISE EXCEPTION 'PRECHECK mesas_access: % foi alterada fora do esperado; revise antes de aplicar.', r.sig;
    END IF;
  END LOOP;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Colunas novas (todas opcionais: comandas e sessões existentes continuam válidas)
-- ---------------------------------------------------------------------------
ALTER TABLE public.dining_tabs
  ADD COLUMN IF NOT EXISTS responsible_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS responsible_since timestamptz,
  ADD COLUMN IF NOT EXISTS holder_claimable boolean NOT NULL DEFAULT false;

ALTER TABLE public.tab_sessions
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_reason text CHECK (ended_reason IS NULL OR ended_reason IN ('REMOVED','STAFF_RESET','TAB_CLOSED','REJECTED','TRANSFERRED')),
  ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS joined_via text NOT NULL DEFAULT 'QR' CHECK (joined_via IN ('QR','INVITE','STAFF'));
CREATE INDEX IF NOT EXISTS tab_sessions_pending_idx ON public.tab_sessions (tenant_id, tab_id) WHERE approved_at IS NULL AND ended_at IS NULL;

-- Código de convite (curto, expira, revogável). Só funções SECURITY DEFINER leem/escrevem; o cliente nunca acessa a tabela.
CREATE TABLE public.dining_tab_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tab_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z2-9]{6}$'),
  created_by_session uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
  max_uses integer NOT NULL DEFAULT 12 CHECK (max_uses BETWEEN 1 AND 50),
  FOREIGN KEY (tenant_id, tab_id) REFERENCES public.dining_tabs(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX dining_tab_invites_active_code ON public.dining_tab_invites (tab_id, code) WHERE revoked_at IS NULL;
CREATE INDEX dining_tab_invites_tab ON public.dining_tab_invites (tenant_id, tab_id, created_at DESC);
ALTER TABLE public.dining_tab_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dining_tab_invites FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.dining_tab_invites TO service_role;

-- Trilha de acesso (quem entrou, removeu, transferiu, aprovou/recusou). Só ids de sessão/usuário de equipe: sem telefone nem nome.
CREATE TABLE public.tab_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tab_id uuid NOT NULL,
  event text NOT NULL CHECK (char_length(event) BETWEEN 3 AND 40),
  actor_kind text NOT NULL CHECK (actor_kind IN ('CUSTOMER','STAFF','SYSTEM')),
  actor_ref uuid,
  target_session_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, tab_id) REFERENCES public.dining_tabs(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX tab_access_events_tab ON public.tab_access_events (tenant_id, tab_id, created_at);
ALTER TABLE public.tab_access_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tab_access_events_staff_read ON public.tab_access_events FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER','WAITER','CASHIER']));
REVOKE ALL ON public.tab_access_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tab_access_events TO authenticated;
GRANT ALL ON public.tab_access_events TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Helpers internos
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._customer_identified() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT auth.uid() IS NOT NULL AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false $$;
REVOKE ALL ON FUNCTION public._customer_identified() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._release_required(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT COALESCE((public._dine_in_config(p_tenant) ->> 'release_required')::boolean, true) $$;
REVOKE ALL ON FUNCTION public._release_required(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._tab_access_log(p_tenant uuid, p_tab uuid, p_event text, p_kind text, p_actor uuid, p_target uuid, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$ INSERT INTO public.tab_access_events (tenant_id, tab_id, event, actor_kind, actor_ref, target_session_id, details)
      VALUES (p_tenant, p_tab, p_event, p_kind, p_actor, p_target, COALESCE(p_details, '{}'::jsonb)) $$;
REVOKE ALL ON FUNCTION public._tab_access_log(uuid, uuid, text, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._end_session(p_session uuid, p_reason text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$ UPDATE public.tab_sessions SET expires_at = LEAST(expires_at, now()), ended_at = now(), ended_reason = p_reason
      WHERE id = p_session AND ended_at IS NULL $$;
REVOKE ALL ON FUNCTION public._end_session(uuid, text) FROM PUBLIC, anon, authenticated;

-- Closing/cancelling a tab ends every session and revokes invites (no matter which function closed it: staff, PIX, cancel).
CREATE FUNCTION public._dining_tabs_close_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.tab_sessions SET expires_at = LEAST(expires_at, now()), ended_at = now(), ended_reason = 'TAB_CLOSED'
  WHERE tenant_id = NEW.tenant_id AND tab_id = NEW.id AND ended_at IS NULL;
  UPDATE public.dining_tab_invites SET revoked_at = now() WHERE tenant_id = NEW.tenant_id AND tab_id = NEW.id AND revoked_at IS NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._dining_tabs_close_sessions() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER dining_tabs_close_sessions AFTER UPDATE OF status ON public.dining_tabs
  FOR EACH ROW WHEN (NEW.status IN ('CLOSED','CANCELLED') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public._dining_tabs_close_sessions();

-- Payload shared by the entry functions.
CREATE FUNCTION public._table_access_payload(p_session uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'state', CASE WHEN tb.responsible_user_id = ts.auth_user_id THEN 'RESPONSIBLE' ELSE 'GUEST' END,
    'role', CASE WHEN tb.responsible_user_id = ts.auth_user_id THEN 'RESPONSIBLE' ELSE 'GUEST' END,
    'sessionId', ts.id, 'tabId', tb.id, 'tableLabel', dt.label, 'approved', ts.approved_at IS NOT NULL,
    'storeName', (SELECT COALESCE(th.store_name, t.name) FROM public.tenants t
                  LEFT JOIN public.tenant_themes th ON th.tenant_id = t.id WHERE t.id = tb.tenant_id))
  FROM public.tab_sessions ts
  JOIN public.dining_tabs tb ON tb.id = ts.tab_id AND tb.tenant_id = ts.tenant_id
  JOIN public.dining_tables dt ON dt.id = tb.table_id AND dt.tenant_id = tb.tenant_id
  WHERE ts.id = p_session
$$;
REVOKE ALL ON FUNCTION public._table_access_payload(uuid) FROM PUBLIC, anon, authenticated;

-- The caller's live session, only if they are the Responsável of an open tab. Raises otherwise.
CREATE FUNCTION public._responsible_session(p_session uuid) RETURNS public.tab_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_s public.tab_sessions; v_tab public.dining_tabs;
BEGIN
  IF auth.uid() IS NULL OR NOT public._customer_identified() THEN
    RAISE EXCEPTION 'IDENTIFICATION_REQUIRED: entre na sua conta.' USING ERRCODE = '42501';
  END IF;
  SELECT ts.* INTO v_s FROM public.tab_sessions ts
  WHERE ts.id = p_session AND ts.auth_user_id = auth.uid() AND ts.ended_at IS NULL AND ts.expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'TAB_NOT_FOUND: comanda não encontrada.' USING ERRCODE = '42501'; END IF;
  SELECT tb.* INTO v_tab FROM public.dining_tabs tb WHERE tb.id = v_s.tab_id AND tb.tenant_id = v_s.tenant_id FOR UPDATE;
  IF v_tab.status NOT IN ('OPEN','BILL_REQUESTED') THEN RAISE EXCEPTION 'TAB_CLOSED: conta encerrada.'; END IF;
  IF v_tab.responsible_user_id IS DISTINCT FROM v_s.auth_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN: somente o responsável da mesa pode fazer isso.' USING ERRCODE = '42501';
  END IF;
  RETURN v_s;
END;
$$;
REVOKE ALL ON FUNCTION public._responsible_session(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Entrada na mesa: o primeiro a ler o QR de uma mesa livre vira o Responsável
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.enter_table(p_qr_token text, p_display_name text, p_device_id text) RETURNS jsonb
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

-- Old clients (and the old name) keep working but can no longer bypass the model: anonymous callers are refused,
-- an occupied table answers TABLE_IN_USE instead of joining.
CREATE OR REPLACE FUNCTION public.open_or_join_tab(p_qr_token text, p_display_name text, p_device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.enter_table(p_qr_token, p_display_name, p_device_id);
  IF v_result ->> 'state' = 'IN_USE' THEN
    RAISE EXCEPTION 'TABLE_IN_USE: esta mesa já está em uso. Peça o código de convite ao responsável da mesa.';
  END IF;
  RETURN v_result;
END;
$$;

-- Guest: "Fui convidado" — code typed by a logged-in customer; strict rate limits, one generic answer (no oracle).
-- Returns state INVALID_CODE (not an exception) for wrong/expired/revoked codes so every attempt is counted and kept.
CREATE FUNCTION public.join_with_code(p_qr_token text, p_code text, p_display_name text, p_device_id text) RETURNS jsonb
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

-- ---------------------------------------------------------------------------
-- 4. Responsável: convidar, remover convidado, transferir
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.create_tab_invite(p_session_id uuid, p_ttl_minutes integer DEFAULT 15) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_s public.tab_sessions;
  v_ttl integer := LEAST(120, GREATEST(5, COALESCE(p_ttl_minutes, 15)));
  v_code text;
  v_exp timestamptz;
  v_try integer := 0;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
BEGIN
  v_s := public._responsible_session(p_session_id);
  IF public._release_required(v_s.tenant_id) AND v_s.approved_at IS NULL THEN
    RAISE EXCEPTION 'SESSION_NOT_APPROVED: aguarde o garçom liberar sua mesa para convidar pessoas.';
  END IF;
  IF NOT public._rate_limit_hit('invite_create', public._sha256_hex(v_s.id::text), v_s.tenant_id, 10, 600) THEN
    RAISE EXCEPTION 'RATE_LIMITED: aguarde antes de gerar outro código.';
  END IF;
  UPDATE public.dining_tab_invites SET revoked_at = now() WHERE tenant_id = v_s.tenant_id AND tab_id = v_s.tab_id AND revoked_at IS NULL;
  v_exp := now() + make_interval(mins => v_ttl);
  LOOP
    v_bytes := extensions.gen_random_bytes(6);
    v_code := '';
    FOR i IN 0..5 LOOP
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    END LOOP;
    BEGIN
      INSERT INTO public.dining_tab_invites (tenant_id, tab_id, code, created_by_session, expires_at)
      VALUES (v_s.tenant_id, v_s.tab_id, v_code, v_s.id, v_exp);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_try := v_try + 1;
      IF v_try > 5 THEN RAISE EXCEPTION 'Não foi possível gerar o código. Tente novamente.'; END IF;
    END;
  END LOOP;
  PERFORM public._tab_access_log(v_s.tenant_id, v_s.tab_id, 'INVITE_CREATED', 'CUSTOMER', v_s.id, NULL, jsonb_build_object('ttl_minutes', v_ttl));
  RETURN jsonb_build_object('code', v_code, 'expiresAt', v_exp);
END;
$$;
REVOKE ALL ON FUNCTION public.create_tab_invite(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tab_invite(uuid, integer) TO authenticated;

CREATE FUNCTION public.get_tab_invite(p_session_id uuid) RETURNS jsonb
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

CREATE FUNCTION public.revoke_tab_invite(p_session_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_s public.tab_sessions;
BEGIN
  v_s := public._responsible_session(p_session_id);
  UPDATE public.dining_tab_invites SET revoked_at = now() WHERE tenant_id = v_s.tenant_id AND tab_id = v_s.tab_id AND revoked_at IS NULL;
  PERFORM public._tab_access_log(v_s.tenant_id, v_s.tab_id, 'INVITE_REVOKED', 'CUSTOMER', v_s.id, NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_tab_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_tab_invite(uuid) TO authenticated;

CREATE FUNCTION public.remove_tab_guest(p_session_id uuid, p_target_session_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_s public.tab_sessions; v_t public.tab_sessions;
BEGIN
  v_s := public._responsible_session(p_session_id);
  SELECT x.* INTO v_t FROM public.tab_sessions x
  WHERE x.id = p_target_session_id AND x.tenant_id = v_s.tenant_id AND x.tab_id = v_s.tab_id AND x.ended_at IS NULL;
  IF NOT FOUND OR v_t.auth_user_id = v_s.auth_user_id THEN
    RAISE EXCEPTION 'GUEST_NOT_FOUND: convidado não encontrado nesta mesa.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._end_session(v_t.id, 'REMOVED');
  PERFORM public._tab_access_log(v_s.tenant_id, v_s.tab_id, 'GUEST_REMOVED', 'CUSTOMER', v_s.id, v_t.id);
END;
$$;
REVOKE ALL ON FUNCTION public.remove_tab_guest(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_tab_guest(uuid, uuid) TO authenticated;

CREATE FUNCTION public.transfer_tab_responsibility(p_session_id uuid, p_target_session_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_s public.tab_sessions; v_t public.tab_sessions;
BEGIN
  v_s := public._responsible_session(p_session_id);
  SELECT x.* INTO v_t FROM public.tab_sessions x
  WHERE x.id = p_target_session_id AND x.tenant_id = v_s.tenant_id AND x.tab_id = v_s.tab_id
    AND x.ended_at IS NULL AND x.expires_at > now() AND x.approved_at IS NOT NULL;
  IF NOT FOUND OR v_t.auth_user_id = v_s.auth_user_id THEN
    RAISE EXCEPTION 'GUEST_NOT_FOUND: escolha uma pessoa que já está na mesa.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.dining_tabs SET responsible_user_id = v_t.auth_user_id, responsible_since = now(), holder_claimable = false
  WHERE id = v_s.tab_id AND tenant_id = v_s.tenant_id;
  UPDATE public.dining_tab_invites SET revoked_at = now() WHERE tenant_id = v_s.tenant_id AND tab_id = v_s.tab_id AND revoked_at IS NULL;
  PERFORM public._tab_access_log(v_s.tenant_id, v_s.tab_id, 'RESPONSIBLE_TRANSFERRED', 'CUSTOMER', v_s.id, v_t.id);
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_tab_responsibility(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_tab_responsibility(uuid, uuid) TO authenticated;

-- A blocked order (waiter has not released the table yet) calls this so staff see "tried to order" without losing the round.
CREATE FUNCTION public.ping_pending_approval(p_session_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT ts.tenant_id INTO v_tenant FROM public.tab_sessions ts
  WHERE ts.id = p_session_id AND ts.auth_user_id = auth.uid() AND ts.ended_at IS NULL AND ts.expires_at > now() AND ts.approved_at IS NULL;
  IF v_tenant IS NULL THEN RETURN; END IF;
  IF public._rate_limit_hit('approval_ping', public._sha256_hex(p_session_id::text), v_tenant, 6, 60) THEN
    UPDATE public.tab_sessions SET approval_requested_at = now() WHERE id = p_session_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ping_pending_approval(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ping_pending_approval(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Equipe: aprovar / recusar, trocar o responsável, abrir mesa e pedir a conta pelo garçom
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_session(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT ts.tenant_id INTO v_tenant FROM public.tab_sessions ts WHERE ts.id = p_session_id;
  IF v_tenant IS NULL OR auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_tenant, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para liberar esta sessão.' USING ERRCODE = '42501';
  END IF;
  IF public._dine_in_config(v_tenant) IS NULL THEN
    RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.';
  END IF;
  UPDATE public.tab_sessions SET approved_by = auth.uid(), approved_at = now(), expires_at = GREATEST(expires_at, now() + interval '12 hours')
  WHERE id = p_session_id AND tenant_id = v_tenant AND expires_at > now() AND ended_at IS NULL
    AND EXISTS (SELECT 1 FROM public.dining_tabs tb WHERE tb.id = tab_sessions.tab_id AND tb.status = 'OPEN');
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_EXPIRED: sessão inválida ou comanda encerrada.'; END IF;
  INSERT INTO public.tab_events (tenant_id, tab_id, event_type, actor_id, details)
  SELECT v_tenant, ts.tab_id, 'SESSION_APPROVED', auth.uid(), jsonb_build_object('session_id', p_session_id)
  FROM public.tab_sessions ts WHERE ts.id = p_session_id;
END;
$$;

CREATE FUNCTION public.reject_session(p_session_id uuid) RETURNS void
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

-- Lost phone: end the Responsável's sessions and let the next person who scans claim the tab (staff approves them).
CREATE FUNCTION public.staff_reset_tab_holder(p_tab_id uuid) RETURNS void
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

CREATE FUNCTION public.staff_transfer_tab_holder(p_tab_id uuid, p_target_session_id uuid, p_end_previous boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_tab public.dining_tabs; v_t public.tab_sessions; v_old uuid;
BEGIN
  SELECT tb.* INTO v_tab FROM public.dining_tabs tb WHERE tb.id = p_tab_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_tab.tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para alterar o responsável.' USING ERRCODE = '42501';
  END IF;
  IF v_tab.status NOT IN ('OPEN') THEN RAISE EXCEPTION 'TAB_CLOSED: comanda encerrada.'; END IF;
  SELECT x.* INTO v_t FROM public.tab_sessions x
  WHERE x.id = p_target_session_id AND x.tenant_id = v_tab.tenant_id AND x.tab_id = v_tab.id AND x.ended_at IS NULL AND x.expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'GUEST_NOT_FOUND: escolha uma pessoa que está na mesa.' USING ERRCODE = '42501'; END IF;
  v_old := v_tab.responsible_user_id;
  IF v_t.approved_at IS NULL THEN
    UPDATE public.tab_sessions SET approved_at = now(), approved_by = auth.uid() WHERE id = v_t.id;
  END IF;
  IF p_end_previous AND v_old IS NOT NULL AND v_old <> v_t.auth_user_id THEN
    PERFORM public._end_session(ts.id, 'TRANSFERRED') FROM public.tab_sessions ts
    WHERE ts.tenant_id = v_tab.tenant_id AND ts.tab_id = v_tab.id AND ts.auth_user_id = v_old AND ts.ended_at IS NULL;
  END IF;
  UPDATE public.dining_tabs SET responsible_user_id = v_t.auth_user_id, responsible_since = now(), holder_claimable = false
  WHERE id = v_tab.id AND tenant_id = v_tab.tenant_id;
  UPDATE public.dining_tab_invites SET revoked_at = now() WHERE tenant_id = v_tab.tenant_id AND tab_id = v_tab.id AND revoked_at IS NULL;
  PERFORM public._tab_access_log(v_tab.tenant_id, v_tab.id, 'HOLDER_TRANSFERRED', 'STAFF', auth.uid(), v_t.id, jsonb_build_object('ended_previous', p_end_previous));
END;
$$;
REVOKE ALL ON FUNCTION public.staff_transfer_tab_holder(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_transfer_tab_holder(uuid, uuid, boolean) TO authenticated;

-- Waiter app: opens a tab for customers who order through the waiter (no customer account, no Responsável).
CREATE FUNCTION public.staff_open_tab(p_table_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_table public.dining_tables; v_tab public.dining_tabs; v_config jsonb; v_fee numeric := 0;
BEGIN
  SELECT dt.* INTO v_table FROM public.dining_tables dt WHERE dt.id = p_table_id AND dt.active FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_table.tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para abrir esta mesa.' USING ERRCODE = '42501';
  END IF;
  v_config := public._dine_in_config(v_table.tenant_id);
  IF v_config IS NULL THEN RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.'; END IF;
  SELECT tb.* INTO v_tab FROM public.dining_tabs tb
  WHERE tb.tenant_id = v_table.tenant_id AND tb.table_id = v_table.id AND tb.status IN ('OPEN','BILL_REQUESTED')
  ORDER BY tb.opened_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('tabId', v_tab.id, 'existing', true); END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_modules tm WHERE tm.tenant_id = v_table.tenant_id AND tm.module_key = 'service_fee' AND tm.enabled) THEN
    v_fee := COALESCE((SELECT NULLIF(tm.config ->> 'percent', '')::numeric
      FROM public.tenant_modules tm WHERE tm.tenant_id = v_table.tenant_id AND tm.module_key = 'service_fee'), 10);
  END IF;
  INSERT INTO public.dining_tabs (tenant_id, mode, table_id, service_fee_percent, waiter_id)
  VALUES (v_table.tenant_id, CASE WHEN v_config ->> 'mode' = 'INDIVIDUAL' THEN 'INDIVIDUAL' ELSE 'TABLE' END, v_table.id, v_fee,
          (SELECT u.id FROM public.users u WHERE u.id = auth.uid()))
  RETURNING * INTO v_tab;
  PERFORM public._tab_access_log(v_tab.tenant_id, v_tab.id, 'TAB_OPENED_BY_STAFF', 'STAFF', auth.uid(), NULL);
  RETURN jsonb_build_object('tabId', v_tab.id, 'existing', false);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_open_tab(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_open_tab(uuid) TO authenticated;

CREATE FUNCTION public.staff_request_bill(p_tab_id uuid) RETURNS void
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

-- ---------------------------------------------------------------------------
-- 6. get_my_tab (+ quem sou eu, membros para o Responsável, quem pediu cada rodada), resolve_table_qr com limite, LGPD, capacidades
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_tab(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
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

-- Same result as before, now VOLATILE so every lookup is counted: per IP and per token (anti-enumeration).
CREATE OR REPLACE FUNCTION public.resolve_table_qr(p_qr_token text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_qr_token IS NULL OR length(p_qr_token) NOT BETWEEN 8 AND 128 THEN
    RETURN jsonb_build_object('available', false);
  END IF;
  IF NOT public._rate_limit_hit('table_qr_resolve_ip', public._request_ip_hash(), NULL, 300, 60)
     OR NOT public._rate_limit_hit('table_qr_resolve_token', public._sha256_hex(p_qr_token), NULL, 120, 60) THEN
    RAISE EXCEPTION 'RATE_LIMITED: muitas consultas. Tente novamente em instantes.';
  END IF;
  SELECT jsonb_build_object(
    'available', true,
    'tenantSlug', t.slug,
    'storeName', COALESCE(th.store_name, t.name),
    'tableLabel', dt.label
  ) INTO v_result
  FROM public.dining_tables dt
  JOIN public.tenants t ON t.id = dt.tenant_id AND t.status = 'ACTIVE'
  LEFT JOIN public.tenant_themes th ON th.tenant_id = t.id
  WHERE dt.qr_token = p_qr_token AND dt.active
    AND public._dine_in_config(dt.tenant_id) IS NOT NULL;
  RETURN COALESCE(v_result, jsonb_build_object('available', false));
END;
$$;

CREATE OR REPLACE FUNCTION public.anonymize_old_tab_sessions(p_days integer DEFAULT 90)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  IF p_days IS NULL OR p_days < 7 THEN RAISE EXCEPTION 'p_days deve ser >= 7'; END IF;
  UPDATE public.tab_sessions ts SET display_name = 'Cliente', device_id = 'anon-' || replace(ts.id::text, '-', '')
  WHERE ts.expires_at < now() - make_interval(days => p_days)
    AND (ts.display_name <> 'Cliente' OR ts.device_id NOT LIKE 'anon-%')
    AND ts.tab_id IN (SELECT tb.id FROM public.dining_tabs tb WHERE tb.status IN ('CLOSED','CANCELLED'));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- LGPD: the link between an old tab and the customer account is dropped; invite codes are not kept.
  UPDATE public.dining_tabs SET responsible_user_id = NULL
  WHERE responsible_user_id IS NOT NULL AND status IN ('CLOSED','CANCELLED') AND COALESCE(closed_at, opened_at) < now() - make_interval(days => p_days);
  DELETE FROM public.dining_tab_invites WHERE created_at < now() - make_interval(days => p_days);
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.mesas_qr_capabilities() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT jsonb_build_object('version', 2, 'qr_pause', true, 'tab_pix', true, 'table_name_rule', true,
                                'table_access', true, 'waiter_app', true); $$;
-- The customer screen must know whether the new access model exists BEFORE the person logs in; the answer is only a version number.
GRANT EXECUTE ON FUNCTION public.mesas_qr_capabilities() TO anon;


-- submit_round: identical to the audited function except (1) a released session stays released while it is live (the old fixed
-- 6-hour approval window would cut off long nights) and (2) sessions ended because the tab closed still reach the TAB_CLOSED answer.
CREATE OR REPLACE FUNCTION public.submit_round(p_items jsonb, p_idempotency_key uuid, p_session_id uuid DEFAULT NULL::uuid, p_tab_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_tab uuid := p_tab_id;
  v_session uuid := p_session_id;
  v_table uuid;
  v_name text;
  v_role text;
  v_config jsonb;
  v_round integer;
  v_subtotal numeric;
  v_limit numeric;
  v_order uuid;
  v_number integer;
  v_lines jsonb;
  v_existing record;
BEGIN
  IF v_user IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sessão e chave de envio são obrigatórias.' USING ERRCODE = '42501';
  END IF;
  IF v_session IS NOT NULL THEN
    SELECT ts.tenant_id, ts.tab_id, ts.display_name INTO v_tenant, v_tab, v_name
    FROM public.tab_sessions ts WHERE ts.id = v_session AND ts.auth_user_id = v_user AND (ts.expires_at > now() OR ts.ended_reason = 'TAB_CLOSED');
    IF v_tenant IS NULL THEN RAISE EXCEPTION 'SESSION_INVALID: sessão da mesa inválida ou expirada.'; END IF;
  ELSE
    SELECT tb.tenant_id, ts.id, ts.display_name INTO v_tenant, v_session, v_name
    FROM public.dining_tabs tb
    LEFT JOIN LATERAL (
      SELECT x.id, x.display_name FROM public.tab_sessions x
      WHERE x.tab_id = tb.id AND x.tenant_id = tb.tenant_id ORDER BY x.expires_at DESC LIMIT 1
    ) ts ON true
    WHERE tb.id = v_tab;
    v_role := public._tenant_role_of_caller(v_tenant);
    IF v_tenant IS NULL OR COALESCE(v_role, '') NOT IN ('OWNER', 'MANAGER', 'WAITER', 'CASHIER') THEN
      RAISE EXCEPTION 'FORBIDDEN: acesso à comanda negado.' USING ERRCODE = '42501';
    END IF;
  END IF;
  v_config := public._dine_in_config(v_tenant);
  IF v_config IS NULL THEN RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.'; END IF;
  IF v_role IS NULL AND COALESCE((v_config ->> 'release_required')::boolean, true) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tab_sessions ts WHERE ts.id = v_session AND ts.approved_at IS NOT NULL
        AND (ts.expires_at > now() OR ts.ended_reason = 'TAB_CLOSED')
    ) THEN
      RAISE EXCEPTION 'SESSION_NOT_APPROVED: aguardando o garçom liberar sua mesa.';
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || p_idempotency_key::text, 0));
  SELECT o.id, o.order_number INTO v_existing FROM public.orders o
  WHERE o.tenant_id = v_tenant AND o.fulfillment_type = 'DINE_IN' AND o.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = v_existing.id AND o.tab_id = v_tab)
       OR (v_role IS NULL AND NOT EXISTS (SELECT 1 FROM public.tab_sessions ts
            WHERE ts.id = v_session AND ts.auth_user_id = v_user AND ts.tab_id = v_tab)) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: chave de envio já utilizada.';
    END IF;
    RETURN jsonb_build_object('orderId', v_existing.id, 'orderNumber', v_existing.order_number, 'replayed', true);
  END IF;
  SELECT tb.table_id INTO v_table FROM public.dining_tabs tb
  WHERE tb.id = v_tab AND tb.tenant_id = v_tenant AND tb.status = 'OPEN' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TAB_CLOSED: conta encerrada. Para pedir de novo, chame o garçom.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dining_tables dt WHERE dt.id = v_table AND dt.active) THEN
    RAISE EXCEPTION 'TABLE_UNAVAILABLE: mesa indisponível.';
  END IF;
  IF NOT public._rate_limit_hit('dine_in_submit', public._sha256_hex(v_user::text), v_tenant, 30, 60) THEN
    RAISE EXCEPTION 'RATE_LIMITED: aguarde antes de enviar outra rodada.';
  END IF;
  SELECT COALESCE(max(o.round_no), 0) + 1 INTO v_round
  FROM public.orders o WHERE o.tenant_id = v_tenant AND o.tab_id = v_tab AND o.fulfillment_type = 'DINE_IN';
  SELECT COALESCE((v_config ->> 'round_limit')::numeric, 300) INTO v_limit;
  SELECT jsonb_agg(jsonb_build_object(
           'product_id', x.r_product_id, 'quantity', x.r_quantity, 'notes', x.r_notes, 'name', x.r_name,
           'unit', x.r_unit, 'unit_price', x.r_unit_price, 'original_price', x.r_original_price,
           'is_promotional', x.r_is_promotional, 'item_kind', 'PRODUCT'
         )),
         round(sum(x.r_unit_price * x.r_quantity), 2)
  INTO v_lines, v_subtotal FROM public._price_items(v_tenant, p_items, true) x;
  IF v_subtotal > v_limit THEN
    RAISE EXCEPTION 'ROUND_LIMIT: limite por rodada é R$ %.', v_limit;
  END IF;
  INSERT INTO public.orders (
    tenant_id, customer_name, customer_phone, delivery_address, subtotal, delivery_fee, discount, total_amount,
    payment_method, payment_status, fulfillment_type, status, origin, tab_id, round_no, ordered_by_session_id,
    idempotency_key
  ) VALUES (
    v_tenant, COALESCE(NULLIF(v_name, ''), 'Atendimento'), '', '', v_subtotal, 0, 0, v_subtotal,
    'CASH', 'PENDING', 'DINE_IN', 'CONFIRMED', 'qr_code', v_tab, v_round, v_session,
    p_idempotency_key
  ) RETURNING id, order_number INTO v_order, v_number;
  PERFORM public._insert_order_lines(v_order, v_tenant, v_lines, 0, v_subtotal, 'Salão');
  INSERT INTO public.order_status_history (order_id, status, note, changed_by)
  VALUES (v_order, 'CONFIRMED', 'Rodada enviada pelo salão.', COALESCE(v_name, 'Salão'));
  RETURN jsonb_build_object('orderId', v_order, 'orderNumber', v_number, 'roundNo', v_round,
    'subtotal', v_subtotal, 'replayed', false);
END;
$function$
;

COMMIT;
