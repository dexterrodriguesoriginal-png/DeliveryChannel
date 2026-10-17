-- EFEITOS DESTRUTIVOS: nenhum dado; remove list_team_invites/list_my_team_invites (telas de convites deixam de listar).
-- Rollback 0900: remove list_team_invites e list_my_team_invites. Sem perda de dados (só funções).
BEGIN;
DO $pre$ BEGIN
  IF to_regprocedure('public.set_my_availability(uuid,text)') IS NOT NULL THEN RAISE EXCEPTION 'PRE: reverter 1100/1000 antes do 0900'; END IF;
END $pre$;
DROP FUNCTION IF EXISTS public.list_team_invites(uuid);
DROP FUNCTION IF EXISTS public.list_my_team_invites();
COMMIT;
