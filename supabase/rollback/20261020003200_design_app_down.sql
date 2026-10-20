-- Rollback 20261020003200_design_app: restore get_public_store (20261017001700) first, then drop the column.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_public_store(p_slug text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
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
    v_now TIMESTAMPTZ := now();
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

    -- 3. Configurações operacionais públicas (N6: + default_prep_time_minutes; sem pix_key)
    SELECT is_open, min_order_value, public._delivery_fee_customer_part(delivery_fee) AS delivery_fee, free_delivery_threshold,
           estimated_delivery_time, address, city, phone_whatsapp, default_prep_time_minutes
    INTO v_settings
    FROM public.tenant_settings
    WHERE tenant_id = v_tenant.id;

    -- 4. Categorias públicas do tenant
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

    -- 5. Produtos públicos ativos (sem cost_price, sku ou estoque). Preço promocional = servidor.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'tenantId', p.tenant_id,
        'categoryId', p.category_id,
        'name', p.name,
        'description', p.description,
        'imageUrl', p.image_url,
        'price', p.price,
        'promotionalPrice', CASE WHEN ep.is_promotional THEN ep.unit_price ELSE NULL END,
        'effectivePrice', ep.unit_price,
        'priceSource', ep.price_source,
        'unit', p.unit,
        'isAvailable', (p.stock_quantity > 0 AND p.is_active = true),
        'isActive', p.is_active,
        'isFeatured', p.is_featured
    ) ORDER BY p.name ASC), '[]'::jsonb)
    INTO v_products
    FROM public.products p
    CROSS JOIN LATERAL public._effective_product_price(p.tenant_id, p.id, v_now) ep
    WHERE p.tenant_id = v_tenant.id AND p.is_active = true;

    -- 6. Ofertas públicas na vigência. F1-A: vínculo de produto de outro tenant é ignorado.
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
        'isActive', o.is_active,
        'media', public._public_media_json(o.tenant_id, o.media_asset_id),
        'autoOverlay', o.auto_overlay,
        'hasPromoCheckout', (o.has_promo_checkout AND o.product_id IS NOT NULL),
        'promoPrice', CASE WHEN o.has_promo_checkout AND o.product_id IS NOT NULL
                           THEN LEAST(o.promo_price, ep.unit_price) END,
        'promoFulfillment', CASE WHEN o.has_promo_checkout THEN o.promo_fulfillment END,
        'promoMaxQtyPerOrder', CASE WHEN o.has_promo_checkout THEN o.promo_max_qty_per_order END,
        'promoAvailable', (o.has_promo_checkout AND o.product_id IS NOT NULL
                           AND (o.promo_usage_limit IS NULL OR o.promo_times_used < o.promo_usage_limit)
                           AND COALESCE(pp.stock_quantity, 0) > 0 AND COALESCE(pp.is_active, false))
    ) ORDER BY o.display_order ASC), '[]'::jsonb)
    INTO v_offers
    FROM public.offers o
    LEFT JOIN public.products pp ON pp.id = o.product_id AND pp.tenant_id = o.tenant_id
    LEFT JOIN LATERAL public._effective_product_price(o.tenant_id, o.product_id, v_now) ep ON o.product_id IS NOT NULL
    WHERE o.tenant_id = v_tenant.id
      AND (o.product_id IS NULL OR pp.id IS NOT NULL)
      AND public._offer_is_live(o.id, v_now);

    -- 7. (N6) Carrosséis ativos e visíveis na loja; preço do item = _effective_product_price.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'description', c.description,
        'cover', public._public_media_json(c.tenant_id, c.cover_asset_id),
        'order', c.display_order,
        'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'productId', i.product_id,
                    'price', p.price,
                    'effectivePrice', ep.unit_price,
                    'isPromotional', ep.is_promotional,
                    'isAvailable', (p.stock_quantity > 0),
                    'order', i.display_order) ORDER BY i.display_order, i.product_id)
                 FROM public.promotion_carousel_items i
                 JOIN public.products p ON p.id = i.product_id AND p.tenant_id = i.tenant_id AND p.is_active
                 CROSS JOIN LATERAL public._effective_product_price(p.tenant_id, p.id, v_now) ep
                 WHERE i.carousel_id = c.id AND i.tenant_id = c.tenant_id AND i.is_active
                   AND (i.start_at IS NULL OR i.start_at <= v_now) AND (i.end_at IS NULL OR i.end_at > v_now)), '[]'::jsonb)
    ) ORDER BY c.display_order, c.id), '[]'::jsonb)
    INTO v_carousels
    FROM public.promotion_carousels c
    WHERE c.tenant_id = v_tenant.id AND c.is_active AND c.show_in_store
      AND (c.start_at IS NULL OR c.start_at <= v_now) AND (c.end_at IS NULL OR c.end_at > v_now);

    -- 8. (N6) Campanhas ACTIVE na janela, com cards visíveis (_campaign_card_visible_at).
    --    Nunca: name/internal_notes da campanha, contadores, limites, cupom não exibido.
    SELECT COALESCE(jsonb_agg(x.j ORDER BY x.display_order, x.id), '[]'::jsonb)
    INTO v_campaigns
    FROM (
        SELECT k.id, k.display_order, jsonb_build_object(
            'id', k.id,
            'title', k.public_title,
            'channel', k.channel,
            'shareSlug', k.share_slug,
            'order', k.display_order,
            'cards', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'id', cd.id,
                        'campaignId', cd.campaign_id,
                        'mode', cd.commercial_mode,
                        'title', cd.title,
                        'subtitle', cd.subtitle,
                        'ctaLabel', cd.cta_label,
                        'media', public._public_media_json(cd.tenant_id, cd.media_asset_id),
                        'autoOverlay', cd.auto_overlay,
                        'offerId', cd.offer_id,
                        'productId', COALESCE(cd.product_id, ofr.product_id),
                        'couponCode', CASE WHEN cd.show_coupon_code AND cp.status = 'ACTIVE' THEN cp.code END,
                        'customName', cd.custom_name,
                        'price', CASE cd.commercial_mode
                                    WHEN 'CUSTOM' THEN cd.custom_price
                                    WHEN 'PRODUCT' THEN CASE WHEN cd.card_promotional_price IS NOT NULL
                                                             THEN LEAST(cd.card_promotional_price, epc.unit_price)
                                                             ELSE epc.unit_price END
                                    WHEN 'OFFER' THEN CASE WHEN ofr.has_promo_checkout THEN LEAST(ofr.promo_price, epo.unit_price)
                                                           ELSE epo.unit_price END
                                 END,
                        'originalPrice', CASE cd.commercial_mode
                                    WHEN 'CUSTOM' THEN COALESCE(cd.custom_original_price, cd.custom_price)
                                    WHEN 'PRODUCT' THEN pc.price
                                    WHEN 'OFFER' THEN po.price END,
                        'purchasable', (cd.commercial_mode <> 'BANNER_ONLY'
                                        AND (cd.commercial_mode <> 'OFFER' OR ofr.has_promo_checkout)
                                        AND (cd.commercial_mode NOT IN ('CUSTOM','PRODUCT') OR cd.custom_usage_limit IS NULL
                                             OR cd.custom_times_used < cd.custom_usage_limit)
                                        AND (cd.commercial_mode <> 'OFFER' OR ofr.promo_usage_limit IS NULL
                                             OR ofr.promo_times_used < ofr.promo_usage_limit)),
                        'fulfillment', CASE WHEN cd.commercial_mode = 'OFFER' THEN ofr.promo_fulfillment ELSE cd.custom_fulfillment END,
                        'maxQtyPerOrder', CASE WHEN cd.commercial_mode = 'OFFER' THEN ofr.promo_max_qty_per_order ELSE cd.custom_max_qty_per_order END,
                        'order', cd.display_order) ORDER BY cd.display_order, cd.id)
                     FROM public.campaign_cards cd
                     LEFT JOIN public.offers ofr ON ofr.id = cd.offer_id AND ofr.tenant_id = cd.tenant_id
                     LEFT JOIN public.products po ON po.id = ofr.product_id AND po.tenant_id = cd.tenant_id
                     LEFT JOIN public.products pc ON pc.id = cd.product_id AND pc.tenant_id = cd.tenant_id
                     LEFT JOIN public.coupons cp ON cp.id = cd.coupon_id AND cp.tenant_id = cd.tenant_id
                     LEFT JOIN LATERAL public._effective_product_price(cd.tenant_id, po.id, v_now) epo ON po.id IS NOT NULL
                     LEFT JOIN LATERAL public._effective_product_price(cd.tenant_id, pc.id, v_now) epc ON pc.id IS NOT NULL
                     WHERE cd.campaign_id = k.id AND cd.tenant_id = k.tenant_id
                       AND public._campaign_card_visible_at(cd.id, v_now)
                       AND (cd.commercial_mode <> 'PRODUCT' OR pc.is_active)), '[]'::jsonb)
        ) AS j
        FROM public.campaigns k
        WHERE k.tenant_id = v_tenant.id AND k.status = 'ACTIVE'
          AND (k.start_at IS NULL OR k.start_at <= v_now) AND (k.end_at IS NULL OR k.end_at > v_now)
    ) x;

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
        'offers', v_offers,
        'carousels', v_carousels,
        'campaigns', v_campaigns
    );
END;
$$;

ALTER TABLE public.tenant_themes DROP CONSTRAINT IF EXISTS tenant_themes_theme_tokens_valid;
ALTER TABLE public.tenant_themes DROP COLUMN IF EXISTS theme_tokens;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261020003200';
NOTIFY pgrst, 'reload schema';
COMMIT;
