-- Expected-failure fixture. Run only against a disposable PRE-entrega1 database:
-- psql -v ON_ERROR_STOP=1 -v patch_case=literal -f security_patch_guards.sql
-- Cases literal/regexp/path/path_extra/roles must abort the included migration with
-- ENTREGA1_PATCH_MISMATCH. The open transaction must roll back on connection exit.
\set ON_ERROR_STOP 1
\if :{?patch_case}
\else
  \set patch_case literal
\endif
BEGIN;
SELECT set_config('entrega1.patch_case',:'patch_case',true);
DO $drift$
DECLARE v_case text:=current_setting('entrega1.patch_case'); v_before text; v_after text;
BEGIN
 IF v_case='literal' THEN
  v_before:=pg_catalog.pg_get_functiondef('public._waiter_is_active(uuid,uuid)'::regprocedure);
  v_after:=replace(v_before,'SELECT EXISTS','SELECT /* fixture: baseline drift */ EXISTS');
 ELSIF v_case='regexp' THEN
  v_before:=pg_catalog.pg_get_functiondef('public._legal_signup_check()'::regprocedure);
  v_after:=replace(v_before,'BEGIN','begin');
 ELSIF v_case='roles' THEN
  v_before:=pg_catalog.pg_get_functiondef('public.create_team_invite(uuid,character varying,character varying)'::regprocedure);
  v_after:=replace(v_before,$s$'DRIVER','WAITER')$s$,$s$'DRIVER' , 'WAITER')$s$);
 ELSIF v_case='path' THEN
  ALTER FUNCTION public._kitchen_resolve_tenant(uuid) SET search_path TO public;
  RETURN;
 ELSIF v_case='path_extra' THEN
  ALTER FUNCTION public._kitchen_resolve_tenant(uuid) SET search_path TO '',public;
  RETURN;
 ELSE RAISE EXCEPTION 'Unknown patch_case'; END IF;
 IF v_after IS NOT DISTINCT FROM v_before THEN RAISE EXCEPTION 'Invalid drift fixture: baseline anchor missing'; END IF;
 EXECUTE v_after;
END $drift$;
\ir ../../migrations/20261103000100_entrega1.sql
