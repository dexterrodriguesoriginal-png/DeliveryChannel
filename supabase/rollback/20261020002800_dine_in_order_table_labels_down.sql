-- Rollback 20261020002800: remove the staff-only table-label RPC (read-only, no data touched).
BEGIN;
DROP FUNCTION IF EXISTS public.get_dine_in_order_table_labels(uuid, uuid[]);
COMMIT;
