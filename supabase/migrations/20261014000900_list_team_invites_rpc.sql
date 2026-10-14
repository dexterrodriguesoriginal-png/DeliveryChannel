-- =============================================================================
-- 20261014000900_list_team_invites_rpc.sql
-- Base: 001–020 + N1–N6 + 0700 v3.4 + 0800.
-- Leitura de convites de equipe por RPC, mantendo team_invites sem SELECT para anon/authenticated
-- (0800). Corrige a tela Equipe e o onboarding, que liam a tabela direto e recebiam 403.
--   list_team_invites(p_tenant_id): só OWNER ativo da loja ativa (CEO/SUPER_ADMIN ativos via
--     has_tenant_role); MANAGER excluído, igual ao RBAC do front (manage_team).
--   list_my_team_invites(): convites pendentes do e-mail do próprio usuário (de auth.users).
-- Só PENDING e não vencidos; sem accepted_*; team_invites não tem token/hash.
-- STABLE, SECURITY DEFINER, search_path vazio; EXECUTE só para authenticated.
-- Não altera RLS, policies nem privilégios de tabela. Aplicar uma única vez (o PRE aborta se já existe).
-- =============================================================================
BEGIN;
-- PRE: função ainda não existe; tabela e colunas esperadas
DO $pre$ BEGIN
  IF to_regprocedure('public.list_team_invites(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'PRE: list_team_invites já existe'; END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='team_invites'
      AND column_name IN ('id','tenant_id','email','role_id','invited_by','status','expires_at','created_at')) <> 8 THEN
    RAISE EXCEPTION 'PRE: colunas de team_invites divergem'; END IF;
END $pre$;

-- Convites PENDENTES e não expirados da loja; só gestor de equipe ATIVO da loja.
CREATE FUNCTION public.list_team_invites(p_tenant_id uuid)
RETURNS TABLE (id uuid, tenant_id uuid, email text, role_id text, invited_by uuid, invited_by_name text,
               status text, expires_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501'; END IF;
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'Loja obrigatória.' USING ERRCODE = '22023'; END IF;
  -- has_tenant_role: vínculo ACTIVE + loja ACTIVE (ou CEO/SUPER_ADMIN ativo). Trocar para ARRAY['OWNER','MANAGER'] se decidido.
  IF NOT public.has_tenant_role(v_uid, p_tenant_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION 'Sem permissão para ver convites desta loja.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT ti.id, ti.tenant_id, ti.email::text, ti.role_id::text, ti.invited_by, u.name::text,
           ti.status::text, ti.expires_at, ti.created_at
    FROM public.team_invites ti
    LEFT JOIN public.users u ON u.id = ti.invited_by
    WHERE ti.tenant_id = p_tenant_id AND ti.status = 'PENDING' AND ti.expires_at > now()
    ORDER BY ti.created_at DESC
    LIMIT 200;
END $$;

-- Convites PENDENTES recebidos pelo próprio usuário (e-mail da sessão), para o onboarding.
CREATE FUNCTION public.list_my_team_invites()
RETURNS TABLE (id uuid, tenant_id uuid, tenant_name text, role_id text, invited_by_name text,
               status text, expires_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_email text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501'; END IF;
  SELECT lower(au.email) INTO v_email FROM auth.users au WHERE au.id = v_uid;  -- e-mail do servidor, não do JWT
  IF v_email IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT ti.id, ti.tenant_id, t.name::text, ti.role_id::text, u.name::text, ti.status::text, ti.expires_at, ti.created_at
    FROM public.team_invites ti
    JOIN public.tenants t ON t.id = ti.tenant_id
    LEFT JOIN public.users u ON u.id = ti.invited_by
    WHERE lower(ti.email) = v_email AND ti.status = 'PENDING' AND ti.expires_at > now()
    ORDER BY ti.created_at DESC
    LIMIT 50;
END $$;

REVOKE ALL ON FUNCTION public.list_team_invites(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_team_invites() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_team_invites(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_team_invites() TO authenticated;

-- POST: tabela continua fechada; só authenticated executa
DO $post$ BEGIN
  IF has_table_privilege('authenticated','public.team_invites','SELECT') OR has_table_privilege('anon','public.team_invites','SELECT') THEN
    RAISE EXCEPTION 'POST: SELECT em team_invites não deveria existir'; END IF;
  IF has_function_privilege('anon','public.list_team_invites(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.list_my_team_invites()','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.list_team_invites(uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.list_my_team_invites()','EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.proname IN ('list_team_invites','list_my_team_invites')
                AND p.pronamespace='public'::regnamespace AND a.grantee = 0) THEN
    RAISE EXCEPTION 'POST: grants de função inesperados'; END IF;
END $post$;
COMMIT;
