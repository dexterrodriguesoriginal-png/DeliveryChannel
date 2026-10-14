-- N6: vitrine pública (sem PII/financeiro/internos; F1-A) e checkout promocional (cadeia, limites, cupom, estorno).
-- Preparação (OWNER pela API)
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.lives($$UPDATE public.offers SET has_promo_checkout = true, promo_price = 7, promo_usage_limit = 5, promo_usage_limit_per_customer = 3,
   promo_max_qty_per_order = 3, promo_fulfillment = 'BOTH', internal_name = 'NOME-INTERNO-X', internal_notes = 'NOTA-INTERNA-Y'
   WHERE id = 'e0000000-0000-0000-0000-0000000000a1'$$, 'OWNER configura checkout promocional na oferta');
SELECT t.lives($$INSERT INTO public.campaigns (id, tenant_id, name, public_title, internal_notes, status) VALUES
   ('cb000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-00000000000a','NOME-CAMPANHA-INTERNO','Festival','SEGREDO-CAMPANHA','ACTIVE'),
   ('cb000000-0000-0000-0000-000000000062','10000000-0000-0000-0000-00000000000a','Outra','Outra pública',NULL,'DRAFT')$$, 'OWNER cria campanhas');
SELECT t.lives($$INSERT INTO public.campaign_cards (id, tenant_id, campaign_id, commercial_mode, offer_id, product_id, title, card_promotional_price,
   custom_name, custom_price, custom_original_price, custom_usage_limit, coupon_id, show_coupon_code) VALUES
   ('cc000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000061','OFFER','e0000000-0000-0000-0000-0000000000a1',NULL,'Oferta card',NULL,NULL,NULL,NULL,NULL,NULL,false),
   ('cc000000-0000-0000-0000-000000000062','10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000061','CUSTOM',NULL,NULL,'Kit',NULL,'Kit festa',30,40,1,NULL,false),
   ('cc000000-0000-0000-0000-000000000063','10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000061','BANNER_ONLY',NULL,NULL,'Banner',NULL,NULL,NULL,NULL,NULL,'c1000000-0000-0000-0000-000000000001',true),
   ('cc000000-0000-0000-0000-000000000064','10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000061','PRODUCT',NULL,'d0000000-0000-0000-0000-0000000000a5','Destilado',45,NULL,NULL,NULL,NULL,'c1000000-0000-0000-0000-000000000005',false),
   ('cc000000-0000-0000-0000-000000000065','10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000061','PRODUCT',NULL,'d0000000-0000-0000-0000-0000000000a5','Destilado cheio',60,NULL,NULL,NULL,NULL,NULL,false),
   ('cc000000-0000-0000-0000-000000000066','10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000062','CUSTOM',NULL,NULL,'Rascunho',NULL,'Kit rascunho',10,NULL,NULL,NULL,false)$$, 'OWNER cria cards');
SELECT set_config('t.cre6', (public.register_marketing_asset('10000000-0000-0000-0000-00000000000a','CREATIVE','IMAGE','png',100) ->> 'asset_id'), false);
SELECT t.lives(format($$UPDATE public.offers SET media_asset_id = %L WHERE id = 'e0000000-0000-0000-0000-0000000000a1'$$, current_setting('t.cre6')), 'oferta referencia mídia ainda não publicada');
RESET ROLE;

-- Vitrine (anon)
SET ROLE anon;
SELECT t.login(NULL);
SELECT set_config('t.store', public.get_public_store('adega-a')::text, false);
RESET ROLE;
SELECT t.ok(current_setting('t.store')::jsonb ?& ARRAY['tenant','theme','settings','categories','products','offers','carousels','campaigns'], 'chaves antigas preservadas + carousels/campaigns aditivos');
SELECT t.ok((current_setting('t.store')::jsonb -> 'settings') ?& ARRAY['is_open','min_order_value','delivery_fee','free_delivery_threshold','estimated_delivery_time','address','city','phone_whatsapp','default_prep_time_minutes'], 'settings antigos + default_prep_time_minutes');
SELECT t.ok(NOT ((current_setting('t.store')::jsonb -> 'settings') ? 'pix_key'), 'settings sem pix_key');
SELECT t.ok(current_setting('t.store') !~* '529\.982|52998224725|pix', 'nenhuma chave PIX na vitrine');
SELECT t.ok(current_setting('t.store') !~* 'contato@adega-a|@test\.local|email', 'nenhum e-mail na vitrine');
SELECT t.ok(current_setting('t.store') !~* 'cost_?price|costPrice|stock_quantity|stockQuantity', 'sem custo nem estoque detalhado');
SELECT t.ok(current_setting('t.store') !~* 'NOME-INTERNO-X|NOTA-INTERNA-Y|internal_?name|internal_?notes|internalNotes', 'sem campos internos da oferta');
SELECT t.ok(current_setting('t.store') !~* 'times_used|timesUsed|usage_limit|usageLimit', 'sem contadores/limites');
SELECT t.ok(current_setting('t.store') !~* 'SEGREDO-CAMPANHA|NOME-CAMPANHA-INTERNO', 'sem nome/nota interna da campanha');
SELECT t.ok(current_setting('t.store') !~* 'Kit rascunho', 'card de campanha DRAFT não aparece');
SELECT t.ok(current_setting('t.store') ~ 'DEZ10' AND current_setting('t.store') !~ 'PRIMEIRA', 'só o cupom marcado para exibição aparece');
SELECT t.ok(NOT (current_setting('t.store') ~ 'e0000000-0000-0000-0000-0000000000a9'), 'F1-A: oferta com vínculo inválido entre tenants omitida da vitrine');
SELECT t.is(t.sq($$SELECT count(*) FROM public.offers WHERE id = 'e0000000-0000-0000-0000-0000000000a9' AND product_id = 'd0000000-0000-0000-0000-0000000000b1'$$), '1', 'F1-A: oferta inválida continua intacta no banco (sem UPDATE/DELETE)');
SELECT t.is((SELECT o ->> 'promoPrice' FROM jsonb_array_elements(current_setting('t.store')::jsonb -> 'offers') o WHERE o ->> 'id' = 'e0000000-0000-0000-0000-0000000000a1'), '7.00', 'promoPrice calculado no servidor');
SELECT t.ok((SELECT o -> 'media' FROM jsonb_array_elements(current_setting('t.store')::jsonb -> 'offers') o WHERE o ->> 'id' = 'e0000000-0000-0000-0000-0000000000a1') = 'null'::jsonb, 'mídia não publicada não aparece');
SELECT t.is((SELECT p ->> 'promotionalPrice' FROM jsonb_array_elements(current_setting('t.store')::jsonb -> 'products') p WHERE p ->> 'id' = 'd0000000-0000-0000-0000-0000000000a2'), '15.00', 'preço promocional de produto preservado');
SELECT t.is((SELECT count(*) FROM jsonb_array_elements(current_setting('t.store')::jsonb -> 'campaigns'))::int, 1, 'só campanha ACTIVE');
SELECT t.is((SELECT c ->> 'price' FROM jsonb_array_elements(current_setting('t.store')::jsonb -> 'campaigns' -> 0 -> 'cards') c WHERE c ->> 'id' = 'cc000000-0000-0000-0000-000000000064'), '45.00', 'preço do card PRODUCT vem do servidor');
-- publicar mídia (simulado como o fluxo da N3 deixaria) => aparece; despublicar => some
UPDATE public.marketing_media_assets SET status = 'PUBLISHED', mime_type = 'image/png', size_bytes = 100,
   public_path = tenant_id::text || '/published/' || id::text || '.png' WHERE id = current_setting('t.cre6')::uuid;
SELECT t.ok((SELECT o -> 'media' ->> 'bucket' FROM jsonb_array_elements(public.get_public_store('adega-a') -> 'offers') o WHERE o ->> 'id' = 'e0000000-0000-0000-0000-0000000000a1') = 'marketing-public', 'mídia PUBLISHED aparece (bucket público)');
UPDATE public.marketing_media_assets SET status = 'UNPUBLISHED' WHERE id = current_setting('t.cre6')::uuid;
SELECT t.ok((SELECT o -> 'media' FROM jsonb_array_elements(public.get_public_store('adega-a') -> 'offers') o WHERE o ->> 'id' = 'e0000000-0000-0000-0000-0000000000a1') = 'null'::jsonb, 'mídia despublicada some da vitrine');
SELECT t.ok(NOT (public.get_public_store('adega-b')::text ~ '10000000-0000-0000-0000-00000000000a'), 'vitrine de B não contém nada de A');
SELECT t.throws($$SELECT public.get_public_store('nao-existe')$$, 'não encontrado', 'slug inexistente');

-- Checkout promocional
SET ROLE anon;
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000a1',1,'X','11977776666','Rua',NULL,'CASH','PICKUP',NULL)$$, 'permission denied', 'anon não executa checkout promocional');
SET ROLE authenticated;
SELECT t.login(NULL);
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000a1',1,'X','11977776666','Rua',NULL,'CASH','PICKUP',NULL)$$, 'AUTH_REQUIRED', 'sem auth.uid() não compra');
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT set_config('t.s0', t.stock('d0000000-0000-0000-0000-0000000000a1')::text, false);
SELECT set_config('t.p1', public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000a1',2,'Cliente Dois','11977776666','',NULL,'CASH','PICKUP',NULL,NULL,'1d000000-0000-0000-0000-000000000061')::text, false);
SELECT t.is((current_setting('t.p1')::jsonb ->> 'total_amount')::numeric, 14.00, 'oferta: 2 × 7 (preço do servidor)');
SELECT t.is(public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000a1',2,'Cliente Dois','11977776666','',NULL,'CASH','PICKUP',NULL,NULL,'1d000000-0000-0000-0000-000000000061') ->> 'replayed', 'true', 'idempotência: mesma chave devolve o mesmo pedido');
RESET ROLE;
SELECT t.is(t.sq($$SELECT promo_times_used FROM public.offers WHERE id='e0000000-0000-0000-0000-0000000000a1'$$), '2', 'contador promocional +2 (uma vez só, apesar do replay)');
SELECT t.is(t.stock('d0000000-0000-0000-0000-0000000000a1'), current_setting('t.s0')::int - 2, 'estoque baixado 2');
SELECT t.is(t.sq(format($$SELECT oi.item_kind || '/' || oi.offer_id || '/' || o.attribution_source || '/' || origin FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id WHERE o.id = %L$$, current_setting('t.p1')::jsonb ->> 'order_id')),
    'OFFER/e0000000-0000-0000-0000-0000000000a1/OFFER/storefront_promo', 'item OFFER com offer_id e atribuição OFFER');
SELECT t.is(t.sq(format($$SELECT count(*) FROM public.campaign_analytics_events WHERE order_id = %L AND event_type = 'PURCHASE' AND source = 'SERVER'$$, current_setting('t.p1')::jsonb ->> 'order_id')), '1', 'PURCHASE do servidor');
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000a1',1,'Cliente Dois','11977776666','',NULL,'CASH','PICKUP',NULL,'DEZ10')$$, 'COUPON_NOT_APPLICABLE_PROMO', 'cupom não acumula com preço promocional');
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000a1',4,'Cliente Dois','11977776666','',NULL,'CASH','PICKUP',NULL)$$, 'PROMO_QTY_EXCEEDED', 'máximo por pedido');
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000a1',2,'Cliente Dois','11977776666','',NULL,'CASH','PICKUP',NULL)$$, 'PROMO_CUSTOMER_LIMIT', 'limite por cliente (2 + 2 > 3)');
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000b1',1,'Cliente Dois','11977776666','',NULL,'CASH','PICKUP',NULL)$$, 'PROMO_UNAVAILABLE', 'oferta de outro tenant');
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-b',NULL,NULL,'e0000000-0000-0000-0000-0000000000a1',1,'Cliente Dois','11977776666','',NULL,'CASH','PICKUP',NULL)$$, 'PROMO_UNAVAILABLE', 'oferta de A pelo slug de B');
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a','cb000000-0000-0000-0000-000000000062','cc000000-0000-0000-0000-000000000061',NULL,1,'Cliente Dois','11977776666','',NULL,'CASH','PICKUP',NULL)$$, 'PROMO_UNAVAILABLE', 'card com campanha divergente');
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a',NULL,'cc000000-0000-0000-0000-000000000061',NULL,1,'Cliente Dois','11977776666','',NULL,'CASH','PICKUP',NULL)$$, 'PROMO_UNAVAILABLE', 'card sem campanha informada');
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a','cb000000-0000-0000-0000-000000000061','cc000000-0000-0000-0000-000000000063',NULL,1,'Cliente Dois','11977776666','',NULL,'CASH','PICKUP',NULL)$$, 'PROMO_UNAVAILABLE', 'BANNER_ONLY não é comprável');
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a','cb000000-0000-0000-0000-000000000062','cc000000-0000-0000-0000-000000000066',NULL,1,'Cliente Dois','11977776666','',NULL,'CASH','PICKUP',NULL)$$, 'PROMO_UNAVAILABLE', 'card de campanha DRAFT');
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a','cb000000-0000-0000-0000-000000000061','cc000000-0000-0000-0000-000000000061','e0000000-0000-0000-0000-0000000000a5',1,'Cliente Dois','11977776666','',NULL,'CASH','PICKUP',NULL)$$, 'PROMO_UNAVAILABLE', 'offer enviada diferente da offer do card');
-- CUSTOM: sem produto, sem estoque, contador do card
SELECT set_config('t.p2', public.process_promotional_checkout_atomic('adega-a','cb000000-0000-0000-0000-000000000061','cc000000-0000-0000-0000-000000000062',NULL,1,'Cliente Dois','11977776666','Rua Z',NULL,'PIX','DELIVERY',NULL)::text, false);
SELECT t.is((current_setting('t.p2')::jsonb ->> 'total_amount')::numeric, 35.00, 'CUSTOM: 30 + taxa 5');
SELECT t.is(current_setting('t.p2')::jsonb ->> 'payment_status', 'PENDING', 'PIX fica PENDING');
SELECT t.login('a0000000-0000-0000-0000-000000000007');
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a','cb000000-0000-0000-0000-000000000061','cc000000-0000-0000-0000-000000000062',NULL,1,'Cliente Um','11988887777','',NULL,'CASH','PICKUP',NULL)$$, 'PROMO_EXHAUSTED', 'CUSTOM com limite 1 esgotado');
-- PRODUCT: preço do card 45 < 50; card com preço 60 não é promoção => cupom permitido
SELECT t.is((public.process_promotional_checkout_atomic('adega-a','cb000000-0000-0000-0000-000000000061','cc000000-0000-0000-0000-000000000064',NULL,1,'Cliente Um','11988887777','',NULL,'CASH','PICKUP',NULL) ->> 'total_amount')::numeric, 45.00, 'PRODUCT: preço do card');
SELECT t.is((public.process_promotional_checkout_atomic('adega-a','cb000000-0000-0000-0000-000000000061','cc000000-0000-0000-0000-000000000065',NULL,1,'Cliente Um','11988887777','',NULL,'CASH','PICKUP',NULL,'DEZ10') ->> 'total_amount')::numeric, 45.00, 'PRODUCT sem desconto real: preço de tabela 50 − cupom 10% = 45');
-- Oferta F1-A inválida nunca é comprável
RESET ROLE;
UPDATE public.offers SET has_promo_checkout = true, promo_price = 1 WHERE id = 'e0000000-0000-0000-0000-0000000000a9';
SET ROLE authenticated;
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000a9',1,'Cliente Um','11988887777','',NULL,'CASH','PICKUP',NULL)$$, 'PROMO_UNAVAILABLE', 'F1-A: oferta com produto de outro tenant não é comprável');
-- fulfillment
RESET ROLE;
UPDATE public.offers SET promo_fulfillment = 'PICKUP' WHERE id = 'e0000000-0000-0000-0000-0000000000a1';
SET ROLE authenticated;
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000a1',1,'Cliente Um','11988887777','Rua',NULL,'CASH','DELIVERY',NULL)$$, 'PROMO_FULFILLMENT', 'promoção só retirada');
SELECT t.lives($$SELECT public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000a1',3,'Cliente Um','11988887777','',NULL,'CASH','PICKUP',NULL)$$, 'cliente 1 compra 3 (contador 5/5)');
SELECT t.login('b0000000-0000-0000-0000-000000000004');
SELECT t.throws($$SELECT public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000a1',1,'Outro','11955554444','',NULL,'CASH','PICKUP',NULL)$$, 'PROMO_EXHAUSTED', 'limite global da oferta esgotado');
-- Estorno: cancelar o pedido do cliente 2 devolve 2 ao contador e mantém o histórico
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.lives(format($$SELECT public.update_order_status(%L, 'CANCELLED', 'desistência')$$, current_setting('t.p1')::jsonb ->> 'order_id'), 'OWNER cancela pedido promocional');
RESET ROLE;
SELECT t.is(t.sq($$SELECT promo_times_used FROM public.offers WHERE id='e0000000-0000-0000-0000-0000000000a1'$$), '3', 'estorno do contador promocional (5 → 3)');
SELECT t.is(t.sq($$SELECT count(*) FROM public.orders WHERE origin = 'storefront_promo' AND total_amount <> subtotal - discount + delivery_fee$$), '0', 'todos os pedidos promocionais com total consistente');
SELECT t.is(t.sq($$SELECT count(*) FROM public.order_items WHERE item_kind = 'CUSTOM' AND product_id IS NULL$$)::int >= 1, true, 'item CUSTOM gravado sem produto');
-- limpeza para a concorrência: limite promocional novo
UPDATE public.offers SET promo_usage_limit = NULL, promo_usage_limit_per_customer = NULL, promo_fulfillment = 'BOTH' WHERE id = 'e0000000-0000-0000-0000-0000000000a1';
UPDATE public.offers SET has_promo_checkout = false, promo_price = NULL WHERE id = 'e0000000-0000-0000-0000-0000000000a9';
