-- N5/N6: desempenho dos cards promocionais (aba Marketing → Desempenho & Vendas).
-- Atribuição gravada só pelo servidor, cadeia no tenant, dedup, cancelamento/estorno com reversão
-- do contador, isolamento multi-tenant e acesso só OWNER/MANAGER (F2).
RESET ROLE;
INSERT INTO public.offers (id, tenant_id, product_id, title, image_url, original_price, promotional_price, is_active, display_order,
                           has_promo_checkout, promo_price, promo_fulfillment) VALUES
 ('e0000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000a2','Perf A5','https://img.test/a5.jpg',20.00,NULL,true,5,true,12,'BOTH'),
 ('e0000000-0000-0000-0000-0000000000f2','10000000-0000-0000-0000-00000000000b','d0000000-0000-0000-0000-0000000000b1','Perf B5','https://img.test/b5.jpg',50.00,NULL,true,5,true,30,'BOTH');

SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000007');
SELECT set_config('t.x1', public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000f1',2,'Cliente Um','11988887777','',NULL,'CASH','PICKUP',NULL) ->> 'order_id', false);
SELECT set_config('t.x3', public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000f1',1,'Cliente Um','11988887777','',NULL,'CASH','PICKUP',NULL) ->> 'order_id', false);
SELECT set_config('t.xn', public.process_checkout_atomic_v2('adega-a','Cliente Um','11988887777','',NULL,'CASH','PICKUP',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a2","quantity":3}]') ->> 'order_id', false);
SELECT set_config('t.xb', public.process_promotional_checkout_atomic('adega-b',NULL,NULL,'e0000000-0000-0000-0000-0000000000f2',1,'Cliente Um','11988887777','',NULL,'CASH','PICKUP',NULL) ->> 'order_id', false);
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000f2',1,'Cliente Um','11988887777','',NULL,'CASH','PICKUP',NULL)$$, 'PROMO_UNAVAILABLE', 'perf: card/oferta de outra loja rejeitado no checkout');
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT set_config('t.x2', public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000f1',1,'Cliente Dois','11977776666','',NULL,'CASH','PICKUP',NULL) ->> 'order_id', false);
RESET ROLE;

SELECT t.is(t.sq($$SELECT offer_id::text || '|' || attribution_source || '|' || origin FROM public.orders WHERE id = '$$ || current_setting('t.x1') || $$'$$),
            'e0000000-0000-0000-0000-0000000000f1|OFFER|storefront_promo', 'perf: origem gravada pelo servidor (offer_id + attribution_source)');
SELECT t.is(t.sq($$SELECT count(*) FROM public.orders WHERE id = '$$ || current_setting('t.xn') || $$' AND offer_id IS NULL AND card_id IS NULL$$), '1', 'perf: venda comum do mesmo produto não é atribuída ao card');
SELECT t.is(t.sq($$SELECT promo_times_used FROM public.offers WHERE id = 'e0000000-0000-0000-0000-0000000000f1'$$), '4', 'perf: contador consumido (2+1+1)');
SELECT t.throws(format($$UPDATE public.orders SET offer_id = 'e0000000-0000-0000-0000-0000000000a1' WHERE id = %L$$, current_setting('t.x1')), 'ORDER_FIELD_IMMUTABLE', 'perf: origem imutável mesmo para o dono do banco');
SELECT t.throws(format($$UPDATE public.orders SET offer_id = 'e0000000-0000-0000-0000-0000000000f2' WHERE id = %L$$, current_setting('t.x1')), 'ORDER_FIELD_IMMUTABLE|orders_offer_fk', 'perf: não aceita oferta de outra loja');

SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.throws(format($$UPDATE public.orders SET offer_id = NULL WHERE id = %L$$, current_setting('t.x1')), 'permission denied', 'perf: staff não altera atribuição por UPDATE direto');
SELECT t.lives(format($$SELECT public.update_order_status(%L, 'CANCELLED', 'desistência')$$, current_setting('t.x2')), 'perf: OWNER cancela pedido promocional');
SELECT t.lives(format($$SELECT public.update_order_payment_status(%L,'PAID')$$, current_setting('t.x3')), 'perf: OWNER marca PAID');
SELECT t.lives(format($$SELECT public.update_order_payment_status(%L,'REFUNDED','devolvido')$$, current_setting('t.x3')), 'perf: OWNER registra estorno');
RESET ROLE;
SELECT t.is(t.sq($$SELECT promo_times_used FROM public.offers WHERE id = 'e0000000-0000-0000-0000-0000000000f1'$$), '2', 'perf: cancelamento e estorno revertem o contador (4 → 2)');
SELECT t.is(t.sq($$SELECT count(*) FROM public.orders WHERE offer_id = 'e0000000-0000-0000-0000-0000000000f1'$$), '3', 'perf: histórico preservado (pedidos invalidados continuam atribuídos)');

-- Métricas como OWNER A
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT set_config('t.perf', public.get_promo_offer_performance('10000000-0000-0000-0000-00000000000a', now() - interval '1 day', now() + interval '1 day')::text, false);
SELECT set_config('t.row', COALESCE((SELECT r::text FROM jsonb_array_elements(current_setting('t.perf')::jsonb -> 'rows') r WHERE r ->> 'offer_id' = 'e0000000-0000-0000-0000-0000000000f1'), '{}'), false);
SELECT t.is(current_setting('t.row')::jsonb ->> 'valid_orders', '1', 'perf: 1 pedido válido (cancelado e estornado fora)');
SELECT t.is(current_setting('t.row')::jsonb ->> 'invalidated_orders', '2', 'perf: 2 invalidados contados à parte');
SELECT t.is((current_setting('t.row')::jsonb ->> 'revenue')::numeric, 24.00, 'perf: faturamento = total - frete dos válidos (12 x 2)');
SELECT t.is(current_setting('t.row')::jsonb ->> 'redeemed_units', '2', 'perf: resgates = unidades OFFER de pedidos válidos');
SELECT t.is((current_setting('t.row')::jsonb ->> 'discount')::numeric, 16.00, 'perf: desconto concedido (20 - 12) x 2');
SELECT t.ok(current_setting('t.row')::jsonb ->> 'last_valid_order_at' IS NOT NULL, 'perf: data da última venda válida');
SELECT t.ok(current_setting('t.perf') !~ 'e0000000-0000-0000-0000-0000000000f2', 'perf: OWNER A não vê oferta/pedidos da loja B');
SELECT t.is((SELECT count(*) FROM jsonb_array_elements(current_setting('t.perf')::jsonb -> 'rows') r WHERE r ->> 'offer_id' = 'e0000000-0000-0000-0000-0000000000f1')::int, 1, 'perf: cada oferta aparece uma vez (sem duplicação)');
SELECT t.is((SELECT sum((r ->> 'valid_orders')::int + (r ->> 'invalidated_orders')::int) FROM jsonb_array_elements(current_setting('t.perf')::jsonb -> 'rows') r)::text,
            t.sq($$SELECT count(*) FROM public.orders WHERE tenant_id = '10000000-0000-0000-0000-00000000000a' AND offer_id IS NOT NULL AND created_at >= now() - interval '1 day'$$),
            'perf: soma por oferta = pedidos atribuídos distintos (cada pedido conta uma vez)');
SELECT t.throws($$SELECT public.get_promo_offer_performance('10000000-0000-0000-0000-00000000000b', now() - interval '1 day', now())$$, 'FORBIDDEN', 'perf: OWNER A não consulta loja B');
SELECT t.throws($$SELECT public.get_promo_offer_performance('10000000-0000-0000-0000-00000000000a', now(), now() - interval '1 day')$$, 'INVALID_PERIOD', 'perf: período invertido rejeitado');
SELECT t.throws($$SELECT public.get_promo_offer_performance('10000000-0000-0000-0000-00000000000a', now() - interval '500 days', now())$$, 'INVALID_PERIOD', 'perf: período > 400 dias rejeitado');
SELECT t.login('a0000000-0000-0000-0000-000000000002');
SELECT t.lives($$SELECT public.get_promo_offer_performance('10000000-0000-0000-0000-00000000000a', now() - interval '1 day', now() + interval '1 day')$$, 'perf: MANAGER consulta');
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.throws($$SELECT public.get_promo_offer_performance('10000000-0000-0000-0000-00000000000a', now() - interval '1 day', now())$$, 'FORBIDDEN', 'perf: CASHIER não consulta');
SELECT t.login('a0000000-0000-0000-0000-000000000003');
SELECT t.throws($$SELECT public.get_promo_offer_performance('10000000-0000-0000-0000-00000000000a', now() - interval '1 day', now())$$, 'FORBIDDEN', 'perf: OPERATOR não consulta');
SELECT t.login('c0000000-0000-0000-0000-000000000001');
SELECT t.throws($$SELECT public.get_promo_offer_performance('10000000-0000-0000-0000-00000000000a', now() - interval '1 day', now())$$, 'FORBIDDEN', 'perf: CEO/SUPER_ADMIN sem acesso (F2)');
SELECT t.login('a0000000-0000-0000-0000-000000000007');
SELECT t.throws($$SELECT public.get_promo_offer_performance('10000000-0000-0000-0000-00000000000a', now() - interval '1 day', now())$$, 'FORBIDDEN', 'perf: cliente não consulta');
SELECT t.login('b0000000-0000-0000-0000-000000000001');
SELECT set_config('t.perfb', public.get_promo_offer_performance('10000000-0000-0000-0000-00000000000b', now() - interval '1 day', now() + interval '1 day')::text, false);
SELECT t.ok(current_setting('t.perfb') ~ 'e0000000-0000-0000-0000-0000000000f2' AND current_setting('t.perfb') !~ 'e0000000-0000-0000-0000-0000000000f1', 'perf: OWNER B vê só a loja B');
RESET ROLE;
SET ROLE anon;
SELECT t.login(NULL);
SELECT t.throws($$SELECT public.get_promo_offer_performance('10000000-0000-0000-0000-00000000000a', now() - interval '1 day', now())$$, 'permission denied', 'perf: anon sem EXECUTE');
RESET ROLE;
