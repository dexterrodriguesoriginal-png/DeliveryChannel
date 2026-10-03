-- Depois de aplicar a 027 por cima de 001..026: dados legados preservados e visíveis.
DO $$
DECLARE v JSONB;
BEGIN
  SET LOCAL ROLE anon;
  v := public.get_public_store('adega-legado');
  IF NOT (v->'offers' @> '[{"id":"11111111-1111-4111-8111-111111111111","displayMode":"FULL_MEDIA","autoOverlay":false}]'::jsonb) THEN
    RAISE EXCEPTION 'card legado não apareceu após 027: %', v->'offers';
  END IF;
  IF NOT (v->'campaigns' @> '[{"id":"22222222-2222-4222-8222-222222222222","cards":[{"id":"33333333-3333-4333-8333-333333333333"}]}]'::jsonb) THEN
    RAISE EXCEPTION 'campanha legada não apareceu após 027: %', v->'campaigns';
  END IF;
  RAISE NOTICE 'OK (depois da 027): dados legados preservados; card e campanha legados aparecem na vitrine';
END $$;

DO $$
DECLARE r JSONB;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
  r := public.process_promotional_checkout_atomic('adega-legado', '44444444-4444-4444-8444-444444444444', 1, 'Cli', '11988887777', NULL, NULL, '{}'::jsonb, 'PIX', 'PICKUP');
  IF NOT (r->>'success')::boolean THEN RAISE EXCEPTION 'checkout legado não funcionou após 027: %', r; END IF;
  RAISE NOTICE 'OK (depois da 027): o mesmo checkout promocional agora cria o pedido %', r->>'order_id';
END $$;
