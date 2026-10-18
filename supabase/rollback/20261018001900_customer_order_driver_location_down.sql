-- Rollback da 20261018001900: remove só a RPC (nenhum dado é tocado). O app volta a mostrar só a linha do tempo.
BEGIN;
DROP FUNCTION IF EXISTS public.get_order_driver_location(uuid);
COMMIT;
