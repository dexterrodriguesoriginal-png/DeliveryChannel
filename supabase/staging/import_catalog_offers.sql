-- IMPORT EM STAGING (F6). Chamado por import_catalog_offers.sh (executado dentro do diretório dos CSVs).
-- Transação única (psql -1). Não apaga nem atualiza nada no destino.
\set ON_ERROR_STOP 1
DO $guard$
BEGIN
    IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 20
       OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version > '20260929000020') THEN
        RAISE EXCEPTION 'F6: o destino precisa estar em exatamente 001–020 (antes de N1–N6); abortado.';
    END IF;
END
$guard$;
CREATE TEMP TABLE imp_categories (id uuid, tenant_slug text, name text, description text, image_url text, display_order int, is_active boolean) ON COMMIT DROP;
CREATE TEMP TABLE imp_products (id uuid, tenant_slug text, category_id uuid, name text, description text, image_url text, price numeric, promotional_price numeric, sku text, unit text, stock_quantity int, min_stock_alert int, is_active boolean, is_featured boolean) ON COMMIT DROP;
CREATE TEMP TABLE imp_offers (id uuid, tenant_slug text, product_id uuid, title text, subtitle text, description text, badge text, discount_percentage int, original_price numeric, promotional_price numeric, image_url text, internal_link text, display_order int, start_date date, end_date date, background_color text, accent_color text, is_active boolean) ON COMMIT DROP;
-- \copy (lado do cliente): os CSVs são lidos do diretório corrente (o .sh faz cd para ele)
\copy imp_categories FROM 'categories.csv' WITH (FORMAT csv, HEADER true)
\copy imp_products FROM 'products.csv' WITH (FORMAT csv, HEADER true)
\copy imp_offers FROM 'offers.csv' WITH (FORMAT csv, HEADER true)
DO $val$
DECLARE v TEXT;
BEGIN
    SELECT string_agg(DISTINCT s, ', ') INTO v FROM (SELECT tenant_slug s FROM imp_categories UNION SELECT tenant_slug FROM imp_products UNION SELECT tenant_slug FROM imp_offers) x
    WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.slug = x.s);
    IF v IS NOT NULL THEN RAISE EXCEPTION 'F6: slugs inexistentes em staging: % (crie os tenants antes).', v; END IF;
    SELECT string_agg(o.id::text, ', ') INTO v FROM imp_offers o
    WHERE o.product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM imp_products p WHERE p.id = o.product_id)
      AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = o.product_id);
    IF v IS NOT NULL THEN RAISE EXCEPTION 'F6: ofertas apontam produtos não exportados: % (inclua o slug do tenant dono do produto).', v; END IF;
    SELECT string_agg(x.id::text, ', ') INTO v FROM (
        SELECT i.id FROM imp_categories i JOIN public.categories c ON c.id = i.id JOIN public.tenants t ON t.id = c.tenant_id WHERE t.slug <> i.tenant_slug
        UNION ALL SELECT i.id FROM imp_products i JOIN public.products c ON c.id = i.id JOIN public.tenants t ON t.id = c.tenant_id WHERE t.slug <> i.tenant_slug
        UNION ALL SELECT i.id FROM imp_offers i JOIN public.offers c ON c.id = i.id JOIN public.tenants t ON t.id = c.tenant_id WHERE t.slug <> i.tenant_slug) x;
    IF v IS NOT NULL THEN RAISE EXCEPTION 'F6: UUIDs já existem em staging com outro tenant: %', v; END IF;
END
$val$;
INSERT INTO public.categories (id, tenant_id, name, description, image_url, display_order, is_active)
SELECT i.id, t.id, i.name, i.description, i.image_url, COALESCE(i.display_order, 0), COALESCE(i.is_active, true)
FROM imp_categories i JOIN public.tenants t ON t.slug = i.tenant_slug ON CONFLICT (id) DO NOTHING;
INSERT INTO public.products (id, tenant_id, category_id, name, description, image_url, price, promotional_price, cost_price, sku, unit,
                             stock_quantity, min_stock_alert, is_active, is_featured)
SELECT i.id, t.id, i.category_id, i.name, i.description, i.image_url, i.price, i.promotional_price, NULL, i.sku, COALESCE(i.unit, 'un'),
       COALESCE(i.stock_quantity, 0), i.min_stock_alert, COALESCE(i.is_active, true), COALESCE(i.is_featured, false)
FROM imp_products i JOIN public.tenants t ON t.slug = i.tenant_slug ON CONFLICT (id) DO NOTHING;
INSERT INTO public.offers (id, tenant_id, product_id, title, subtitle, description, badge, discount_percentage, original_price, promotional_price,
                           image_url, internal_link, display_order, start_date, end_date, background_color, accent_color, is_active)
SELECT i.id, t.id, i.product_id, i.title, i.subtitle, i.description, i.badge, i.discount_percentage, i.original_price, i.promotional_price,
       i.image_url, i.internal_link, COALESCE(i.display_order, 0), i.start_date, i.end_date, i.background_color, i.accent_color, COALESCE(i.is_active, true)
FROM imp_offers i JOIN public.tenants t ON t.slug = i.tenant_slug ON CONFLICT (id) DO NOTHING;
SELECT 'categories' AS tabela, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.categories c WHERE c.id = i.id)) AS presentes, count(*) AS no_csv FROM imp_categories i
UNION ALL SELECT 'products', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.products c WHERE c.id = i.id)), count(*) FROM imp_products i
UNION ALL SELECT 'offers', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.offers c WHERE c.id = i.id)), count(*) FROM imp_offers i;
SELECT count(*) AS ofertas_com_vinculo_invalido_entre_tenants FROM public.offers o JOIN public.products p ON p.id = o.product_id WHERE p.tenant_id <> o.tenant_id;
