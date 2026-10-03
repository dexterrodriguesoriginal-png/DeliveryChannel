-- Migration: 20261003000023_promotional_cards_media_and_atomic_coupons.sql
-- COMANDO 139: SISTEMA PROFISSIONAL DE CARDS PROMOCIONAIS + MÍDIA + AGENDAMENTO + CUPONS COM LIMITE REAL

-- 1. EVOLUÇÃO DA TABELA OFFERS PARA SUPORTAR CARDS PROMOCIONAIS MULTIFORMATO E MÍDIA (VÍDEO / IMAGEM)
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS card_format VARCHAR(20) NOT NULL DEFAULT 'HORIZONTAL';
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) NOT NULL DEFAULT 'IMAGE';
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC(5,2) NOT NULL DEFAULT 5.0;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS video_duration NUMERIC(5,2);
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS detected_width INT;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS detected_height INT;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS aspect_ratio VARCHAR(20) DEFAULT '16:9';
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS internal_title TEXT;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS internal_description TEXT;

-- Garante que media_url herde image_url para registros existentes
UPDATE public.offers 
SET media_url = image_url 
WHERE media_url IS NULL AND image_url IS NOT NULL;

-- 2. BUCKET DE STORAGE DEDICADO A MARKETING E CRIATIVOS MULTIMÍDIA
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'marketing',
    'marketing',
    true,
    36700160, -- 35 MB para suportar vídeos curtos/animados e imagens em alta resolução
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 36700160,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];

-- Políticas de RLS para o bucket marketing
DROP POLICY IF EXISTS "marketing_public_read" ON storage.objects;
CREATE POLICY "marketing_public_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'marketing');

DROP POLICY IF EXISTS "marketing_staff_write" ON storage.objects;
CREATE POLICY "marketing_staff_write" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'marketing' AND
        public.can_manage_catalog_storage(name)
    );

DROP POLICY IF EXISTS "marketing_staff_update" ON storage.objects;
CREATE POLICY "marketing_staff_update" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'marketing' AND
        public.can_manage_catalog_storage(name)
    );

DROP POLICY IF EXISTS "marketing_staff_delete" ON storage.objects;
CREATE POLICY "marketing_staff_delete" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'marketing' AND
        public.can_manage_catalog_storage(name)
    );

-- 3. TABELA DE AUDITORIA E REGISTRO ATÔMICO DE UTILIZAÇÃO DE CUPONS
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    coupon_id UUID NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    redemption_number INTEGER NOT NULL,
    discount_applied NUMERIC(10,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_tenant ON public.coupon_redemptions(tenant_id, coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_customer ON public.coupon_redemptions(customer_id, coupon_id);

ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coupon_redemptions_staff_view" ON public.coupon_redemptions;
CREATE POLICY "coupon_redemptions_staff_view" ON public.coupon_redemptions
    FOR ALL USING (
        tenant_id IN (
            SELECT tu.tenant_id FROM public.tenant_users tu 
            WHERE tu.user_id = auth.uid() AND tu.status = 'ACTIVE'
        )
    );

-- 4. FUNÇÃO SERVER-SIDE ATÔMICA PARA RESERVA E RESGATE DE CUPOM (SEM CONDIÇÃO DE CORRIDA)
CREATE OR REPLACE FUNCTION public.redeem_coupon(
    p_tenant_id UUID,
    p_coupon_code TEXT,
    p_customer_id UUID,
    p_order_id UUID,
    p_subtotal NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_coupon RECORD;
    v_clean_code TEXT := UPPER(TRIM(p_coupon_code));
    v_previous_uses INT := 0;
    v_new_redemption_number INT;
    v_discount NUMERIC(10,2) := 0;
    v_remaining INT;
BEGIN
    -- 1. Travar o cupom para atualização atômica (ROW-LEVEL LOCK FOR UPDATE)
    SELECT * INTO v_coupon
    FROM public.coupons
    WHERE tenant_id = p_tenant_id 
      AND code = v_clean_code
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Cupom inválido ou inexistente para este estabelecimento.');
    END IF;

    IF NOT v_coupon.is_active THEN
        RETURN jsonb_build_object('success', false, 'message', 'Este cupom foi desativado.');
    END IF;

    IF v_coupon.start_date IS NOT NULL AND v_coupon.start_date > NOW() THEN
        RETURN jsonb_build_object('success', false, 'message', 'Este cupom ainda não é válido.');
    END IF;

    IF v_coupon.end_date IS NOT NULL AND v_coupon.end_date < NOW() THEN
        RETURN jsonb_build_object('success', false, 'message', 'Este cupom já expirou.');
    END IF;

    -- Validação de limite total atômico
    IF v_coupon.usage_limit IS NOT NULL AND v_coupon.times_used >= v_coupon.usage_limit THEN
        RETURN jsonb_build_object(
            'success', false, 
            'is_exhausted', true,
            'message', 'Esta promoção acabou. Os cupons disponíveis já foram utilizados.'
        );
    END IF;

    -- Validação de pedido mínimo
    IF v_coupon.min_order_value IS NOT NULL AND p_subtotal < v_coupon.min_order_value THEN
        RETURN jsonb_build_object(
            'success', false, 
            'message', format('Pedido mínimo de R$ %s necessário para este cupom.', to_char(v_coupon.min_order_value, 'FM999990.00'))
        );
    END IF;

    -- Validação de cliente específico
    IF v_coupon.customer_id IS NOT NULL AND (p_customer_id IS NULL OR v_coupon.customer_id != p_customer_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Este cupom é exclusivo para outro cliente.');
    END IF;

    -- Validação de limite por cliente
    IF p_customer_id IS NOT NULL AND v_coupon.usage_limit_per_customer IS NOT NULL THEN
        SELECT COUNT(*) INTO v_previous_uses
        FROM public.coupon_redemptions
        WHERE coupon_id = v_coupon.id AND customer_id = p_customer_id;

        IF v_previous_uses >= v_coupon.usage_limit_per_customer THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', 'Você já atingiu o limite de utilizações deste cupom para sua conta.'
            );
        END IF;
    END IF;

    -- Cálculo do desconto
    IF v_coupon.discount_type = 'PERCENTAGE' THEN
        v_discount := ROUND((p_subtotal * v_coupon.discount_value / 100), 2);
    ELSE
        v_discount := LEAST(p_subtotal, v_coupon.discount_value);
    END IF;

    -- Operação Atômica: Incrementa contador
    UPDATE public.coupons
    SET times_used = times_used + 1,
        updated_at = NOW()
    WHERE id = v_coupon.id;

    v_new_redemption_number := v_coupon.times_used + 1;

    -- Registra na tabela de auditoria de redenções
    INSERT INTO public.coupon_redemptions (
        tenant_id, coupon_id, customer_id, order_id, redemption_number, discount_applied
    ) VALUES (
        p_tenant_id, v_coupon.id, p_customer_id, p_order_id, v_new_redemption_number, v_discount
    );

    IF v_coupon.usage_limit IS NOT NULL THEN
        v_remaining := v_coupon.usage_limit - v_new_redemption_number;
    ELSE
        v_remaining := NULL;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'coupon_id', v_coupon.id,
        'coupon_code', v_coupon.code,
        'redemption_number', v_new_redemption_number,
        'discount_amount', v_discount,
        'remaining_uses', v_remaining,
        'message', format('Cupom "%s" validado e aplicado!', v_coupon.code)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_coupon(UUID, TEXT, UUID, UUID, NUMERIC) TO anon, authenticated;

-- 5. ATUALIZAR get_public_store PARA INCLUIR FORMATO, TIPO DE MÍDIA E TEMPO DOS CARDS
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

    -- 6. Obter cards promocionais ativos dentro do período agendado
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
            'email', v_tenant.email,
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
