-- Integridade da migração: nada existente foi alterado; F1 opção A; PIX copiado; prep_time NULL.
SELECT t.ok(NOT EXISTS (
    SELECT 1 FROM t.snap s LEFT JOIN public.offers o ON o.id::text = s.id
    WHERE s.tbl = 'offers' AND (o.id IS NULL OR (SELECT jsonb_object_agg(k, to_jsonb(o) -> k) FROM jsonb_object_keys(s.data) k) <> s.data)),
    'offers: nenhuma oferta existente alterada ou removida (F1 opção A, decisão 5)');
SELECT t.is((SELECT count(*) FROM public.offers WHERE id::text IN (SELECT id FROM t.snap WHERE tbl='offers')), (SELECT count(*) FROM t.snap WHERE tbl='offers'), 'offers: contagem preservada');
SELECT t.ok(NOT EXISTS (
    SELECT 1 FROM t.snap s LEFT JOIN public.orders o ON o.id::text = s.id
    WHERE s.tbl = 'orders' AND (o.id IS NULL OR (SELECT jsonb_object_agg(k, to_jsonb(o) -> k) FROM jsonb_object_keys(s.data) k) <> s.data)),
    'orders: pedidos existentes intactos');
SELECT t.ok(NOT EXISTS (
    SELECT 1 FROM t.snap s LEFT JOIN public.order_items o ON o.id::text = s.id
    WHERE s.tbl = 'order_items' AND (o.id IS NULL OR (SELECT jsonb_object_agg(k, to_jsonb(o) -> k) FROM jsonb_object_keys(s.data) k) <> s.data)),
    'order_items: itens existentes intactos');
SELECT t.ok(NOT EXISTS (
    SELECT 1 FROM t.snap s LEFT JOIN public.customers o ON o.id::text = s.id
    WHERE s.tbl = 'customers' AND (o.id IS NULL OR (SELECT jsonb_object_agg(k, to_jsonb(o) -> k) FROM jsonb_object_keys(s.data) k) <> s.data)),
    'customers: clientes existentes intactos');
SELECT t.ok(NOT EXISTS (
    SELECT 1 FROM t.snap s LEFT JOIN public.order_status_history o ON o.id::text = s.id
    WHERE s.tbl = 'order_status_history' AND (o.id IS NULL OR (SELECT jsonb_object_agg(k, to_jsonb(o) -> k) FROM jsonb_object_keys(s.data) k) <> s.data)),
    'order_status_history: histórico intacto');
SELECT t.ok(NOT EXISTS (
    SELECT 1 FROM t.snap s LEFT JOIN public.products o ON o.id::text = s.id
    WHERE s.tbl = 'products' AND (o.id IS NULL OR (SELECT jsonb_object_agg(k, to_jsonb(o) -> k) FROM jsonb_object_keys(s.data) k) <> s.data)),
    'products: produtos intactos após migração');
SELECT t.ok(NOT EXISTS (
    SELECT 1 FROM t.snap s LEFT JOIN public.tenant_settings o ON o.id::text = s.id
    WHERE s.tbl = 'tenant_settings' AND (o.id IS NULL OR (SELECT jsonb_object_agg(k, to_jsonb(o) -> k) FROM jsonb_object_keys(s.data) k) <> s.data)),
    'tenant_settings: linhas intactas (pix_key legado preservado)');
SELECT t.ok((SELECT count(*) FROM public.orders WHERE prep_time_minutes IS NOT NULL AND id::text IN (SELECT id FROM t.snap WHERE tbl='orders')) = 0,
    'prep_time: histórico NULL (decisão 34)');
SELECT t.ok((SELECT column_default FROM information_schema.columns WHERE table_name='orders' AND column_name='prep_time_minutes') IS NULL,
    'prep_time: sem default 30');
SELECT t.ok((SELECT column_default FROM information_schema.columns WHERE table_name='tenant_settings' AND column_name='default_prep_time_minutes') IS NULL,
    'default_prep_time_minutes: sem default');
-- F1-A: FK composta NOT VALID e oferta cruzada continua no banco
SELECT t.ok((SELECT NOT convalidated FROM pg_constraint WHERE conname='offers_product_same_tenant'), 'F1: offers_product_same_tenant criada NOT VALID');
SELECT t.ok(EXISTS (SELECT 1 FROM public.offers WHERE id='e0000000-0000-0000-0000-0000000000a9' AND product_id='d0000000-0000-0000-0000-0000000000b1'),
    'F1: vínculo inválido legado não foi corrigido/apagado');
SELECT t.throws($$INSERT INTO public.offers (tenant_id, product_id, title, image_url) VALUES ('10000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000b1','nova cruzada','x')$$,
    'offers_product_same_tenant', 'F1: nova oferta cruzando tenants é recusada');
SELECT t.lives($$UPDATE public.offers SET title = title WHERE id='e0000000-0000-0000-0000-0000000000a9'$$, 'F1: editar outros campos da oferta legada continua possível');
-- PIX copiado (INSERT), chave inválida não habilitada
SELECT t.ok((SELECT pix_enabled AND pix_key_type='CPF' AND pix_key='52998224725' AND pix_merchant_name='Adega Acida Teste' AND pix_merchant_city='Sao Paulo'
             FROM public.tenant_payment_settings WHERE tenant_id='10000000-0000-0000-0000-00000000000a'), 'PIX: chave CPF válida copiada e habilitada, nome/cidade ASCII');
SELECT t.ok((SELECT NOT pix_enabled AND pix_key_type IS NULL FROM public.tenant_payment_settings WHERE tenant_id='10000000-0000-0000-0000-00000000000b'),
    'PIX: chave inválida copiada mas NÃO habilitada');
-- Registro das versões
SELECT t.ok((SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version > '20260929000020') >= 1, 'versões N registradas após 020');
-- Nenhuma coluna de IP nas tabelas novas
SELECT t.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
    AND c.table_name IN ('security_rate_limits','tenant_payment_settings','coupons','coupon_redemptions','marketing_media_assets',
        'marketing_media_publication_log','promotion_carousels','promotion_carousel_items','campaigns','campaign_cards','campaign_analytics_events')
    AND c.column_name ~* '(^|_)ip(_|$)'), 'decisão 38: nenhuma coluna de IP nas tabelas novas');
-- Todas as funções novas DEFINER com search_path fixo
SELECT t.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef
    AND (p.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))),
    'toda função SECURITY DEFINER tem search_path fixo');
-- Nenhuma função interna (_*) executável por anon/authenticated
SELECT t.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '\_%'
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
    'funções internas (_*) sem EXECUTE para anon/authenticated', (SELECT string_agg(p.proname, ',') FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '\_%'
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))));
