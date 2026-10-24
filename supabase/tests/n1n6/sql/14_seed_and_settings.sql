-- F3: auto-seed demo mantido para lojas novas; autorização corrigida.
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000007');
SELECT t.throws($$SELECT public.seed_tenant_demo_catalog('10000000-0000-0000-0000-00000000000b')$$, 'DEMO_SEED_FORBIDDEN|permission denied', 'F3: cliente não semeia catálogo de outra loja');
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.throws($$SELECT public.seed_tenant_demo_catalog('10000000-0000-0000-0000-00000000000b')$$, 'DEMO_SEED_FORBIDDEN|permission denied', 'F3: OWNER de A não semeia B');
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.throws($$SELECT public.seed_tenant_demo_catalog('10000000-0000-0000-0000-00000000000a')$$, 'DEMO_SEED_FORBIDDEN|permission denied', 'F3: CASHIER não semeia');
SELECT t.login('c0000000-0000-0000-0000-000000000001');
SELECT t.throws($$SELECT public.seed_tenant_demo_catalog('10000000-0000-0000-0000-00000000000a')$$, 'DEMO_SEED_FORBIDDEN|permission denied', 'F3: CEO não semeia (escopado)');
SELECT t.throws($$SELECT public._seed_tenant_demo_catalog_internal('10000000-0000-0000-0000-00000000000a')$$, 'permission denied', 'função interna sem EXECUTE');
RESET ROLE;
SET ROLE anon;
SELECT t.login(NULL);
SELECT t.throws($$SELECT public.seed_tenant_demo_catalog('10000000-0000-0000-0000-00000000000a')$$, 'permission denied', 'anon sem EXECUTE no seed');
RESET ROLE;
-- auto-seed de loja nova continua (trigger)
INSERT INTO public.tenants (id, slug, name, document, phone, email, status)
VALUES ('10000000-0000-0000-0000-00000000000c','adega-c','Adega C','00000000000191','1100','c@test.local','ACTIVE');
SELECT t.ok((SELECT count(*) FROM public.products WHERE tenant_id='10000000-0000-0000-0000-00000000000c' AND is_demo) = 0, 'F3 (demo pack 20261024003500): inserção direta de loja não semeia; seed só via create_tenant_for_current_user');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.offers o JOIN public.products p ON p.id = o.product_id
    WHERE o.tenant_id='10000000-0000-0000-0000-00000000000c' AND p.tenant_id <> o.tenant_id), 'F3: seed só usa o próprio tenant');
