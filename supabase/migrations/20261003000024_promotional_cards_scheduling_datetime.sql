-- Migration: 20261003000024_promotional_cards_scheduling_datetime.sql
-- COMANDO: AJUSTE DO MÓDULO DE CARDS PROMOCIONAIS — AGENDAMENTO PROFISSIONAL POR DATA E HORÁRIO
-- Suporta agendamento por data + horário com timezone America/Sao_Paulo (TIMESTAMPTZ)
-- Vitrine pública filtra rigorosamente: start_at <= NOW() AND (end_at IS NULL OR end_at >= NOW()) AND is_active = true

-- 1. EVOLUÇÃO DAS COLUNAS DE AGENDAMENTO PARA TIMESTAMPTZ
DO $$
BEGIN
    -- Se start_date for DATE simples, converte com segurança para TIMESTAMPTZ
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'offers' AND column_name = 'start_date' AND data_type = 'date'
    ) THEN
        ALTER TABLE public.offers 
            ALTER COLUMN start_date TYPE TIMESTAMPTZ USING (
                CASE 
                    WHEN start_date IS NOT NULL THEN (start_date::text || ' 00:00:00-03')::TIMESTAMPTZ 
                    ELSE NULL 
                END
            );
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'offers' AND column_name = 'end_date' AND data_type = 'date'
    ) THEN
        ALTER TABLE public.offers 
            ALTER COLUMN end_date TYPE TIMESTAMPTZ USING (
                CASE 
                    WHEN end_date IS NOT NULL THEN (end_date::text || ' 23:59:59-03')::TIMESTAMPTZ 
                    ELSE NULL 
                END
            );
    END IF;
END $$;

-- Adiciona colunas canônicas start_at e end_at para maior clareza e compatibilidade total
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ;

-- Sincroniza start_at / start_date e end_at / end_date
UPDATE public.offers
SET start_at = start_date
WHERE start_at IS NULL AND start_date IS NOT NULL;

UPDATE public.offers
SET end_at = end_date
WHERE end_at IS NULL AND end_date IS NOT NULL;

-- 2. ÍNDICE DE PERFORMANCE PARA CONSULTA TEMPORAL MULTI-TENANT
CREATE INDEX IF NOT EXISTS idx_offers_scheduling_tenant
ON public.offers(tenant_id, is_active, start_at, end_at);

-- 3. ATUALIZAÇÃO DA FUNÇÃO PÚBLICA get_public_store COM FILTRO TEMPORAL ATÔMICO
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
    SELECT id, slug, name, phone, email, category, status
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
           address, city, phone_whatsapp, pix_key
    INTO v_settings
    FROM public.tenant_settings
    WHERE tenant_id = v_tenant.id;

    -- 4. Obter categorias públicas ativas do tenant
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

    -- 6. Obter cards promocionais ESTRITAMENTE ATIVOS no momento presente (NOW())
    -- Cards agendados no futuro NÃO aparecem.
    -- Cards expirados no passado NÃO aparecem.
    -- Cards com end_at nulo permanecem ativos até desativação manual.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'tenantId', o.tenant_id,
        'title', o.title,
        'subtitle', o.subtitle,
        'description', o.description,
        'badge', o.badge,
        'discountPercentage', o.discount_percentage,
        'imageUrl', COALESCE(o.media_url, o.image_url),
        'mediaUrl', COALESCE(o.media_url, o.image_url),
        'mediaType', COALESCE(o.media_type, 'IMAGE'),
        'displayMode', COALESCE(o.display_mode, 'FULL_MEDIA'),
        'cardFormat', COALESCE(o.card_format, 'HORIZONTAL'),
        'durationSeconds', COALESCE(o.duration_seconds, 5.0),
        'videoDuration', o.video_duration,
        'detectedWidth', o.detected_width,
        'detectedHeight', o.detected_height,
        'aspectRatio', COALESCE(o.aspect_ratio, '16:9'),
        'internalTitle', o.internal_title,
        'internalDescription', o.internal_description,
        'internalLink', o.internal_link,
        'order', o.display_order,
        'startDate', COALESCE(o.start_at, o.start_date),
        'endDate', COALESCE(o.end_at, o.end_date),
        'startAt', COALESCE(o.start_at, o.start_date),
        'endAt', COALESCE(o.end_at, o.end_date),
        'backgroundColor', o.background_color,
        'accentColor', o.accent_color,
        'isActive', o.is_active
    ) ORDER BY o.display_order ASC), '[]'::jsonb)
    INTO v_offers
    FROM public.offers o
    WHERE o.tenant_id = v_tenant.id 
      AND o.is_active = true
      AND (COALESCE(o.start_at, o.start_date) IS NULL OR COALESCE(o.start_at, o.start_date) <= NOW())
      AND (COALESCE(o.end_at, o.end_date) IS NULL OR COALESCE(o.end_at, o.end_date) >= NOW());

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
                            'price', p.price,
                            'imageUrl', p.image_url
                        )
                    ) ORDER BY pci.display_order ASC
                ) FILTER (WHERE pci.id IS NOT NULL AND p.id IS NOT NULL AND p.is_active = true), '[]'::jsonb)
                FROM public.promotion_carousel_items pci
                JOIN public.products p ON p.id = pci.product_id
                WHERE pci.carousel_id = pc.id AND pci.is_active = true
            )
        ) ORDER BY pc.display_order ASC
    ), '[]'::jsonb)
    INTO v_carousels
    FROM public.promotion_carousels pc
    WHERE pc.tenant_id = v_tenant.id AND pc.is_active = true AND pc.show_in_store = true;

    RETURN jsonb_build_object(
        'tenant', jsonb_build_object(
            'id', v_tenant.id,
            'slug', v_tenant.slug,
            'name', v_tenant.name,
            'phone', v_tenant.phone,
            'email', v_tenant.email,
            'category', v_tenant.category
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
