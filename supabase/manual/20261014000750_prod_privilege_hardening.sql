-- 0750 — Endurecimento de privilégios (estado real de produção, antes do 0800).
-- Remove de anon/authenticated: TRUNCATE/REFERENCES/TRIGGER/MAINTAIN em todas as tabelas public;
-- toda escrita (INSERT/UPDATE/DELETE) de anon; escrita de authenticated onde NENHUMA policy a permite
-- (roles, app_events, audit_logs, tenant_email_confirmations); deixa drivers/team_invites/tenant_users
-- no alvo do 0800 (só authenticated SELECT em tenant_users); sequences: anon sem uso, ninguém com setval;
-- default privileges do role postgres em public sem os privilégios perigosos.
-- Todas as escritas legítimas usam RPC SECURITY DEFINER ou policies de authenticated, que ficam intactas.
-- Snapshot completo em public.priv_backup_0750 (rollback: rollback/20261014000750_prod_privilege_hardening_down.sql).
BEGIN;

DO $pre$
DECLARE t text;
BEGIN
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION 'PRE: PG17+ exigido'; END IF;
  IF to_regclass('public.priv_backup_0750') IS NOT NULL THEN RAISE EXCEPTION 'PRE: 0750 já aplicado (priv_backup_0750 existe)'; END IF;
  FOR t IN SELECT c.oid::regclass::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity LOOP
    RAISE EXCEPTION 'PRE: RLS desligada em % — abortar', t;
  END LOOP;
END $pre$;

-- snapshot (tabelas, sequences, colunas, default acl)
CREATE TABLE public.priv_backup_0750 AS
SELECT 'rel'::text kind, c.oid::regclass::text obj, NULL::text col, c.relkind::text relkind, c.relacl::text acl
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m')
UNION ALL
SELECT 'col', c.oid::regclass::text, a.attname::text, c.relkind::text, a.attacl::text
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND a.attacl IS NOT NULL AND a.attnum>0
UNION ALL
SELECT 'defacl', pg_get_userbyid(d.defaclrole), d.defaclobjtype::text, NULL, d.defaclacl::text
  FROM pg_default_acl d WHERE d.defaclnamespace='public'::regnamespace;
-- tabela de backup: só o owner (sem policies, RLS ligada, nenhum grant para PUBLIC/anon/authenticated/service_role)
ALTER TABLE public.priv_backup_0750 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.priv_backup_0750 FROM PUBLIC, anon, authenticated, service_role;

-- 1) privilégios perigosos fora de todas as tabelas
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
-- 2) anon não escreve diretamente em nada (fluxos públicos usam RPC SECURITY DEFINER)
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;
-- 3) authenticated: escrita onde nenhuma policy permite (sem mudança de comportamento, defesa em profundidade)
REVOKE INSERT, UPDATE, DELETE ON public.roles, public.app_events, public.audit_logs,
       public.tenant_email_confirmations FROM authenticated;
-- 4) alvo do 0800 nas 3 tabelas de equipe
REVOKE ALL ON public.drivers, public.team_invites, public.tenant_users FROM anon, authenticated;
GRANT SELECT ON public.tenant_users TO authenticated;
-- 5) sequences
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
-- 6) default privileges (objetos futuros criados por postgres)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;

DO $post$
DECLARE r record; n int;
BEGIN
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace, unnest(array['anon','authenticated']) g(rol),
         unnest(array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(priv)
   WHERE s.nspname='public' AND c.relkind IN ('r','p') AND has_table_privilege(g.rol, c.oid, p.priv);
  IF n>0 THEN RAISE EXCEPTION 'POST: % privilégios perigosos restantes', n; END IF;
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace, unnest(array['INSERT','UPDATE','DELETE']) p(priv)
   WHERE s.nspname='public' AND c.relkind IN ('r','p') AND has_table_privilege('anon', c.oid, p.priv);
  IF n>0 THEN RAISE EXCEPTION 'POST: anon ainda escreve em % casos', n; END IF;
  -- outros papéis (postgres/service_role/...) intactos
  FOR r IN SELECT b.obj FROM public.priv_backup_0750 b JOIN pg_class c ON c.oid=b.obj::regclass
           WHERE b.kind='rel' AND (SELECT coalesce(array_agg(x::text ORDER BY x::text),'{}') FROM unnest(b.acl::aclitem[]) x
                                   WHERE split_part(x::text,'=',1) NOT IN ('anon','authenticated'))
                 IS DISTINCT FROM (SELECT coalesce(array_agg(x::text ORDER BY x::text),'{}') FROM unnest(c.relacl) x
                                   WHERE split_part(x::text,'=',1) NOT IN ('anon','authenticated')) LOOP
    RAISE EXCEPTION 'POST: ACL de outros papéis mudou em %', r.obj;
  END LOOP;
  -- ACL de colunas (coupons/tenant_settings) intacta
  IF EXISTS (SELECT 1 FROM public.priv_backup_0750 b JOIN pg_attribute a ON a.attrelid=b.obj::regclass AND a.attname=b.col
             WHERE b.kind='col' AND a.attacl::text IS DISTINCT FROM b.acl) THEN
    RAISE EXCEPTION 'POST: ACL de coluna mudou';
  END IF;
  IF has_table_privilege('anon','public.priv_backup_0750','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated','public.priv_backup_0750','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('service_role','public.priv_backup_0750','SELECT,INSERT,UPDATE,DELETE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.priv_backup_0750'::regclass) THEN
    RAISE EXCEPTION 'POST: priv_backup_0750 acessível fora do owner';
  END IF;
  RAISE NOTICE '0750 POST OK';
END $post$;
COMMIT;
