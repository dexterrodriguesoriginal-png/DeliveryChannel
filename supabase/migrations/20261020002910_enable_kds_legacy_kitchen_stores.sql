-- 2910: switch kds ON for legacy stores (business_type NULL) that already use the kitchen
-- (paired kitchen devices or kitchen order signals), only where the kds row is OFF and was
-- never set by a person (updated_by IS NULL, i.e. created by the 2400 backfill).
-- Each switched row is recorded in public.module_backfill_audit (action = 'enable').
BEGIN;

ALTER TABLE public.module_backfill_audit ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'insert';

WITH switched AS (
  UPDATE public.tenant_modules m
  SET enabled = true, updated_at = now()
  FROM public.tenants t
  WHERE t.id = m.tenant_id
    AND m.module_key = 'kds' AND NOT m.enabled AND m.updated_by IS NULL
    AND t.business_type IS NULL AND t.slug <> 'rafa-cortes'
    AND (EXISTS (SELECT 1 FROM public.kitchen_devices d WHERE d.tenant_id = t.id)
      OR EXISTS (SELECT 1 FROM public.kitchen_order_signals s WHERE s.tenant_id = t.id))
    AND NOT EXISTS (SELECT 1 FROM public.module_backfill_audit a
                    WHERE a.migration = '20261020002910' AND a.tenant_id = m.tenant_id AND a.module_key = 'kds')
  RETURNING m.tenant_id
)
INSERT INTO public.module_backfill_audit (migration, tenant_id, module_key, reason, action)
SELECT '20261020002910', tenant_id, 'kds', 'legacy:kitchen_activity', 'enable' FROM switched
ON CONFLICT DO NOTHING;

COMMIT;
