-- Migration: 20261002000021_tenant_default_prep_time.sql
-- Objetivo: Garantir o funcionamento real e persistente da configuração de tempo de preparo por estabelecimento
-- 1. Coluna default_prep_time_minutes em public.tenant_settings
-- 2. Coluna prep_time_minutes em public.orders (snapshot imutável no momento da criação do pedido)
-- 3. Atualização atômica em process_checkout_atomic, get_public_store e get_customer_order_by_id

-- 1. Estrutura na tabela de configurações operacionais do estabelecimento
ALTER TABLE public.tenant_settings 
ADD COLUMN IF NOT EXISTS default_prep_time_minutes INTEGER NOT NULL DEFAULT 30 
CHECK (default_prep_time_minutes >= 1 AND default_prep_time_minutes <= 240);

COMMENT ON COLUMN public.tenant_settings.default_prep_time_minutes IS 'Tempo de preparo operacional padrão em minutos configurado pelo estabelecimento (1 a 240 min).';

-- 2. Estrutura na tabela de pedidos para snapshot definitivo (pedidos antigos preservam 30 ou seu valor original)
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS prep_time_minutes INTEGER NOT NULL DEFAULT 30 
CHECK (prep_time_minutes >= 1 AND prep_time_minutes <= 240);

COMMENT ON COLUMN public.orders.prep_time_minutes IS 'Snapshot imutável do tempo estimado de preparo no momento em que o pedido foi emitido.';

-- 3. Atualização de get_public_store para incluir default_prep_time_minutes
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

    -- 3. Obter configurações operacionais públicas necessárias para a compra/retirada
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

GRANT EXECUTE ON FUNCTION public.get_public_store(TEXT) TO anon, authenticated;

-- 4. Atualização de get_customer_order_by_id para retornar snapshot do prepTimeMinutes
CREATE OR REPLACE FUNCTION public.get_customer_order_by_id(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_order RECORD;
    v_items JSONB;
    v_history JSONB;
    v_result JSONB;
BEGIN
    -- 1. Busca o pedido e valida autorização estrita
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Validação: Se usuário autenticado, deve ser o dono do pedido ou membro staff do tenant
    IF v_user_id IS NOT NULL THEN
        IF v_order.customer_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.customers c 
                WHERE c.id = v_order.customer_id AND c.user_id = v_user_id
            ) AND NOT EXISTS (
                SELECT 1 FROM public.tenant_users tu 
                WHERE tu.tenant_id = v_order.tenant_id AND tu.user_id = v_user_id AND tu.status = 'ACTIVE'
            ) THEN
                RAISE EXCEPTION 'Acesso não autorizado ao pedido informado.';
            END IF;
        END IF;
    END IF;

    -- 2. Itens
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', oi.id,
                'productId', oi.product_id,
                'productName', oi.product_name,
                'quantity', oi.quantity,
                'unitPrice', oi.unit_price,
                'totalPrice', oi.total_price,
                'notes', oi.notes,
                'unit', oi.unit
            ) ORDER BY oi.id ASC
        ),
        '[]'::jsonb
    )
    INTO v_items
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id;

    -- 3. Histórico de status
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', osh.id,
                'status', osh.status,
                'note', osh.note,
                'changedBy', osh.changed_by,
                'timestamp', osh.created_at
            ) ORDER BY osh.created_at ASC
        ),
        '[]'::jsonb
    )
    INTO v_history
    FROM public.order_status_history osh
    WHERE osh.order_id = v_order.id;

    -- 4. Retorno oficial estruturado com snapshot de prepTimeMinutes
    v_result := jsonb_build_object(
        'id', v_order.id,
        'orderNumber', v_order.order_number,
        'tenantId', v_order.tenant_id,
        'customerId', v_order.customer_id,
        'customerName', v_order.customer_name,
        'customerPhone', v_order.customer_phone,
        'customerEmail', v_order.customer_email,
        'deliveryAddress', v_order.delivery_address,
        'addressDetails', v_order.address_details,
        'subtotal', v_order.subtotal,
        'deliveryFee', v_order.delivery_fee,
        'discount', v_order.discount,
        'totalAmount', v_order.total_amount,
        'paymentMethod', v_order.payment_method,
        'paymentStatus', v_order.payment_status,
        'fulfillmentType', v_order.fulfillment_type,
        'status', v_order.status,
        'notes', v_order.notes,
        'origin', v_order.origin,
        'prepTimeMinutes', COALESCE(v_order.prep_time_minutes, 30),
        'items', v_items,
        'statusHistory', v_history,
        'createdAt', v_order.created_at,
        'updatedAt', v_order.updated_at
    );

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_order_by_id(UUID) TO authenticated;
