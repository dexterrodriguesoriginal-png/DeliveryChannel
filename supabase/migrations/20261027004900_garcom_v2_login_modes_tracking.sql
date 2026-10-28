-- Garçom v2 — login simples (usuário + senha), modos de atendimento (LIVRE / MESAS FIXAS / CENTRAL),
-- rastreio por garçom (waiter_id em pedidos, comandas e chamados), relatório por garçom e "Seu garçom" para o cliente.
-- Forward migration. Revert: supabase/rollback/20261027004900_garcom_v2_login_modes_tracking_down.sql
-- Requires: 20261027004800_mesas_holder_lock_empty_cancel_waiter_rls.sql
-- NÃO APLICAR sem revisão: criada apenas como arquivo (ver supabase/tests/garcom_v2/run_regressions.sh).
--
-- Segurança:
--   * Senha NUNCA é gravada aqui: o usuário é criado no Supabase Auth pela Edge Function `waiter-admin` (service role só no servidor).
--   * Funções de provisionamento (`waiter_*` sem auth.uid) só são executáveis por service_role.
--   * Garçom só enxerga a própria loja e NÃO lê telefone/e-mail de outros garçons (waiter_profiles: RLS própria linha).
BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.waiter_calls') IS NULL OR to_regclass('public.dining_tabs') IS NULL
     OR to_regprocedure('public.staff_create_holder_code(uuid)') IS NULL
     OR to_regprocedure('public.handle_waiter_call(uuid)') IS NULL
     OR to_regprocedure('public._rate_limit_hit(text,text,uuid,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK 20261027004900: aplique antes a migration 20261027004800_mesas_holder_lock_empty_cancel_waiter_rls.';
  END IF;
  IF to_regclass('public.waiter_profiles') IS NOT NULL OR to_regclass('public.waiter_service_settings') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK 20261027004900: objetos já existem.';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
CREATE TABLE public.waiter_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  username text NOT NULL CHECK (username ~ '^[a-z0-9_]{3,24}$'),
  phone text NOT NULL CHECK (length(btrim(phone)) BETWEEN 8 AND 32),
  contact_email text CHECK (contact_email IS NULL OR length(contact_email) <= 254),
  photo_url text CHECK (photo_url IS NULL OR length(photo_url) <= 500),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, username)
);
CREATE INDEX waiter_profiles_tenant_idx ON public.waiter_profiles (tenant_id, active);

CREATE TABLE public.waiter_service_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'FREE' CHECK (mode IN ('FREE', 'FIXED', 'CENTRAL')),
  hybrid_help boolean NOT NULL DEFAULT false,
  accept_timeout_seconds integer NOT NULL DEFAULT 60 CHECK (accept_timeout_seconds BETWEEN 10 AND 600),
  dispatch_timeout_seconds integer NOT NULL DEFAULT 60 CHECK (dispatch_timeout_seconds BETWEEN 10 AND 600),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.waiter_table_assignments (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  table_id uuid NOT NULL,
  waiter_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, table_id),
  FOREIGN KEY (tenant_id, table_id) REFERENCES public.dining_tables(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX waiter_table_assignments_waiter_idx ON public.waiter_table_assignments (tenant_id, waiter_id);

CREATE TABLE public.waiter_presence (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- Garçom que "Ajudou" em mesa de outro (modo híbrido) — fica registrado.
CREATE TABLE public.waiter_table_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  table_id uuid NOT NULL,
  waiter_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  call_id uuid REFERENCES public.waiter_calls(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, table_id) REFERENCES public.dining_tables(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX waiter_table_helpers_tenant_idx ON public.waiter_table_helpers (tenant_id, created_at);

ALTER TABLE public.waiter_calls
  ADD COLUMN route text NOT NULL DEFAULT 'ALL' CHECK (route IN ('ALL', 'ASSIGNED', 'CENTRAL')),
  ADD COLUMN assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN accepted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN dispatched_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN dispatched_at timestamptz,
  ADD COLUMN escalated_at timestamptz;

ALTER TABLE public.orders ADD COLUMN waiter_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.dining_tabs ADD COLUMN closed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX orders_waiter_idx ON public.orders (tenant_id, waiter_id, created_at) WHERE waiter_id IS NOT NULL;

ALTER TABLE public.waiter_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiter_service_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiter_table_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiter_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiter_table_helpers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.waiter_profiles, public.waiter_service_settings, public.waiter_table_assignments,
  public.waiter_presence, public.waiter_table_helpers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.waiter_profiles, public.waiter_service_settings, public.waiter_table_assignments,
  public.waiter_table_helpers TO authenticated;

-- Perfil (telefone/e-mail de contato): dono/gerente veem todos; garçom só a PRÓPRIA linha.
CREATE POLICY waiter_profiles_read ON public.waiter_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER', 'MANAGER']));
CREATE POLICY waiter_service_settings_read ON public.waiter_service_settings FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']));
CREATE POLICY waiter_table_assignments_read ON public.waiter_table_assignments FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']));
CREATE POLICY waiter_table_helpers_read ON public.waiter_table_helpers FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER', 'MANAGER']) OR waiter_id = auth.uid());
-- waiter_presence: sem política => ninguém lê direto (apenas as RPCs SECURITY DEFINER).

-- ---------------------------------------------------------------------------
-- 2. Auxiliares internos
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._waiter_is_online(p_tenant uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.waiter_presence wp
                 WHERE wp.tenant_id = p_tenant AND wp.user_id = p_user AND wp.last_seen_at > now() - interval '90 seconds');
$$;

CREATE FUNCTION public._waiter_is_active(p_tenant uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.waiter_profiles wp
                 JOIN public.tenant_users tu ON tu.user_id = wp.user_id AND tu.tenant_id = wp.tenant_id
                 WHERE wp.tenant_id = p_tenant AND wp.user_id = p_user AND wp.active
                   AND tu.status = 'ACTIVE' AND tu.role_id = 'WAITER');
$$;

CREATE FUNCTION public._waiter_settings(p_tenant uuid) RETURNS public.waiter_service_settings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT s FROM public.waiter_service_settings s WHERE s.tenant_id = p_tenant),
    ROW(p_tenant, 'FREE', false, 60, 60, NULL, now())::public.waiter_service_settings);
$$;

-- Chamado visível para o garçom? (a política RESTRITIVA abaixo usa isto; demais papéis sempre veem.)
-- Escalonamento é "preguiçoso": vale tempo esgotado OU responsável offline OU escalated_at gravado — nenhum cliente fica sem atendimento.
CREATE FUNCTION public._waiter_call_visible(
  p_tenant uuid, p_route text, p_assigned uuid, p_accepted uuid, p_status text,
  p_created timestamptz, p_escalated timestamptz, p_handled_by uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_s public.waiter_service_settings;
BEGIN
  IF public._tenant_role_of_caller(p_tenant) IS DISTINCT FROM 'WAITER' THEN RETURN true; END IF;
  IF p_status <> 'OPEN' THEN RETURN p_accepted = v_uid OR p_handled_by = v_uid; END IF;
  IF p_accepted IS NOT NULL THEN RETURN p_accepted = v_uid; END IF;
  IF p_route = 'ALL' THEN RETURN true; END IF;
  IF p_assigned = v_uid THEN RETURN true; END IF;
  IF p_escalated IS NOT NULL THEN RETURN true; END IF;
  IF p_route = 'ASSIGNED' THEN
    v_s := public._waiter_settings(p_tenant);
    RETURN p_assigned IS NULL
        OR p_created + make_interval(secs => v_s.accept_timeout_seconds) <= now()
        OR NOT public._waiter_is_online(p_tenant, p_assigned);
  END IF;
  RETURN false; -- CENTRAL ainda não despachado nem escalonado
END;
$$;
REVOKE ALL ON FUNCTION public._waiter_is_online(uuid, uuid), public._waiter_is_active(uuid, uuid),
  public._waiter_settings(uuid), public._waiter_call_visible(uuid, text, uuid, uuid, text, timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._waiter_call_visible(uuid, text, uuid, uuid, text, timestamptz, timestamptz, uuid) TO authenticated;

CREATE POLICY waiter_calls_waiter_routing ON public.waiter_calls AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public._waiter_call_visible(tenant_id, route, assigned_to, accepted_by, status, created_at, escalated_at, handled_by));

-- ---------------------------------------------------------------------------
-- 3. Triggers de roteamento e rastreio
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._waiter_calls_route() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_s public.waiter_service_settings := public._waiter_settings(NEW.tenant_id);
  v_assigned uuid;
BEGIN
  NEW.route := 'ALL'; NEW.assigned_to := NULL; NEW.accepted_by := NULL; NEW.accepted_at := NULL;
  NEW.dispatched_by := NULL; NEW.dispatched_at := NULL; NEW.escalated_at := NULL;
  IF v_s.mode = 'FIXED' THEN
    SELECT wta.waiter_id INTO v_assigned
    FROM public.dining_tabs tb
    JOIN public.waiter_table_assignments wta ON wta.tenant_id = tb.tenant_id AND wta.table_id = tb.table_id
    WHERE tb.tenant_id = NEW.tenant_id AND tb.id = NEW.tab_id;
    IF v_assigned IS NOT NULL AND public._waiter_is_active(NEW.tenant_id, v_assigned) THEN
      NEW.route := 'ASSIGNED'; NEW.assigned_to := v_assigned;
      IF NOT public._waiter_is_online(NEW.tenant_id, v_assigned) THEN NEW.escalated_at := now(); END IF; -- offline => todos
    END IF;
  ELSIF v_s.mode = 'CENTRAL' THEN
    NEW.route := 'CENTRAL';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER waiter_calls_route BEFORE INSERT ON public.waiter_calls
  FOR EACH ROW EXECUTE FUNCTION public._waiter_calls_route();

-- orders.waiter_id = quem lançou (só quando o autor é equipe); dining_tabs.waiter_id = quem abriu; closed_by = quem fechou.
CREATE FUNCTION public._orders_set_waiter() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.fulfillment_type = 'DINE_IN' AND auth.uid() IS NOT NULL AND NEW.tenant_id IS NOT NULL
     AND public._tenant_role_of_caller(NEW.tenant_id) IN ('WAITER', 'OWNER', 'MANAGER', 'CASHIER') THEN
    NEW.waiter_id := auth.uid();
  ELSE
    NEW.waiter_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_set_waiter BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public._orders_set_waiter();

CREATE FUNCTION public._dining_tabs_track_waiter() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.waiter_id IS NULL AND auth.uid() IS NOT NULL
       AND public._tenant_role_of_caller(NEW.tenant_id) IN ('WAITER', 'OWNER', 'MANAGER', 'CASHIER') THEN
      NEW.waiter_id := auth.uid();
    END IF;
  ELSIF NEW.status = 'CLOSED' AND OLD.status IS DISTINCT FROM 'CLOSED' AND NEW.closed_by IS NULL
        AND auth.uid() IS NOT NULL AND public._tenant_role_of_caller(NEW.tenant_id) IS NOT NULL THEN
    NEW.closed_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dining_tabs_track_waiter BEFORE INSERT OR UPDATE OF status ON public.dining_tabs
  FOR EACH ROW EXECUTE FUNCTION public._dining_tabs_track_waiter();

-- Desativar garçom: solta mesas, presença e devolve chamados dele para todos.
CREATE FUNCTION public._waiter_profile_deactivated() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.active AND NOT NEW.active THEN
    DELETE FROM public.waiter_table_assignments WHERE tenant_id = NEW.tenant_id AND waiter_id = NEW.user_id;
    DELETE FROM public.waiter_presence WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id;
    UPDATE public.waiter_calls SET escalated_at = now()
    WHERE tenant_id = NEW.tenant_id AND status = 'OPEN' AND accepted_by IS NULL AND assigned_to = NEW.user_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER waiter_profiles_deactivated BEFORE UPDATE ON public.waiter_profiles
  FOR EACH ROW EXECUTE FUNCTION public._waiter_profile_deactivated();

REVOKE ALL ON FUNCTION public._waiter_calls_route(), public._orders_set_waiter(),
  public._dining_tabs_track_waiter(), public._waiter_profile_deactivated() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Provisionamento (SOMENTE service_role — chamado pela Edge Function waiter-admin; a senha nunca passa por aqui)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.waiter_username_state(p_tenant uuid, p_username text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('state', CASE WHEN wp.active THEN 'ACTIVE' ELSE 'INACTIVE' END, 'user_id', wp.user_id)
     FROM public.waiter_profiles wp WHERE wp.tenant_id = p_tenant AND wp.username = lower(btrim(p_username))),
    jsonb_build_object('state', 'FREE'));
$$;

CREATE FUNCTION public.waiter_provision(p_tenant uuid, p_user uuid, p_name text, p_phone text, p_username text,
                                       p_synthetic_email text, p_contact_email text, p_photo_url text, p_created_by uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'INVALID_INPUT: informe o nome do garçom.'; END IF;
  INSERT INTO public.users (id, name, email, phone) VALUES (p_user, btrim(p_name), p_synthetic_email, btrim(p_phone))
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone;
  INSERT INTO public.tenant_users (user_id, tenant_id, role_id, status) VALUES (p_user, p_tenant, 'WAITER', 'ACTIVE');
  INSERT INTO public.waiter_profiles (user_id, tenant_id, username, phone, contact_email, photo_url, created_by)
  VALUES (p_user, p_tenant, lower(btrim(p_username)), btrim(p_phone), NULLIF(btrim(COALESCE(p_contact_email, '')), ''), p_photo_url, p_created_by);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'WAITER_USERNAME_TAKEN: este usuário já faz parte da equipe.' USING ERRCODE = 'P0412';
END;
$$;

CREATE FUNCTION public.waiter_update_profile(p_tenant uuid, p_user uuid, p_name text, p_phone text, p_photo_url text, p_set_photo boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.waiter_profiles WHERE tenant_id = p_tenant AND user_id = p_user) THEN
    RAISE EXCEPTION 'WAITER_NOT_FOUND: garçom não encontrado.';
  END IF;
  IF length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'INVALID_INPUT: informe o nome do garçom.'; END IF;
  UPDATE public.users SET name = btrim(p_name), phone = btrim(p_phone) WHERE id = p_user;
  UPDATE public.waiter_profiles SET phone = btrim(p_phone),
         photo_url = CASE WHEN p_set_photo THEN p_photo_url ELSE photo_url END
  WHERE tenant_id = p_tenant AND user_id = p_user;
END;
$$;

CREATE FUNCTION public.waiter_set_active(p_tenant uuid, p_user uuid, p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.waiter_profiles SET active = p_active WHERE tenant_id = p_tenant AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'WAITER_NOT_FOUND: garçom não encontrado.'; END IF;
  UPDATE public.tenant_users SET status = CASE WHEN p_active THEN 'ACTIVE' ELSE 'SUSPENDED' END, updated_at = now()
  WHERE tenant_id = p_tenant AND user_id = p_user AND role_id = 'WAITER';
END;
$$;

CREATE FUNCTION public.waiter_assert_member(p_tenant uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM public.waiter_profiles WHERE tenant_id = p_tenant AND user_id = p_user); $$;

-- Rate limit do login: 5/min por loja+usuário+IP e 20/10 min por loja+usuário (service_role; IP já vem em hash).
CREATE FUNCTION public.waiter_login_check(p_slug text, p_username text, p_ip_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant uuid;
  v_user text := lower(btrim(COALESCE(p_username, '')));
  v_subject text;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.slug = lower(btrim(COALESCE(p_slug, ''))) AND t.status = 'ACTIVE';
  v_subject := public._sha256_hex(lower(btrim(COALESCE(p_slug, ''))) || '|' || v_user);
  IF NOT public._rate_limit_hit('waiter_login_ip', public._sha256_hex(v_subject || '|' || COALESCE(p_ip_hash, '-')), v_tenant, 5, 60)
     OR NOT public._rate_limit_hit('waiter_login_user', v_subject, v_tenant, 20, 600) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'RATE_LIMITED');
  END IF;
  RETURN jsonb_build_object('allowed', v_tenant IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.waiter_profiles wp WHERE wp.tenant_id = v_tenant AND wp.username = v_user AND wp.active),
         'tenant_id', v_tenant);
END;
$$;

REVOKE ALL ON FUNCTION public.waiter_username_state(uuid, text), public.waiter_provision(uuid, uuid, text, text, text, text, text, text, uuid),
  public.waiter_update_profile(uuid, uuid, text, text, text, boolean), public.waiter_set_active(uuid, uuid, boolean),
  public.waiter_assert_member(uuid, uuid), public.waiter_login_check(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waiter_username_state(uuid, text), public.waiter_provision(uuid, uuid, text, text, text, text, text, text, uuid),
  public.waiter_update_profile(uuid, uuid, text, text, text, boolean), public.waiter_set_active(uuid, uuid, boolean),
  public.waiter_assert_member(uuid, uuid), public.waiter_login_check(text, text, text) TO service_role;

-- Página de login pública /garcom/<slug>: só nome e logo da loja.
CREATE FUNCTION public.get_waiter_login_store(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object('name', t.name, 'slug', t.slug)
  FROM public.tenants t WHERE t.slug = lower(btrim(p_slug)) AND t.status = 'ACTIVE';
$$;
REVOKE ALL ON FUNCTION public.get_waiter_login_store(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_waiter_login_store(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Equipe: diretório para dono/gerente (corrige cards "Colaborador / Sem e-mail": users só é legível pelo próprio usuário)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.list_team_directory(p_tenant uuid) RETURNS TABLE (
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

-- ---------------------------------------------------------------------------
-- 6. Modos de atendimento
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._waiter_require_manager(p_tenant uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_tenant_scoped_role(p_tenant, ARRAY['OWNER', 'MANAGER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: apenas dono ou gerente.' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._waiter_require_manager(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_waiter_service_settings(p_tenant uuid, p_mode text, p_hybrid_help boolean, p_accept_seconds integer, p_dispatch_seconds integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public._waiter_require_manager(p_tenant);
  IF p_mode NOT IN ('FREE', 'FIXED', 'CENTRAL') THEN RAISE EXCEPTION 'INVALID_INPUT: modo de atendimento inválido.'; END IF;
  IF p_accept_seconds NOT BETWEEN 10 AND 600 OR p_dispatch_seconds NOT BETWEEN 10 AND 600 THEN
    RAISE EXCEPTION 'INVALID_INPUT: o tempo deve ficar entre 10 e 600 segundos.';
  END IF;
  INSERT INTO public.waiter_service_settings (tenant_id, mode, hybrid_help, accept_timeout_seconds, dispatch_timeout_seconds, updated_by, updated_at)
  VALUES (p_tenant, p_mode, COALESCE(p_hybrid_help, false) AND p_mode = 'FIXED', p_accept_seconds, p_dispatch_seconds, auth.uid(), now())
  ON CONFLICT (tenant_id) DO UPDATE SET mode = EXCLUDED.mode, hybrid_help = EXCLUDED.hybrid_help,
    accept_timeout_seconds = EXCLUDED.accept_timeout_seconds, dispatch_timeout_seconds = EXCLUDED.dispatch_timeout_seconds,
    updated_by = EXCLUDED.updated_by, updated_at = now();
  -- Chamados já abertos não ficam presos no modo antigo: vão para todos.
  UPDATE public.waiter_calls SET escalated_at = now()
  WHERE tenant_id = p_tenant AND status = 'OPEN' AND accepted_by IS NULL AND escalated_at IS NULL AND route <> 'ALL';
END;
$$;

-- Dono distribui mesas: o garçom passa a ter EXATAMENTE as mesas informadas (tira de quem tinha). p_waiter NULL => libera as mesas.
CREATE FUNCTION public.assign_waiter_tables(p_tenant uuid, p_waiter uuid, p_table_ids uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_n integer;
BEGIN
  PERFORM public._waiter_require_manager(p_tenant);
  IF p_waiter IS NOT NULL AND NOT public._waiter_is_active(p_tenant, p_waiter) THEN
    RAISE EXCEPTION 'WAITER_NOT_FOUND: garçom inativo ou inexistente.';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_table_ids, ARRAY[]::uuid[])) x
             WHERE NOT EXISTS (SELECT 1 FROM public.dining_tables dt WHERE dt.id = x AND dt.tenant_id = p_tenant)) THEN
    RAISE EXCEPTION 'INVALID_INPUT: mesa de outra loja.';
  END IF;
  IF p_waiter IS NULL THEN
    DELETE FROM public.waiter_table_assignments WHERE tenant_id = p_tenant AND table_id = ANY (COALESCE(p_table_ids, ARRAY[]::uuid[]));
  ELSE
    INSERT INTO public.waiter_table_assignments (tenant_id, table_id, waiter_id, assigned_by)
    SELECT p_tenant, x, p_waiter, auth.uid() FROM unnest(COALESCE(p_table_ids, ARRAY[]::uuid[])) x
    ON CONFLICT (tenant_id, table_id) DO UPDATE SET waiter_id = EXCLUDED.waiter_id, assigned_by = EXCLUDED.assigned_by, assigned_at = now();
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Troca de turno: dono/gerente (qualquer par) ou o próprio garçom (só as dele). p_table_ids NULL => todas as mesas do p_from.
CREATE FUNCTION public.pass_waiter_tables(p_tenant uuid, p_from uuid, p_to uuid, p_table_ids uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_role text := public._tenant_role_of_caller(p_tenant);
  v_n integer;
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'FORBIDDEN: sem permissão.' USING ERRCODE = '42501'; END IF;
  IF v_role = 'WAITER' AND p_from IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'FORBIDDEN: você só pode passar as suas mesas.' USING ERRCODE = '42501';
  ELSIF v_role NOT IN ('WAITER', 'OWNER', 'MANAGER') THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF p_to = p_from OR NOT public._waiter_is_active(p_tenant, p_to) THEN
    RAISE EXCEPTION 'WAITER_NOT_FOUND: escolha outro garçom ativo.';
  END IF;
  UPDATE public.waiter_table_assignments SET waiter_id = p_to, assigned_by = auth.uid(), assigned_at = now()
  WHERE tenant_id = p_tenant AND waiter_id = p_from AND (p_table_ids IS NULL OR table_id = ANY (p_table_ids));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.waiter_calls wc SET assigned_to = p_to
  WHERE wc.tenant_id = p_tenant AND wc.status = 'OPEN' AND wc.accepted_by IS NULL AND wc.route = 'ASSIGNED' AND wc.assigned_to = p_from
    AND EXISTS (SELECT 1 FROM public.dining_tabs tb JOIN public.waiter_table_assignments a ON a.tenant_id = tb.tenant_id AND a.table_id = tb.table_id
                WHERE tb.id = wc.tab_id AND tb.tenant_id = wc.tenant_id AND a.waiter_id = p_to);
  RETURN v_n;
END;
$$;

CREATE FUNCTION public.waiter_heartbeat(p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR public._tenant_role_of_caller(p_tenant) IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.waiter_presence (tenant_id, user_id, last_seen_at) VALUES (p_tenant, auth.uid(), now())
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET last_seen_at = now();
END;
$$;

CREATE FUNCTION public.waiter_go_offline(p_tenant uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$ DELETE FROM public.waiter_presence WHERE tenant_id = p_tenant AND user_id = auth.uid(); $$;

-- "Vou atender": o primeiro que toca assume; some para os outros (RLS restritiva) e vira dele.
CREATE FUNCTION public.accept_waiter_call(p_call_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_c public.waiter_calls;
  v_role text;
BEGIN
  SELECT wc.* INTO v_c FROM public.waiter_calls wc WHERE wc.id = p_call_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WAITER_CALL_NOT_FOUND: chamado não encontrado.'; END IF;
  v_role := public._tenant_role_of_caller(v_c.tenant_id);
  IF auth.uid() IS NULL OR v_role IS NULL OR v_role NOT IN ('OWNER', 'MANAGER', 'WAITER', 'CASHIER') THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para atender este chamado.' USING ERRCODE = '42501';
  END IF;
  IF v_c.status <> 'OPEN' THEN RAISE EXCEPTION 'WAITER_CALL_NOT_OPEN: chamado não está aberto.'; END IF;
  IF v_c.accepted_by IS NOT NULL THEN
    IF v_c.accepted_by = auth.uid() THEN RETURN; END IF;
    RAISE EXCEPTION 'WAITER_CALL_TAKEN: outro garçom já assumiu este chamado.' USING ERRCODE = 'P0409';
  END IF;
  IF v_role = 'WAITER' AND NOT public._waiter_call_visible(v_c.tenant_id, v_c.route, v_c.assigned_to, v_c.accepted_by, v_c.status,
                                                          v_c.created_at, v_c.escalated_at, v_c.handled_by) THEN
    RAISE EXCEPTION 'FORBIDDEN: este chamado não é da sua mesa.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.waiter_calls SET accepted_by = auth.uid(), accepted_at = now() WHERE id = v_c.id;
END;
$$;

-- Central: dono/gerente toca no garçom => só ele recebe o chamado.
CREATE FUNCTION public.dispatch_waiter_call(p_call_id uuid, p_waiter uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_c public.waiter_calls;
BEGIN
  SELECT wc.* INTO v_c FROM public.waiter_calls wc WHERE wc.id = p_call_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WAITER_CALL_NOT_FOUND: chamado não encontrado.'; END IF;
  PERFORM public._waiter_require_manager(v_c.tenant_id);
  IF v_c.status <> 'OPEN' OR v_c.accepted_by IS NOT NULL THEN RAISE EXCEPTION 'WAITER_CALL_NOT_OPEN: chamado não está aberto.'; END IF;
  IF NOT public._waiter_is_active(v_c.tenant_id, p_waiter) THEN RAISE EXCEPTION 'WAITER_NOT_FOUND: garçom inativo ou inexistente.'; END IF;
  UPDATE public.waiter_calls SET route = 'CENTRAL', assigned_to = p_waiter, dispatched_by = auth.uid(), dispatched_at = now(), escalated_at = NULL
  WHERE id = v_c.id;
END;
$$;

-- Escalonar para todos (central, manual) — também usado para forçar a liberação de qualquer chamado.
CREATE FUNCTION public.escalate_waiter_call(p_call_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_c public.waiter_calls;
BEGIN
  SELECT wc.* INTO v_c FROM public.waiter_calls wc WHERE wc.id = p_call_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WAITER_CALL_NOT_FOUND: chamado não encontrado.'; END IF;
  PERFORM public._waiter_require_manager(v_c.tenant_id);
  IF v_c.status <> 'OPEN' OR v_c.accepted_by IS NOT NULL THEN RAISE EXCEPTION 'WAITER_CALL_NOT_OPEN: chamado não está aberto.'; END IF;
  UPDATE public.waiter_calls SET escalated_at = now() WHERE id = v_c.id;
END;
$$;

-- Grava o escalonamento dos chamados com tempo esgotado (modo FIXO). Qualquer equipe pode chamar; idempotente.
CREATE FUNCTION public.escalate_due_waiter_calls(p_tenant uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_s public.waiter_service_settings;
  v_n integer;
BEGIN
  IF auth.uid() IS NULL OR public._tenant_role_of_caller(p_tenant) IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão.' USING ERRCODE = '42501';
  END IF;
  v_s := public._waiter_settings(p_tenant);
  UPDATE public.waiter_calls wc SET escalated_at = now()
  WHERE wc.tenant_id = p_tenant AND wc.status = 'OPEN' AND wc.accepted_by IS NULL AND wc.escalated_at IS NULL
    AND wc.route = 'ASSIGNED'
    AND (wc.created_at + make_interval(secs => v_s.accept_timeout_seconds) <= now()
         OR NOT public._waiter_is_online(p_tenant, wc.assigned_to));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Híbrido: garçom "Ajuda" em mesa de outro; fica registrado.
CREATE FUNCTION public.waiter_help_table(p_tenant uuid, p_table_id uuid, p_call_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR public._tenant_role_of_caller(p_tenant) IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public._waiter_settings(p_tenant)).hybrid_help OR (public._waiter_settings(p_tenant)).mode <> 'FIXED' THEN
    RAISE EXCEPTION 'HYBRID_DISABLED: o modo "Ajudar" não está ativo.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dining_tables dt WHERE dt.id = p_table_id AND dt.tenant_id = p_tenant) THEN
    RAISE EXCEPTION 'INVALID_INPUT: mesa não encontrada.';
  END IF;
  IF p_call_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.waiter_calls wc WHERE wc.id = p_call_id AND wc.tenant_id = p_tenant) THEN
    RAISE EXCEPTION 'INVALID_INPUT: chamado não encontrado.';
  END IF;
  INSERT INTO public.waiter_table_helpers (tenant_id, table_id, waiter_id, call_id) VALUES (p_tenant, p_table_id, auth.uid(), p_call_id);
END;
$$;

-- Painel da central: garçons com online/ocupado/mesas (sem telefone nem e-mail).
CREATE FUNCTION public.waiter_roster(p_tenant uuid) RETURNS TABLE (
  user_id uuid, name text, photo_url text, online boolean, busy boolean, table_count integer, open_calls integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR public._tenant_role_of_caller(p_tenant) IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT wp.user_id, u.name::text, wp.photo_url,
         public._waiter_is_online(p_tenant, wp.user_id),
         EXISTS (SELECT 1 FROM public.waiter_calls wc WHERE wc.tenant_id = p_tenant AND wc.status = 'OPEN' AND wc.accepted_by = wp.user_id),
         (SELECT count(*)::int FROM public.waiter_table_assignments a WHERE a.tenant_id = p_tenant AND a.waiter_id = wp.user_id),
         (SELECT count(*)::int FROM public.waiter_calls wc WHERE wc.tenant_id = p_tenant AND wc.status = 'OPEN'
                 AND (wc.accepted_by = wp.user_id OR (wc.accepted_by IS NULL AND wc.assigned_to = wp.user_id)))
  FROM public.waiter_profiles wp
  JOIN public.users u ON u.id = wp.user_id
  WHERE wp.tenant_id = p_tenant AND wp.active
  ORDER BY u.name;
END;
$$;

-- handle_waiter_call v2: respeita o roteamento (garçom só conclui o que pode ver / assumiu) e registra quem atendeu.
CREATE OR REPLACE FUNCTION public.handle_waiter_call(p_call_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_c public.waiter_calls;
BEGIN
  SELECT wc.* INTO v_c FROM public.waiter_calls wc WHERE wc.id = p_call_id FOR UPDATE;
  IF v_c.id IS NULL THEN
    RAISE EXCEPTION 'WAITER_CALL_NOT_FOUND: chamado não encontrado.';
  END IF;
  IF auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_c.tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para atender este chamado.' USING ERRCODE = '42501';
  END IF;
  IF public._dine_in_config(v_c.tenant_id) IS NULL THEN
    RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.';
  END IF;
  IF v_c.status <> 'OPEN' THEN
    RAISE EXCEPTION 'WAITER_CALL_NOT_OPEN: chamado não está aberto.';
  END IF;
  IF v_c.accepted_by IS NOT NULL AND v_c.accepted_by <> auth.uid()
     AND public._tenant_role_of_caller(v_c.tenant_id) = 'WAITER' THEN
    RAISE EXCEPTION 'WAITER_CALL_TAKEN: outro garçom já assumiu este chamado.' USING ERRCODE = 'P0409';
  END IF;
  IF v_c.accepted_by IS NULL AND public._tenant_role_of_caller(v_c.tenant_id) = 'WAITER'
     AND NOT public._waiter_call_visible(v_c.tenant_id, v_c.route, v_c.assigned_to, v_c.accepted_by, v_c.status,
                                         v_c.created_at, v_c.escalated_at, v_c.handled_by) THEN
    RAISE EXCEPTION 'FORBIDDEN: este chamado não é da sua mesa.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.waiter_calls
  SET status = 'HANDLED', handled_by = auth.uid(), handled_at = now(),
      accepted_by = COALESCE(accepted_by, auth.uid()), accepted_at = COALESCE(accepted_at, now())
  WHERE id = p_call_id AND tenant_id = v_c.tenant_id AND status = 'OPEN';
END;
$$;
REVOKE ALL ON FUNCTION public.handle_waiter_call(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_waiter_call(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.set_waiter_service_settings(uuid, text, boolean, integer, integer), public.assign_waiter_tables(uuid, uuid, uuid[]),
  public.pass_waiter_tables(uuid, uuid, uuid, uuid[]), public.waiter_heartbeat(uuid), public.waiter_go_offline(uuid),
  public.accept_waiter_call(uuid), public.dispatch_waiter_call(uuid, uuid), public.escalate_waiter_call(uuid),
  public.escalate_due_waiter_calls(uuid), public.waiter_help_table(uuid, uuid, uuid), public.waiter_roster(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_waiter_service_settings(uuid, text, boolean, integer, integer), public.assign_waiter_tables(uuid, uuid, uuid[]),
  public.pass_waiter_tables(uuid, uuid, uuid, uuid[]), public.waiter_heartbeat(uuid), public.waiter_go_offline(uuid),
  public.accept_waiter_call(uuid), public.dispatch_waiter_call(uuid, uuid), public.escalate_waiter_call(uuid),
  public.escalate_due_waiter_calls(uuid), public.waiter_help_table(uuid, uuid, uuid), public.waiter_roster(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Relatório por garçom e "Seu garçom"
-- ---------------------------------------------------------------------------
-- Dono/gerente: todos (ou um). Garçom: somente o próprio. Gorjeta/10% = taxa de serviço das comandas fechadas (subtotal dos pedidos × %).
CREATE FUNCTION public.waiter_performance_report(p_tenant uuid, p_from timestamptz, p_to timestamptz, p_waiter uuid DEFAULT NULL) RETURNS TABLE (
  waiter_id uuid, name text, tabs_attended integer, orders_count integer, total_sold numeric,
  calls_handled integer, avg_response_seconds numeric, service_fee_total numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_role text := public._tenant_role_of_caller(p_tenant);
  v_filter uuid := p_waiter;
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL OR v_role NOT IN ('OWNER', 'MANAGER', 'WAITER') THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para ver o relatório.' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'WAITER' THEN v_filter := auth.uid(); END IF;
  RETURN QUERY
  WITH w AS (
    SELECT wp.user_id, u.name::text AS name FROM public.waiter_profiles wp JOIN public.users u ON u.id = wp.user_id
    WHERE wp.tenant_id = p_tenant AND (v_filter IS NULL OR wp.user_id = v_filter)
  ), o AS (
    SELECT od.waiter_id, count(*)::int AS n, COALESCE(sum(od.total_amount), 0) AS total
    FROM public.orders od
    WHERE od.tenant_id = p_tenant AND od.fulfillment_type = 'DINE_IN' AND od.waiter_id IS NOT NULL
      AND od.status <> 'CANCELLED' AND od.created_at >= p_from AND od.created_at < p_to
    GROUP BY od.waiter_id
  ), t AS (
    SELECT x.wid, count(DISTINCT x.tab_id)::int AS n FROM (
      SELECT tb.waiter_id AS wid, tb.id AS tab_id FROM public.dining_tabs tb
        WHERE tb.tenant_id = p_tenant AND tb.waiter_id IS NOT NULL AND tb.opened_at >= p_from AND tb.opened_at < p_to
      UNION ALL SELECT od.waiter_id, od.tab_id FROM public.orders od
        WHERE od.tenant_id = p_tenant AND od.waiter_id IS NOT NULL AND od.tab_id IS NOT NULL AND od.created_at >= p_from AND od.created_at < p_to
      UNION ALL SELECT tb.closed_by, tb.id FROM public.dining_tabs tb
        WHERE tb.tenant_id = p_tenant AND tb.closed_by IS NOT NULL AND tb.closed_at >= p_from AND tb.closed_at < p_to
    ) x GROUP BY x.wid
  ), c AS (
    SELECT COALESCE(wc.accepted_by, wc.handled_by) AS wid, count(*)::int AS n,
           avg(extract(epoch FROM (COALESCE(wc.accepted_at, wc.handled_at) - wc.created_at))) AS avg_s
    FROM public.waiter_calls wc
    WHERE wc.tenant_id = p_tenant AND wc.status IN ('OPEN', 'HANDLED') AND (wc.accepted_by IS NOT NULL OR wc.status = 'HANDLED')
      AND wc.created_at >= p_from AND wc.created_at < p_to
    GROUP BY COALESCE(wc.accepted_by, wc.handled_by)
  ), f AS (
    SELECT COALESCE(tb.waiter_id, tb.closed_by) AS wid,
           sum(round((SELECT COALESCE(sum(od.subtotal), 0) FROM public.orders od
                      WHERE od.tenant_id = tb.tenant_id AND od.tab_id = tb.id AND od.status <> 'CANCELLED') * tb.service_fee_percent / 100, 2)) AS fee
    FROM public.dining_tabs tb
    WHERE tb.tenant_id = p_tenant AND tb.status = 'CLOSED' AND NOT tb.service_fee_removed
      AND tb.closed_at >= p_from AND tb.closed_at < p_to
    GROUP BY COALESCE(tb.waiter_id, tb.closed_by)
  )
  SELECT w.user_id, w.name, COALESCE(t.n, 0), COALESCE(o.n, 0), COALESCE(o.total, 0), COALESCE(c.n, 0),
         round(c.avg_s::numeric, 1), COALESCE(f.fee, 0)
  FROM w LEFT JOIN o ON o.waiter_id = w.user_id LEFT JOIN t ON t.wid = w.user_id
         LEFT JOIN c ON c.wid = w.user_id LEFT JOIN f ON f.wid = w.user_id
  ORDER BY COALESCE(o.total, 0) DESC, w.name;
END;
$$;
REVOKE ALL ON FUNCTION public.waiter_performance_report(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waiter_performance_report(uuid, timestamptz, timestamptz, uuid) TO authenticated;

-- Cliente da mesa: SÓ nome e foto (LGPD). Responsável = quem abriu a comanda; senão o dono da mesa (modo fixo).
CREATE FUNCTION public.get_my_table_waiter(p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tab public.dining_tabs;
  v_waiter uuid;
  v_name text;
  v_photo text;
BEGIN
  SELECT tb.* INTO v_tab
  FROM public.tab_sessions ts JOIN public.dining_tabs tb ON tb.tenant_id = ts.tenant_id AND tb.id = ts.tab_id
  WHERE ts.id = p_session_id AND ts.auth_user_id = auth.uid() AND ts.ended_at IS NULL AND ts.expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT a.waiter_id INTO v_waiter FROM public.waiter_table_assignments a WHERE a.tenant_id = v_tab.tenant_id AND a.table_id = v_tab.table_id;
  v_waiter := COALESCE(v_waiter, v_tab.waiter_id);
  IF v_waiter IS NULL OR NOT public._waiter_is_active(v_tab.tenant_id, v_waiter) THEN RETURN NULL; END IF;
  SELECT u.name, wp.photo_url INTO v_name, v_photo
  FROM public.users u JOIN public.waiter_profiles wp ON wp.user_id = u.id WHERE u.id = v_waiter;
  RETURN jsonb_build_object('name', v_name, 'photo_url', v_photo);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_table_waiter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_table_waiter(uuid) TO authenticated;

CREATE FUNCTION public.waiter_v2_capabilities() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT jsonb_build_object('version', 1, 'username_login', true, 'modes', jsonb_build_array('FREE', 'FIXED', 'CENTRAL'),
                                'report', true, 'my_waiter', true); $$;
REVOKE ALL ON FUNCTION public.waiter_v2_capabilities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waiter_v2_capabilities() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Foto do garçom (bucket público de leitura; escrita só pelo servidor/service role) — se o Storage existir.
-- ---------------------------------------------------------------------------
DO $st$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('waiter-photos', 'waiter-photos', true, 262144, ARRAY['image/jpeg', 'image/png', 'image/webp'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$st$;

COMMIT;
