-- Rollback 2910: switch kds back OFF only for rows this migration switched and nobody changed since.
BEGIN;
UPDATE public.tenant_modules m SET enabled = false
FROM public.module_backfill_audit a
WHERE a.migration = '20261020002910' AND a.module_key = 'kds' AND a.action = 'enable'
  AND m.tenant_id = a.tenant_id AND m.module_key = 'kds' AND m.enabled AND m.updated_by IS NULL;
DELETE FROM public.module_backfill_audit WHERE migration = '20261020002910';
COMMIT;
