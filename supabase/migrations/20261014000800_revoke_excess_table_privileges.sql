-- =============================================================================
-- 20261014000800_revoke_excess_table_privileges.sql
-- Base: 001–020 + N1–N6 + 20261006000700 (v3.4, sha256 29842f77…cf2d).
-- Fonte: /workspace/proposals/revoke_privilegios_relatorio.md (auditoria read-only staging 14/10 15:50 BRT).
--
-- Remove de anon e authenticated os privilégios TRUNCATE, MAINTAIN, REFERENCES e TRIGGER em
-- public.drivers, public.team_invites e public.tenant_users. Nenhum é usado pelo app (escritas só via
-- RPC SECURITY DEFINER de dono postgres). TRUNCATE e MAINTAIN ignoram RLS.
-- Mantém: SELECT de authenticated em tenant_users (AuthContext/teamRepository).
-- NÃO toca: service_role, postgres, demais tabelas, default privileges, SELECT de team_invites.
--
-- Requer PostgreSQL 17+ (privilégio MAINTAIN). Idempotente: reexecutar é seguro (o precheck aceita o
-- estado auditado ou o estado já revogado; REVOKE de privilégio ausente não falha).
-- Transação própria (BEGIN/COMMIT), no mesmo padrão da 0700 aplicada via psql -f.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- PRE: aborta se o estado diverge do auditado
-- -----------------------------------------------------------------------------
DO $pre$
DECLARE
  t text; r text; p text; v_expected boolean; v_has boolean;
BEGIN
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE EXCEPTION 'PRE: PostgreSQL 17+ exigido (MAINTAIN); versao=%', current_setting('server_version');
  END IF;

  FOREACH t IN ARRAY ARRAY['public.drivers','public.team_invites','public.tenant_users'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'PRE: tabela % inexistente', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(t)) THEN
      RAISE EXCEPTION 'PRE: RLS desligada em %', t;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      -- SELECT/INSERT/UPDATE/DELETE: devem ser exatamente o auditado
      FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
        v_expected := (t = 'public.tenant_users' AND r = 'authenticated' AND p = 'SELECT');
        v_has := has_table_privilege(r, t, p);
        IF v_has IS DISTINCT FROM v_expected THEN
          RAISE EXCEPTION 'PRE: % em % para % = % (auditado %)', p, t, r, v_has, v_expected;
        END IF;
      END LOOP;
      -- alvos: auditado (S, exceto TRUNCATE em drivers) ou já revogado (n)
      FOREACH p IN ARRAY ARRAY['TRUNCATE','MAINTAIN','REFERENCES','TRIGGER'] LOOP
        v_expected := NOT (t = 'public.drivers' AND p = 'TRUNCATE');
        v_has := has_table_privilege(r, t, p);
        IF v_has AND NOT v_expected THEN
          RAISE EXCEPTION 'PRE: % em % para % presente (auditado ausente)', p, t, r;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- sem ACL por coluna para anon/authenticated
  IF EXISTS (
    SELECT 1 FROM pg_attribute a, aclexplode(a.attacl) x
    WHERE a.attrelid IN ('public.drivers'::regclass,'public.team_invites'::regclass,'public.tenant_users'::regclass)
      AND a.attacl IS NOT NULL
      AND x.grantee IN ('anon'::regrole, 'authenticated'::regrole)
  ) THEN
    RAISE EXCEPTION 'PRE: ACL por coluna inesperada para anon/authenticated';
  END IF;
END
$pre$;

-- foto das ACLs de outros papéis (service_role, postgres etc.) para provar que não mudam
CREATE TEMP TABLE _m0800_other_acl ON COMMIT DROP AS
SELECT c.oid::regclass::text AS tbl, x.grantee, x.grantor, x.privilege_type, x.is_grantable
FROM pg_class c, aclexplode(c.relacl) x
WHERE c.oid IN ('public.drivers'::regclass,'public.team_invites'::regclass,'public.tenant_users'::regclass)
  AND x.grantee NOT IN ('anon'::regrole, 'authenticated'::regrole);

-- -----------------------------------------------------------------------------
-- REVOKE
-- -----------------------------------------------------------------------------
REVOKE TRUNCATE, MAINTAIN, REFERENCES, TRIGGER
  ON TABLE public.drivers, public.team_invites, public.tenant_users
  FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- POST
-- -----------------------------------------------------------------------------
DO $post$
DECLARE t text; r text; p text; v_expected boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['public.drivers','public.team_invites','public.tenant_users'] LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        v_expected := (t = 'public.tenant_users' AND r = 'authenticated' AND p = 'SELECT');
        IF has_table_privilege(r, t, p) IS DISTINCT FROM v_expected THEN
          RAISE EXCEPTION 'POST: % em % para % diferente do esperado (%)', p, t, r, v_expected;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF EXISTS (
    (SELECT * FROM _m0800_other_acl
     EXCEPT
     SELECT c.oid::regclass::text, x.grantee, x.grantor, x.privilege_type, x.is_grantable
     FROM pg_class c, aclexplode(c.relacl) x
     WHERE c.oid IN ('public.drivers'::regclass,'public.team_invites'::regclass,'public.tenant_users'::regclass)
       AND x.grantee NOT IN ('anon'::regrole, 'authenticated'::regrole))
    UNION ALL
    (SELECT c.oid::regclass::text, x.grantee, x.grantor, x.privilege_type, x.is_grantable
     FROM pg_class c, aclexplode(c.relacl) x
     WHERE c.oid IN ('public.drivers'::regclass,'public.team_invites'::regclass,'public.tenant_users'::regclass)
       AND x.grantee NOT IN ('anon'::regrole, 'authenticated'::regrole)
     EXCEPT
     SELECT * FROM _m0800_other_acl)
  ) THEN
    RAISE EXCEPTION 'POST: ACL de outros papeis (service_role/postgres) mudou';
  END IF;

  RAISE NOTICE '0800 POST OK: anon/authenticated sem TRUNCATE/MAINTAIN/REFERENCES/TRIGGER nas 3 tabelas; authenticated mantém SELECT em tenant_users';
END
$post$;

COMMIT;
