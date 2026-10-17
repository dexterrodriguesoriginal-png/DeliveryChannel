-- Rollback do n5_delta_manual.sql. Remove SOMENTE os 2 objetos criados. NÃO executar sem autorização.
\set ON_ERROR_STOP on
SET lock_timeout = '5s';
BEGIN;
DROP FUNCTION IF EXISTS public.get_promo_offer_performance(uuid,timestamp with time zone,timestamp with time zone);
DROP INDEX IF EXISTS public.idx_orders_tenant_offer_created;
DO $$ BEGIN
  IF to_regclass('public.idx_orders_tenant_offer_created') IS NOT NULL
     OR to_regprocedure('public.get_promo_offer_performance(uuid,timestamp with time zone,timestamp with time zone)') IS NOT NULL
  THEN RAISE EXCEPTION 'ROLLBACK POST falhou'; END IF; RAISE NOTICE 'ROLLBACK OK'; END $$;
COMMIT;
