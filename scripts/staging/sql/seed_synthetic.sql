-- Seed SINTÉTICO para STAGING (nenhum dado real; nada de produção).
-- Pré-requisito: usuários de teste criados em Authentication → Users (ver docs/staging/RUNBOOK_STAGING.md §5)
-- com os e-mails abaixo. Idempotente (ON CONFLICT DO NOTHING). Aborta se N1–N6 não estiverem aplicadas
-- ou se algum e-mail de teste não existir. Não apaga nem atualiza nada.
DO $seed$
DECLARE
  v_missing text;
  ta CONSTANT uuid := '5a000000-0000-4000-8000-00000000000a';
  tb CONSTANT uuid := '5a000000-0000-4000-8000-00000000000b';
  emails text[] := ARRAY['stg.owner.a@example.com','stg.manager.a@example.com','stg.cashier.a@example.com',
                         'stg.driver.a@example.com','stg.operator.a@example.com','stg.owner.b@example.com',
                         'stg.cliente1@example.com','stg.cliente2@example.com'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006000600') THEN
    RAISE EXCEPTION 'SEED: N6 não aplicada; rode apply_staging.sh all antes.'; END IF;
  SELECT string_agg(e, ', ') INTO v_missing FROM unnest(emails) e
   WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE lower(u.email) = e);
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'SEED: usuários de teste ausentes em public.users: %', v_missing; END IF;

  INSERT INTO public.tenants (id, slug, name, document, phone, email, status) VALUES
   (ta, 'stg-adega-a', 'STG Adega A', '00000000000191', '11900000001', 'loja-a@example.com', 'ACTIVE'),
   (tb, 'stg-adega-b', 'STG Adega B', '00000000000272', '11900000002', 'loja-b@example.com', 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.tenant_settings (tenant_id, is_open, min_order_value, delivery_fee, free_delivery_threshold, address, city, phone_whatsapp)
  VALUES (ta, true, 0, 5.00, 200.00, 'Rua Sintética A, 1', 'Carapicuíba', '11900000001'),
         (tb, true, 0, 7.00, NULL, 'Rua Sintética B, 2', 'Osasco', '11900000002')
  ON CONFLICT (tenant_id) DO NOTHING;
  INSERT INTO public.tenant_themes (tenant_id, store_name) VALUES (ta, 'STG Adega A'), (tb, 'STG Adega B')
  ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO public.tenant_users (user_id, tenant_id, role_id, status)
  SELECT u.id, x.t, x.r, 'ACTIVE' FROM (VALUES
     ('stg.owner.a@example.com', ta, 'OWNER'), ('stg.manager.a@example.com', ta, 'MANAGER'),
     ('stg.cashier.a@example.com', ta, 'CASHIER'), ('stg.driver.a@example.com', ta, 'DRIVER'),
     ('stg.operator.a@example.com', ta, 'OPERATOR'), ('stg.owner.b@example.com', tb, 'OWNER')) x(e, t, r)
  JOIN public.users u ON lower(u.email) = x.e
  WHERE NOT EXISTS (SELECT 1 FROM public.tenant_users tu WHERE tu.user_id = u.id AND tu.tenant_id = x.t);

  INSERT INTO public.products (id, tenant_id, name, image_url, price, promotional_price, stock_quantity, is_active) VALUES
   ('5b000000-0000-4000-8000-0000000000a1', ta, 'STG Cerveja 350ml', '/demo/padaria-do-joao-logo.svg', 10.00, NULL, 100, true),
   ('5b000000-0000-4000-8000-0000000000a2', ta, 'STG Vinho Tinto',   '/demo/padaria-do-joao-logo.svg', 50.00, 45.00, 20, true),
   ('5b000000-0000-4000-8000-0000000000a3', ta, 'STG Estoque 1',     '/demo/padaria-do-joao-logo.svg', 30.00, NULL, 1, true),
   ('5b000000-0000-4000-8000-0000000000b1', tb, 'STG Produto B',     '/demo/padaria-do-joao-logo.svg', 12.00, NULL, 100, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.coupons (id, tenant_id, code, discount_type, discount_value, usage_limit, status) VALUES
   ('5c000000-0000-4000-8000-000000000001', ta, 'STGDEZ', 'PERCENTAGE', 10, NULL, 'ACTIVE'),
   ('5c000000-0000-4000-8000-000000000002', ta, 'STGUM',  'FIXED_AMOUNT', 5, 1, 'ACTIVE'),
   ('5c000000-0000-4000-8000-000000000003', tb, 'STGB',   'PERCENTAGE', 10, NULL, 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;

  -- PIX sintético: chave aleatória (EVP) que não pertence a ninguém
  INSERT INTO public.tenant_payment_settings (tenant_id, pix_enabled, pix_key_type, pix_key, pix_merchant_name, pix_merchant_city)
  VALUES (ta, true, 'EVP', '123e4567-e89b-42d3-a456-426614174000', 'STG ADEGA A', 'CARAPICUIBA')
  ON CONFLICT (tenant_id) DO NOTHING;
  RAISE NOTICE 'SEED OK: lojas stg-adega-a / stg-adega-b, 6 vínculos de papel, 4 produtos, 3 cupons, PIX sintético.';
END $seed$;
