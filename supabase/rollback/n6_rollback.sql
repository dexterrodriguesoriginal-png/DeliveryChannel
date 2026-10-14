-- ============================================================================
-- ROLLBACK MANUAL DA N6 — NÃO É MIGRATION. NUNCA EXECUTADO AUTOMATICAMENTE.
-- Uso: BEGIN; SET LOCAL n1n6.rollback_confirm = 'N6'; \i supabase/rollback/n6_rollback.sql; COMMIT;
-- Restaura get_public_store com o corpo LITERAL da 001 (md5 normalizado cb6e53c1...) e remove
-- o checkout promocional. Pedidos promocionais já gravados permanecem intactos.
-- Atenção: ao restaurar a 001, a vitrine volta a listar a oferta com vínculo inválido (F1).
-- ============================================================================
DO $rb$
BEGIN
    IF current_setting('n1n6.rollback_confirm', true) IS DISTINCT FROM 'N6' THEN
        RAISE EXCEPTION 'Rollback N6 não confirmado: SET LOCAL n1n6.rollback_confirm = ''N6''.';
    END IF;
END
$rb$;
REVOKE EXECUTE ON FUNCTION public.process_promotional_checkout_atomic(text,uuid,uuid,uuid,integer,text,text,text,jsonb,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.process_promotional_checkout_atomic(text,uuid,uuid,uuid,integer,text,text,text,jsonb,text,text,text,text,uuid);
DROP FUNCTION IF EXISTS public._resolve_promotional_terms(uuid,uuid,uuid,uuid,integer,boolean);

-- Corpo literal da 001
CREATE OR REPLACE FUNCTION public.get_public_store(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant RECORD;
    v_theme RECORD;
    v_settings RECORD;
    v_categories JSONB;
    v_products JSONB;
    v_offers JSONB;
BEGIN
    -- 1. Resolver e validar o tenant pelo slug (apenas ACTIVE)
    SELECT id, slug, name, phone, category, status
    INTO v_tenant
    FROM public.tenants
    WHERE slug = p_slug AND status = 'ACTIVE';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Estabelecimento com slug "%" não encontrado ou inativo', p_slug;
    END IF;

    -- 2. Obter tema visual público
    SELECT store_name, tagline, logo_url, banner_url, primary_color, 
           secondary_color, background_color, card_color, button_color, 
           text_color, border_radius, font_family
    INTO v_theme
    FROM public.tenant_themes
    WHERE tenant_id = v_tenant.id;

    -- 3. Obter configurações operacionais públicas necessárias para a compra/retirada
    SELECT is_open, min_order_value, delivery_fee, free_delivery_threshold,
           estimated_delivery_time, address, city, phone_whatsapp
    INTO v_settings
    FROM public.tenant_settings
    WHERE tenant_id = v_tenant.id;

    -- 4. Obter categorias públicas do tenant
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'tenantId', c.tenant_id,
        'name', c.name,
        'description', c.description,
        'imageUrl', c.image_url,
        'order', c.display_order,
        'isActive', c.is_active
    ) ORDER BY c.display_order ASC), '[]'::jsonb)
    INTO v_categories
    FROM public.categories c
    WHERE c.tenant_id = v_tenant.id AND c.is_active = true;

    -- 5. Obter produtos públicos ativos do tenant
    -- PROTEÇÃO DE PRIVACIDADE: Não expõe cost_price, sku ou stock_quantity detalhado.
    -- O cliente apenas recebe 'isAvailable' (disponível ou indisponível).
    -- PromotionalPrice validado: promotional_price > 0 AND promotional_price <= price.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'tenantId', p.tenant_id,
        'categoryId', p.category_id,
        'name', p.name,
        'description', p.description,
        'imageUrl', p.image_url,
        'price', p.price,
        'promotionalPrice', CASE 
            WHEN p.promotional_price IS NOT NULL AND p.promotional_price > 0 AND p.promotional_price <= p.price 
            THEN p.promotional_price 
            ELSE NULL 
        END,
        'unit', p.unit,
        'isAvailable', (p.stock_quantity > 0 AND p.is_active = true),
        'isActive', p.is_active,
        'isFeatured', p.is_featured
    ) ORDER BY p.name ASC), '[]'::jsonb)
    INTO v_products
    FROM public.products p
    WHERE p.tenant_id = v_tenant.id AND p.is_active = true;

    -- 6. Obter ofertas públicas ativas do tenant dentro da vigência
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'tenantId', o.tenant_id,
        'productId', o.product_id,
        'title', o.title,
        'subtitle', o.subtitle,
        'description', o.description,
        'badge', o.badge,
        'discountPercentage', o.discount_percentage,
        'originalPrice', o.original_price,
        'promotionalPrice', o.promotional_price,
        'imageUrl', o.image_url,
        'internalLink', o.internal_link,
        'order', o.display_order,
        'backgroundColor', o.background_color,
        'accentColor', o.accent_color,
        'isActive', o.is_active
    ) ORDER BY o.display_order ASC), '[]'::jsonb)
    INTO v_offers
    FROM public.offers o
    WHERE o.tenant_id = v_tenant.id 
      AND o.is_active = true
      AND (o.start_date IS NULL OR o.start_date <= CURRENT_DATE)
      AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE);

    -- Montagem do objeto seguro (SEM dados corporativos internos)
    RETURN jsonb_build_object(
        'tenant', jsonb_build_object(
            'id', v_tenant.id,
            'slug', v_tenant.slug,
            'name', v_tenant.name,
            'phone', v_tenant.phone,
            'category', v_tenant.category,
            'status', v_tenant.status
        ),
        'theme', to_jsonb(v_theme),
        'settings', to_jsonb(v_settings),
        'categories', v_categories,
        'products', v_products,
        'offers', v_offers
    );
END;
$$;

DROP FUNCTION IF EXISTS public._public_media_json(uuid,uuid);
GRANT EXECUTE ON FUNCTION public.get_public_store(TEXT) TO anon, authenticated;
DO $chk$
BEGIN
    IF (SELECT md5(regexp_replace(prosrc, '\s+', '', 'g')) FROM pg_proc WHERE oid = to_regprocedure('public.get_public_store(text)'))
       <> 'cb6e53c11a484d484c31bf071f3a8f73' THEN
        RAISE EXCEPTION 'Rollback N6: get_public_store restaurada difere da 001.';
    END IF;
END
$chk$;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261006000600';
