-- N5: campanhas, cards (cadeia/tenant/F1-A), status, analytics sem efeito financeiro, atribuição, métricas, contadores.
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.lives($$INSERT INTO public.campaigns (id, tenant_id, name, public_title, internal_notes, status, created_by, published_at)
  VALUES ('cb000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','Verão','Verão gelado','nota interna','DRAFT',
          'c0000000-0000-0000-0000-000000000001', now())$$, 'OWNER cria campanha DRAFT');
SELECT t.is(t.sq($$SELECT created_by::text || '/' || COALESCE(published_at::text,'null') FROM public.campaigns WHERE id='cb000000-0000-0000-0000-000000000001'$$),
    'a0000000-0000-0000-0000-000000000001/null', 'created_by vem de auth.uid() e published_at não é gravável pela API');
SELECT t.throws($$INSERT INTO public.campaigns (tenant_id, name, status) VALUES ('10000000-0000-0000-0000-00000000000a','x','ENDED')$$, 'CAMPAIGN_STATUS_INVALID', 'campanha não nasce ENDED');
SELECT t.lives($$UPDATE public.campaigns SET status='ACTIVE' WHERE id='cb000000-0000-0000-0000-000000000001'$$, 'DRAFT -> ACTIVE');
SELECT t.ok(t.sq($$SELECT published_at FROM public.campaigns WHERE id='cb000000-0000-0000-0000-000000000001'$$) IS NOT NULL, 'published_at preenchido ao ativar');
SELECT t.throws($$UPDATE public.campaigns SET status='DRAFT' WHERE id='cb000000-0000-0000-0000-000000000001'$$, 'CAMPAIGN_STATUS_TRANSITION', 'ACTIVE -> DRAFT recusado');
SELECT t.throws($$INSERT INTO public.campaigns (tenant_id, name) VALUES ('10000000-0000-0000-0000-00000000000b','Invasão')$$, 'row-level security', 'OWNER A não cria campanha em B');
-- Cards
SELECT t.lives($$INSERT INTO public.campaign_cards (id, tenant_id, campaign_id, commercial_mode, offer_id, title, custom_times_used)
  VALUES ('cc000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000001','OFFER','e0000000-0000-0000-0000-0000000000a1','Card oferta', 9)$$, 'card OFFER com oferta válida');
SELECT t.is(t.sq($$SELECT custom_times_used FROM public.campaign_cards WHERE id='cc000000-0000-0000-0000-000000000001'$$), '0', 'custom_times_used forçado a 0 pela API');
SELECT t.throws($$UPDATE public.campaign_cards SET custom_times_used = 3 WHERE id='cc000000-0000-0000-0000-000000000001'$$, 'COUNTER_PROTECTED', 'custom_times_used não gravável pela API');
SELECT t.throws($$INSERT INTO public.campaign_cards (tenant_id, campaign_id, commercial_mode, offer_id, title)
  VALUES ('10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000001','OFFER','e0000000-0000-0000-0000-0000000000a9','x')$$, 'CARD_CHAIN_INVALID', 'F1-A: oferta legada com produto de outro tenant não entra em card');
SELECT t.throws($$INSERT INTO public.campaign_cards (tenant_id, campaign_id, commercial_mode, offer_id, title)
  VALUES ('10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000001','OFFER','e0000000-0000-0000-0000-0000000000b1','x')$$, 'CARD_CHAIN_INVALID|foreign key|campaign_cards_offer_fk', 'card não usa oferta de outro tenant (trigger de cadeia + FK composta)');
SELECT t.throws($$INSERT INTO public.campaign_cards (tenant_id, campaign_id, commercial_mode, product_id, title)
  VALUES ('10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000001','PRODUCT','d0000000-0000-0000-0000-0000000000b1','x')$$, 'foreign key|campaign_cards_product_fk', 'card não usa produto de outro tenant');
SELECT t.throws($$INSERT INTO public.campaign_cards (tenant_id, campaign_id, commercial_mode, offer_id, product_id, title)
  VALUES ('10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000001','OFFER','e0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a2','x')$$, 'CARD_CHAIN_INVALID', 'produto do card precisa ser o da oferta');
SELECT t.throws($$INSERT INTO public.campaign_cards (tenant_id, campaign_id, commercial_mode, title, custom_price)
  VALUES ('10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000001','BANNER_ONLY','x', 10)$$, 'campaign_cards_mode', 'BANNER_ONLY não tem preço');
SELECT t.throws($$INSERT INTO public.campaign_cards (tenant_id, campaign_id, commercial_mode, title)
  VALUES ('10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000001','CUSTOM','x')$$, 'campaign_cards_mode', 'CUSTOM exige nome e preço');
SELECT t.throws($$INSERT INTO public.campaign_cards (tenant_id, campaign_id, commercial_mode, title, coupon_id)
  VALUES ('10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000001','BANNER_ONLY','x','c1000000-0000-0000-0000-000000000003')$$, 'foreign key|campaign_cards_coupon_fk', 'card não usa cupom de outro tenant');
SELECT t.lives($$INSERT INTO public.campaign_cards (id, tenant_id, campaign_id, commercial_mode, title, custom_name, custom_price, custom_original_price, custom_usage_limit)
  VALUES ('cc000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000001','CUSTOM','Kit','Kit churrasco', 30, 40, 5)$$, 'card CUSTOM válido');
SELECT t.lives($$INSERT INTO public.campaign_cards (id, tenant_id, campaign_id, commercial_mode, title)
  VALUES ('cc000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000001','BANNER_ONLY','Banner')$$, 'card BANNER_ONLY válido');
UPDATE public.campaigns SET end_at = now() + interval '30 days' WHERE id='cb000000-0000-0000-0000-000000000001';
SELECT t.throws($$INSERT INTO public.campaign_cards (tenant_id, campaign_id, commercial_mode, title, end_at)
  VALUES ('10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000001','BANNER_ONLY','x', now() + interval '60 days')$$, 'CARD_WINDOW_INVALID', 'janela do card dentro da campanha');
SELECT set_config('t.priv5', (public.register_marketing_asset('10000000-0000-0000-0000-00000000000a','PRIVATE','IMAGE','png',100) ->> 'asset_id'), false);
SELECT t.throws(format($$UPDATE public.campaign_cards SET media_asset_id = %L WHERE id='cc000000-0000-0000-0000-000000000003'$$, current_setting('t.priv5')), 'MEDIA_REFERENCE_INVALID', 'card não referencia mídia PRIVATE');
-- MANAGER administra
SELECT t.login('a0000000-0000-0000-0000-000000000002');
SELECT t.lives($$INSERT INTO public.campaigns (id, tenant_id, name, status) VALUES ('cb000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a','Pausada','ACTIVE')$$, 'MANAGER cria campanha');
SELECT t.lives($$INSERT INTO public.campaign_cards (id, tenant_id, campaign_id, commercial_mode, product_id, card_promotional_price, title)
  VALUES ('cc000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-00000000000a','cb000000-0000-0000-0000-000000000002','PRODUCT','d0000000-0000-0000-0000-0000000000a5', 45, 'Destilado')$$, 'MANAGER cria card PRODUCT');
SELECT t.lives($$UPDATE public.campaigns SET status='PAUSED' WHERE id='cb000000-0000-0000-0000-000000000002'$$, 'ACTIVE -> PAUSED');
-- Papéis sem acesso (F2 incluso)
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.is(t.visible($$SELECT * FROM public.campaigns$$), 0::bigint, 'CASHIER não lê campanhas');
SELECT t.throws($$INSERT INTO public.campaigns (tenant_id, name) VALUES ('10000000-0000-0000-0000-00000000000a','x')$$, 'row-level security', 'CASHIER não cria campanha');
SELECT t.login('a0000000-0000-0000-0000-000000000003');
SELECT t.is(t.visible($$SELECT * FROM public.campaign_cards$$), 0::bigint, 'OPERATOR não lê cards');
SELECT t.login('c0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible($$SELECT * FROM public.campaigns$$), 0::bigint, 'F2: CEO não lê campanhas');
SELECT t.is(t.visible($$SELECT * FROM public.campaign_analytics_events$$), 0::bigint, 'F2: CEO não lê analytics');
SELECT t.throws($$SELECT public.get_campaign_metrics('cb000000-0000-0000-0000-000000000001', now() - interval '1 day', now() + interval '1 day')$$, 'FORBIDDEN', 'F2: CEO sem métricas');
SELECT t.login('b0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible($$SELECT * FROM public.campaigns$$), 0::bigint, 'OWNER B não vê campanhas de A');
SELECT t.throws($$SELECT public.get_campaign_metrics('cb000000-0000-0000-0000-000000000001', now() - interval '1 day', now() + interval '1 day')$$, 'FORBIDDEN', 'OWNER B sem métricas de A');
SELECT t.throws($$INSERT INTO public.campaign_analytics_events (tenant_id, event_type, source, dedupe_key) VALUES ('10000000-0000-0000-0000-00000000000b','PURCHASE','SERVER','x')$$, 'permission denied', 'API não insere evento diretamente');
RESET ROLE;

-- Analytics (anon)
CREATE TEMP TABLE _fin_before AS SELECT
  (SELECT md5(string_agg(to_jsonb(p)::text, ',' ORDER BY id)) FROM public.products p) AS p,
  (SELECT md5(string_agg(to_jsonb(o)::text, ',' ORDER BY id)) FROM public.offers o) AS o,
  (SELECT md5(string_agg(to_jsonb(c)::text, ',' ORDER BY id)) FROM public.coupons c) AS c,
  (SELECT md5(string_agg(to_jsonb(r)::text, ',' ORDER BY id)) FROM public.orders r) AS r;
GRANT SELECT ON _fin_before TO PUBLIC;
SET ROLE anon;
SELECT t.login(NULL);
SELECT t.lives($$SELECT public.track_campaign_event('adega-a','CARD_VIEW','5e550000-0000-0000-0000-000000000001',NULL,'cc000000-0000-0000-0000-000000000001',NULL,'{"position":2,"ip":"200.1.2.3","email":"x@y.z","viewport":"mobile"}')$$, 'anon registra CARD_VIEW');
SELECT public.track_campaign_event('adega-a','CARD_VIEW','5e550000-0000-0000-0000-000000000001',NULL,'cc000000-0000-0000-0000-000000000001',NULL,'{}');
SELECT public.track_campaign_event('adega-a','PURCHASE','5e550000-0000-0000-0000-000000000001',NULL,'cc000000-0000-0000-0000-000000000001',NULL,'{}');
SELECT public.track_campaign_event('adega-a','FOO','5e550000-0000-0000-0000-000000000001',NULL,'cc000000-0000-0000-0000-000000000001',NULL,'{}');
SELECT public.track_campaign_event('adega-b','CARD_VIEW','5e550000-0000-0000-0000-000000000001',NULL,'cc000000-0000-0000-0000-000000000001',NULL,'{}');
SELECT public.track_campaign_event('adega-a','CARD_VIEW','5e550000-0000-0000-0000-000000000001',NULL,'cc000000-0000-0000-0000-000000000004',NULL,'{}');
SELECT public.track_campaign_event('adega-a','CARD_CLICK','5e550000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000002','cc000000-0000-0000-0000-000000000001',NULL,'{}');
SELECT public.track_campaign_event('adega-a','CARD_CLICK','5e550000-0000-0000-0000-000000000001',NULL,NULL,'e0000000-0000-0000-0000-0000000000a9','{}');
SELECT t.is(t.visible($$SELECT * FROM public.campaign_analytics_events$$), -1::bigint, 'anon não lê analytics');
RESET ROLE;
SELECT t.is(t.sq($$SELECT count(*) FROM public.campaign_analytics_events$$), '1', 'dedupe por minuto; PURCHASE do navegador, evento fora da whitelist, slug de outro tenant, card de campanha pausada, campanha divergente e oferta F1-A inválida descartados');
SELECT t.is(t.sq($$SELECT metadata::text FROM public.campaign_analytics_events$$), '{"position": 2, "viewport": "mobile"}', 'metadata só com chaves da whitelist (IP/e-mail removidos)');
SELECT t.is(t.sq($$SELECT offer_id::text || '/' || campaign_id::text FROM public.campaign_analytics_events$$), 'e0000000-0000-0000-0000-0000000000a1/cb000000-0000-0000-0000-000000000001', 'campanha e oferta derivadas do card no servidor');
SELECT t.is(t.sq($$SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='campaign_analytics_events' AND (column_name ILIKE '%ip%' OR column_name ILIKE '%addr%')$$), '0', 'sem coluna de IP em analytics');
-- IP: só HMAC em security_rate_limits
INSERT INTO vault.secrets_stub VALUES ('n1n6_ip_hash_salt','sal-de-teste') ON CONFLICT DO NOTHING;
SET ROLE anon;
SELECT set_config('request.headers', '{"x-forwarded-for":"203.0.113.77, 10.0.0.1"}', false);
SELECT public.track_campaign_event('adega-a','VIDEO_PLAY','5e550000-0000-0000-0000-000000000002',NULL,'cc000000-0000-0000-0000-000000000003',NULL,'{"video_seconds":3}');
SELECT set_config('request.headers', '', false);
RESET ROLE;
SELECT t.is(t.sq($$SELECT count(*) FROM public.security_rate_limits WHERE scope='track_ip'$$), '1', 'camada de rate limit por HMAC de IP ativa');
SELECT t.is(t.sq($$SELECT count(*) FROM public.security_rate_limits WHERE subject_key LIKE '%203.0.113%'$$), '0', 'nenhum IP puro em security_rate_limits');
SELECT t.is(t.sq($$SELECT count(*) FROM public.campaign_analytics_events WHERE metadata::text LIKE '%203.0.113%' OR COALESCE(session_hash,'') LIKE '%203.0.113%'$$), '0', 'nenhum IP puro em analytics');
-- Rate limit por sessão (120/min): após o limite, novos eventos são descartados em silêncio
SET ROLE anon;
DO $$ BEGIN FOR i IN 1..125 LOOP PERFORM public.track_campaign_event('adega-a','IMPRESSION','5e550000-0000-0000-0000-000000000003','cb000000-0000-0000-0000-000000000001',NULL,NULL,'{}'); END LOOP; END $$;
SELECT public.track_campaign_event('adega-a','CARD_CLICK','5e550000-0000-0000-0000-000000000003',NULL,'cc000000-0000-0000-0000-000000000002',NULL,'{}');
RESET ROLE;
SELECT t.is(t.sq($$SELECT count(*) FROM public.campaign_analytics_events WHERE session_hash = public._sha256_hex('5e550000-0000-0000-0000-000000000003')$$), '1', 'rate limit por sessão: 125 impressões viram 1 linha e o clique após o limite é descartado');
SELECT t.ok((SELECT p FROM _fin_before) = (SELECT md5(string_agg(to_jsonb(p)::text, ',' ORDER BY id)) FROM public.products p)
        AND (SELECT o FROM _fin_before) = (SELECT md5(string_agg(to_jsonb(o)::text, ',' ORDER BY id)) FROM public.offers o)
        AND (SELECT c FROM _fin_before) = (SELECT md5(string_agg(to_jsonb(c)::text, ',' ORDER BY id)) FROM public.coupons c)
        AND (SELECT r FROM _fin_before) = (SELECT md5(string_agg(to_jsonb(r)::text, ',' ORDER BY id)) FROM public.orders r),
        'analytics não altera produtos/preço/estoque, ofertas, cupons nem pedidos (regra 36)');
SELECT t.throws($$INSERT INTO public.campaign_analytics_events (tenant_id, event_type, source, dedupe_key) VALUES ('10000000-0000-0000-0000-00000000000a','PURCHASE','CLIENT','zz')$$, 'cae_purchase_server_only', 'PURCHASE só com source SERVER (CHECK)');

-- Atribuição no checkout de carrinho + PURCHASE do servidor
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT set_config('t.o5', public.process_checkout_atomic_v2('adega-a','Cliente Dois','11977776666','Rua',NULL,'CASH','PICKUP',NULL,
   '[{"productId":"d0000000-0000-0000-0000-0000000000a5","quantity":1}]', NULL, NULL, 'cc000000-0000-0000-0000-000000000001') ->> 'order_id', false);
SELECT set_config('t.o6', public.process_checkout_atomic_v2('adega-a','Cliente Dois','11977776666','Rua',NULL,'CASH','PICKUP',NULL,
   '[{"productId":"d0000000-0000-0000-0000-0000000000a5","quantity":1}]', NULL, NULL, 'cc000000-0000-0000-0000-000000000004') ->> 'order_id', false);
RESET ROLE;
SELECT t.is(t.sq(format($$SELECT campaign_id || '/' || card_id || '/' || attribution_source FROM public.orders WHERE id = %L$$, current_setting('t.o5'))),
    'cb000000-0000-0000-0000-000000000001/cc000000-0000-0000-0000-000000000001/CARD', 'pedido atribuído ao card visível');
SELECT t.is(t.sq(format($$SELECT COALESCE(card_id::text,'null') || '/' || attribution_source FROM public.orders WHERE id = %L$$, current_setting('t.o6'))),
    'null/DIRECT', 'card de campanha pausada é ignorado (pedido criado, sem atribuição)');
SELECT t.is(t.sq(format($$SELECT count(*) FROM public.campaign_analytics_events WHERE order_id = %L AND event_type='PURCHASE' AND source='SERVER'$$, current_setting('t.o5'))), '1', 'PURCHASE gravado pelo servidor');
SELECT t.is(t.sq(format($$SELECT total_amount FROM public.orders WHERE id = %L$$, current_setting('t.o5'))), '50.00', 'atribuição não altera preço');
-- Métricas
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.is((public.get_campaign_metrics('cb000000-0000-0000-0000-000000000001', now() - interval '1 day', now() + interval '1 day') -> 'orders' ->> 'revenue')::numeric, 50.00, 'receita vem de orders válidos');
SELECT t.is((public.get_campaign_metrics('cb000000-0000-0000-0000-000000000001', now() - interval '1 day', now() + interval '1 day') -> 'funnel_estimate' ->> 'CARD_VIEW')::int, 1, 'funil por eventos (estimativa)');
SELECT t.lives(format($$SELECT public.update_order_status(%L, 'CANCELLED', 'cliente desistiu')$$, current_setting('t.o5')), 'OWNER cancela pedido atribuído');
SELECT t.is((public.get_campaign_metrics('cb000000-0000-0000-0000-000000000001', now() - interval '1 day', now() + interval '1 day') -> 'orders' ->> 'revenue')::numeric, 0::numeric, 'pedido cancelado sai da receita (o evento PURCHASE não conta como receita)');
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.throws($$SELECT public.get_campaign_metrics('cb000000-0000-0000-0000-000000000001', now() - interval '1 day', now() + interval '1 day')$$, 'FORBIDDEN', 'CASHIER sem métricas');
RESET ROLE;

-- Contadores promocionais: consumo com guarda e estorno no cancelamento
UPDATE public.offers SET promo_usage_limit = 3 WHERE id = 'e0000000-0000-0000-0000-0000000000a1';
SELECT set_config('t.o7', t.mk_order('10000000-0000-0000-0000-00000000000a','CONFIRMED')::text, false);
INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, item_kind, offer_id, card_id)
VALUES (current_setting('t.o7')::uuid, 'd0000000-0000-0000-0000-0000000000a1', 'promo', 2, 0, 0, 'OFFER', 'e0000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-000000000001'),
       (current_setting('t.o7')::uuid, NULL, 'Kit churrasco', 1, 0, 0, 'CUSTOM', NULL, 'cc000000-0000-0000-0000-000000000002');
SELECT t.lives(format($$SELECT public._promo_counter_adjust(%L, 1)$$, current_setting('t.o7')), 'consumo dos contadores');
SELECT t.is(t.sq($$SELECT promo_times_used || '/' || (SELECT custom_times_used FROM public.campaign_cards WHERE id='cc000000-0000-0000-0000-000000000002') FROM public.offers WHERE id='e0000000-0000-0000-0000-0000000000a1'$$), '2/1', 'offer +2, card CUSTOM +1');
SELECT t.throws(format($$SELECT public._promo_counter_adjust(%L, 1)$$, current_setting('t.o7')), 'PROMO_EXHAUSTED', 'guarda de limite (2+2 > 3)');
SELECT t.throws($$INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, item_kind) VALUES ('0d000000-0000-0000-0000-0000000000a1', NULL, 'x', 1, 1, 1, 'PRODUCT')$$, 'order_items_custom_product', 'item sem produto só se CUSTOM');
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.lives(format($$SELECT public.update_order_status(%L, 'CANCELLED', 'estorno teste')$$, current_setting('t.o7')), 'cancelamento do pedido promocional');
RESET ROLE;
SELECT t.is(t.sq($$SELECT promo_times_used || '/' || (SELECT custom_times_used FROM public.campaign_cards WHERE id='cc000000-0000-0000-0000-000000000002') FROM public.offers WHERE id='e0000000-0000-0000-0000-0000000000a1'$$), '0/0', 'estorno devolve contadores promocionais');
SELECT t.is(t.sq(format($$SELECT count(*) FROM public.order_items WHERE order_id = %L$$, current_setting('t.o7'))), '3', 'histórico dos itens mantido');
-- Exclusão de campanha: pedidos ficam, só a referência vira NULL; eventos da campanha somem com ela
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.lives($$DELETE FROM public.campaigns WHERE id='cb000000-0000-0000-0000-000000000001'$$, 'OWNER exclui campanha com pedidos atribuídos');
RESET ROLE;
SELECT t.is(t.sq(format($$SELECT COALESCE(campaign_id::text,'null') || '/' || COALESCE(card_id::text,'null') || '/' || status FROM public.orders WHERE id = %L$$, current_setting('t.o5'))), 'null/null/CANCELLED', 'pedido preservado; FK SET NULL aceita pelo trigger de proteção');
SELECT t.is(t.sq(format($$SELECT count(*) FROM public.order_items WHERE order_id = %L AND card_id IS NULL$$, current_setting('t.o7'))), '3', 'itens preservados com card_id NULL');
UPDATE public.offers SET promo_usage_limit = NULL WHERE id = 'e0000000-0000-0000-0000-0000000000a1';
