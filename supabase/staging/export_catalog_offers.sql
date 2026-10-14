-- EXPORT SOMENTE LEITURA — executado pelo FUNDADOR na produção (nenhum agente conecta em produção).
-- Uso: psql "<url somente leitura da produção>" -X -f export_catalog_offers.sql   (gera 3 CSVs no diretório corrente)
-- ANTES: troque 'SLUG-1','SLUG-2' pelos slugs desejados nas TRÊS linhas (inclua o slug do tenant dono
-- de qualquer produto referenciado por oferta de outro tenant, para reproduzir o vínculo inválido F1).
-- Sem PII: não lê clientes, pedidos, usuários, tenant_settings (pix_key) nem cost_price.
BEGIN READ ONLY;
\copy (SELECT c.id, t.slug AS tenant_slug, c.name, c.description, c.image_url, c.display_order, c.is_active FROM public.categories c JOIN public.tenants t ON t.id = c.tenant_id WHERE t.slug IN ('SLUG-1','SLUG-2') ORDER BY c.id) TO 'categories.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT p.id, t.slug AS tenant_slug, p.category_id, p.name, p.description, p.image_url, p.price, p.promotional_price, p.sku, p.unit, p.stock_quantity, p.min_stock_alert, p.is_active, p.is_featured FROM public.products p JOIN public.tenants t ON t.id = p.tenant_id WHERE t.slug IN ('SLUG-1','SLUG-2') ORDER BY p.id) TO 'products.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT o.id, t.slug AS tenant_slug, o.product_id, o.title, o.subtitle, o.description, o.badge, o.discount_percentage, o.original_price, o.promotional_price, o.image_url, o.internal_link, o.display_order, o.start_date, o.end_date, o.background_color, o.accent_color, o.is_active FROM public.offers o JOIN public.tenants t ON t.id = o.tenant_id WHERE t.slug IN ('SLUG-1','SLUG-2') ORDER BY o.id) TO 'offers.csv' WITH (FORMAT csv, HEADER true)
COMMIT;
