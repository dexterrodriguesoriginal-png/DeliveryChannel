-- Varredura RLS/multi-tenant: TODAS as tabelas novas × TODOS os papéis (+ anon). F2 incluso.
DO $sweep$
DECLARE
    v_tables TEXT[] := ARRAY['tenant_payment_settings','coupons','coupon_redemptions','marketing_media_assets',
        'marketing_media_publication_log','promotion_carousels','promotion_carousel_items','campaigns','campaign_cards',
        'campaign_analytics_events'];
    v_users TEXT[][] := ARRAY[
        ['a0000000-0000-0000-0000-000000000001','OWNER_A','om'], ['a0000000-0000-0000-0000-000000000002','MANAGER_A','om'],
        ['a0000000-0000-0000-0000-000000000003','OPERATOR_A','no'], ['a0000000-0000-0000-0000-000000000004','CASHIER_A','no'],
        ['a0000000-0000-0000-0000-000000000005','DRIVER_A','no'], ['a0000000-0000-0000-0000-000000000006','DELIVERY_MANAGER_A','no'],
        ['a0000000-0000-0000-0000-000000000007','CUSTOMER_1','no'], ['a0000000-0000-0000-0000-000000000008','CUSTOMER_2','no'],
        ['b0000000-0000-0000-0000-000000000001','OWNER_B','no'], ['b0000000-0000-0000-0000-000000000004','CASHIER_B','no'],
        ['c0000000-0000-0000-0000-000000000001','CEO','no'], ['c0000000-0000-0000-0000-000000000002','SUPER_ADMIN','no']];
    v_tbl TEXT;
    v_total BIGINT;
    v_seen BIGINT;
    v_mode TEXT;
    i INT;
BEGIN
    FOREACH v_tbl IN ARRAY v_tables LOOP
        PERFORM t.ok((SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_tbl)::regclass), 'RLS habilitada: ' || v_tbl);
        EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = %L', v_tbl, '10000000-0000-0000-0000-00000000000a') INTO v_total;
        PERFORM t.ok(v_total > 0, 'há linhas do tenant A para testar: ' || v_tbl, 'tabela vazia para A; varredura sem efeito');
        FOR i IN 1 .. array_length(v_users, 1) LOOP
            PERFORM set_config('role', 'authenticated', true);
            PERFORM t.login(v_users[i][1]::uuid);
            v_seen := t.visible(format('SELECT 1 FROM public.%I WHERE tenant_id = %L', v_tbl, '10000000-0000-0000-0000-00000000000a'));
            PERFORM set_config('role', 'none', true);
            EXECUTE 'RESET ROLE';
            v_mode := v_users[i][3];
            IF v_mode = 'om' THEN
                PERFORM t.is(v_seen, v_total, format('%s vê todas as %s linhas de A em %s', v_users[i][2], v_total, v_tbl));
            ELSE
                PERFORM t.ok(v_seen <= 0, format('%s NÃO vê linhas de A em %s', v_users[i][2], v_tbl), 'visíveis=' || v_seen);
            END IF;
        END LOOP;
        PERFORM set_config('role', 'anon', true);
        PERFORM t.login(NULL);
        v_seen := t.visible(format('SELECT 1 FROM public.%I', v_tbl));
        EXECUTE 'RESET ROLE';
        PERFORM t.ok(v_seen <= 0, 'anon NÃO vê linhas em ' || v_tbl, 'visíveis=' || v_seen);
    END LOOP;
    -- security_rate_limits: ninguém da API lê
    FOR i IN 1 .. array_length(v_users, 1) LOOP
        PERFORM set_config('role', 'authenticated', true);
        PERFORM t.login(v_users[i][1]::uuid);
        v_seen := t.visible('SELECT 1 FROM public.security_rate_limits');
        EXECUTE 'RESET ROLE';
        PERFORM t.ok(v_seen <= 0, v_users[i][2] || ' não lê security_rate_limits', 'visíveis=' || v_seen);
    END LOOP;
END
$sweep$;

-- Escrita: nenhum papel fora de OWNER/MANAGER de A cria/edita/exclui nas tabelas administráveis de A
DO $w$
DECLARE
    v_users TEXT[] := ARRAY['a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000005',
        'a0000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000007','b0000000-0000-0000-0000-000000000001',
        'c0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002'];
    v_stmts TEXT[] := ARRAY[
        $$INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value) VALUES ('10000000-0000-0000-0000-00000000000a','HACK','FIXED_AMOUNT',1)$$,
        $$INSERT INTO public.campaigns (tenant_id, name) VALUES ('10000000-0000-0000-0000-00000000000a','hack')$$,
        $$INSERT INTO public.promotion_carousels (tenant_id, name) VALUES ('10000000-0000-0000-0000-00000000000a','hack')$$,
        $$INSERT INTO public.tenant_payment_settings (tenant_id) VALUES ('10000000-0000-0000-0000-00000000000a')$$,
        $$INSERT INTO public.campaign_analytics_events (tenant_id, event_type, source, dedupe_key) VALUES ('10000000-0000-0000-0000-00000000000a','PURCHASE','SERVER','hack')$$];
    v_mut TEXT[] := ARRAY[
        $$UPDATE public.coupons SET discount_value = 99 WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'$$,
        $$DELETE FROM public.coupons WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'$$,
        $$UPDATE public.campaigns SET name = 'x' WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'$$,
        $$DELETE FROM public.campaign_cards WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'$$,
        $$UPDATE public.tenant_payment_settings SET pix_enabled = false WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'$$,
        $$DELETE FROM public.marketing_media_assets WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'$$];
    u TEXT; s TEXT; v_ok BOOLEAN; v_n BIGINT; v_before TEXT; v_after TEXT;
BEGIN
    SELECT md5(string_agg(x, ',' ORDER BY x)) INTO v_before FROM (
        SELECT to_jsonb(c)::text x FROM public.coupons c UNION ALL SELECT to_jsonb(k)::text FROM public.campaigns k
        UNION ALL SELECT to_jsonb(d)::text FROM public.campaign_cards d UNION ALL SELECT to_jsonb(p)::text FROM public.tenant_payment_settings p
        UNION ALL SELECT to_jsonb(m)::text FROM public.marketing_media_assets m) z;
    FOREACH u IN ARRAY v_users LOOP
        FOREACH s IN ARRAY v_stmts LOOP
            PERFORM set_config('role', 'authenticated', true);
            PERFORM t.login(u::uuid);
            BEGIN
                EXECUTE s;
                v_ok := false;
            EXCEPTION WHEN OTHERS THEN
                v_ok := true;
            END;
            EXECUTE 'RESET ROLE';
            PERFORM t.ok(v_ok, format('usuário %s não insere: %s', u, left(s, 60)));
        END LOOP;
        FOREACH s IN ARRAY v_mut LOOP
            PERFORM set_config('role', 'authenticated', true);
            PERFORM t.login(u::uuid);
            BEGIN
                EXECUTE s;
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END;
            EXECUTE 'RESET ROLE';
        END LOOP;
    END LOOP;
    SELECT md5(string_agg(x, ',' ORDER BY x)) INTO v_after FROM (
        SELECT to_jsonb(c)::text x FROM public.coupons c UNION ALL SELECT to_jsonb(k)::text FROM public.campaigns k
        UNION ALL SELECT to_jsonb(d)::text FROM public.campaign_cards d UNION ALL SELECT to_jsonb(p)::text FROM public.tenant_payment_settings p
        UNION ALL SELECT to_jsonb(m)::text FROM public.marketing_media_assets m) z;
    PERFORM t.is(v_after, v_before, 'UPDATE/DELETE de 8 papéis não autorizados não alteram nenhuma linha (RLS/grants)');
END
$w$;

-- Isolamento em tabelas antigas de pedidos (sem regressão): OWNER B e CASHIER B não veem pedidos de A
SET ROLE authenticated;
SELECT t.login('b0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible($$SELECT 1 FROM public.orders WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'$$), 0::bigint, 'OWNER B não vê pedidos de A');
SELECT t.is(t.visible($$SELECT 1 FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id WHERE o.tenant_id = '10000000-0000-0000-0000-00000000000a'$$), 0::bigint, 'OWNER B não vê itens de A');
SELECT t.login('b0000000-0000-0000-0000-000000000004');
SELECT t.throws($$SELECT public.update_order_status('0d000000-0000-0000-0000-0000000000a1','CONFIRMED',NULL)$$, 'FORBIDDEN|não encontrado|NOT_FOUND|permiss', 'CASHIER B não altera status de pedido de A');
SELECT t.throws($$SELECT public.process_pos_sale_atomic('10000000-0000-0000-0000-00000000000a','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]','CASH')$$, 'POS_FORBIDDEN', 'CASHIER B não vende no PDV de A');
SELECT t.throws($$SELECT public.get_order_pix_payload('0d000000-0000-0000-0000-0000000000a1')$$, 'FORBIDDEN|NOT_FOUND|não encontrado|permiss', 'CASHIER B não gera PIX de pedido de A');
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT t.throws($$SELECT public.validate_coupon_pos('10000000-0000-0000-0000-00000000000a','DEZ10','[]')$$, 'FORBIDDEN|42501|somente', 'cliente não usa validação de PDV');
RESET ROLE;
-- Grants (vale nos DOIS modos: as migrations precisam revogar explicitamente, porque o Supabase
-- concede ALL a anon/authenticated por default privileges em tabelas/funções novas)
SELECT t.is((SELECT string_agg(DISTINCT table_name || ':' || privilege_type, ', ') FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_schema = 'public'
      AND table_name IN ('security_rate_limits','tenant_payment_settings','coupons','coupon_redemptions','marketing_media_assets',
                         'marketing_media_publication_log','promotion_carousels','promotion_carousel_items','campaigns','campaign_cards',
                         'campaign_analytics_events','n1n6_privileges_backup')), NULL, 'anon sem nenhum privilégio de tabela nas tabelas novas');
SELECT t.is((SELECT string_agg(privilege_type, ',') FROM information_schema.role_table_grants WHERE grantee IN ('anon','authenticated') AND table_schema = 'public'
      AND table_name = 'n1n6_privileges_backup'), NULL, 'backup de privilégios inacessível pela API');
SELECT t.is((SELECT string_agg(DISTINCT table_name || ':' || privilege_type, ', ') FROM information_schema.role_table_grants WHERE grantee = 'authenticated' AND table_schema = 'public'
      AND ((table_name IN ('security_rate_limits','coupon_redemptions','marketing_media_publication_log','campaign_analytics_events','marketing_media_assets','tenant_payment_settings')
            AND privilege_type <> 'SELECT') OR privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER'))
      AND table_name IN ('security_rate_limits','tenant_payment_settings','coupons','coupon_redemptions','marketing_media_assets',
                         'marketing_media_publication_log','promotion_carousels','promotion_carousel_items','campaigns','campaign_cards',
                         'campaign_analytics_events')), NULL, 'authenticated: tabelas de log/servidor só SELECT (via RLS); sem TRUNCATE/REFERENCES/TRIGGER');
SELECT t.is((SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.oid::regprocedure::text NOT IN (SELECT sig FROM t.fn_before)
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
       AND p.proname NOT IN ('track_campaign_event')), NULL, 'funções novas executáveis por anon: somente track_campaign_event');
SELECT t.is((SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE '\_%'
       AND p.oid::regprocedure::text NOT IN (SELECT sig FROM t.fn_before)
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE')), NULL, 'nenhuma função interna (_*) nova executável por authenticated');
SELECT t.is((SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('process_checkout_atomic','get_customer_order_by_id','seed_tenant_demo_catalog',
           'process_checkout_atomic_v2','process_pos_sale_atomic','process_promotional_checkout_atomic','update_order_status','update_order_payment_status',
           'get_order_pix_payload','upsert_tenant_payment_settings','validate_coupon','validate_coupon_pos','get_campaign_metrics','get_promo_offer_performance')
       AND has_function_privilege('anon', p.oid, 'EXECUTE')), NULL, 'RPCs de compra/pedido/admin não executáveis por anon (toda compra exige auth)');
