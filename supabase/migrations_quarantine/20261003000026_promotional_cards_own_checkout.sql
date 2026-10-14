-- Migration: 20261003000026_promotional_cards_own_checkout.sql
-- COMANDO: CHECKOUT PROMOCIONAL PRÓPRIO + DESTINOS DE CARD + ATRIBUIÇÃO ATÔMICA
-- Permite que cards promocionais tenham seu próprio checkout mesmo sem produto no catálogo,
-- garantindo pedidos reais, integridade no banco, concorrência atômica e métricas no painel.

-- 1. ADICIONA CAMPOS DE CHECKOUT PROMOCIONAL E DESTINO NA TABELA OFFERS
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS destination_type VARCHAR(32) NOT NULL DEFAULT 'BANNER_ONLY';
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS has_promo_checkout BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS promo_title TEXT;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS promo_description TEXT;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS promo_price NUMERIC(10,2);
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS promo_original_price NUMERIC(10,2);
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS promo_discount_percentage INT;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS promo_unit VARCHAR(16) DEFAULT 'un';
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS promo_min_quantity INT DEFAULT 1;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS promo_max_quantity_per_customer INT DEFAULT 10;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS promo_notes TEXT;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS promo_fulfillment_types JSONB DEFAULT '["DELIVERY", "PICKUP"]'::jsonb;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS promo_payment_methods JSONB DEFAULT '["PIX", "CREDIT_CARD", "DEBIT_CARD", "CASH"]'::jsonb;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS promo_coupon_code VARCHAR(64);
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS promo_usage_limit INT;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS promo_times_used INT NOT NULL DEFAULT 0;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS auto_overlay BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS card_model VARCHAR(32) DEFAULT 'HERO';

-- Atualiza dados legados: se tem product_id definido, define destination_type = 'PRODUCT'
UPDATE public.offers 
SET destination_type = 'PRODUCT'
WHERE product_id IS NOT NULL AND (destination_type IS NULL OR destination_type = 'BANNER_ONLY');

-- 2. GARANTE COLUNAS DE VÍNCULO DE OFERTA NAS TABELAS DE PEDIDOS
ALTER TABLE public.order_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS offer_id UUID REFERENCES public.offers(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS offer_id UUID REFERENCES public.offers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_offer ON public.order_items(offer_id);
CREATE INDEX IF NOT EXISTS idx_orders_offer ON public.orders(tenant_id, offer_id);

-- 3. PROCEDURE ATÔMICA DE CHECKOUT PROMOCIONAL PRÓPRIO
-- Não confia em valores do frontend: busca preço, desconto e estoque diretamente do banco
CREATE OR REPLACE FUNCTION public.process_promotional_checkout_atomic(
    p_tenant_slug TEXT,
    p_offer_id UUID,
    p_quantity INT,
    p_customer_name VARCHAR,
    p_customer_phone VARCHAR,
    p_customer_email VARCHAR,
    p_delivery_address TEXT,
    p_address_details JSONB,
    p_payment_method VARCHAR,
    p_fulfillment_type VARCHAR,
    p_notes TEXT DEFAULT NULL,
    p_coupon_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_tenant_status VARCHAR(32);
    v_tenant_name TEXT;
    v_min_order_value NUMERIC(10,2) := 0.00;
    v_delivery_fee NUMERIC(10,2) := 0.00;
    v_free_threshold NUMERIC(10,2);
    v_default_prep INT := 30;
    
    v_offer RECORD;
    v_prod RECORD;
    v_unit_price NUMERIC(10,2);
    v_orig_price NUMERIC(10,2);
    v_subtotal NUMERIC(10,2) := 0.00;
    v_discount NUMERIC(10,2) := 0.00;
    v_coupon_discount NUMERIC(10,2) := 0.00;
    v_total_amount NUMERIC(10,2) := 0.00;
    
    v_customer_id UUID;
    v_order_id UUID;
    v_clean_phone VARCHAR(32);
    v_clean_address TEXT;
    v_new_usage_count INT;
    v_redemption_msg TEXT := NULL;
    v_item_name TEXT;
    v_item_unit VARCHAR(16);
BEGIN
    -- 1. Validar autenticação do cliente: NÃO EXISTE CHECKOUT ANÔNIMO
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Autenticação necessária. É necessário estar conectado para finalizar o pedido promocional.';
    END IF;

    -- 2. Validar dados do cliente
    IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
        RAISE EXCEPTION 'O nome do cliente é obrigatório.';
    END IF;
    IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN
        RAISE EXCEPTION 'O WhatsApp do cliente é obrigatório.';
    END IF;
    v_clean_phone := regexp_replace(p_customer_phone, '[^\d]', '', 'g');
    IF length(v_clean_phone) < 10 THEN
        RAISE EXCEPTION 'Número de WhatsApp inválido.';
    END IF;

    -- 3. Validar tenant
    SELECT t.id, t.status, t.name, s.min_order_value, s.delivery_fee, s.free_delivery_threshold, COALESCE(s.default_prep_time_minutes, 30)
    INTO v_tenant_id, v_tenant_status, v_tenant_name, v_min_order_value, v_delivery_fee, v_free_threshold, v_default_prep
    FROM public.tenants t
    LEFT JOIN public.tenant_settings s ON s.tenant_id = t.id
    WHERE t.slug = p_tenant_slug;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Estabelecimento com slug "%" não encontrado.', p_tenant_slug;
    END IF;
    IF v_tenant_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'O estabelecimento "%" está temporariamente desativado para pedidos.', p_tenant_slug;
    END IF;

    -- 4. Validar quantidade
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'A quantidade deve ser de pelo menos 1 unidade.';
    END IF;

    -- 5. TRAVAR O CARD PROMOCIONAL PARA ATUALIZAÇÃO ATÔMICA (ROW-LEVEL LOCK FOR UPDATE)
    SELECT * INTO v_offer
    FROM public.offers
    WHERE id = p_offer_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Card promocional não encontrado para este estabelecimento.';
    END IF;

    IF NOT v_offer.is_active THEN
        RAISE EXCEPTION 'Esta promoção foi desativada pelo estabelecimento.';
    END IF;

    -- Validar período temporal
    IF v_offer.start_at IS NOT NULL AND v_offer.start_at > NOW() THEN
        RAISE EXCEPTION 'Esta promoção ainda não iniciou.';
    END IF;
    IF v_offer.end_at IS NOT NULL AND v_offer.end_at < NOW() THEN
        RAISE EXCEPTION 'Esta promoção expirou.';
    END IF;

    -- Validar limite atômico de usos
    IF v_offer.promo_usage_limit IS NOT NULL AND v_offer.promo_usage_limit > 0 THEN
        IF v_offer.promo_times_used >= v_offer.promo_usage_limit THEN
            RAISE EXCEPTION 'Esta promoção atingiu o limite máximo de % usos e está esgotada.', v_offer.promo_usage_limit;
        END IF;
    END IF;

    -- Validar quantidade máxima por cliente
    IF v_offer.promo_max_quantity_per_customer IS NOT NULL AND p_quantity > v_offer.promo_max_quantity_per_customer THEN
        RAISE EXCEPTION 'A quantidade máxima permitida por cliente nesta promoção é de % unidades.', v_offer.promo_max_quantity_per_customer;
    END IF;

    -- Determina preço oficial a partir do banco de dados (impossível fraudar no front)
    v_unit_price := COALESCE(v_offer.promo_price, v_offer.promotional_price, v_offer.original_price, 0.00);
    v_orig_price := COALESCE(v_offer.promo_original_price, v_offer.original_price, v_unit_price);
    v_item_name := COALESCE(v_offer.promo_title, v_offer.title);
    v_item_unit := COALESCE(v_offer.promo_unit, 'un');

    IF v_unit_price <= 0 THEN
        RAISE EXCEPTION 'Preço promocional inválido no cadastro da promoção.';
    END IF;

    v_subtotal := v_unit_price * p_quantity;

    -- Se a oferta estiver vinculada a um produto do catálogo físico, valida estoque
    IF v_offer.product_id IS NOT NULL THEN
        SELECT * INTO v_prod FROM public.products
        WHERE id = v_offer.product_id AND tenant_id = v_tenant_id
        FOR UPDATE;

        IF FOUND THEN
            IF v_prod.stock_quantity < p_quantity THEN
                RAISE EXCEPTION 'Estoque insuficiente para o produto da promoção. Disponível: %', v_prod.stock_quantity;
            END IF;
            -- Baixa atômica de estoque
            UPDATE public.products
            SET stock_quantity = stock_quantity - p_quantity,
                updated_at = NOW()
            WHERE id = v_prod.id;
        END IF;
    END IF;

    -- 6. Validar tipo de entrega e taxa
    IF p_fulfillment_type = 'DELIVERY' THEN
        v_clean_address := trim(COALESCE(p_delivery_address, ''));
        IF v_clean_address = '' THEN
            RAISE EXCEPTION 'Endereço de entrega é obrigatório para entrega.';
        END IF;
        IF v_free_threshold IS NOT NULL AND v_subtotal >= v_free_threshold THEN
            v_delivery_fee := 0.00;
        END IF;
    ELSE
        p_fulfillment_type := 'PICKUP';
        v_clean_address := 'Retirada no Balcão';
        v_delivery_fee := 0.00;
    END IF;

    -- 7. Resolver ou criar cliente
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE tenant_id = v_tenant_id AND user_id = v_user_id;

    IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (
            tenant_id, user_id, name, phone, email, notes
        ) VALUES (
            v_tenant_id, v_user_id, p_customer_name, v_clean_phone, p_customer_email, 'Cliente cadastrado via Checkout Promocional'
        ) RETURNING id INTO v_customer_id;
    ELSE
        UPDATE public.customers
        SET name = p_customer_name,
            phone = v_clean_phone,
            email = COALESCE(p_customer_email, email),
            updated_at = NOW()
        WHERE id = v_customer_id;
    END IF;

    v_total_amount := v_subtotal + v_delivery_fee;

    -- 8. Incrementa contador atômico de usos da promoção
    v_new_usage_count := v_offer.promo_times_used + 1;
    UPDATE public.offers
    SET promo_times_used = v_new_usage_count,
        updated_at = NOW()
    WHERE id = v_offer.id;

    IF v_offer.promo_usage_limit IS NOT NULL AND v_offer.promo_usage_limit > 0 THEN
        v_redemption_msg := format('🎉 Parabéns! Você foi o cliente nº %s a aproveitar esta promoção!', v_new_usage_count);
    END IF;

    -- 9. Inserir Pedido Real no Sistema Oficial (public.orders)
    INSERT INTO public.orders (
        tenant_id,
        customer_id,
        customer_name,
        customer_phone,
        customer_email,
        delivery_address,
        address_details,
        subtotal,
        delivery_fee,
        discount,
        total_amount,
        payment_method,
        payment_status,
        fulfillment_type,
        status,
        notes,
        origin,
        prep_time_minutes,
        offer_id,
        campaign_metadata
    ) VALUES (
        v_tenant_id,
        v_customer_id,
        p_customer_name,
        v_clean_phone,
        p_customer_email,
        v_clean_address,
        COALESCE(p_address_details, '{}'::jsonb),
        v_subtotal,
        v_delivery_fee,
        v_discount,
        v_total_amount,
        p_payment_method,
        'PENDING',
        p_fulfillment_type,
        'PENDING',
        COALESCE(p_notes, ''),
        'promotional_checkout',
        v_default_prep,
        v_offer.id,
        jsonb_build_object(
            'offer_id', v_offer.id,
            'offer_title', v_offer.title,
            'redemption_number', v_new_usage_count,
            'is_limited', (v_offer.promo_usage_limit IS NOT NULL AND v_offer.promo_usage_limit > 0)
        )
    ) RETURNING id INTO v_order_id;

    -- 10. Inserir Item Oficial (public.order_items)
    INSERT INTO public.order_items (
        order_id,
        product_id,
        product_name,
        quantity,
        unit_price,
        total_price,
        notes,
        unit,
        offer_id,
        original_price,
        discount_amount,
        discount_percentage
    ) VALUES (
        v_order_id,
        v_offer.product_id,
        v_item_name,
        p_quantity,
        v_unit_price,
        v_subtotal,
        COALESCE(p_notes, 'Oferta Promocional Exclusiva'),
        v_item_unit,
        v_offer.id,
        v_orig_price,
        GREATEST(0, (v_orig_price - v_unit_price) * p_quantity),
        v_offer.promo_discount_percentage
    );

    -- 11. Histórico de status do pedido
    INSERT INTO public.order_status_history (
        order_id, status, note, changed_by
    ) VALUES (
        v_order_id, 'PENDING', 'Pedido confirmado via Checkout Promocional', 'Checkout Promocional'
    );

    -- 12. Registrar evento de Analytics
    INSERT INTO public.campaign_analytics_events (
        tenant_id,
        card_id,
        offer_id,
        product_id,
        customer_id,
        order_id,
        event_type,
        event_value,
        quantity,
        metadata
    ) VALUES (
        v_tenant_id,
        v_offer.id,
        v_offer.id,
        v_offer.product_id,
        v_customer_id,
        v_order_id,
        'CHECKOUT_COMPLETED',
        v_total_amount,
        p_quantity,
        jsonb_build_object(
            'offer_title', v_item_name,
            'redemption_number', v_new_usage_count,
            'unit_price', v_unit_price
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'redemption_number', v_new_usage_count,
        'celebration_message', v_redemption_msg,
        'total_amount', v_total_amount,
        'is_exhausted', (v_offer.promo_usage_limit IS NOT NULL AND v_new_usage_count >= v_offer.promo_usage_limit)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_promotional_checkout_atomic TO authenticated;

-- 4. ATUALIZAR get_public_store PARA EXPOR CAMPOS DE CHECKOUT PROMOCIONAL
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
    SELECT id, slug, name, phone, email, category, status
    INTO v_tenant
    FROM public.tenants
    WHERE slug = p_slug AND status = 'ACTIVE';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Estabelecimento com slug "%" não encontrado ou inativo', p_slug;
    END IF;

    SELECT store_name, tagline, logo_url, banner_url, primary_color, 
           secondary_color, background_color, card_color, button_color, 
           text_color, border_radius, font_family
    INTO v_theme
    FROM public.tenant_themes
    WHERE tenant_id = v_tenant.id;

    SELECT is_open, min_order_value, delivery_fee, free_delivery_threshold,
           estimated_delivery_time, COALESCE(default_prep_time_minutes, 30) AS default_prep_time_minutes,
           address, city, phone_whatsapp, pix_key
    INTO v_settings
    FROM public.tenant_settings
    WHERE tenant_id = v_tenant.id;

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
        'isActive', o.is_active,
        
        -- Configuração de Destino e Checkout Promocional Próprio
        'destinationType', COALESCE(o.destination_type, CASE WHEN o.product_id IS NOT NULL THEN 'PRODUCT' ELSE 'BANNER_ONLY' END),
        'hasPromoCheckout', COALESCE(o.has_promo_checkout, false),
        'promoTitle', o.promo_title,
        'promoDescription', o.promo_description,
        'promoPrice', o.promo_price,
        'promoOriginalPrice', o.promo_original_price,
        'promoDiscountPercentage', o.promo_discount_percentage,
        'promoUnit', COALESCE(o.promo_unit, 'un'),
        'promoMinQuantity', COALESCE(o.promo_min_quantity, 1),
        'promoMaxQuantityPerCustomer', COALESCE(o.promo_max_quantity_per_customer, 10),
        'promoNotes', o.promo_notes,
        'promoFulfillmentTypes', COALESCE(o.promo_fulfillment_types, '["DELIVERY", "PICKUP"]'::jsonb),
        'promoPaymentMethods', COALESCE(o.promo_payment_methods, '["PIX", "CREDIT_CARD", "DEBIT_CARD", "CASH"]'::jsonb),
        'promoCouponCode', o.promo_coupon_code,
        'promoUsageLimit', o.promo_usage_limit,
        'promoTimesUsed', COALESCE(o.promo_times_used, 0),
        'isExhausted', (o.promo_usage_limit IS NOT NULL AND o.promo_usage_limit > 0 AND COALESCE(o.promo_times_used, 0) >= o.promo_usage_limit),
        'remainingUses', CASE WHEN o.promo_usage_limit IS NOT NULL AND o.promo_usage_limit > 0 THEN GREATEST(0, o.promo_usage_limit - COALESCE(o.promo_times_used, 0)) ELSE NULL END,
        'autoOverlay', COALESCE(o.auto_overlay, true),
        'cardModel', COALESCE(o.card_model, 'HERO')
    ) ORDER BY o.display_order ASC), '[]'::jsonb)
    INTO v_offers
    FROM public.offers o
    WHERE o.tenant_id = v_tenant.id 
      AND o.is_active = true
      AND (COALESCE(o.start_at, o.start_date) IS NULL OR COALESCE(o.start_at, o.start_date) <= NOW())
      AND (COALESCE(o.end_at, o.end_date) IS NULL OR COALESCE(o.end_at, o.end_date) >= NOW());

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
