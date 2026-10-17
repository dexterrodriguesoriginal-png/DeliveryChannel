-- EFEITOS DESTRUTIVOS: nenhum (no-op). Não reconcede privilégios perigosos.
-- Rollback 0800: NO-OP INTENCIONAL (verificado).
-- O 0800 só revoga TRUNCATE/MAINTAIN/REFERENCES/TRIGGER de anon/authenticated em drivers/team_invites/tenant_users.
-- No caminho de produção esses privilégios já foram retirados pelo 0750, então o 0800 não muda nada e não há o que devolver.
-- Reconceder privilégios perigosos não é um rollback desejável; se for preciso voltar ao estado pré-0750,
-- use o rollback do 0750 (que restaura o snapshot exato).
BEGIN;
DO $chk$ BEGIN
  IF to_regprocedure('public.list_team_invites(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'PRE: reverter 0900 antes do 0800'; END IF;
  RAISE NOTICE '0800 down: no-op (estado de privilégios mantido)';
END $chk$;
COMMIT;
