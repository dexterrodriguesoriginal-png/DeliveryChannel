-- rollback_0900.sql — remove as RPCs da 0900. O front volta a mostrar listas vazias (sem erro novo).
-- Uso só com autorização explícita. Depois: delete from supabase_migrations.schema_migrations where version='20261014000900';
BEGIN;
DROP FUNCTION IF EXISTS public.list_team_invites(uuid);
DROP FUNCTION IF EXISTS public.list_my_team_invites();
DO $chk$ BEGIN
  IF to_regprocedure('public.list_team_invites(uuid)') IS NOT NULL OR to_regprocedure('public.list_my_team_invites()') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK CHECK: funções ainda existem'; END IF;
  IF has_table_privilege('authenticated','public.team_invites','SELECT') THEN RAISE EXCEPTION 'ROLLBACK CHECK: SELECT inesperado'; END IF;
  RAISE NOTICE 'rollback_0900 OK';
END $chk$;
COMMIT;
