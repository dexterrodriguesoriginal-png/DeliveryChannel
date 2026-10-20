-- 2900: turn on the kitchen module (kds) for existing stores so they keep Tela da Cozinha.
-- Additive only: inserts kds rows that do not exist yet; never updates or deletes.
-- A store that already has a kds row (even disabled by the owner) is left alone.
-- Every inserted row is recorded in public.module_backfill_audit so the rollback removes only those rows.
BEGIN;

CREATE TABLE IF NOT EXISTS public.module_backfill_audit (
  migration text NOT NULL,
  tenant_id uuid NOT NULL,
  module_key text NOT NULL,
  reason text NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (migration, tenant_id, module_key)
);
ALTER TABLE public.module_backfill_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.module_backfill_audit FROM PUBLIC, anon, authenticated;

WITH candidates AS (
  SELECT t.id AS tenant_id,
         CASE WHEN t.business_type IN ('RESTAURANTE', 'PIZZARIA', 'BAR', 'LANCHONETE_CAFE')
              THEN 'food_preset:' || t.business_type
              WHEN EXISTS (SELECT 1 FROM public.kitchen_devices d WHERE d.tenant_id = t.id)
                OR EXISTS (SELECT 1 FROM public.kitchen_order_signals s WHERE s.tenant_id = t.id)
              THEN 'legacy:kitchen_activity'
              ELSE 'legacy:delivery_or_pickup_on'
         END AS reason
  FROM public.tenants t
  WHERE t.slug <> 'rafa-cortes'
    AND (
      t.business_type IN ('RESTAURANTE', 'PIZZARIA', 'BAR', 'LANCHONETE_CAFE')
      OR (t.business_type IS NULL AND (
            EXISTS (SELECT 1 FROM public.kitchen_devices d WHERE d.tenant_id = t.id)
         OR EXISTS (SELECT 1 FROM public.kitchen_order_signals s WHERE s.tenant_id = t.id)
         OR EXISTS (SELECT 1 FROM public.tenant_modules m WHERE m.tenant_id = t.id
                    AND m.module_key IN ('delivery', 'pickup') AND m.enabled)))
    )
    AND NOT EXISTS (SELECT 1 FROM public.tenant_modules m WHERE m.tenant_id = t.id AND m.module_key = 'kds')
), inserted AS (
  INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, config)
  SELECT tenant_id, 'kds', true, '{}'::jsonb FROM candidates
  ON CONFLICT (tenant_id, module_key) DO NOTHING
  RETURNING tenant_id
)
INSERT INTO public.module_backfill_audit (migration, tenant_id, module_key, reason)
SELECT '20261020002900', c.tenant_id, 'kds', c.reason
FROM inserted i JOIN candidates c USING (tenant_id)
ON CONFLICT DO NOTHING;

COMMIT;
