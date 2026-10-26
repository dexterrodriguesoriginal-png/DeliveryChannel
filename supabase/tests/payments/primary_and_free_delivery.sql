-- Disposable local DB only, with all migrations and n1n6 fixtures. No real charges.
\set ON_ERROR_STOP 1
BEGIN;
DO $$
DECLARE
 tenant uuid := '10000000-0000-0000-0000-00000000000a';
 owner_id uuid := 'a0000000-0000-0000-0000-000000000001';
 member uuid; v_version bigint; provider_name text; result jsonb; order_id uuid; row_order record;
BEGIN
 SELECT id INTO STRICT member FROM public.tenant_users WHERE tenant_id=tenant AND user_id=owner_id;
 -- The same completion RPC handles OAuth, InfiniteTag and manual PIX.
 FOREACH provider_name IN ARRAY ARRAY['mercadopago','pagbank','infinitepay','manual_pix'] LOOP
  UPDATE public.store_payment_accounts SET status='disconnected',is_primary=false WHERE tenant_id=tenant;
  PERFORM public.configure_store_payment(owner_id,member,provider_name,'{"status":"disconnected"}');
  SELECT connection_version INTO v_version FROM public.store_payment_accounts WHERE tenant_id=tenant AND provider=provider_name;
  PERFORM public.complete_store_payment_connection(owner_id,member,provider_name,
    CASE WHEN provider_name='manual_pix' THEN NULL ELSE 'synthetic-ciphertext' END,v_version);
  ASSERT (SELECT is_primary FROM public.store_payment_accounts WHERE tenant_id=tenant AND provider=provider_name), 'first connected account must be primary: '||provider_name;
 END LOOP;
 -- Manual PIX remains primary when a second account connects.
 PERFORM public.configure_store_payment(owner_id,member,'mercadopago','{"status":"disconnected"}');
 SELECT connection_version INTO v_version FROM public.store_payment_accounts WHERE tenant_id=tenant AND provider='mercadopago';
 PERFORM public.complete_store_payment_connection(owner_id,member,'mercadopago','synthetic-ciphertext',v_version);
 ASSERT (SELECT is_primary FROM public.store_payment_accounts WHERE tenant_id=tenant AND provider='manual_pix'), 'second connection must preserve primary';
 -- Real regression: no status in payload. INSERT checks must pass before DO UPDATE.
 PERFORM public.configure_store_payment(owner_id,member,'mercadopago','{"is_primary":true}');
 ASSERT (SELECT is_primary AND status='connected' FROM public.store_payment_accounts WHERE tenant_id=tenant AND provider='mercadopago'), 'mark already-connected account primary';
 ASSERT (SELECT count(*)=1 FROM public.store_payment_accounts WHERE tenant_id=tenant AND is_primary), 'exactly one primary';
 PERFORM public.configure_store_payment(owner_id,member,'mercadopago','{"accepts_card":false}');
 ASSERT (SELECT is_primary AND NOT accepts_card FROM public.store_payment_accounts WHERE tenant_id=tenant AND provider='mercadopago'), 'other edits preserve primary';
 BEGIN
  PERFORM public.configure_store_payment(owner_id,member,'pagbank','{"is_primary":true}');
  RAISE EXCEPTION 'disconnected account accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Conta não conectada.' THEN RAISE; END IF;
 END;
 ASSERT (SELECT is_primary FROM public.store_payment_accounts WHERE tenant_id=tenant AND provider='mercadopago'), 'invalid choice must preserve primary';
 PERFORM public.configure_store_payment(owner_id,member,'mercadopago','{"status":"disconnected"}');
 ASSERT (SELECT is_primary FROM public.store_payment_accounts WHERE tenant_id=tenant AND provider='manual_pix'), 'disconnect promotes another connected account';
 ASSERT NOT EXISTS(SELECT 1 FROM private.store_payment_credentials WHERE tenant_id=tenant AND provider='mercadopago'), 'disconnect still erases credentials';
 BEGIN
  PERFORM public.complete_store_payment_connection(owner_id,member,'mercadopago','stale',v_version);
  RAISE EXCEPTION 'stale callback accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Conexão expirada; inicie novamente.' THEN RAISE; END IF;
 END;
 PERFORM public.configure_store_payment(owner_id,member,'manual_pix','{"status":"disconnected"}');
 ASSERT NOT EXISTS(SELECT 1 FROM public.store_payment_accounts WHERE tenant_id=tenant AND is_primary), 'last disconnect leaves no primary';
 -- Save as the owner (RLS and column grants), then checkout as a customer.
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 SET LOCAL ROLE authenticated;
 UPDATE public.tenant_settings SET delivery_fee=0,free_delivery_threshold=NULL WHERE tenant_id=tenant;
 RESET ROLE;
 ASSERT (SELECT delivery_fee=0 FROM public.tenant_settings WHERE tenant_id=tenant), 'free flag must persist';
 ASSERT (public.get_public_store('adega-a')->'settings'->>'delivery_fee')::numeric=0, 'storefront shows free';
 PERFORM set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000007',true);
 SET LOCAL ROLE authenticated;
 result := public.process_checkout_atomic_v2('adega-a','Cliente Um','11988887777','Rua Teste, 10','{}','CASH','DELIVERY',NULL,
  '[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]',NULL,gen_random_uuid());
 RESET ROLE;
 order_id := coalesce(result->>'order_id',result->>'orderId',result->'order'->>'id')::uuid;
 SELECT * INTO STRICT row_order FROM public.orders WHERE id=order_id;
 ASSERT row_order.delivery_fee=0 AND row_order.store_delivery_share=7 AND row_order.driver_payout=7, 'free order: customer 0/store 7/driver 7';
 ASSERT row_order.total_amount=row_order.subtotal-row_order.discount, 'free order total has no fee';
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 SET LOCAL ROLE authenticated;
 UPDATE public.tenant_settings SET delivery_fee=7 WHERE tenant_id=tenant;
 RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000007',true);
 SET LOCAL ROLE authenticated;
 result := public.process_checkout_atomic_v2('adega-a','Cliente Um','11988887777','Rua Teste, 10','{}','CASH','DELIVERY',NULL,
  '[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]',NULL,gen_random_uuid());
 RESET ROLE;
 order_id := coalesce(result->>'order_id',result->>'orderId',result->'order'->>'id')::uuid;
 SELECT * INTO STRICT row_order FROM public.orders WHERE id=order_id;
 ASSERT row_order.delivery_fee=3.5 AND row_order.store_delivery_share=3.5 AND row_order.driver_payout=7, 'paid order: customer 3.5/store 3.5/driver 7';
 RAISE NOTICE 'PASS: primary account lifecycle, stale callback protection, free and shared-fee checkout';
END $$;
ROLLBACK;
