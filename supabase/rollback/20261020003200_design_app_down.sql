-- ==============================================================================
-- Rollback: 20261020003200_design_app_down.sql
-- Restaura get_public_store sem a coluna theme_tokens e remove a coluna theme_tokens.
-- ==============================================================================

BEGIN;

-- 1. Restaura get_public_store anterior (20261017001700_delivery_fee_split.sql)
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

    -- 3. Configurações operacionais públicas
    SELECT is_open, min_order_value, delivery_fee, free_delivery_threshold,
           estimated_delivery_time, address, city, phone_whatsapp,
           delivery_enabled, pickup_enabled, pickup_discount_enabled,
           pickup_discount_percent, pickup_discount_exclude_promotional,
           pickup_discount_excluded_product_ids, default_prep_time_minutes,
           delivery_fee_splits
    INTO v_settings
    FROM public.tenant_settings
    WHERE tenant_id = v_tenant.id;

    -- 4. Categorias ativas ordenadas
    SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.display_order ASC, c.name ASC), '[]'::jsonb)
    INTO v_categories
    FROM (
        SELECT id, tenant_id AS "tenantId", name, description, image_url AS "imageUrl",
               display_order AS "order", is_active AS "isActive"
        FROM public.categories
        WHERE tenant_id = v_tenant.id AND is_active = TRUE
    ) c;

    -- 5. Produtos ativos e disponíveis
    SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.display_order ASC, p.name ASC), '[]'::jsonb)
    INTO v_products
    FROM (
        SELECT id, tenant_id AS "tenantId", category_id AS "categoryId", name, description,
               image_url AS "imageUrl", price, promotional_price AS "promotionalPrice",
               unit, is_available AS "isAvailable", is_active AS "isActive",
               is_featured AS "isFeatured", display_order AS "order",
               promotional_discount_type AS "promotionalDiscountType",
               promotional_discount_value AS "promotionalDiscountValue"
        FROM public.products
        WHERE tenant_id = v_tenant.id AND is_active = TRUE AND is_available = TRUE
    ) p;

    -- 6. Cards de ofertas
    SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb)
    INTO v_offers
    FROM (
        SELECT id, tenant_id AS "tenantId", title, description, badge,
               discount_tag AS "discountTag", image_url AS "imageUrl",
               video_url AS "videoUrl", media_type AS "mediaType",
               video_duration AS "videoDuration",
               destination_type AS "destinationType", product_id AS "productId",
               custom_url AS "customUrl", background_color AS "backgroundColor",
               text_color AS "textColor", auto_overlay AS "autoOverlay",
               display_order AS "displayOrder", is_active AS "isActive",
               start_at AS "startAt", end_at AS "endAt",
               card_format AS "cardFormat", card_model AS "cardModel"
        FROM public.offers
        WHERE tenant_id = v_tenant.id
          AND is_active = TRUE
          AND (start_at IS NULL OR start_at <= v_now)
          AND (end_at IS NULL OR end_at >= v_now)
        ORDER BY display_order ASC, created_at DESC
    ) o;

    -- 7. Carrosséis de destaques
    SELECT COALESCE(jsonb_agg(to_jsonb(cr) ORDER BY cr.display_order ASC), '[]'::jsonb)
    INTO v_carousels
    FROM (
        SELECT id, tenant_id AS "tenantId", title, subtitle,
               card_format AS "cardFormat", display_order AS "displayOrder",
               is_active AS "isActive",
               (
                   SELECT COALESCE(jsonb_agg(to_jsonb(ci) ORDER BY ci.display_order ASC), '[]'::jsonb)
                   FROM (
                       SELECT id, carousel_id AS "carouselId", title, subtitle,
                              image_url AS "imageUrl", destination_type AS "destinationType",
                              product_id AS "productId", custom_url AS "customUrl",
                              display_order AS "displayOrder"
                       FROM public.promotion_carousel_items
                       WHERE carousel_id = promotion_carousels.id AND is_active = TRUE
                   ) ci
               ) AS items
        FROM public.promotion_carousels
        WHERE tenant_id = v_tenant.id AND is_active = TRUE
    ) cr;

    -- 8. Campanhas ativas
    SELECT COALESCE(jsonb_agg(to_jsonb(cmp) ORDER BY cmp.display_order ASC, cmp.created_at DESC), '[]'::jsonb)
    INTO v_campaigns
    FROM (
        SELECT c.id, c.tenant_id AS "tenantId", c.name, c.status,
               c.start_at AS "startAt", c.end_at AS "endAt",
               c.no_end_date AS "noEndDate", c.is_active AS "isActive",
               c.display_order AS "displayOrder", c.created_at,
               (
                   SELECT COALESCE(jsonb_agg(to_jsonb(cc) ORDER BY cc.display_order ASC, cc.created_at ASC), '[]'::jsonb)
                   FROM (
                       SELECT card.id, card.campaign_id AS "campaignId",
                              card.tenant_id AS "tenantId", card.model,
                              card.destination, card.title, card.subtitle,
                              card.badge_text AS "badgeText",
                              card.media_type AS "mediaType",
                              card.media_url AS "mediaUrl",
                              card.video_duration_seconds AS "videoDurationSeconds",
                              card.product_id AS "productId",
                              card.custom_path AS "customPath",
                              card.coupon_id AS "couponId",
                              card.show_coupon_code AS "showCouponCode",
                              card.display_order AS "displayOrder",
                              card.is_active AS "isActive",
                              (
                                  SELECT to_jsonb(p_sub)
                                  FROM (
                                      SELECT p.id, p.name, p.price,
                                             p.promotional_price AS "promotionalPrice",
                                             p.image_url AS "imageUrl"
                                      FROM public.products p
                                      WHERE p.id = card.product_id AND p.tenant_id = v_tenant.id
                                  ) p_sub
                              ) AS product,
                              (
                                  SELECT to_jsonb(cp_sub)
                                  FROM (
                                      SELECT cp.id, cp.code, cp.description,
                                             cp.discount_type AS "discountType",
                                             cp.discount_value AS "discountValue"
                                      FROM public.coupons cp
                                      WHERE cp.id = card.coupon_id
                                        AND cp.tenant_id = v_tenant.id
                                        AND cp.status = 'ACTIVE'
                                        AND (cp.starts_at IS NULL OR cp.starts_at <= v_now)
                                        AND (cp.expires_at IS NULL OR cp.expires_at >= v_now)
                                        AND (cp.max_uses IS NULL OR cp.current_uses < cp.max_uses)
                                  ) cp_sub
                              ) AS coupon
                       FROM public.campaign_cards card
                       WHERE card.campaign_id = c.id AND card.is_active = TRUE
                   ) cc
               ) AS cards
        FROM public.campaigns c
        WHERE c.tenant_id = v_tenant.id
          AND c.status = 'ACTIVE'
          AND c.is_active = TRUE
          AND (c.start_at IS NULL OR c.start_at <= v_now)
          AND (c.no_end_date = TRUE OR c.end_at IS NULL OR c.end_at >= v_now)
    ) cmp;

    RETURN jsonb_build_object(
        'tenant', to_jsonb(v_tenant),
        'theme', to_jsonb(v_theme),
        'settings', to_jsonb(v_settings),
        'categories', v_categories,
        'products', v_products,
        'offers', v_offers,
        'carousels', v_carousels,
        'campaigns', v_campaigns,
        'serverTime', v_now
    );
END;
$$;

-- 2. Remove coluna theme_tokens
ALTER TABLE public.tenant_themes
  DROP COLUMN IF EXISTS theme_tokens;

COMMIT;
