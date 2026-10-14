-- N4: carrosséis (preço no servidor, menor promoção vence, sem acúmulo) e colunas novas de offers.
\set A '\'10000000-0000-0000-0000-00000000000a\''
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.lives($$INSERT INTO public.promotion_carousels (id, tenant_id, name) VALUES ('ca000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','Semana')$$, 'OWNER cria carrossel');
SELECT t.lives($$INSERT INTO public.promotion_carousel_items (tenant_id, carousel_id, product_id, discount_type, discount_value) VALUES
  ('10000000-0000-0000-0000-00000000000a','ca000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-0000000000a1','PERCENTAGE',20),
  ('10000000-0000-0000-0000-00000000000a','ca000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-0000000000a2','FIXED_AMOUNT',3)$$, 'OWNER adiciona itens');
SELECT t.throws($$INSERT INTO public.promotion_carousel_items (tenant_id, carousel_id, product_id, discount_type, discount_value) VALUES
  ('10000000-0000-0000-0000-00000000000a','ca000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-0000000000b1','PERCENTAGE',20)$$, 'pci_product_fk|foreign key', 'item com produto de outro tenant recusado (FK composta)');
SELECT t.throws($$INSERT INTO public.promotion_carousels (tenant_id, name) VALUES ('10000000-0000-0000-0000-00000000000b','Invasão')$$, 'row-level security', 'OWNER A não cria carrossel em B');
RESET ROLE;
SELECT t.is(t.sq($$SELECT unit_price || '/' || price_source FROM public._effective_product_price('10000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000a1', now())$$), '8.00/CAROUSEL', 'carrossel 20% sobre 10 = 8');
SELECT t.is(t.sq($$SELECT unit_price || '/' || price_source FROM public._effective_product_price('10000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000a2', now())$$), '15.00/PRODUCT_PROMO', 'menor preço vence: promo do produto 15 < carrossel 17');
UPDATE public.promotion_carousel_items SET discount_type = 'PROMOTIONAL_PRICE', discount_value = 12 WHERE product_id = 'd0000000-0000-0000-0000-0000000000a2';
SELECT t.is(t.sq($$SELECT unit_price || '/' || price_source FROM public._effective_product_price('10000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000a2', now())$$), '12.00/CAROUSEL', 'preço promocional do carrossel 12 vence 15');
UPDATE public.promotion_carousel_items SET discount_type = 'PROMOTIONAL_PRICE', discount_value = 25 WHERE product_id = 'd0000000-0000-0000-0000-0000000000a2';
SELECT t.is(t.sq($$SELECT unit_price FROM public._effective_product_price('10000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000a2', now())$$), '15.00', 'preço de carrossel acima do preço de tabela é ignorado');
-- Checkout usa o preço do carrossel e o cupom não se aplica a ele
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT t.is((public.process_checkout_atomic_v2('adega-a','Cliente Dois','11977776666','Rua',NULL,'CASH','PICKUP',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":2},{"productId":"d0000000-0000-0000-0000-0000000000a5","quantity":1}]','VINTE20') ->> 'total_amount')::numeric,
    61.00, 'checkout: carrossel (2×8) + item normal 50 − cupom 5 (só sobre o item normal) = 61');
SELECT t.is((public.validate_coupon('adega-a','DEZ10','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]') ->> 'reason'), 'COUPON_NOT_APPLICABLE_PROMO', 'cupom não acumula com carrossel');
-- Outros papéis
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.is(t.visible($$SELECT * FROM public.promotion_carousels$$), 0::bigint, 'CASHIER não lê carrosséis');
SELECT t.throws($$INSERT INTO public.promotion_carousels (tenant_id, name) VALUES ('10000000-0000-0000-0000-00000000000a','x')$$, 'row-level security', 'CASHIER não cria carrossel');
SELECT t.login('c0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible($$SELECT * FROM public.promotion_carousels$$), 0::bigint, 'F2: CEO não lê carrosséis');
SELECT t.is(t.visible($$SELECT * FROM public.promotion_carousel_items$$), 0::bigint, 'F2: CEO não lê itens');
SELECT t.login('c0000000-0000-0000-0000-000000000002');
SELECT t.throws($$INSERT INTO public.promotion_carousels (tenant_id, name) VALUES ('10000000-0000-0000-0000-00000000000a','x')$$, 'row-level security', 'F2: SUPER_ADMIN não cria carrossel');
-- Offers: contador protegido e referência de mídia
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.throws($$UPDATE public.offers SET promo_times_used = 5 WHERE id = 'e0000000-0000-0000-0000-0000000000a1'$$, 'COUNTER_PROTECTED', 'promo_times_used não gravável pela API');
SELECT t.lives($$INSERT INTO public.offers (id, tenant_id, product_id, title, image_url, promo_times_used) VALUES ('e0000000-0000-0000-0000-0000000000a5','10000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000a5','Nova','x', 7)$$, 'OWNER cria oferta nova');
SELECT t.is(t.sq($$SELECT promo_times_used FROM public.offers WHERE id = 'e0000000-0000-0000-0000-0000000000a5'$$), '0', 'contador forçado a 0 na criação pela API');
SELECT t.throws($$UPDATE public.offers SET has_promo_checkout = true WHERE id = 'e0000000-0000-0000-0000-0000000000a5'$$, 'offers_promo_checkout_requires_price', 'checkout promocional exige promo_price');
SELECT set_config('t.priv', (public.register_marketing_asset('10000000-0000-0000-0000-00000000000a','PRIVATE','IMAGE','png',100) ->> 'asset_id'), false);
SELECT t.throws(format($$UPDATE public.offers SET media_asset_id = %L WHERE id = 'e0000000-0000-0000-0000-0000000000a5'$$, current_setting('t.priv')), 'MEDIA_REFERENCE_INVALID', 'oferta não referencia mídia PRIVATE');
SELECT set_config('t.cre', (public.register_marketing_asset('10000000-0000-0000-0000-00000000000a','CREATIVE','IMAGE','png',100) ->> 'asset_id'), false);
SELECT t.lives(format($$UPDATE public.offers SET media_asset_id = %L WHERE id = 'e0000000-0000-0000-0000-0000000000a5'$$, current_setting('t.cre')), 'oferta referencia mídia CREATIVE do tenant');
SELECT t.login('b0000000-0000-0000-0000-000000000001');
SELECT t.throws(format($$INSERT INTO public.offers (tenant_id, title, image_url, media_asset_id) VALUES ('10000000-0000-0000-0000-00000000000b','x','x',%L)$$, current_setting('t.cre')), 'foreign key|MEDIA_REFERENCE_INVALID', 'oferta de B não referencia mídia de A');
RESET ROLE;
-- Desliga o carrossel para não afetar suítes seguintes
UPDATE public.promotion_carousels SET is_active = false WHERE id = 'ca000000-0000-0000-0000-000000000001';
SELECT t.is(t.sq($$SELECT unit_price || '/' || price_source FROM public._effective_product_price('10000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000a1', now())$$), '10.00/BASE', 'carrossel inativo não altera preço');
