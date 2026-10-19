-- Per-tenant business type and module selector. Safe to apply more than once.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS business_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.tenants'::pg_catalog.regclass
      AND conname = 'tenants_business_type_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_business_type_check
      CHECK (business_type IS NULL OR business_type IN (
        'RESTAURANTE', 'BAR', 'LANCHONETE_CAFE', 'PIZZARIA', 'MERCADO', 'ADEGA',
        'ROUPAS', 'PERFUMARIA', 'SALAO_BARBEARIA', 'CONSTRUCAO', 'AMBULANTE', 'OUTRO'
      ));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.tenant_modules (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  module_key text NOT NULL CHECK (module_key IN (
    'delivery', 'pickup', 'addons', 'kds', 'dine_in', 'counter', 'service_fee',
    'printing', 'weight', 'barcode', 'substitution', 'variants', 'reserve_exchange',
    'scheduling', 'quotes', 'street_vendor', 'pos', 'loyalty', 'credit_tab'
  )),
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_modules_enabled
  ON public.tenant_modules (tenant_id, module_key) WHERE enabled;

ALTER TABLE public.tenant_modules ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_tenant_module_member(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_users tu
    WHERE tu.tenant_id = p_tenant
      AND tu.user_id = auth.uid()
      AND tu.status = 'ACTIVE'
  );
$$;

REVOKE ALL ON FUNCTION public.is_tenant_module_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_module_member(uuid) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid = 'public.tenant_modules'::pg_catalog.regclass
      AND polname = 'tenant_modules_select_members'
  ) THEN
    CREATE POLICY tenant_modules_select_members ON public.tenant_modules
      FOR SELECT TO authenticated
      USING (public.is_tenant_module_member(tenant_id));
  END IF;
END;
$$;

REVOKE ALL ON TABLE public.tenant_modules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tenant_modules TO authenticated;

-- Preserve existing behavior for migrated stores, while leaving future modules off.
INSERT INTO public.tenant_modules (tenant_id, module_key, enabled)
SELECT t.id, keys.module_key, keys.module_key IN ('delivery', 'pickup', 'pos', 'printing')
FROM public.tenants t
CROSS JOIN unnest(ARRAY[
  'delivery', 'pickup', 'addons', 'kds', 'dine_in', 'counter', 'service_fee',
  'printing', 'weight', 'barcode', 'substitution', 'variants', 'reserve_exchange',
  'scheduling', 'quotes', 'street_vendor', 'pos', 'loyalty', 'credit_tab'
]::text[]) AS keys(module_key)
ON CONFLICT (tenant_id, module_key) DO NOTHING;

-- Extension point for modules with open operational work. Mesa/Comanda has no
-- storage model yet, so it currently has no blockers; add its check here later.
CREATE OR REPLACE FUNCTION public._tenant_module_disable_blockers(p_tenant uuid, p_key text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ARRAY[]::text[];
$$;

REVOKE ALL ON FUNCTION public._tenant_module_disable_blockers(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assert_tenant_module_enabled(p_tenant uuid, p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_modules tm
    WHERE tm.tenant_id = p_tenant AND tm.module_key = p_key AND tm.enabled
  ) THEN
    RAISE EXCEPTION 'MODULE_DISABLED: Este recurso está desativado para este estabelecimento.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_tenant_module_enabled(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_order_module_enabled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.fulfillment_type IS NOT DISTINCT FROM OLD.fulfillment_type
     AND NEW.origin IS NOT DISTINCT FROM OLD.origin THEN
    RETURN NEW;
  END IF;

  IF NEW.origin = 'pos' THEN
    PERFORM public.assert_tenant_module_enabled(NEW.tenant_id, 'pos');
  ELSE
    IF NEW.fulfillment_type = 'DELIVERY' THEN
      PERFORM public.assert_tenant_module_enabled(NEW.tenant_id, 'delivery');
    ELSIF NEW.fulfillment_type = 'PICKUP' THEN
      PERFORM public.assert_tenant_module_enabled(NEW.tenant_id, 'pickup');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_order_module_enabled() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.orders'::pg_catalog.regclass
      AND tgname = 'orders_module_enabled_guard'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER orders_module_enabled_guard
      BEFORE INSERT OR UPDATE ON public.orders
      FOR EACH ROW EXECUTE FUNCTION public.guard_order_module_enabled();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_tenant_module(
  p_tenant uuid,
  p_key text,
  p_enabled boolean,
  p_config jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_previous_enabled boolean;
  v_previous_config jsonb;
  v_blockers text[];
  v_config jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Faça login para alterar os módulos.';
  END IF;

  SELECT tu.role_id INTO v_role
  FROM public.tenant_users tu
  WHERE tu.tenant_id = p_tenant
    AND tu.user_id = auth.uid()
    AND tu.status = 'ACTIVE';

  IF v_role IS DISTINCT FROM 'OWNER' THEN
    RAISE EXCEPTION 'MODULE_OWNER_REQUIRED: Apenas o proprietário pode alterar os módulos.';
  END IF;

  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'MODULE_INVALID: Informe se o módulo deve ficar ativado ou desativado.';
  END IF;

  IF p_key IS NULL OR p_key NOT IN (
    'delivery', 'pickup', 'addons', 'kds', 'dine_in', 'counter', 'service_fee',
    'printing', 'weight', 'barcode', 'substitution', 'variants', 'reserve_exchange',
    'scheduling', 'quotes', 'street_vendor', 'pos', 'loyalty', 'credit_tab'
  ) THEN
    RAISE EXCEPTION 'MODULE_INVALID: Módulo inválido.';
  END IF;

  IF p_enabled AND p_key = 'service_fee' AND NOT EXISTS (
    SELECT 1 FROM public.tenant_modules tm
    WHERE tm.tenant_id = p_tenant AND tm.module_key IN ('dine_in', 'counter') AND tm.enabled
  ) THEN
    RAISE EXCEPTION 'MODULE_DEPENDENCY: Taxa de serviço precisa de Mesa ou Balcão.';
  END IF;

  IF p_enabled AND p_key = 'kds' AND NOT EXISTS (
    SELECT 1 FROM public.tenant_modules tm
    WHERE tm.tenant_id = p_tenant AND tm.module_key IN ('pickup', 'counter') AND tm.enabled
  ) THEN
    RAISE EXCEPTION 'MODULE_DEPENDENCY: Chamar no TV precisa de Retirada ou Balcão.';
  END IF;

  IF NOT p_enabled THEN
    v_blockers := public._tenant_module_disable_blockers(p_tenant, p_key);
    IF COALESCE(pg_catalog.cardinality(v_blockers), 0) > 0 THEN
      RAISE EXCEPTION 'MODULE_HAS_OPEN_ITEMS: Feche primeiro: %', pg_catalog.array_to_string(v_blockers, ', ');
    END IF;
  END IF;

  SELECT tm.enabled, tm.config
  INTO v_previous_enabled, v_previous_config
  FROM public.tenant_modules tm
  WHERE tm.tenant_id = p_tenant AND tm.module_key = p_key;

  v_config := CASE
    WHEN p_config IS NULL OR (p_config = '{}'::jsonb AND COALESCE(v_previous_config, '{}'::jsonb) <> '{}'::jsonb)
      THEN COALESCE(v_previous_config, '{}'::jsonb)
    ELSE p_config
  END;

  INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, config, updated_by, updated_at)
  VALUES (p_tenant, p_key, p_enabled, v_config, auth.uid(), pg_catalog.now())
  ON CONFLICT (tenant_id, module_key) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        config = EXCLUDED.config,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at
    WHERE public.tenant_modules.enabled IS DISTINCT FROM EXCLUDED.enabled
       OR public.tenant_modules.config IS DISTINCT FROM EXCLUDED.config;

  IF v_previous_enabled IS DISTINCT FROM p_enabled OR v_previous_config IS DISTINCT FROM v_config THEN
    PERFORM public.log_audit_event(
      'TENANT_MODULE_UPDATED',
      'tenant_modules',
      pg_catalog.format('Módulo %s %s.', p_key, CASE WHEN p_enabled THEN 'ativado' ELSE 'desativado' END),
      p_key,
      pg_catalog.jsonb_build_object('enabled', COALESCE(v_previous_enabled, false), 'config', COALESCE(v_previous_config, '{}'::jsonb))::text,
      pg_catalog.jsonb_build_object('enabled', p_enabled, 'config', v_config)::text,
      p_tenant
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_tenant_module(uuid, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_module(uuid, text, boolean, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_business_preset(p_tenant uuid, p_type text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_preset jsonb;
  v_item record;
  v_previous_type text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Faça login para aplicar a predefinição.';
  END IF;

  SELECT tu.role_id INTO v_role
  FROM public.tenant_users tu
  WHERE tu.tenant_id = p_tenant
    AND tu.user_id = auth.uid()
    AND tu.status = 'ACTIVE';
  IF v_role IS DISTINCT FROM 'OWNER' THEN
    RAISE EXCEPTION 'MODULE_OWNER_REQUIRED: Apenas o proprietário pode aplicar a predefinição.';
  END IF;

  IF p_type IS NULL OR p_type NOT IN (
    'RESTAURANTE', 'BAR', 'LANCHONETE_CAFE', 'PIZZARIA', 'MERCADO', 'ADEGA',
    'ROUPAS', 'PERFUMARIA', 'SALAO_BARBEARIA', 'CONSTRUCAO', 'AMBULANTE', 'OUTRO'
  ) THEN
    RAISE EXCEPTION 'BUSINESS_TYPE_INVALID: Tipo de negócio inválido.';
  END IF;

  v_preset := CASE p_type
    WHEN 'RESTAURANTE' THEN '{"delivery":{},"pickup":{},"addons":{},"kds":{},"dine_in":{"mode":"TABLE"},"service_fee":{"percent":10},"pos":{}}'::jsonb
    WHEN 'PIZZARIA' THEN '{"delivery":{},"pickup":{},"addons":{},"kds":{},"dine_in":{"mode":"TABLE"},"service_fee":{"percent":10},"pos":{},"loyalty":{}}'::jsonb
    WHEN 'BAR' THEN '{"addons":{},"kds":{"mode":"BAR"},"dine_in":{"mode":"INDIVIDUAL"},"counter":{},"service_fee":{"percent":10},"pos":{}}'::jsonb
    WHEN 'LANCHONETE_CAFE' THEN '{"delivery":{},"pickup":{},"addons":{},"kds":{},"counter":{},"pos":{},"loyalty":{}}'::jsonb
    WHEN 'MERCADO' THEN '{"delivery":{},"pickup":{},"weight":{},"barcode":{},"substitution":{},"pos":{}}'::jsonb
    WHEN 'ADEGA' THEN '{"delivery":{},"pickup":{},"barcode":{},"pos":{},"loyalty":{}}'::jsonb
    WHEN 'ROUPAS' THEN '{"delivery":{},"pickup":{},"barcode":{},"variants":{},"reserve_exchange":{},"pos":{}}'::jsonb
    WHEN 'PERFUMARIA' THEN '{"delivery":{},"pickup":{},"barcode":{},"variants":{},"reserve_exchange":{},"pos":{},"loyalty":{}}'::jsonb
    WHEN 'SALAO_BARBEARIA' THEN '{"scheduling":{},"pos":{},"loyalty":{}}'::jsonb
    WHEN 'CONSTRUCAO' THEN '{"delivery":{},"pickup":{},"barcode":{},"quotes":{},"pos":{}}'::jsonb
    WHEN 'AMBULANTE' THEN '{"pickup":{},"street_vendor":{},"pos":{}}'::jsonb
    ELSE '{"delivery":{},"pickup":{}}'::jsonb
  END;

  SELECT t.business_type INTO v_previous_type
  FROM public.tenants t WHERE t.id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TENANT_NOT_FOUND: Estabelecimento não encontrado.'; END IF;

  UPDATE public.tenants SET business_type = p_type, updated_at = pg_catalog.now()
  WHERE id = p_tenant AND business_type IS DISTINCT FROM p_type;

  IF v_previous_type IS DISTINCT FROM p_type THEN
    PERFORM public.log_audit_event(
      'TENANT_BUSINESS_TYPE_UPDATED',
      'tenants',
      'Tipo de negócio atualizado.',
      p_tenant::text,
      pg_catalog.jsonb_build_object('business_type', v_previous_type)::text,
      pg_catalog.jsonb_build_object('business_type', p_type)::text,
      p_tenant
    );
  END IF;

  FOR v_item IN
    SELECT entry.key, entry.value
    FROM pg_catalog.jsonb_each(v_preset) AS entry
    ORDER BY CASE entry.key
      WHEN 'pickup' THEN 1
      WHEN 'counter' THEN 2
      WHEN 'dine_in' THEN 3
      ELSE 10
    END
  LOOP
    PERFORM public.set_tenant_module(p_tenant, v_item.key, true, v_item.value);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_business_preset(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_business_preset(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_modules(p_tenant_id uuid)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT tm.module_key
  FROM public.tenant_modules tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.tenant_id = p_tenant_id
    AND tm.enabled
    AND t.status = 'ACTIVE'
  ORDER BY tm.module_key;
$$;

REVOKE ALL ON FUNCTION public.get_public_modules(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_modules(uuid) TO anon, authenticated;
