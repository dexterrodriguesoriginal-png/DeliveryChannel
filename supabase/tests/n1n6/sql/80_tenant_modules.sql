SELECT t.is(
  (SELECT count(*) FROM public.tenant_modules WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'),
  19::bigint,
  'existing tenant A has a backfilled row for every module'
);
SELECT t.is(
  (SELECT count(*) FROM public.tenant_modules WHERE tenant_id = '10000000-0000-0000-0000-00000000000b'),
  19::bigint,
  'existing tenant B has a backfilled row for every module'
);
SELECT t.ok(
  (SELECT bool_and(enabled) FROM public.tenant_modules WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'
    AND module_key IN ('delivery', 'pickup', 'pos', 'printing')),
  'legacy modules remain enabled after backfill'
);
SELECT t.ok(
  (SELECT bool_and(NOT enabled) FROM public.tenant_modules WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'
    AND module_key NOT IN ('delivery', 'pickup', 'pos', 'printing')),
  'not-yet-enabled modules remain off for existing tenants'
);

SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible($$SELECT 1 FROM public.tenant_modules WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'$$),
  19::bigint, 'tenant A owner reads its own module rows');
SELECT t.is(t.visible($$SELECT 1 FROM public.tenant_modules WHERE tenant_id = '10000000-0000-0000-0000-00000000000b'$$),
  0::bigint, 'tenant A owner cannot read tenant B modules');
SELECT t.throws(
  $$INSERT INTO public.tenant_modules (tenant_id, module_key) VALUES ('10000000-0000-0000-0000-00000000000a', 'addons')$$,
  'permission denied',
  'direct module inserts are denied'
);
SELECT t.throws(
  $$UPDATE public.tenant_modules SET enabled = false WHERE tenant_id = '10000000-0000-0000-0000-00000000000a' AND module_key = 'delivery'$$,
  'permission denied',
  'direct module updates are denied'
);
SELECT t.throws(
  $$DELETE FROM public.tenant_modules WHERE tenant_id = '10000000-0000-0000-0000-00000000000a' AND module_key = 'delivery'$$,
  'permission denied',
  'direct module deletes are denied'
);
SELECT t.lives(
  $$SELECT public.set_tenant_module('10000000-0000-0000-0000-00000000000a', 'addons', true, '{"test_data":"retained"}')$$,
  'OWNER may change modules through the RPC'
);
SELECT t.lives(
  $$SELECT public.set_tenant_module('10000000-0000-0000-0000-00000000000a', 'addons', false, '{}')$$,
  'OWNER may disable a module through the RPC'
);
SELECT t.lives(
  $$SELECT public.set_tenant_module('10000000-0000-0000-0000-00000000000a', 'addons', true, '{}')$$,
  'OWNER may re-enable a module through the RPC'
);
RESET ROLE;
SELECT t.is(
  (SELECT config FROM public.tenant_modules WHERE tenant_id = '10000000-0000-0000-0000-00000000000a' AND module_key = 'addons'),
  '{"test_data":"retained"}'::jsonb,
  'disable and re-enable preserve module configuration'
);
SELECT t.ok(
  (SELECT enabled FROM public.tenant_modules WHERE tenant_id = '10000000-0000-0000-0000-00000000000b' AND module_key = 'addons') = false,
  'tenant A changes do not modify tenant B'
);

SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000002');
SELECT t.throws(
  $$SELECT public.set_tenant_module('10000000-0000-0000-0000-00000000000a', 'pickup', false, '{}')$$,
  'MODULE_OWNER_REQUIRED',
  'MANAGER cannot change modules through the RPC'
);
RESET ROLE;

SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.lives(
  $$SELECT public.set_tenant_module('10000000-0000-0000-0000-00000000000a', 'delivery', false, '{}')$$,
  'OWNER disables delivery before the guarded API test'
);
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT t.throws(
  $$SELECT public.process_checkout_atomic_v2('adega-a', 'Cliente Dois', '11977776666', 'Rua X, 1', NULL, 'CASH', 'DELIVERY', NULL, '[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]')$$,
  'MODULE_DISABLED',
  'server rejects checkout for a disabled fulfillment module'
);
RESET ROLE;

INSERT INTO public.tenants (id, slug, name, document, phone, email)
SELECT ('20000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       'modules-preset-' || i, 'Modules preset ' || i, '2000000000000' || lpad(i::text, 4, '0'),
       '119000000' || lpad(i::text, 2, '0'), 'modules-preset-' || i || '@test.local'
FROM generate_series(1, 12) AS i;

INSERT INTO public.tenant_users (user_id, tenant_id, role_id, status)
SELECT 'a0000000-0000-0000-0000-000000000001',
       ('20000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       'OWNER', 'ACTIVE'
FROM generate_series(1, 12) AS i;

SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
DO $presets$
DECLARE
  v_type text;
  v_id uuid;
  v_expected jsonb;
  v_actual jsonb;
  v_case record;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      ('RESTAURANTE', 1, '{"delivery":{},"pickup":{},"addons":{},"kds":{},"dine_in":{"mode":"TABLE"},"service_fee":{"percent":10},"pos":{}}'::jsonb),
      ('PIZZARIA', 2, '{"delivery":{},"pickup":{},"addons":{},"kds":{},"dine_in":{"mode":"TABLE"},"service_fee":{"percent":10},"pos":{},"loyalty":{}}'::jsonb),
      ('BAR', 3, '{"addons":{},"kds":{"mode":"BAR"},"dine_in":{"mode":"INDIVIDUAL"},"counter":{},"service_fee":{"percent":10},"pos":{}}'::jsonb),
      ('LANCHONETE_CAFE', 4, '{"delivery":{},"pickup":{},"addons":{},"kds":{},"counter":{},"pos":{},"loyalty":{}}'::jsonb),
      ('MERCADO', 5, '{"delivery":{},"pickup":{},"weight":{},"barcode":{},"substitution":{},"pos":{}}'::jsonb),
      ('ADEGA', 6, '{"delivery":{},"pickup":{},"barcode":{},"pos":{},"loyalty":{}}'::jsonb),
      ('ROUPAS', 7, '{"delivery":{},"pickup":{},"barcode":{},"variants":{},"reserve_exchange":{},"pos":{}}'::jsonb),
      ('PERFUMARIA', 8, '{"delivery":{},"pickup":{},"barcode":{},"variants":{},"reserve_exchange":{},"pos":{},"loyalty":{}}'::jsonb),
      ('SALAO_BARBEARIA', 9, '{"scheduling":{},"pos":{},"loyalty":{}}'::jsonb),
      ('CONSTRUCAO', 10, '{"delivery":{},"pickup":{},"barcode":{},"quotes":{},"pos":{}}'::jsonb),
      ('AMBULANTE', 11, '{"pickup":{},"street_vendor":{},"pos":{}}'::jsonb),
      ('OUTRO', 12, '{"delivery":{},"pickup":{}}'::jsonb)
    ) AS presets(business_type, tenant_no, modules)
  LOOP
    v_id := ('20000000-0000-0000-0000-' || lpad(v_case.tenant_no::text, 12, '0'))::uuid;
    PERFORM public.apply_business_preset(v_id, v_case.business_type);
    SELECT pg_catalog.jsonb_object_agg(tm.module_key, tm.config)
    INTO v_actual
    FROM public.tenant_modules tm
    WHERE tm.tenant_id = v_id AND tm.enabled;
    PERFORM t.is(v_actual, v_case.modules, v_case.business_type || ' creates exactly the expected preset');
    PERFORM t.is((SELECT business_type FROM public.tenants WHERE id = v_id), v_case.business_type,
      v_case.business_type || ' is saved as the tenant business type');
  END LOOP;
END
$presets$;
RESET ROLE;
