-- Migration: 20261002000022_promotional_carousels_and_coupons.sql
-- COMANDO 138: CARROSÉIS PROMOCIONAIS REAIS NA VITRINE + CENTRAL DE PROMOÇÕES & CUPONS

-- 1. Tabela de Carrosséis de Promoção (entidade separada de categorias do catálogo)
CREATE TABLE IF NOT EXISTS public.promotion_carousels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    image_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    show_in_store BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotion_carousels_tenant ON public.promotion_carousels(tenant_id, is_active, display_order);

-- 2. Tabela de Itens do Carrossel Promocional (produtos com desconto individual)
CREATE TABLE IF NOT EXISTS public.promotion_carousel_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    carousel_id UUID NOT NULL REFERENCES public.promotion_carousels(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    discount_type VARCHAR(30) NOT NULL DEFAULT 'PERCENTAGE' CHECK (discount_type IN ('PERCENTAGE', 'FIXED_AMOUNT', 'PROMOTIONAL_PRICE')),
    discount_value NUMERIC(10,2) NOT NULL DEFAULT 0,
    promotional_price NUMERIC(10,2) NOT NULL CHECK (promotional_price > 0),
    show_discount_badge BOOLEAN NOT NULL DEFAULT true,
    show_promotional_price BOOLEAN NOT NULL DEFAULT true,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_carousel_product UNIQUE (carousel_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_promotion_carousel_items_carousel ON public.promotion_carousel_items(carousel_id, is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_promotion_carousel_items_product ON public.promotion_carousel_items(product_id);

-- 3. Tabela de Cupons de Desconto
CREATE TABLE IF NOT EXISTS public.coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    discount_type VARCHAR(30) NOT NULL DEFAULT 'PERCENTAGE' CHECK (discount_type IN ('PERCENTAGE', 'FIXED_AMOUNT')),
    discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
    min_order_value NUMERIC(10,2) DEFAULT 0,
    usage_limit INTEGER,
    usage_limit_per_customer INTEGER DEFAULT 1,
    times_used INTEGER NOT NULL DEFAULT 0,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_coupon_code UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_coupons_tenant ON public.coupons(tenant_id, is_active);

-- 4. Habilitar RLS em todas as tabelas
ALTER TABLE public.promotion_carousels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_carousel_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para promotion_carousels
DROP POLICY IF EXISTS "promotion_carousels_public_view" ON public.promotion_carousels;
CREATE POLICY "promotion_carousels_public_view" ON public.promotion_carousels
    FOR SELECT USING (is_active = true AND show_in_store = true);

DROP POLICY IF EXISTS "promotion_carousels_staff_manage" ON public.promotion_carousels;
CREATE POLICY "promotion_carousels_staff_manage" ON public.promotion_carousels
    FOR ALL USING (
        tenant_id IN (
            SELECT tu.tenant_id FROM public.tenant_users tu 
            WHERE tu.user_id = auth.uid() AND tu.status = 'ACTIVE'
        )
    );

-- Políticas de RLS para promotion_carousel_items
DROP POLICY IF EXISTS "promotion_carousel_items_public_view" ON public.promotion_carousel_items;
CREATE POLICY "promotion_carousel_items_public_view" ON public.promotion_carousel_items
    FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "promotion_carousel_items_staff_manage" ON public.promotion_carousel_items;
CREATE POLICY "promotion_carousel_items_staff_manage" ON public.promotion_carousel_items
    FOR ALL USING (
        tenant_id IN (
            SELECT tu.tenant_id FROM public.tenant_users tu 
            WHERE tu.user_id = auth.uid() AND tu.status = 'ACTIVE'
        )
    );

-- Políticas de RLS para coupons
DROP POLICY IF EXISTS "coupons_public_view" ON public.coupons;
CREATE POLICY "coupons_public_view" ON public.coupons
    FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "coupons_staff_manage" ON public.coupons;
CREATE POLICY "coupons_staff_manage" ON public.coupons
    FOR ALL USING (
        tenant_id IN (
            SELECT tu.tenant_id FROM public.tenant_users tu 
            WHERE tu.user_id = auth.uid() AND tu.status = 'ACTIVE'
        )
    );

-- 5. Atualizar get_public_store para retornar carrosséis de promoção com produtos e descontos validados
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
    v_carousels JSONB;
BEGIN
    -- 1. Obter tenant ativo pelo slug
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

    -- 3. Obter configurações operacionais públicas
    SELECT is_open, min_order_value, delivery_fee, free_delivery_threshold,
           estimated_delivery_time, COALESCE(default_prep_time_minutes, 30) AS default_prep_time_minutes,
           address, city, phone_whatsapp
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
    ) ORDER BY p.is_featured DESC, p.name ASC), '[]'::jsonb)
    INTO v_products
    FROM public.products p
    WHERE p.tenant_id = v_tenant.id AND p.is_active = true;

    -- 6. Obter ofertas públicas ativas do tenant dentro da vigência
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'tenantId', o.tenant_id,
        'title', o.title,
        'subtitle', o.subtitle,
        'badgeText', o.badge_text,
        'discountPercentage', o.discount_percentage,
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

    -- 7. Obter carrosséis de promoção ativos com produtos válidos
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', pc.id,
            'tenantId', pc.tenant_id,
            'name', pc.name,
            'description', pc.description,
            'imageUrl', pc.image_url,
            'isActive', pc.is_active,
            'showInStore', pc.show_in_store,
            'displayOrder', pc.display_order,
            'items', (
                SELECT COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'id', pci.id,
                        'carouselId', pci.carousel_id,
                        'productId', pci.product_id,
                        'tenantId', pci.tenant_id,
                        'discountType', pci.discount_type,
                        'discountValue', pci.discount_value,
                        'promotionalPrice', pci.promotional_price,
                        'calculatedDiscountPercentage', ROUND(((p.price - pci.promotional_price) / p.price) * 100),
                        'showDiscountBadge', pci.show_discount_badge,
                        'showPromotionalPrice', pci.show_promotional_price,
                        'startDate', pci.start_date,
                        'endDate', pci.end_date,
                        'isActive', pci.is_active,
                        'displayOrder', pci.display_order,
                        'product', jsonb_build_object(
                            'id', p.id,
                            'name', p.name,
                            'description', p.description,
                            'imageUrl', p.image_url,
                            'price', p.price,
                            'unit', p.unit,
                            'isAvailable', (p.stock_quantity > 0 AND p.is_active = true),
                            'isActive', p.is_active
                        )
                    ) ORDER BY pci.display_order ASC
                ), '[]'::jsonb)
                FROM public.promotion_carousel_items pci
                JOIN public.products p ON p.id = pci.product_id
                WHERE pci.carousel_id = pc.id
                  AND pci.is_active = true
                  AND p.is_active = true
                  AND p.stock_quantity > 0
                  AND pci.promotional_price > 0
                  AND pci.promotional_price < p.price
                  AND (pci.start_date IS NULL OR pci.start_date <= NOW())
                  AND (pci.end_date IS NULL OR pci.end_date >= NOW())
            )
        ) ORDER BY pc.display_order ASC
    ), '[]'::jsonb)
    INTO v_carousels
    FROM public.promotion_carousels pc
    WHERE pc.tenant_id = v_tenant.id 
      AND pc.is_active = true 
      AND pc.show_in_store = true
      AND EXISTS (
          SELECT 1 FROM public.promotion_carousel_items pci
          JOIN public.products p ON p.id = pci.product_id
          WHERE pci.carousel_id = pc.id
            AND pci.is_active = true
            AND p.is_active = true
            AND p.stock_quantity > 0
            AND pci.promotional_price > 0
            AND pci.promotional_price < p.price
            AND (pci.start_date IS NULL OR pci.start_date <= NOW())
            AND (pci.end_date IS NULL OR pci.end_date >= NOW())
      );

    -- Montagem do objeto seguro
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
        'offers', v_offers,
        'promotionCarousels', v_carousels
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_store(TEXT) TO anon, authenticated;
