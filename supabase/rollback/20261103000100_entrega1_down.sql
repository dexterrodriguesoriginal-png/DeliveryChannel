-- Entrega 1 — rollback transacional, restaurando definições e ACL do instante do apply.
BEGIN;
-- Não remove pessoas para satisfazer uma constraint antiga. Resolva vínculos/convites de
-- Cozinha antes de executar down em uma base que já passou a usar o novo papel.
DO $pre$
BEGIN
 IF EXISTS(SELECT 1 FROM public.tenant_users WHERE role_id='KITCHEN') OR EXISTS(SELECT 1 FROM public.team_invites WHERE role_id='KITCHEN') THEN
  RAISE EXCEPTION 'ROLLBACK_BLOCKED: há vínculos/convites de Cozinha; migre os papéis antes do rollback (nenhuma pessoa será excluída).';
 END IF;
END $pre$;

DO $restore$
DECLARE r record; a jsonb;
BEGIN
 FOR r IN SELECT * FROM public._entrega1_restore WHERE signature NOT LIKE 'constraint:%' ORDER BY signature LOOP
  EXECUTE r.definition;
  EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role';
  FOR a IN SELECT * FROM jsonb_array_elements(r.acl) LOOP
   EXECUTE 'GRANT '||(a->>'privilege')||' ON FUNCTION '||r.signature||' TO '||CASE WHEN a->>'grantee'='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(a->>'grantee') END||CASE WHEN (a->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
  END LOOP;
 END LOOP;
END $restore$;
DO $policies$
DECLARE r record;
BEGIN
 FOR r IN SELECT schemaname,tablename,policyname FROM pg_catalog.pg_policies WHERE schemaname='public' AND policyname LIKE 'entrega1_%' LOOP
  EXECUTE format('DROP POLICY %I ON %I.%I',r.policyname,r.schemaname,r.tablename);
 END LOOP;
END $policies$;
ALTER TABLE public.team_invites DROP CONSTRAINT chk_team_invites_role;
-- Mantém a expressão-fonte do baseline: deparse/reparse de ANY(varchar[]::text[])
-- redistribui casts no PostgreSQL e perde a igualdade estrutural do CHECK.
ALTER TABLE public.team_invites ADD CONSTRAINT chk_team_invites_role CHECK(role_id IN('MANAGER','CASHIER','OPERATOR','DELIVERY_MANAGER','DRIVER','WAITER')) NOT VALID;
DROP FUNCTION public._store_caller_role(uuid);
DROP FUNCTION public._store_waiter_tab_visible(uuid);
DROP FUNCTION public.salon_rounds_for_staff(uuid,uuid);
DROP FUNCTION public.team_accept_invite(text,text);
DROP FUNCTION public.waiter_reusable_identity(uuid,text);
DROP FUNCTION public.waiter_invite_check(text,text);
DROP FUNCTION public.team_invite_check(text,text,text);
DROP FUNCTION public._team_signup_invited(text,text,text);
DROP FUNCTION public.set_store_role_permission(uuid,text,text,boolean);
DROP FUNCTION public.set_store_tool(uuid,text,boolean);
DROP FUNCTION public.list_store_role_permissions(uuid);
DROP FUNCTION public.get_store_access(uuid);
DROP FUNCTION public.list_store_tools(uuid);
DROP TABLE public.store_access_audit,public.store_role_permissions,public.store_tools;
DROP FUNCTION public.has_store_permission(uuid,text);
DROP FUNCTION public._store_user_permission(uuid,uuid,text);
DROP FUNCTION public._store_tool_enabled(uuid,text);
DROP FUNCTION public._store_role_defaults(text);
DELETE FROM public.roles WHERE id='KITCHEN';
DROP TABLE public._entrega1_restore;
COMMIT;
