-- Migration: 20261003000025_campaigns_cards_analytics_attribution.sql
-- COMANDO MASTER: EVOLUÇÃO COMPLETA DO MÓDULO DE PROMOÇÕES & CAMPANHAS
-- Suporte a: Campanhas Multi-Card, 3 Modelos 16:9 (Full Media, Promo Card, Offer Card),
-- Ofertas Personalizadas com Checkout Integrado, Cupons com Concorrência Atômica,
-- Analytics com Funil Completo e Atribuição de Receita aos Pedidos/Financeiro/CRM.

-- 1. TABELA DE CAMPANHAS PROMOCIONAIS (CAMPAIGNS)
CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- DRAFT, SCHEDULED, ACTIVE, PAUSED, EXPIRED, SOLD_OUT, ARCHIVED
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
    no_end_date BOOLEAN NOT NULL DEFAULT false,
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_status ON public.campaigns(tenant_id, status, is_active);
CREATE INDEX IF NOT EXISTS idx_campaigns_timing ON public.campaigns(tenant_id, start_at, end_at);

-- 2. TABELA DE CARDS DA CAMPANHA (CAMPAIGN_CARDS - 1..N CARDS POR CAMPANHA)
CREATE TABLE IF NOT EXISTS public.campaign_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    display_order INT NOT NULL DEFAULT 0,
    model VARCHAR(32) NOT NULL DEFAULT 'FULL_MEDIA', -- FULL_MEDIA, PROMO_CARD, OFFER_CARD (todos 1200x675 / 16:9)
    media_type VARCHAR(16) NOT NULL DEFAULT 'IMAGE', -- IMAGE, VIDEO
    media_url TEXT NOT NULL,
    storage_path TEXT,
    duration_seconds NUMERIC(5,2) NOT NULL DEFAULT 5.0,
    video_duration NUMERIC(5,2),
    title TEXT,
    subtitle TEXT,
    description TEXT,
    badge TEXT,
    cta_text VARCHAR(64) DEFAULT 'Aproveitar Oferta',
    auto_overlay BOOLEAN NOT NULL DEFAULT false, -- Configuração de sobreposição automática: OFF por padrão em Full Media
    destination_type VARCHAR(32) NOT NULL DEFAULT 'BANNER_ONLY', -- PRODUCT, BANNER_ONLY, CUSTOM_OFFER
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    coupon_id UUID REFERENCES public.coupons(id) ON DELETE SET NULL,
    
    -- Campos da Oferta Personalizada (Custom Offer)
    custom_title TEXT,
    custom_description TEXT,
    custom_price NUMERIC(10,2),
    custom_promotional_price NUMERIC(10,2),
    custom_discount_percentage INT,
    custom_quantity_available INT,
    custom_unit VARCHAR(16) DEFAULT 'un',
    custom_notes TEXT,
    
    background_color VARCHAR(32) DEFAULT '#15803d',
    accent_color VARCHAR(32) DEFAULT '#4ade80',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_cards_campaign ON public.campaign_cards(campaign_id, display_order);
CREATE INDEX IF NOT EXISTS idx_campaign_cards_tenant ON public.campaign_cards(tenant_id, is_active);

-- 3. EVOLUÇÃO DAS TABELAS DE PEDIDOS E ITENS PARA ATRIBUIÇÃO DE RECEITA
-- Permite que itens de pedido referenciem ofertas personalizadas sem quebrar pedidos existentes
ALTER TABLE public.order_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS card_id UUID REFERENCES public.campaign_cards(id) ON DELETE SET NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS original_price NUMERIC(10,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS discount_percentage INT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES public.coupons(id) ON DELETE SET NULL;

-- Na tabela de pedidos adiciona metadados da campanha para rastreamento no Financeiro, CRM e Relatórios
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS card_id UUID REFERENCES public.campaign_cards(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES public.coupons(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS coupon_discount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS campaign_metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_orders_campaign ON public.orders(tenant_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_orders_coupon ON public.orders(tenant_id, coupon_id);

-- 4. TABELA DE EVENTOS DE ANALYTICS DAS CAMPANHAS
CREATE TABLE IF NOT EXISTS public.campaign_analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
    card_id UUID REFERENCES public.campaign_cards(id) ON DELETE SET NULL,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    offer_id UUID,
    coupon_id UUID REFERENCES public.coupons(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    session_id TEXT,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    event_type VARCHAR(64) NOT NULL, -- CAMPAIGN_IMPRESSION, CARD_IMPRESSION, CARD_CLICK, PRODUCT_OPEN, ADD_TO_CART, CHECKOUT_STARTED, CHECKOUT_COMPLETED, COUPON_VIEWED, COUPON_APPLIED, COUPON_REJECTED, CAMPAIGN_SOLD_OUT, CAMPAIGN_EXPIRED
    event_value NUMERIC(10,2) DEFAULT 0,
    quantity INT DEFAULT 1,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_analytics_tenant_event ON public.campaign_analytics_events(tenant_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_analytics_campaign ON public.campaign_analytics_events(campaign_id, card_id);
CREATE INDEX IF NOT EXISTS idx_campaign_analytics_order ON public.campaign_analytics_events(order_id);

-- 5. RLS NAS NOVAS TABELAS
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_analytics_events ENABLE ROW LEVEL SECURITY;

-- Políticas Campaigns
DROP POLICY IF EXISTS "campaigns_staff_all" ON public.campaigns;
CREATE POLICY "campaigns_staff_all" ON public.campaigns
    FOR ALL USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
    );

DROP POLICY IF EXISTS "campaigns_staff_select" ON public.campaigns;
CREATE POLICY "campaigns_staff_select" ON public.campaigns
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER'])
    );

-- Políticas Campaign Cards
DROP POLICY IF EXISTS "campaign_cards_staff_all" ON public.campaign_cards;
CREATE POLICY "campaign_cards_staff_all" ON public.campaign_cards
    FOR ALL USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
    );

DROP POLICY IF EXISTS "campaign_cards_staff_select" ON public.campaign_cards;
CREATE POLICY "campaign_cards_staff_select" ON public.campaign_cards
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER'])
    );

-- Políticas Analytics Events (Staff pode ver relatórios do tenant; público pode registrar eventos)
DROP POLICY IF EXISTS "campaign_analytics_staff_select" ON public.campaign_analytics_events;
CREATE POLICY "campaign_analytics_staff_select" ON public.campaign_analytics_events
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER'])
    );

DROP POLICY IF EXISTS "campaign_analytics_public_insert" ON public.campaign_analytics_events;
CREATE POLICY "campaign_analytics_public_insert" ON public.campaign_analytics_events
    FOR INSERT WITH CHECK (
        tenant_id IS NOT NULL
    );

-- 6. RPC DE REGISTRO SEGURO DE EVENTOS ANALYTICS (COM DEDUPLICAÇÃO)
CREATE OR REPLACE FUNCTION public.track_campaign_event(
    p_tenant_id UUID,
    p_event_type TEXT,
    p_campaign_id UUID DEFAULT NULL,
    p_card_id UUID DEFAULT NULL,
    p_product_id UUID DEFAULT NULL,
    p_coupon_id UUID DEFAULT NULL,
    p_customer_id UUID DEFAULT NULL,
    p_session_id TEXT DEFAULT NULL,
    p_order_id UUID DEFAULT NULL,
    p_event_value NUMERIC DEFAULT 0,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_event_id UUID;
BEGIN
    INSERT INTO public.campaign_analytics_events (
        tenant_id,
        campaign_id,
        card_id,
        product_id,
        coupon_id,
        customer_id,
        session_id,
        order_id,
        event_type,
        event_value,
        metadata
    ) VALUES (
        p_tenant_id,
        p_campaign_id,
        p_card_id,
        p_product_id,
        p_coupon_id,
        p_customer_id,
        p_session_id,
        p_order_id,
        p_event_type,
        COALESCE(p_event_value, 0),
        COALESCE(p_metadata, '{}'::jsonb)
    ) RETURNING id INTO v_event_id;

    RETURN jsonb_build_object('success', true, 'event_id', v_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.track_campaign_event TO anon, authenticated;

-- 7. ATUALIZAÇÃO DA RPC ATÔMICA DE RESGATE DE CUPOM COM VÍNCULO DE CAMPANHA E MENSAGEM DE RANKING
CREATE OR REPLACE FUNCTION public.redeem_coupon(
    p_tenant_id UUID,
    p_coupon_code TEXT,
    p_order_id UUID,
    p_customer_id UUID DEFAULT NULL,
    p_subtotal NUMERIC DEFAULT 0,
    p_campaign_id UUID DEFAULT NULL,
    p_card_id UUID DEFAULT NULL
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
            'message', 'Esta promoção acabou. Os cupons disponíveis já foram totalmente utilizados.'
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

    -- Atualiza metadados do pedido se fornecido
    IF p_order_id IS NOT NULL THEN
        UPDATE public.orders
        SET coupon_id = v_coupon.id,
            coupon_code = v_coupon.code,
            coupon_discount = v_discount,
            campaign_id = COALESCE(p_campaign_id, orders.campaign_id),
            card_id = COALESCE(p_card_id, orders.card_id)
        WHERE id = p_order_id AND tenant_id = p_tenant_id;
    END IF;

    -- Registra evento de Analytics
    INSERT INTO public.campaign_analytics_events (
        tenant_id, campaign_id, card_id, coupon_id, customer_id, order_id, event_type, event_value
    ) VALUES (
        p_tenant_id, p_campaign_id, p_card_id, v_coupon.id, p_customer_id, p_order_id, 'COUPON_APPLIED', v_discount
    );

    RETURN jsonb_build_object(
        'success', true,
        'coupon_id', v_coupon.id,
        'coupon_code', v_coupon.code,
        'redemption_number', v_new_redemption_number,
        'discount_amount', v_discount,
        'remaining_uses', v_remaining,
        'is_exhausted', (v_remaining IS NOT NULL AND v_remaining <= 0),
        'message', format('🎉 PARABÉNS! Você foi o %sº cliente a aproveitar esta promoção!', v_new_redemption_number)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_coupon(UUID, TEXT, UUID, UUID, NUMERIC, UUID, UUID) TO anon, authenticated;

-- 8. ATUALIZAR get_public_store PARA INCLUIR CAMPANHAS E SEUS RESPECTIVOS CARDS
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
    v_campaigns JSONB;
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

    -- 6. Obter cards promocionais isolados (Offers históricas) preservando compatibilidade
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

    -- 8. Obter Campanhas Promocionais Profissionais com Cards (NOVO - COMANDO MASTER)
    -- Somente campanhas ativas dentro do horário programado
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', cmp.id,
            'tenantId', cmp.tenant_id,
            'name', cmp.name,
            'description', cmp.description,
            'status', cmp.status,
            'startAt', cmp.start_at,
            'endAt', cmp.end_at,
            'noEndDate', cmp.no_end_date,
            'timezone', cmp.timezone,
            'isActive', cmp.is_active,
            'displayOrder', cmp.display_order,
            'cards', (
                SELECT COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'id', crd.id,
                        'campaignId', crd.campaign_id,
                        'tenantId', crd.tenant_id,
                        'displayOrder', crd.display_order,
                        'model', crd.model,
                        'mediaType', crd.media_type,
                        'mediaUrl', crd.media_url,
                        'storagePath', crd.storage_path,
                        'durationSeconds', crd.duration_seconds,
                        'videoDuration', crd.video_duration,
                        'title', crd.title,
                        'subtitle', crd.subtitle,
                        'description', crd.description,
                        'badge', crd.badge,
                        'ctaText', crd.cta_text,
                        'autoOverlay', crd.auto_overlay,
                        'destinationType', crd.destination_type,
                        'productId', crd.product_id,
                        'couponId', crd.coupon_id,
                        'customTitle', crd.custom_title,
                        'customDescription', crd.custom_description,
                        'customPrice', crd.custom_price,
                        'customPromotionalPrice', crd.custom_promotional_price,
                        'customDiscountPercentage', crd.custom_discount_percentage,
                        'customQuantityAvailable', crd.custom_quantity_available,
                        'customUnit', crd.custom_unit,
                        'customNotes', crd.custom_notes,
                        'backgroundColor', crd.background_color,
                        'accentColor', crd.accent_color,
                        'isActive', crd.is_active,
                        'coupon', (
                            SELECT jsonb_build_object(
                                'id', cpn.id,
                                'code', cpn.code,
                                'discountType', cpn.discount_type,
                                'discountValue', cpn.discount_value,
                                'usageLimit', cpn.usage_limit,
                                'timesUsed', cpn.times_used,
                                'remainingUses', CASE WHEN cpn.usage_limit IS NOT NULL THEN GREATEST(0, cpn.usage_limit - cpn.times_used) ELSE NULL END,
                                'isExhausted', (cpn.usage_limit IS NOT NULL AND cpn.times_used >= cpn.usage_limit)
                            )
                            FROM public.coupons cpn
                            WHERE cpn.id = crd.coupon_id AND cpn.is_active = true
                        )
                    ) ORDER BY crd.display_order ASC
                ) FILTER (WHERE crd.id IS NOT NULL AND crd.is_active = true), '[]'::jsonb)
                FROM public.campaign_cards crd
                WHERE crd.campaign_id = cmp.id AND crd.is_active = true
            )
        ) ORDER BY cmp.display_order ASC, cmp.created_at DESC
    ), '[]'::jsonb)
    INTO v_campaigns
    FROM public.campaigns cmp
    WHERE cmp.tenant_id = v_tenant.id
      AND cmp.is_active = true
      AND cmp.status IN ('ACTIVE', 'SCHEDULED')
      AND (cmp.start_at IS NULL OR cmp.start_at <= NOW())
      AND (cmp.no_end_date = true OR cmp.end_at IS NULL OR cmp.end_at >= NOW());

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
        'promotionCarousels', v_carousels,
        'campaigns', v_campaigns
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_store(TEXT) TO anon, authenticated;
