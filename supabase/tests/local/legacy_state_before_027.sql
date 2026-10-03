-- Estado legado: banco com 001..026 aplicadas e dados criados ANTES da correção.
-- Demonstra a falha real (get_public_store quebrada por offers.display_mode).
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('00000000-0000-0000-0000-0000000000e1', 'legacy@test.local', '{"name":"Owner Legacy"}');

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","email":"legacy@test.local","role":"authenticated"}', true);
SELECT public.create_tenant_for_current_user('Adega Legado','adega-legado','999','11999990009','l@l.com','ADEGA','Rua L, 9','Carapicuiba','11999990009') IS NOT NULL AS tenant_legado_criado;
COMMIT;
UPDATE public.tenants SET status = 'ACTIVE' WHERE slug = 'adega-legado';

-- Card legado e campanha legada inseridos diretamente (como teriam ficado no banco)
INSERT INTO public.offers (id, tenant_id, title, image_url, media_url, media_type, auto_overlay, is_active, display_order, start_at)
SELECT '11111111-1111-4111-8111-111111111111', id, 'Card legado', 'https://cdn.test/legacy.jpg', 'https://cdn.test/legacy.jpg', 'IMAGE', false, true, 0, NOW() - interval '1 day'
FROM public.tenants WHERE slug = 'adega-legado';
INSERT INTO public.campaigns (id, tenant_id, name, status, start_at, no_end_date)
SELECT '22222222-2222-4222-8222-222222222222', id, 'Campanha legada', 'ACTIVE', NOW() - interval '1 day', true
FROM public.tenants WHERE slug = 'adega-legado';
INSERT INTO public.campaign_cards (id, campaign_id, tenant_id, display_order, media_url)
SELECT '33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', id, 0, 'https://cdn.test/legacy-card.jpg'
FROM public.tenants WHERE slug = 'adega-legado';

DO $$
BEGIN
  PERFORM public.get_public_store('adega-legado');
  RAISE EXCEPTION 'ESPERADO falhar antes da 027, mas get_public_store funcionou';
EXCEPTION WHEN undefined_column THEN
  RAISE NOTICE 'OK (antes da 027): get_public_store falha com undefined_column: %', SQLERRM;
END $$;

DO $$
BEGIN
  INSERT INTO public.offers (tenant_id, title, image_url, display_mode)
  SELECT id, 'insert como o offerRepository antigo', 'https://cdn.test/x.jpg', 'FULL_MEDIA' FROM public.tenants WHERE slug = 'adega-legado';
  RAISE EXCEPTION 'ESPERADO falhar: display_mode não existe';
EXCEPTION WHEN undefined_column THEN
  RAISE NOTICE 'OK (antes da 027): INSERT com display_mode (payload antigo do offerRepository) falha: %', SQLERRM;
END $$;

-- Checkout promocional da 026: duas falhas reais encadeadas
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000e2', 'cliente-legado@test.local');
INSERT INTO public.offers (id, tenant_id, title, image_url, is_active, destination_type, has_promo_checkout, promo_title, promo_price)
SELECT '44444444-4444-4444-8444-444444444444', id, 'Checkout legado', 'https://cdn.test/chk.jpg', true, 'CUSTOM_OFFER', true, 'Combo', 10.00
FROM public.tenants WHERE slug = 'adega-legado';

DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
  PERFORM public.process_promotional_checkout_atomic('adega-legado', '44444444-4444-4444-8444-444444444444', 1, 'Cli', '11988887777', NULL, NULL, '{}'::jsonb, 'PIX', 'PICKUP');
  RAISE EXCEPTION 'ESPERADO falhar (customers.notes)';
EXCEPTION WHEN undefined_column THEN
  RAISE NOTICE 'OK (antes da 027): checkout promocional de cliente novo falha: %', SQLERRM;
END $$;

-- Cliente já existente => o UPDATE em customers da 026 é bloqueado pelo trigger
-- check_customer_self_update (a 026 não liga app.internal_customer_update)
INSERT INTO public.customers (tenant_id, user_id, name, phone)
SELECT id, '00000000-0000-0000-0000-0000000000e2', 'Cli', '11988887777' FROM public.tenants WHERE slug = 'adega-legado';
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
  PERFORM public.process_promotional_checkout_atomic('adega-legado', '44444444-4444-4444-8444-444444444444', 1, 'Cli', '11988887777', NULL, NULL, '{}'::jsonb, 'PIX', 'PICKUP');
  RAISE EXCEPTION 'ESPERADO falhar (trigger de customers)';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'Apenas informações pessoais%' THEN RAISE; END IF;
  RAISE NOTICE 'OK (antes da 027): checkout promocional de cliente existente falha no trigger de customers: %', SQLERRM;
END $$;

-- Mesmo contornando o trigger (flag ligada manualmente só neste teste), a 026 ainda viola a FK
-- campaign_analytics_events.card_id -> campaign_cards(id) ao gravar o id do card (offers.id)
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
  PERFORM set_config('app.internal_customer_update', 'true', true);
  PERFORM public.process_promotional_checkout_atomic('adega-legado', '44444444-4444-4444-8444-444444444444', 1, 'Cli', '11988887777', NULL, NULL, '{}'::jsonb, 'PIX', 'PICKUP');
  RAISE EXCEPTION 'ESPERADO falhar (FK card_id)';
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'OK (antes da 027): checkout promocional viola FK: %', SQLERRM;
END $$;
