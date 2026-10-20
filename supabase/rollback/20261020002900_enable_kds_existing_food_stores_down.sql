-- Rollback 2900: remove only the kds rows this migration inserted (listed in the audit table),
-- and only if nobody changed them since (still enabled, config untouched, no updated_by).
BEGIN;
DELETE FROM public.tenant_modules m
USING public.module_backfill_audit a
WHERE a.migration = '20261020002900' AND a.module_key = 'kds'
  AND m.tenant_id = a.tenant_id AND m.module_key = 'kds'
  AND m.enabled AND m.config = '{}'::jsonb AND m.updated_by IS NULL;
DELETE FROM public.module_backfill_audit WHERE migration = '20261020002900';
DROP TABLE IF EXISTS public.module_backfill_audit;
COMMIT;
