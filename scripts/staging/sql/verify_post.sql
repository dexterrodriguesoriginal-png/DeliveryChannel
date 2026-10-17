-- Verificação pós-aplicação (001–020 + N1–N6 + 0700–1700). Somente leitura. Aborta em qualquer falha.
DO $$
DECLARE n int; r record; expected text[] := ARRAY[
 '20260922000001','20260922000002','20260923000003','20260923000004','20260923000005','20260923000006',
 '20260924000007','20260924000008','20260925000009','20260926000010','20260926000011','20260926000012',
 '20260927000013','20260928000014','20260928000015','20260928000016','20260928000017','20260928000018',
 '20260928000019','20260929000020','20261006000100','20261006000200','20261006000300','20261006000400',
 '20261006000500','20261006000600','20261006000700','20261014000800','20261014000900','20261014001000',
 '20261014001100','20261015001200','20261015001300','20261017001400',
 '20261017001500','20261017001600','20261017001700'];
 got text[];
BEGIN
  SELECT array_agg(version ORDER BY version) INTO got FROM supabase_migrations.schema_migrations;
  IF got IS DISTINCT FROM expected THEN RAISE EXCEPTION 'POST: versões registradas diferentes do esperado: %', got; END IF;
  -- RLS habilitado em todas as tabelas do public
  SELECT count(*) INTO n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF n > 0 THEN RAISE EXCEPTION 'POST: % tabela(s) do public sem RLS.', n; END IF;
  -- SECURITY DEFINER sempre com search_path fixo
  SELECT count(*) INTO n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) x WHERE x LIKE 'search_path=%');
  IF n > 0 THEN RAISE EXCEPTION 'POST: % função(ões) SECURITY DEFINER sem search_path.', n; END IF;
  -- RPCs exigidas pelo frontend n1n6
  FOR r IN SELECT unnest(ARRAY['update_order_status','update_order_payment_status','process_pos_sale_atomic',
      'process_checkout_atomic_v2','process_promotional_checkout_atomic','get_order_pix_payload','validate_coupon',
      'validate_coupon_pos','upsert_tenant_payment_settings','register_marketing_asset','confirm_marketing_upload',
      'get_campaign_metrics','track_campaign_event','get_public_store','get_promo_offer_performance',
      'get_customer_order_by_id','driver_accept_order','list_available_driver_orders','get_order_pickup_code',
      'reset_order_pickup_code','confirm_order_pickup','get_my_order_delivery_code','confirm_order_delivery']) AS f LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = r.f) THEN
      RAISE EXCEPTION 'POST: RPC % ausente.', r.f; END IF;
  END LOOP;
  -- Buckets N3
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'marketing' AND NOT public) THEN RAISE EXCEPTION 'POST: bucket marketing (privado) ausente ou público.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'marketing-public') THEN RAISE EXCEPTION 'POST: bucket marketing-public ausente.'; END IF;
  -- anon sem SELECT direto nas tabelas sensíveis novas
  FOR r IN SELECT unnest(ARRAY['tenant_payment_settings','coupons','coupon_redemptions','order_handoff_codes']) AS t LOOP
    IF to_regclass('public.' || r.t) IS NOT NULL AND has_table_privilege('anon', 'public.' || r.t, 'SELECT') THEN
      RAISE EXCEPTION 'POST: anon tem SELECT em public.%.', r.t; END IF;
  END LOOP;
  -- 1600: códigos só por RPC (authenticated sem SELECT direto)
  IF has_table_privilege('authenticated', 'public.order_handoff_codes', 'SELECT') THEN
    RAISE EXCEPTION 'POST: authenticated tem SELECT em public.order_handoff_codes.'; END IF;
  RAISE NOTICE 'POST OK: 37 versões, RLS em todas as tabelas, SECURITY DEFINER com search_path, RPCs e buckets presentes.';
END $$;
