-- EFEITOS DESTRUTIVOS: nenhum dado; remove a RPC set_my_availability (frontend passa a falhar ao mudar disponibilidade).
-- Rollback 1100: remove set_my_availability. Sem perda de dados (só função). Frontend que chama a RPC passa a receber 404/42883.
BEGIN;
DO $pre$ BEGIN
  IF to_regclass('public.driver_locations') IS NOT NULL THEN RAISE EXCEPTION 'PRE: reverter 1300/1200 antes do 1100'; END IF;
END $pre$;
DROP FUNCTION IF EXISTS public.set_my_availability(uuid, text);
DO $post$ BEGIN
  IF to_regprocedure('public.set_my_availability(uuid,text)') IS NOT NULL THEN RAISE EXCEPTION 'POST: função ainda existe'; END IF;
END $post$;
COMMIT;
