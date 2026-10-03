-- ============================================================================
-- Suíte de testes: fluxo de cards promocionais/campanhas do painel até a vitrine
-- (cobre os testes A–T do fundador no nível de dados/RPC) + checkout promocional.
--
-- Rodar SOMENTE em PostgreSQL local com os stubs de supabase/tests/local/:
--   supabase/tests/local/run_local.sh fresh
--   supabase/tests/local/run_local.sh upgrade
-- Simula usuários via SET ROLE (anon/authenticated) + request.jwt.claims, exatamente
-- como o PostgREST faz. Qualquer falha aborta com ERROR (ON_ERROR_STOP).
-- ============================================================================
\set ON_ERROR_STOP 1
\pset pager off
SET client_min_messages = notice;

-- ---------- Helpers ----------
DROP SCHEMA IF EXISTS tests CASCADE;
CREATE SCHEMA tests;
GRANT USAGE ON SCHEMA tests TO anon, authenticated;

CREATE FUNCTION tests.ok(p_cond BOOLEAN, p_msg TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FALHOU: %', p_msg;
  END IF;
  RAISE NOTICE 'PASS: %', p_msg;
  RETURN 'PASS: ' || p_msg;
END $$;

-- Executa SQL dinâmico como o papel atual e exige erro com o SQLSTATE indicado.
CREATE FUNCTION tests.throws(p_sql TEXT, p_sqlstate TEXT, p_msg TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_sqlstate THEN
      RAISE NOTICE 'PASS: % (erro esperado % - %)', p_msg, SQLSTATE, SQLERRM;
      RETURN 'PASS: ' || p_msg;
    END IF;
    RAISE EXCEPTION 'FALHOU: % (esperado SQLSTATE %, obtido % - %)', p_msg, p_sqlstate, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FALHOU: % (esperava erro %, mas executou sem erro)', p_msg, p_sqlstate;
END $$;

-- Executa SQL dinâmico e devolve quantas linhas foram afetadas (para UPDATE/DELETE sob RLS).
CREATE FUNCTION tests.affected(p_sql TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Vitrine pública vista como anon (como o ClientApp sem login)
CREATE FUNCTION tests.store(p_slug TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT public.get_public_store(p_slug) $$;
CREATE FUNCTION tests.has_offer(p_slug TEXT, p_id UUID) RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_public_store(p_slug)->'offers') e WHERE (e->>'id')::uuid = p_id)
$$;
CREATE FUNCTION tests.offer_json(p_slug TEXT, p_id UUID) RETURNS JSONB LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(public.get_public_store(p_slug)->'offers') e WHERE (e->>'id')::uuid = p_id
$$;
CREATE FUNCTION tests.campaign_json(p_slug TEXT, p_id UUID) RETURNS JSONB LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(public.get_public_store(p_slug)->'campaigns') e WHERE (e->>'id')::uuid = p_id
$$;
CREATE FUNCTION tests.all_ids(p_slug TEXT) RETURNS UUID[] LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(x), '{}') FROM (
    SELECT (e->>'id')::uuid x FROM jsonb_array_elements(public.get_public_store(p_slug)->'offers') e
    UNION ALL SELECT (e->>'id')::uuid FROM jsonb_array_elements(public.get_public_store(p_slug)->'campaigns') e
    UNION ALL SELECT (c->>'id')::uuid FROM jsonb_array_elements(public.get_public_store(p_slug)->'campaigns') e, jsonb_array_elements(e->'cards') c
    UNION ALL SELECT (e->>'id')::uuid FROM jsonb_array_elements(public.get_public_store(p_slug)->'products') e
  ) s
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated;

-- ---------- Fixtures: usuários, duas lojas, staff ----------
-- 0a = owner A, 0b = owner B, ca = caixa A, c1 = cliente final
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-00000000000a','ownera@test.local','{"name":"Owner A"}'),
 ('00000000-0000-0000-0000-00000000000b','ownerb@test.local','{"name":"Owner B"}'),
 ('00000000-0000-0000-0000-0000000000ca','caixa@test.local','{"name":"Caixa A"}'),
 ('00000000-0000-0000-0000-0000000000c1','cliente@test.local','{"name":"Cliente"}');

BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","email":"ownera@test.local","role":"authenticated"}',true);
SELECT public.create_tenant_for_current_user('Adega A','adega-a','123','11999990000','a@a.com','ADEGA','Rua A, 1','Carapicuiba','11999990000') IS NOT NULL AS tenant_a;
COMMIT;
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b","email":"ownerb@test.local","role":"authenticated"}',true);
SELECT public.create_tenant_for_current_user('Adega B','adega-b','456','11999990001','b@b.com','ADEGA','Rua B, 2','Carapicuiba','11999990001') IS NOT NULL AS tenant_b;
COMMIT;
UPDATE public.tenants SET status = 'ACTIVE' WHERE slug IN ('adega-a','adega-b');
UPDATE public.tenant_settings SET delivery_fee = 5.00, free_delivery_threshold = NULL
 WHERE tenant_id IN (SELECT id FROM public.tenants WHERE slug IN ('adega-a','adega-b'));
INSERT INTO public.tenant_users (user_id, tenant_id, role_id, status)
SELECT '00000000-0000-0000-0000-0000000000ca', id, 'CASHIER', 'ACTIVE' FROM public.tenants WHERE slug = 'adega-a';

SELECT id AS ta FROM public.tenants WHERE slug = 'adega-a' \gset
SELECT id AS tb FROM public.tenants WHERE slug = 'adega-b' \gset
-- Produtos próprios (fora do catálogo demo) para vínculo de card
INSERT INTO public.products (tenant_id, name, price, stock_quantity, unit, image_url, is_active)
VALUES (:'ta', 'Produto A1', 30.00, 50, 'un', 'https://cdn.test/pa1.jpg', true) RETURNING id AS pa1 \gset
INSERT INTO public.products (tenant_id, name, price, stock_quantity, unit, image_url, is_active)
VALUES (:'tb', 'Produto B1', 40.00, 50, 'un', 'https://cdn.test/pb1.jpg', true) RETURNING id AS pb1 \gset
INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value, usage_limit)
VALUES (:'tb', 'SEGREDO-B', 'PERCENTAGE', 50, 100) RETURNING id AS cpb \gset

\echo '=================== A/B: estabelecimento A cria card (payload do offerRepository.create) ==================='
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
INSERT INTO public.offers (
  tenant_id, product_id, title, subtitle, description, badge, card_format, media_type, media_url, image_url,
  duration_seconds, video_duration, detected_width, detected_height, aspect_ratio, discount_percentage,
  original_price, promotional_price, internal_link, display_order, start_date, end_date, start_at, end_at,
  background_color, accent_color, is_active, is_demo, destination_type, has_promo_checkout, promo_title,
  promo_description, promo_price, promo_original_price, promo_discount_percentage, promo_unit, promo_min_quantity,
  promo_max_quantity_per_customer, promo_notes, promo_fulfillment_types, promo_payment_methods, promo_coupon_code,
  promo_usage_limit, promo_times_used, auto_overlay, card_model
) VALUES (
  :'ta', NULL, 'Card Imagem A', 'Sub A', 'Desc A', 'NOVO', 'HORIZONTAL', 'IMAGE', 'https://cdn.test/a-img.jpg', 'https://cdn.test/a-img.jpg',
  6, NULL, 1200, 675, '16:9', NULL, NULL, NULL, NULL, 10, NOW() - interval '1 hour', NULL, NOW() - interval '1 hour', NULL,
  '#15803d', '#ffffff', true, false, 'BANNER_ONLY', false, NULL, NULL, NULL, NULL, NULL, 'un', 1, 10, NULL,
  '["DELIVERY","PICKUP"]', '["PIX","CREDIT_CARD","DEBIT_CARD","CASH"]', NULL, NULL, 0, true, 'HERO'
) RETURNING id AS o_img \gset
SELECT tests.ok(:'o_img' IS NOT NULL, 'A: owner A criou card (offers) com o payload real do painel, sem display_mode');
SELECT tests.throws(format($s$INSERT INTO public.offers (tenant_id, title, image_url, display_mode) VALUES (%L,'x','https://x','FULL_MEDIA')$s$, :'ta'),
  '42703', 'A: display_mode continua inexistente (dependência removida, coluna não criada)');
RESET ROLE;
SELECT tests.ok((SELECT tenant_id FROM public.offers WHERE id = :'o_img') = :'ta'::uuid, 'B: card persistido no banco vinculado ao tenant A');

\echo '=================== C/D: reabrir o painel (SELECT do offerRepository.getOffers) ==================='
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
SELECT tests.ok(EXISTS (SELECT 1 FROM public.offers WHERE tenant_id = :'ta' AND id = :'o_img'), 'C/D: owner A relê o card após reabrir o painel');
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000ca","role":"authenticated"}',false);
SELECT tests.ok(EXISTS (SELECT 1 FROM public.offers WHERE tenant_id = :'ta' AND id = :'o_img'), 'C/D: caixa A (CASHIER) também enxerga o card (leitura staff)');
SELECT tests.throws(format($s$INSERT INTO public.offers (tenant_id, title, image_url) VALUES (%L,'caixa tenta','https://x')$s$, :'ta'),
  '42501', 'RBAC: caixa A NÃO pode criar card (somente OWNER/MANAGER)');
RESET ROLE;

\echo '=================== E/F/Q: vitrine pública (anon) mostra o card de imagem ==================='
SET ROLE anon;
SELECT tests.ok(tests.has_offer('adega-a', :'o_img'), 'E/F: card aparece em get_public_store(adega-a) para anon');
SELECT tests.ok(tests.offer_json('adega-a', :'o_img') @> '{"mediaType":"IMAGE","mediaUrl":"https://cdn.test/a-img.jpg","durationSeconds":6,"displayMode":"EDITABLE_CARD","autoOverlay":true,"noEndDate":true,"destinationType":"BANNER_ONLY"}'::jsonb,
  'Q: card de imagem com mídia, duração, overlay e destino corretos');
SELECT tests.ok(tests.store('adega-a') ? 'campaigns' AND tests.store('adega-a') ? 'serverTime' AND tests.store('adega-a') ? 'promotionCarousels', 'Regressão 026: chaves campaigns/serverTime/promotionCarousels presentes');
RESET ROLE;

\echo '=================== G/H: alterar o card reflete na vitrine ==================='
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
SELECT tests.ok(tests.affected(format($s$UPDATE public.offers SET title='Card Imagem A (editado)', auto_overlay=false, media_url='https://cdn.test/a-img-v2.jpg', image_url='https://cdn.test/a-img-v2.jpg', updated_at=NOW() WHERE tenant_id=%L AND id=%L$s$, :'ta', :'o_img')) = 1,
  'G: owner A editou o card (1 linha)');
SET ROLE anon;
SELECT tests.ok(tests.offer_json('adega-a', :'o_img') @> '{"title":"Card Imagem A (editado)","mediaUrl":"https://cdn.test/a-img-v2.jpg","autoOverlay":false,"displayMode":"FULL_MEDIA"}'::jsonb,
  'H: alteração (título, mídia, overlay desligado => FULL_MEDIA) refletida na vitrine');
RESET ROLE;

\echo '=================== I/J: desativar some da vitrine; reativar volta ==================='
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
SELECT tests.affected(format($s$UPDATE public.offers SET is_active=false WHERE tenant_id=%L AND id=%L$s$, :'ta', :'o_img')) AS desativou;
SET ROLE anon;
SELECT tests.ok(NOT tests.has_offer('adega-a', :'o_img'), 'I/J: card desativado NÃO aparece na vitrine');
SET ROLE authenticated;
SELECT tests.affected(format($s$UPDATE public.offers SET is_active=true WHERE tenant_id=%L AND id=%L$s$, :'ta', :'o_img')) AS reativou;
SET ROLE anon;
SELECT tests.ok(tests.has_offer('adega-a', :'o_img'), 'I/J: card reativado volta a aparecer');
RESET ROLE;

\echo '=================== K/L/M/N/O/P: agendamento por data e hora ==================='
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
-- K: agenda para daqui 2h, termina daqui 5h
SELECT tests.affected(format($s$UPDATE public.offers SET start_at=NOW()+interval '2 hours', start_date=NOW()+interval '2 hours', end_at=NOW()+interval '5 hours', end_date=NOW()+interval '5 hours' WHERE tenant_id=%L AND id=%L$s$, :'ta', :'o_img')) AS agendou;
SET ROLE anon;
SELECT tests.ok(NOT tests.has_offer('adega-a', :'o_img'), 'K/L: card agendado para o futuro NÃO aparece antes do início');
RESET ROLE;
-- M: "avança o relógio" até o início (desloca a janela para começar 1 min atrás)
UPDATE public.offers SET start_at=NOW()-interval '1 minute', start_date=NOW()-interval '1 minute', end_at=NOW()+interval '3 hours', end_date=NOW()+interval '3 hours' WHERE id=:'o_img';
SET ROLE anon;
SELECT tests.ok(tests.has_offer('adega-a', :'o_img'), 'M/N: no horário de início o card aparece');
SELECT tests.ok((tests.offer_json('adega-a', :'o_img')->>'noEndDate')::boolean = false, 'M/N: card com término informa noEndDate=false e endAt');
RESET ROLE;
-- O: passa do horário final
UPDATE public.offers SET start_at=NOW()-interval '3 hours', start_date=NOW()-interval '3 hours', end_at=NOW()-interval '1 second', end_date=NOW()-interval '1 second' WHERE id=:'o_img';
SET ROLE anon;
SELECT tests.ok(NOT tests.has_offer('adega-a', :'o_img'), 'O/P: após o horário final o card desaparece');
RESET ROLE;
-- Divergência start_date x start_at: a regra é COALESCE(start_at, start_date) (start_at canônico)
UPDATE public.offers SET start_at=NULL, start_date=NOW()+interval '1 day', end_at=NULL, end_date=NULL WHERE id=:'o_img';
SET ROLE anon;
SELECT tests.ok(NOT tests.has_offer('adega-a', :'o_img'), 'Agendamento: start_date legado (sem start_at) também é respeitado');
RESET ROLE;
UPDATE public.offers SET start_at=NOW()-interval '1 hour', start_date=NOW()-interval '1 hour', end_at=NULL, end_date=NULL WHERE id=:'o_img';

\echo '=================== R/S: vídeo + múltiplos cards ordenados ==================='
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
INSERT INTO public.offers (tenant_id, title, media_type, media_url, image_url, duration_seconds, video_duration, display_order, is_active, start_at, auto_overlay, destination_type, product_id)
VALUES (:'ta', 'Card Vídeo A', 'VIDEO', 'https://cdn.test/a.mp4', 'https://cdn.test/a.mp4', 12.4, 12.4, 2, true, NOW()-interval '1 minute', false, 'PRODUCT', :'pa1')
RETURNING id AS o_vid \gset
INSERT INTO public.offers (tenant_id, title, media_type, media_url, image_url, display_order, is_active, start_at)
VALUES (:'ta', 'Card Ordem 1', 'IMAGE', 'https://cdn.test/o1.jpg', 'https://cdn.test/o1.jpg', 1, true, NOW()-interval '1 minute')
RETURNING id AS o_first \gset
SET ROLE anon;
SELECT tests.ok(tests.offer_json('adega-a', :'o_vid') @> jsonb_build_object('mediaType','VIDEO','mediaUrl','https://cdn.test/a.mp4','videoDuration',12.4,'displayMode','FULL_MEDIA','destinationType','PRODUCT','productId',:'pa1'),
  'R: card de vídeo com duração real (12.4s) e produto vinculado');
SELECT tests.ok((
  SELECT array_agg((e->>'id')::uuid ORDER BY ord)
  FROM jsonb_array_elements(tests.store('adega-a')->'offers') WITH ORDINALITY AS t(e, ord)
  WHERE (e->>'id')::uuid IN (:'o_first', :'o_vid', :'o_img')
) = ARRAY[:'o_first', :'o_vid', :'o_img']::uuid[], 'S: múltiplos cards retornados na ordem display_order (1, 2, 10)');
RESET ROLE;

\echo '=================== Campanhas (modelo 025): múltiplos cards por campanha ==================='
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
INSERT INTO public.campaigns (tenant_id, name, status, start_at, no_end_date, display_order)
VALUES (:'ta', 'Campanha Fim de Semana A', 'ACTIVE', NOW()-interval '1 hour', true, 0) RETURNING id AS cmp_a \gset
INSERT INTO public.campaign_cards (campaign_id, tenant_id, display_order, model, media_type, media_url, video_duration, title, auto_overlay, destination_type, product_id)
VALUES (:'cmp_a', :'ta', 3, 'FULL_MEDIA', 'VIDEO', 'https://cdn.test/c3.mp4', 9.5, 'Card 3', false, 'PRODUCT', :'pa1') RETURNING id AS cc3 \gset
INSERT INTO public.campaign_cards (campaign_id, tenant_id, display_order, model, media_type, media_url, title, auto_overlay)
VALUES (:'cmp_a', :'ta', 1, 'PROMO_CARD', 'IMAGE', 'https://cdn.test/c1.jpg', 'Card 1', true) RETURNING id AS cc1 \gset
INSERT INTO public.campaign_cards (campaign_id, tenant_id, display_order, model, media_type, media_url, title)
VALUES (:'cmp_a', :'ta', 2, 'OFFER_CARD', 'IMAGE', 'https://cdn.test/c2.jpg', 'Card 2') RETURNING id AS cc2 \gset
SET ROLE anon;
SELECT tests.ok((SELECT array_agg((c->>'id')::uuid ORDER BY ord) FROM jsonb_array_elements(tests.campaign_json('adega-a', :'cmp_a')->'cards') WITH ORDINALITY t(c, ord))
  = ARRAY[:'cc1', :'cc2', :'cc3']::uuid[], 'S: campanha com 3 cards na vitrine, ordenados por display_order');
SELECT tests.ok((SELECT c FROM jsonb_array_elements(tests.campaign_json('adega-a', :'cmp_a')->'cards') c WHERE (c->>'id')::uuid = :'cc3')
  @> jsonb_build_object('mediaType','VIDEO','videoDuration',9.5,'autoOverlay',false,'destinationType','PRODUCT','product',jsonb_build_object('id',:'pa1')), 'R: card de vídeo da campanha com duração real e produto do mesmo tenant');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
SELECT tests.affected(format($s$UPDATE public.campaign_cards SET is_active=false WHERE tenant_id=%L AND id=%L$s$, :'ta', :'cc2')) AS card2_off;
SET ROLE anon;
SELECT tests.ok(jsonb_array_length(tests.campaign_json('adega-a', :'cmp_a')->'cards') = 2, 'I/J: card desativado da campanha some; os outros continuam');
RESET ROLE;
UPDATE public.campaigns SET status = 'PAUSED' WHERE id = :'cmp_a';
SET ROLE anon;
SELECT tests.ok(tests.campaign_json('adega-a', :'cmp_a') IS NULL, 'I/J: campanha PAUSED não aparece');
RESET ROLE;
UPDATE public.campaigns SET status = 'SCHEDULED', start_at = NOW()+interval '1 hour' WHERE id = :'cmp_a';
SET ROLE anon;
SELECT tests.ok(tests.campaign_json('adega-a', :'cmp_a') IS NULL, 'K/L: campanha agendada para o futuro não aparece');
RESET ROLE;
UPDATE public.campaigns SET start_at = NOW()-interval '1 minute' WHERE id = :'cmp_a';
SET ROLE anon;
SELECT tests.ok(tests.campaign_json('adega-a', :'cmp_a') IS NOT NULL, 'M/N: campanha SCHEDULED aparece quando chega o início');
RESET ROLE;
UPDATE public.campaigns SET no_end_date = false, end_at = NOW()-interval '1 second' WHERE id = :'cmp_a';
SET ROLE anon;
SELECT tests.ok(tests.campaign_json('adega-a', :'cmp_a') IS NULL, 'O/P: campanha expirada não aparece');
RESET ROLE;
UPDATE public.campaigns SET status='ACTIVE', no_end_date = true, end_at = NULL WHERE id = :'cmp_a';

\echo '=================== T: isolamento entre tenants ==================='
SET ROLE anon;
SELECT tests.ok(NOT (tests.all_ids('adega-b') && ARRAY[:'o_img', :'o_vid', :'o_first', :'cmp_a', :'cc1', :'cc3', :'pa1']::uuid[]), 'T: vitrine B não contém nenhum card, campanha ou produto de A');
SELECT tests.ok(NOT (tests.all_ids('adega-a') && ARRAY[:'pb1']::uuid[]), 'T: vitrine A não contém produto de B');
SELECT tests.ok((SELECT bool_and((e->>'tenantId')::uuid = :'ta'::uuid) FROM jsonb_array_elements(tests.store('adega-a')->'offers') e), 'T: todo card da vitrine A tem tenantId = A');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}',false);
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.offers WHERE tenant_id = :'ta'), 'T: owner B não lê cards de A');
SELECT tests.ok(NOT EXISTS (SELECT 1 FROM public.campaign_cards WHERE tenant_id = :'ta'), 'T: owner B não lê campaign_cards de A');
SELECT tests.throws(format($s$INSERT INTO public.offers (tenant_id, title, image_url) VALUES (%L,'B invade A','https://x')$s$, :'ta'), '42501', 'T: owner B não cria card no tenant A (RLS)');
SELECT tests.ok(tests.affected(format($s$UPDATE public.offers SET title='hack' WHERE id=%L$s$, :'o_img')) = 0, 'T: owner B não altera card de A (0 linhas)');
SELECT tests.ok(tests.affected(format($s$DELETE FROM public.offers WHERE id=%L$s$, :'o_img')) = 0, 'T: owner B não exclui card de A (0 linhas)');
SELECT tests.throws(format($s$INSERT INTO public.campaign_cards (campaign_id, tenant_id, media_url) VALUES (%L,%L,'https://x')$s$, :'cmp_a', :'tb'), '23514', 'T: B não injeta card na campanha de A (trigger de consistência)');
SELECT tests.throws(format($s$INSERT INTO public.offers (tenant_id, title, image_url, product_id) VALUES (%L,'B usa produto A','https://x',%L)$s$, :'tb', :'pa1'), '23514', 'T: B não vincula produto de A ao próprio card');
INSERT INTO public.campaigns (tenant_id, name, status) VALUES (:'tb', 'Campanha B', 'ACTIVE') RETURNING id AS cmp_b \gset
INSERT INTO public.campaign_cards (campaign_id, tenant_id, media_url, coupon_id) VALUES (:'cmp_b', :'tb', 'https://cdn.test/b.jpg', :'cpb') RETURNING id AS ccb \gset
SELECT tests.ok(:'ccb' IS NOT NULL, 'T: B cria card na própria campanha com o próprio cupom');
RESET ROLE;
INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value, usage_limit)
VALUES (:'ta', 'DEZ-A', 'PERCENTAGE', 10, 5) RETURNING id AS cpa \gset
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
SELECT tests.throws(format($s$INSERT INTO public.campaign_cards (campaign_id, tenant_id, media_url, coupon_id) VALUES (%L,%L,'https://x',%L)$s$, :'cmp_a', :'ta', :'cpb'), '23514', 'T: A não vincula cupom de B ao card (cupom de outro tenant nunca chega à vitrine)');
SELECT tests.affected(format($s$UPDATE public.campaign_cards SET coupon_id=%L WHERE id=%L$s$, :'cpa', :'cc1')) AS cupom_a_no_card;
RESET ROLE;
SET ROLE anon;
SELECT tests.ok((SELECT c->'coupon'->>'code' FROM jsonb_array_elements(tests.campaign_json('adega-a', :'cmp_a')->'cards') c WHERE (c->>'id')::uuid = :'cc1') = 'DEZ-A', 'Cupom exibido pelo card de campanha é do próprio tenant');
SELECT tests.ok(position('SEGREDO-B' in tests.store('adega-a')::text) = 0, 'T: código de cupom de B nunca aparece na vitrine A');
RESET ROLE;

\echo '=================== Anon não escreve ==================='
SET ROLE anon;
SELECT tests.throws(format($s$INSERT INTO public.offers (tenant_id, title, image_url) VALUES (%L,'anon','https://x')$s$, :'ta'), '42501', 'anon não cria card (offers)');
SELECT tests.throws(format($s$INSERT INTO public.campaigns (tenant_id, name) VALUES (%L,'anon')$s$, :'ta'), '42501', 'anon não cria campanha');
SELECT tests.throws(format($s$INSERT INTO public.campaign_cards (campaign_id, tenant_id, media_url) VALUES (%L,%L,'https://x')$s$, :'cmp_a', :'ta'), '42501', 'anon não cria campaign_card');
SELECT tests.throws($s$SELECT * FROM public.campaign_cards$s$, '42501', 'anon não lê campaign_cards diretamente (só via get_public_store)');
RESET ROLE;

\echo '=================== Storage: upload de mídia no bucket marketing (caminho {tenant}/cards/...) ==================='
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
SELECT tests.ok(tests.affected(format($s$INSERT INTO storage.objects (bucket_id, name) VALUES ('marketing', %L)$s$, :'ta' || '/cards/x/1.mp4')) = 1, 'Upload: owner A grava em marketing/{tenantA}/cards/... (caminho novo do offerRepository.uploadMedia)');
SELECT tests.throws(format($s$INSERT INTO storage.objects (bucket_id, name) VALUES ('catalog', %L)$s$, 'marketing/' || :'ta' || '/cards/x/1.mp4'), '42501', 'Upload: caminho antigo catalog/marketing/{tenant}/... era NEGADO (causa do fallback base64)');
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}',false);
SELECT tests.throws(format($s$INSERT INTO storage.objects (bucket_id, name) VALUES ('marketing', %L)$s$, :'ta' || '/cards/x/2.mp4'), '42501', 'Upload: owner B não grava na pasta do tenant A');
RESET ROLE;

\echo '=================== Checkout promocional (FK + regras do card + cupom no servidor) ==================='
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
INSERT INTO public.offers (tenant_id, title, media_type, media_url, image_url, display_order, is_active, start_at,
  destination_type, has_promo_checkout, promo_title, promo_price, promo_original_price, promo_unit, promo_min_quantity,
  promo_max_quantity_per_customer, promo_fulfillment_types, promo_payment_methods, promo_usage_limit, promotional_price, original_price, auto_overlay)
VALUES (:'ta', 'Combo Promo A', 'IMAGE', 'https://cdn.test/combo.jpg', 'https://cdn.test/combo.jpg', 3, true, NOW()-interval '1 minute',
  'CUSTOM_OFFER', true, 'Combo 2 cervejas', 20.00, 30.00, 'combo', 1, 3, '["DELIVERY","PICKUP"]', '["PIX","CASH"]', 3, 20.00, 30.00, true)
RETURNING id AS o_chk \gset
RESET ROLE;
SET ROLE anon;
SELECT tests.ok(tests.offer_json('adega-a', :'o_chk') @> '{"destinationType":"CUSTOM_OFFER","hasPromoCheckout":true,"promoPrice":20.00,"promoMaxQuantityPerCustomer":3,"promoUsageLimit":3,"remainingUses":3,"isExhausted":false}'::jsonb,
  'Card com checkout próprio chega à vitrine com dados de CTA/checkout');
SELECT tests.throws(format($s$SELECT public.process_promotional_checkout_atomic('adega-a', %L, 1, 'Cli', '11988887777', NULL, 'Rua X, 1', '{}'::jsonb, 'PIX', 'DELIVERY')$s$, :'o_chk'), '42501', 'Checkout: anon não executa a RPC (EXECUTE revogado)');
RESET ROLE;
SELECT count(*) AS orders_before FROM public.orders WHERE tenant_id = :'ta' \gset
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c1","email":"cliente@test.local","role":"authenticated"}',false);
SELECT public.process_promotional_checkout_atomic('adega-a', :'o_chk', 2, 'Cliente Teste', '+5511988887777', 'cliente@test.local',
  'Rua do Cliente, 10', '{"street":"Rua do Cliente","number":"10"}'::jsonb, 'PIX', 'DELIVERY', 'sem gelo', NULL) AS r1 \gset
SELECT tests.ok((:'r1'::jsonb->>'success')::boolean AND (:'r1'::jsonb->>'total_amount')::numeric = 45.00, 'Checkout: pedido criado (2 x 20,00 + taxa 5,00 = 45,00) — antes da 027 falhava por FK card_id');
SELECT (:'r1'::jsonb->>'order_id') AS ord1 \gset
SELECT tests.ok((SELECT id FROM jsonb_to_record(public.get_customer_order_by_id(:'ord1')) AS x(id uuid)) = :'ord1'::uuid, 'Checkout: cliente consegue reler o pedido via get_customer_order_by_id (usado pelo frontend)');
RESET ROLE;
SELECT tests.ok((:'r1'::jsonb->>'order_number')::int = (SELECT order_number FROM public.orders WHERE id = (:'r1'::jsonb->>'order_id')::uuid), 'Checkout: RPC retorna order_number real do pedido (usado pelo frontend se a releitura falhar)');
SELECT tests.ok((SELECT offer_id = :'o_chk'::uuid AND origin = 'promotional_checkout' AND tenant_id = :'ta'::uuid FROM public.orders WHERE id = :'ord1'), 'Checkout: orders.offer_id aponta para o card e tenant correto');
SELECT tests.ok((SELECT offer_id = :'o_chk'::uuid AND product_id IS NULL AND quantity = 2 AND unit_price = 20.00 FROM public.order_items WHERE order_id = :'ord1'), 'Checkout: order_items.offer_id preenchido, product_id NULL (card visual sem produto)');
SELECT tests.ok((SELECT card_id IS NULL AND offer_id = :'o_chk'::uuid FROM public.campaign_analytics_events WHERE order_id = :'ord1' AND event_type = 'CHECKOUT_COMPLETED'), 'Checkout: analytics com card_id NULL e offer_id = card (FK correta)');
SELECT tests.ok((SELECT promo_times_used FROM public.offers WHERE id = :'o_chk') = 1, 'Checkout: contador de usos do card incrementado');
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c1","email":"cliente@test.local","role":"authenticated"}',false);
SELECT tests.throws(format($s$SELECT public.process_promotional_checkout_atomic('adega-a', %L, 1, 'Cli', '11988887777', NULL, 'Rua X, 1', '{}'::jsonb, 'CREDIT_CARD', 'DELIVERY')$s$, :'o_chk'), 'P0001', 'Checkout: forma de pagamento não permitida pelo card é recusada');
SELECT tests.throws(format($s$SELECT public.process_promotional_checkout_atomic('adega-a', %L, 4, 'Cli', '11988887777', NULL, 'Rua X, 1', '{}'::jsonb, 'PIX', 'DELIVERY')$s$, :'o_chk'), 'P0001', 'Checkout: quantidade acima do máximo do card é recusada');
SELECT tests.throws(format($s$SELECT public.process_promotional_checkout_atomic('adega-b', %L, 1, 'Cli', '11988887777', NULL, 'Rua X, 1', '{}'::jsonb, 'PIX', 'DELIVERY')$s$, :'o_chk'), 'P0001', 'Checkout: card de A não pode ser comprado pelo slug de B');
SELECT tests.throws(format($s$SELECT public.process_promotional_checkout_atomic('adega-a', %L, 1, 'Cli', '11988887777', NULL, 'Rua X, 1', '{}'::jsonb, 'PIX', 'DELIVERY')$s$, :'o_first'), 'P0001', 'Checkout: card sem checkout próprio é recusado');
SELECT tests.throws(format($s$SELECT public.process_promotional_checkout_atomic('adega-a', %L, 1, 'Cli', '11988887777', NULL, 'Rua X, 1', '{}'::jsonb, 'PIX', 'DELIVERY', NULL, 'NAO-EXISTE')$s$, :'o_chk'), 'P0001', 'Checkout: cupom inexistente => pedido recusado (sem desconto fantasma)');
SELECT tests.throws(format($s$SELECT public.process_promotional_checkout_atomic('adega-a', %L, 1, 'Cli', '11988887777', NULL, 'Rua X, 1', '{}'::jsonb, 'PIX', 'DELIVERY', NULL, 'SEGREDO-B')$s$, :'o_chk'), 'P0001', 'Checkout: cupom de outro tenant é recusado');
RESET ROLE;
SELECT tests.ok((SELECT count(*) FROM public.orders WHERE tenant_id = :'ta') = :orders_before + 1, 'Checkout: tentativas recusadas não deixaram pedidos parciais (rollback)');
SELECT tests.ok((SELECT promo_times_used FROM public.offers WHERE id = :'o_chk') = 1, 'Checkout: tentativas recusadas não consumiram usos do card');
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c1","email":"cliente@test.local","role":"authenticated"}',false);
SELECT public.process_promotional_checkout_atomic('adega-a', :'o_chk', 1, 'Cliente Teste', '11988887777', NULL,
  NULL, '{}'::jsonb, 'CASH', 'PICKUP', NULL, ' dez-a ') AS r2 \gset
RESET ROLE;
SELECT tests.ok((:'r2'::jsonb->>'discount')::numeric = 2.00 AND (:'r2'::jsonb->>'total_amount')::numeric = 18.00, 'Cupom: aplicado no servidor (10% de 20,00 = 2,00; retirada sem taxa; total 18,00)');
SELECT tests.ok((SELECT discount = 2.00 AND total_amount = 18.00 AND coupon_code = 'DEZ-A' FROM public.orders WHERE id = (:'r2'::jsonb->>'order_id')::uuid), 'Cupom: pedido gravado com desconto e código do cupom');
SELECT tests.ok((SELECT times_used FROM public.coupons WHERE id = :'cpa') = 1 AND EXISTS (SELECT 1 FROM public.coupon_redemptions WHERE coupon_id = :'cpa' AND order_id = (:'r2'::jsonb->>'order_id')::uuid), 'Cupom: uso atômico registrado (times_used + coupon_redemptions)');
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c1","email":"cliente@test.local","role":"authenticated"}',false);
SELECT public.process_promotional_checkout_atomic('adega-a', :'o_chk', 1, 'Cliente Teste', '11988887777', NULL, NULL, '{}'::jsonb, 'PIX', 'PICKUP') AS r3 \gset
SELECT tests.ok((:'r3'::jsonb->>'is_exhausted')::boolean, 'Limite de usos: 3º uso marca o card como esgotado');
SELECT tests.throws(format($s$SELECT public.process_promotional_checkout_atomic('adega-a', %L, 1, 'Cli', '11988887777', NULL, NULL, '{}'::jsonb, 'PIX', 'PICKUP')$s$, :'o_chk'), 'P0001', 'Limite de usos: 4º pedido recusado (esgotado)');
RESET ROLE;
SET ROLE anon;
SELECT tests.ok(tests.offer_json('adega-a', :'o_chk') @> '{"isExhausted":true,"remainingUses":0}'::jsonb, 'Vitrine informa card esgotado');
RESET ROLE;
UPDATE public.offers SET start_at = NOW() + interval '1 hour' WHERE id = :'o_chk';
UPDATE public.offers SET promo_usage_limit = NULL WHERE id = :'o_chk';
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c1","email":"cliente@test.local","role":"authenticated"}',false);
SELECT tests.throws(format($s$SELECT public.process_promotional_checkout_atomic('adega-a', %L, 1, 'Cli', '11988887777', NULL, NULL, '{}'::jsonb, 'PIX', 'PICKUP')$s$, :'o_chk'), 'P0001', 'Checkout: card agendado (ainda não iniciado) é recusado');
RESET ROLE;

\echo '=================== Card legado/seed com produto e destino BANNER_ONLY ==================='
INSERT INTO public.offers (tenant_id, title, image_url, product_id, destination_type, is_active)
VALUES (:'ta', 'Legado com produto', 'https://cdn.test/leg.jpg', :'pa1', 'BANNER_ONLY', true) RETURNING id AS o_leg \gset
SET ROLE anon;
SELECT tests.ok(tests.offer_json('adega-a', :'o_leg') @> jsonb_build_object('destinationType','PRODUCT','productId',:'pa1'), 'Card legado com produto vinculado é exposto como PRODUCT (regra do backfill da 026)');
RESET ROLE;

\echo '=================== Slug inexistente / inativo ==================='
SET ROLE anon;
SELECT tests.throws($s$SELECT public.get_public_store('nao-existe')$s$, 'P0001', 'Slug inexistente gera erro explícito (não vitrine de outro tenant)');
RESET ROLE;

\echo '=================== TODOS OS TESTES PASSARAM ==================='
DROP SCHEMA tests CASCADE;
