-- Migration: 20261003000027_fix_promotional_cards_public_store.sql
-- CORREÇÃO DE PRODUÇÃO: cards promocionais criados no painel não aparecem na vitrine.
--
-- Migration INCREMENTAL e BACKWARD-COMPATIBLE. Não altera as migrations 001–026.
-- Não remove colunas, não apaga dados e não muda assinaturas de RPC existentes.
--
-- CAUSAS-RAIZ CORRIGIDAS AQUI (lado banco):
--
-- 1) `offers.display_mode` NUNCA foi criada (nenhuma migration 001–026 a cria), mas
--    as versões de get_public_store das migrations 024, 025 e 026 leem `o.display_mode`.
--    Resultado: get_public_store falha com "column o.display_mode does not exist"
--    para QUALQUER slug — a vitrine inteira deixa de carregar.
--    Decisão de arquitetura: a coluna NÃO é criada. O "modo de exibição" do card é
--    derivado exclusivamente de `auto_overlay` (026). No painel (MarketingPage) o valor
--    enviado sempre foi `displayMode = autoOverlay ? 'EDITABLE_CARD' : 'FULL_MEDIA'`,
--    ou seja, display_mode seria uma cópia redundante de auto_overlay. A RPC passa a
--    devolver `displayMode` calculado a partir de `auto_overlay` (compatibilidade do JSON).
--
-- 2) A migration 026 reescreveu get_public_store SEM a chave `campaigns` adicionada na 025
--    (regressão). A 024 também removeu os filtros de estoque/preço/vigência dos itens de
--    `promotionCarousels` que a 023 tinha. A versão final abaixo consolida 022→026:
--    tenant, tema, configurações, categorias, produtos, cards (`offers`) com mídia,
--    agendamento, destino e checkout próprio, `promotionCarousels` com os filtros da 023,
--    `campaigns` com seus `cards` (modelo da 025) e `serverTime` (relógio do servidor).
--
-- 3) process_promotional_checkout_atomic (026) gravava `card_id = offers.id` em
--    campaign_analytics_events, mas `card_id` é FK para campaign_cards(id). Todo checkout
--    promocional violava a FK e sofria rollback. Agora `card_id` fica NULL e o vínculo
--    com o card vai em `offer_id` (que é a entidade real do card do painel).
--    A RPC também passa a: exigir que o card tenha checkout próprio configurado; respeitar
--    promo_min_quantity, promo_fulfillment_types e promo_payment_methods; usar a mesma regra
--    de vigência da vitrine (COALESCE(start_at, start_date) / COALESCE(end_at, end_date));
--    e aplicar o cupom informado NO SERVIDOR via redeem_coupon (antes `p_coupon_code`
--    era ignorado e o desconto existia só na tela). Cupom inválido => pedido rejeitado.
--    Também corrige o INSERT em customers da 026, que usava a coluna inexistente
--    `customers.notes` (segundo motivo de falha de todo checkout promocional), e passa a
--    atualizar as métricas do cliente (total_orders/ltv) como o checkout normal.
--
-- 4) Isolamento multi-tenant de campaign_cards: as policies da 025 só checavam
--    `campaign_cards.tenant_id`; nada impedia um card do tenant A apontar para campanha,
--    produto ou cupom do tenant B (e a vitrine da 025 buscava cards só por campaign_id).
--    Triggers abaixo bloqueiam essa inconsistência em INSERT/UPDATE, e a RPC pública
--    filtra cards, cupons e produtos pelo tenant do slug.
--
-- 5) GRANTs explícitos em campaigns/campaign_cards para `authenticated` (as policies RLS
--    da 025 continuam valendo: escrita só OWNER/MANAGER/CEO; leitura staff do tenant) e
--    REVOKE para `anon` (o público lê somente via get_public_store).
--
-- NÃO ESTÁ NESTA MIGRATION (plano de segurança separado, por decisão do fundador):
-- bypass de login, PIX, policies gerais de pedidos, seed cross-tenant, vazamento de
-- telefone, supabase/.temp, nem a reescrita do sistema de cupons / track_campaign_event.

-- ---------------------------------------------------------------------------
-- 0. Compatibilidade defensiva: se algum ambiente criou `display_mode` manualmente,
--    preserva a intenção do lojista em `auto_overlay` (fonte oficial). Não cria a coluna.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'offers' AND column_name = 'display_mode'
    ) THEN
        EXECUTE $q$
            UPDATE public.offers
               SET auto_overlay = false
             WHERE display_mode IN ('FULL_MEDIA', 'MEDIA_COMPLETA')
               AND auto_overlay = true
        $q$;
        RAISE NOTICE '027: coluna offers.display_mode encontrada (criada fora das migrations); auto_overlay sincronizado. A coluna não é mais lida por nenhuma função.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Consistência multi-tenant (triggers SECURITY DEFINER para não depender de RLS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_campaign_card_tenant_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_campaign_tenant UUID;
BEGIN
    SELECT tenant_id INTO v_campaign_tenant FROM public.campaigns WHERE id = NEW.campaign_id;
    IF v_campaign_tenant IS NULL OR v_campaign_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION 'campaign_cards: a campanha % não pertence ao estabelecimento %', NEW.campaign_id, NEW.tenant_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.product_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.products p WHERE p.id = NEW.product_id AND p.tenant_id = NEW.tenant_id
    ) THEN
        RAISE EXCEPTION 'campaign_cards: o produto % não pertence ao estabelecimento %', NEW.product_id, NEW.tenant_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.coupon_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.coupons c WHERE c.id = NEW.coupon_id AND c.tenant_id = NEW.tenant_id
    ) THEN
        RAISE EXCEPTION 'campaign_cards: o cupom % não pertence ao estabelecimento %', NEW.coupon_id, NEW.tenant_id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_campaign_card_tenant_consistency() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_campaign_cards_tenant_consistency ON public.campaign_cards;
CREATE TRIGGER trg_campaign_cards_tenant_consistency
    BEFORE INSERT OR UPDATE OF campaign_id, tenant_id, product_id, coupon_id
    ON public.campaign_cards
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_campaign_card_tenant_consistency();

CREATE OR REPLACE FUNCTION public.enforce_offer_product_tenant_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.product_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.products p WHERE p.id = NEW.product_id AND p.tenant_id = NEW.tenant_id
    ) THEN
        RAISE EXCEPTION 'offers: o produto % não pertence ao estabelecimento %', NEW.product_id, NEW.tenant_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_offer_product_tenant_consistency() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_offers_product_tenant_consistency ON public.offers;
CREATE TRIGGER trg_offers_product_tenant_consistency
    BEFORE INSERT OR UPDATE OF product_id, tenant_id
    ON public.offers
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_offer_product_tenant_consistency();

-- ---------------------------------------------------------------------------
-- 2. GRANTs explícitos (RLS da 025 continua sendo a regra de acesso)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.campaigns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.campaign_cards TO authenticated;
REVOKE ALL ON TABLE public.campaigns FROM anon;
REVOKE ALL ON TABLE public.campaign_cards FROM anon;

CREATE INDEX IF NOT EXISTS idx_campaign_cards_tenant_campaign_order
    ON public.campaign_cards(tenant_id, campaign_id, is_active, display_order);

-- ---------------------------------------------------------------------------
-- 3. get_public_store — VERSÃO FINAL CONSOLIDADA (022 → 026 + correções)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_store(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_tenant RECORD;
    v_theme RECORD;
    v_settings RECORD;
    v_categories JSONB;
    v_products JSONB;
    v_offers JSONB;
    v_carousels JSONB;
    v_campaigns JSONB;
BEGIN
    -- 1. Tenant ativo pelo slug (única fonte de tenant_id de toda a resposta)
    SELECT id, slug, name, phone, email, category, status
    INTO v_tenant
    FROM public.tenants
    WHERE slug = p_slug AND status = 'ACTIVE';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Estabelecimento com slug "%" não encontrado ou inativo', p_slug;
    END IF;

    -- 2. Tema visual público (inalterado desde 022)
    SELECT store_name, tagline, logo_url, banner_url, primary_color,
           secondary_color, background_color, card_color, button_color,
           text_color, border_radius, font_family
    INTO v_theme
    FROM public.tenant_themes
    WHERE tenant_id = v_tenant.id;

    -- 3. Configurações públicas (mesmos campos da 023–026; sem mudança de exposição)
    SELECT is_open, min_order_value, delivery_fee, free_delivery_threshold,
           estimated_delivery_time, COALESCE(default_prep_time_minutes, 30) AS default_prep_time_minutes,
           address, city, phone_whatsapp, pix_key
    INTO v_settings
    FROM public.tenant_settings
    WHERE tenant_id = v_tenant.id;

    -- 4. Categorias ativas
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

    -- 5. Produtos ativos
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

    -- 6. Cards promocionais do painel (tabela offers) publicados AGORA:
    --    is_active = true AND início <= agora AND (sem término OR término >= agora).
    --    Dois jsonb_build_object concatenados (limite de 100 argumentos por função).
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
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
            'displayMode', CASE WHEN COALESCE(o.auto_overlay, true) THEN 'EDITABLE_CARD' ELSE 'FULL_MEDIA' END,
            'autoOverlay', COALESCE(o.auto_overlay, true),
            'cardModel', COALESCE(o.card_model, 'HERO'),
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
            'noEndDate', (COALESCE(o.end_at, o.end_date) IS NULL),
            'backgroundColor', o.background_color,
            'accentColor', o.accent_color,
            'isActive', o.is_active,
            'createdAt', o.created_at
        )
        || jsonb_build_object(
            -- Mesma regra do backfill da 026: card legado/seed com produto e destino BANNER_ONLY abre o produto
            'destinationType', CASE
                WHEN o.destination_type IS NULL OR (o.destination_type = 'BANNER_ONLY' AND o.product_id IS NOT NULL)
                THEN CASE WHEN o.product_id IS NOT NULL THEN 'PRODUCT' ELSE 'BANNER_ONLY' END
                ELSE o.destination_type
            END,
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
            'remainingUses', CASE WHEN o.promo_usage_limit IS NOT NULL AND o.promo_usage_limit > 0
                                  THEN GREATEST(0, o.promo_usage_limit - COALESCE(o.promo_times_used, 0)) ELSE NULL END
        )
        ORDER BY o.display_order ASC, o.created_at ASC
    ), '[]'::jsonb)
    INTO v_offers
    FROM public.offers o
    WHERE o.tenant_id = v_tenant.id
      AND o.is_active = true
      AND (COALESCE(o.start_at, o.start_date) IS NULL OR COALESCE(o.start_at, o.start_date) <= v_now)
      AND (COALESCE(o.end_at, o.end_date) IS NULL OR COALESCE(o.end_at, o.end_date) >= v_now);

    -- 7. Carrosséis de produtos em promoção (filtros da 023 restaurados)
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
                JOIN public.products p ON p.id = pci.product_id AND p.tenant_id = v_tenant.id
                WHERE pci.carousel_id = pc.id
                  AND pci.tenant_id = v_tenant.id
                  AND pci.is_active = true
                  AND p.is_active = true
                  AND p.stock_quantity > 0
                  AND pci.promotional_price > 0
                  AND pci.promotional_price < p.price
                  AND (pci.start_date IS NULL OR pci.start_date <= v_now)
                  AND (pci.end_date IS NULL OR pci.end_date >= v_now)
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
          JOIN public.products p ON p.id = pci.product_id AND p.tenant_id = v_tenant.id
          WHERE pci.carousel_id = pc.id
            AND pci.tenant_id = v_tenant.id
            AND pci.is_active = true
            AND p.is_active = true
            AND p.stock_quantity > 0
            AND pci.promotional_price > 0
            AND pci.promotional_price < p.price
            AND (pci.start_date IS NULL OR pci.start_date <= v_now)
            AND (pci.end_date IS NULL OR pci.end_date >= v_now)
      );

    -- 8. Campanhas (modelo da 025) publicadas AGORA, com seus cards ativos ordenados.
    --    Cards, produtos e cupons sempre filtrados pelo tenant do slug.
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', cmp.id,
            'tenantId', cmp.tenant_id,
            'name', cmp.name,
            'description', cmp.description,
            'status', cmp.status,
            'startAt', cmp.start_at,
            'endAt', CASE WHEN cmp.no_end_date THEN NULL ELSE cmp.end_at END,
            'noEndDate', (cmp.no_end_date OR cmp.end_at IS NULL),
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
                        'product', (
                            SELECT jsonb_build_object(
                                'id', p.id,
                                'name', p.name,
                                'imageUrl', p.image_url,
                                'price', p.price,
                                'promotionalPrice', CASE
                                    WHEN p.promotional_price IS NOT NULL AND p.promotional_price > 0 AND p.promotional_price <= p.price
                                    THEN p.promotional_price ELSE NULL END,
                                'unit', p.unit,
                                'isAvailable', (p.stock_quantity > 0 AND p.is_active = true)
                            )
                            FROM public.products p
                            WHERE p.id = crd.product_id AND p.tenant_id = v_tenant.id AND p.is_active = true
                        ),
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
                            WHERE cpn.id = crd.coupon_id
                              AND cpn.tenant_id = v_tenant.id
                              AND cpn.is_active = true
                              AND (cpn.start_date IS NULL OR cpn.start_date <= v_now)
                              AND (cpn.end_date IS NULL OR cpn.end_date >= v_now)
                        )
                    ) ORDER BY crd.display_order ASC, crd.created_at ASC
                ), '[]'::jsonb)
                FROM public.campaign_cards crd
                WHERE crd.campaign_id = cmp.id
                  AND crd.tenant_id = v_tenant.id
                  AND crd.is_active = true
            )
        ) ORDER BY cmp.display_order ASC, cmp.created_at DESC
    ), '[]'::jsonb)
    INTO v_campaigns
    FROM public.campaigns cmp
    WHERE cmp.tenant_id = v_tenant.id
      AND cmp.is_active = true
      AND cmp.status IN ('ACTIVE', 'SCHEDULED')
      AND (cmp.start_at IS NULL OR cmp.start_at <= v_now)
      AND (cmp.no_end_date = true OR cmp.end_at IS NULL OR cmp.end_at >= v_now)
      AND EXISTS (
          SELECT 1 FROM public.campaign_cards crd
          WHERE crd.campaign_id = cmp.id AND crd.tenant_id = v_tenant.id AND crd.is_active = true
      );

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
        'promotionCarousels', v_carousels,
        'campaigns', v_campaigns,
        'serverTime', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_store(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_store(TEXT) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. process_promotional_checkout_atomic — FK corrigida + regras do card + cupom no servidor
--    (mesma assinatura da 026; o frontend não precisa mudar a chamada)
-- ---------------------------------------------------------------------------
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
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_unit_price NUMERIC(10,2);
    v_orig_price NUMERIC(10,2);
    v_subtotal NUMERIC(10,2) := 0.00;
    v_coupon_discount NUMERIC(10,2) := 0.00;
    v_total_amount NUMERIC(10,2) := 0.00;
    v_fulfillment VARCHAR(16);
    v_coupon_code TEXT := NULLIF(UPPER(TRIM(COALESCE(p_coupon_code, ''))), '');
    v_coupon_result JSONB;

    v_customer_id UUID;
    v_order_id UUID;
    v_clean_phone VARCHAR(32);
    v_clean_address TEXT;
    v_new_usage_count INT;
    v_redemption_msg TEXT := NULL;
    v_item_name TEXT;
    v_item_unit VARCHAR(16);
BEGIN
    -- 1. Checkout promocional exige cliente autenticado
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Autenticação necessária. É necessário estar conectado para finalizar o pedido promocional.';
    END IF;

    -- 2. Dados do cliente
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

    -- 3. Tenant
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
    v_delivery_fee := COALESCE(v_delivery_fee, 0.00);

    -- 4. Quantidade
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'A quantidade deve ser de pelo menos 1 unidade.';
    END IF;

    -- 5. Card promocional travado (FOR UPDATE) e SEMPRE do tenant do slug
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

    IF NOT (COALESCE(v_offer.has_promo_checkout, false) OR v_offer.destination_type = 'CUSTOM_OFFER') THEN
        RAISE EXCEPTION 'Este card não possui checkout promocional próprio.';
    END IF;

    -- Mesma regra de vigência usada por get_public_store
    v_start := COALESCE(v_offer.start_at, v_offer.start_date);
    v_end := COALESCE(v_offer.end_at, v_offer.end_date);
    IF v_start IS NOT NULL AND v_start > NOW() THEN
        RAISE EXCEPTION 'Esta promoção ainda não iniciou.';
    END IF;
    IF v_end IS NOT NULL AND v_end < NOW() THEN
        RAISE EXCEPTION 'Esta promoção expirou.';
    END IF;

    -- Limite atômico de usos
    IF v_offer.promo_usage_limit IS NOT NULL AND v_offer.promo_usage_limit > 0 THEN
        IF v_offer.promo_times_used >= v_offer.promo_usage_limit THEN
            RAISE EXCEPTION 'Esta promoção atingiu o limite máximo de % usos e está esgotada.', v_offer.promo_usage_limit;
        END IF;
    END IF;

    -- Quantidade mínima / máxima configurada no card
    IF v_offer.promo_min_quantity IS NOT NULL AND p_quantity < v_offer.promo_min_quantity THEN
        RAISE EXCEPTION 'A quantidade mínima desta promoção é de % unidades.', v_offer.promo_min_quantity;
    END IF;
    IF v_offer.promo_max_quantity_per_customer IS NOT NULL AND p_quantity > v_offer.promo_max_quantity_per_customer THEN
        RAISE EXCEPTION 'A quantidade máxima permitida por cliente nesta promoção é de % unidades.', v_offer.promo_max_quantity_per_customer;
    END IF;

    -- Tipo de entrega e forma de pagamento permitidos pelo card
    v_fulfillment := CASE WHEN p_fulfillment_type = 'DELIVERY' THEN 'DELIVERY' ELSE 'PICKUP' END;
    IF v_offer.promo_fulfillment_types IS NOT NULL
       AND jsonb_typeof(v_offer.promo_fulfillment_types) = 'array'
       AND jsonb_array_length(v_offer.promo_fulfillment_types) > 0
       AND NOT (v_offer.promo_fulfillment_types ? v_fulfillment) THEN
        RAISE EXCEPTION 'Tipo de entrega "%" não está disponível para esta promoção.', v_fulfillment;
    END IF;
    IF v_offer.promo_payment_methods IS NOT NULL
       AND jsonb_typeof(v_offer.promo_payment_methods) = 'array'
       AND jsonb_array_length(v_offer.promo_payment_methods) > 0
       AND NOT (v_offer.promo_payment_methods ? COALESCE(p_payment_method, '')) THEN
        RAISE EXCEPTION 'Forma de pagamento "%" não está disponível para esta promoção.', p_payment_method;
    END IF;

    -- Preço oficial vem do banco (nunca do navegador)
    v_unit_price := COALESCE(v_offer.promo_price, v_offer.promotional_price, v_offer.original_price, 0.00);
    v_orig_price := COALESCE(v_offer.promo_original_price, v_offer.original_price, v_unit_price);
    v_item_name := COALESCE(v_offer.promo_title, v_offer.title);
    v_item_unit := COALESCE(v_offer.promo_unit, 'un');

    IF v_unit_price <= 0 THEN
        RAISE EXCEPTION 'Preço promocional inválido no cadastro da promoção.';
    END IF;

    v_subtotal := v_unit_price * p_quantity;

    -- Produto do catálogo vinculado: estoque com lock
    IF v_offer.product_id IS NOT NULL THEN
        SELECT * INTO v_prod FROM public.products
        WHERE id = v_offer.product_id AND tenant_id = v_tenant_id
        FOR UPDATE;

        IF FOUND THEN
            IF v_prod.stock_quantity < p_quantity THEN
                RAISE EXCEPTION 'Estoque insuficiente para o produto da promoção. Disponível: %', v_prod.stock_quantity;
            END IF;
            UPDATE public.products
            SET stock_quantity = stock_quantity - p_quantity,
                updated_at = NOW()
            WHERE id = v_prod.id;
        END IF;
    END IF;

    -- 6. Entrega e taxa
    IF v_fulfillment = 'DELIVERY' THEN
        v_clean_address := trim(COALESCE(p_delivery_address, ''));
        IF v_clean_address = '' THEN
            RAISE EXCEPTION 'Endereço de entrega é obrigatório para entrega.';
        END IF;
        IF v_free_threshold IS NOT NULL AND v_subtotal >= v_free_threshold THEN
            v_delivery_fee := 0.00;
        END IF;
    ELSE
        v_clean_address := 'Retirada no Balcão';
        v_delivery_fee := 0.00;
    END IF;

    -- 7. Cliente do tenant (mesmo padrão de process_checkout_atomic: vínculo por auth.uid();
    --    a 026 inseria a coluna inexistente customers.notes e quebrava o checkout)
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE tenant_id = v_tenant_id AND user_id = v_user_id
    LIMIT 1;

    PERFORM set_config('app.internal_customer_update', 'true', true);
    IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (
            tenant_id, user_id, name, phone, email, origin,
            total_orders, ltv_amount, first_order_date, last_order_date
        ) VALUES (
            v_tenant_id, v_user_id, trim(p_customer_name), v_clean_phone, NULLIF(trim(COALESCE(p_customer_email, '')), ''), 'direct',
            0, 0.00, CURRENT_DATE, CURRENT_DATE
        ) RETURNING id INTO v_customer_id;
    ELSE
        UPDATE public.customers
        SET name = COALESCE(NULLIF(trim(p_customer_name), ''), name),
            phone = v_clean_phone,
            email = COALESCE(NULLIF(trim(COALESCE(p_customer_email, '')), ''), email),
            updated_at = NOW()
        WHERE id = v_customer_id
          AND user_id = v_user_id;
    END IF;
    PERFORM set_config('app.internal_customer_update', 'false', true);

    v_total_amount := v_subtotal + v_delivery_fee;

    -- 8. Contador atômico de usos do card
    v_new_usage_count := v_offer.promo_times_used + 1;
    UPDATE public.offers
    SET promo_times_used = v_new_usage_count,
        updated_at = NOW()
    WHERE id = v_offer.id;

    IF v_offer.promo_usage_limit IS NOT NULL AND v_offer.promo_usage_limit > 0 THEN
        v_redemption_msg := format('🎉 Parabéns! Você foi o cliente nº %s a aproveitar esta promoção!', v_new_usage_count);
    END IF;

    -- 9. Pedido real
    INSERT INTO public.orders (
        tenant_id, customer_id, customer_name, customer_phone, customer_email,
        delivery_address, address_details, subtotal, delivery_fee, discount, total_amount,
        payment_method, payment_status, fulfillment_type, status, notes, origin,
        prep_time_minutes, offer_id, campaign_metadata
    ) VALUES (
        v_tenant_id, v_customer_id, p_customer_name, v_clean_phone, p_customer_email,
        v_clean_address, COALESCE(p_address_details, '{}'::jsonb), v_subtotal, v_delivery_fee, 0.00, v_total_amount,
        p_payment_method, 'PENDING', v_fulfillment, 'PENDING', COALESCE(p_notes, ''), 'promotional_checkout',
        v_default_prep, v_offer.id,
        jsonb_build_object(
            'offer_id', v_offer.id,
            'offer_title', v_offer.title,
            'redemption_number', v_new_usage_count,
            'is_limited', (v_offer.promo_usage_limit IS NOT NULL AND v_offer.promo_usage_limit > 0)
        )
    ) RETURNING id INTO v_order_id;

    -- 10. Item do pedido vinculado ao card (offer_id) e, se houver, ao produto
    INSERT INTO public.order_items (
        order_id, product_id, product_name, quantity, unit_price, total_price, notes, unit,
        offer_id, original_price, discount_amount, discount_percentage
    ) VALUES (
        v_order_id, v_offer.product_id, v_item_name, p_quantity, v_unit_price, v_subtotal,
        COALESCE(p_notes, 'Oferta Promocional Exclusiva'), v_item_unit,
        v_offer.id, v_orig_price, GREATEST(0, (v_orig_price - v_unit_price) * p_quantity), v_offer.promo_discount_percentage
    );

    -- 11. Cupom aplicado NO SERVIDOR (mesma regra atômica de redeem_coupon da 025).
    --     Cupom inválido/esgotado/expirado => exceção => rollback do pedido inteiro.
    IF v_coupon_code IS NOT NULL THEN
        v_coupon_result := public.redeem_coupon(
            v_tenant_id, v_coupon_code, v_order_id, v_customer_id, v_subtotal, NULL::UUID, NULL::UUID
        );
        IF NOT COALESCE((v_coupon_result->>'success')::BOOLEAN, false) THEN
            RAISE EXCEPTION 'Cupom recusado: %', COALESCE(v_coupon_result->>'message', 'cupom inválido.');
        END IF;
        v_coupon_discount := LEAST(v_subtotal, COALESCE((v_coupon_result->>'discount_amount')::NUMERIC, 0));
        v_total_amount := GREATEST(0, v_subtotal + v_delivery_fee - v_coupon_discount);
        UPDATE public.orders
        SET discount = v_coupon_discount,
            total_amount = v_total_amount
        WHERE id = v_order_id;
    END IF;

    -- Métricas do cliente (CRM) com o total FINAL do pedido
    PERFORM set_config('app.internal_customer_update', 'true', true);
    UPDATE public.customers
    SET total_orders = total_orders + 1,
        ltv_amount = ltv_amount + v_total_amount,
        last_order_date = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = v_customer_id;
    PERFORM set_config('app.internal_customer_update', 'false', true);

    -- 12. Histórico de status
    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (v_order_id, 'PENDING', 'Pedido confirmado via Checkout Promocional', 'Checkout Promocional');

    -- 13. Analytics: card_id é FK de campaign_cards => NULL; o card do painel vai em offer_id
    INSERT INTO public.campaign_analytics_events (
        tenant_id, card_id, offer_id, product_id, coupon_id, customer_id, order_id,
        event_type, event_value, quantity, metadata
    ) VALUES (
        v_tenant_id, NULL, v_offer.id, v_offer.product_id,
        CASE WHEN v_coupon_result IS NOT NULL THEN (v_coupon_result->>'coupon_id')::UUID ELSE NULL END,
        v_customer_id, v_order_id, 'CHECKOUT_COMPLETED', v_total_amount, p_quantity,
        jsonb_build_object(
            'offer_title', v_item_name,
            'redemption_number', v_new_usage_count,
            'unit_price', v_unit_price,
            'coupon_code', v_coupon_code,
            'coupon_discount', v_coupon_discount
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'redemption_number', v_new_usage_count,
        'celebration_message', v_redemption_msg,
        'subtotal', v_subtotal,
        'delivery_fee', v_delivery_fee,
        'discount', v_coupon_discount,
        'coupon_code', CASE WHEN v_coupon_result IS NOT NULL THEN v_coupon_result->>'coupon_code' ELSE NULL END,
        'total_amount', v_total_amount,
        'is_exhausted', (v_offer.promo_usage_limit IS NOT NULL AND v_offer.promo_usage_limit > 0 AND v_new_usage_count >= v_offer.promo_usage_limit)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_promotional_checkout_atomic(TEXT, UUID, INT, VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB, VARCHAR, VARCHAR, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_promotional_checkout_atomic(TEXT, UUID, INT, VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB, VARCHAR, VARCHAR, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_promotional_checkout_atomic(TEXT, UUID, INT, VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB, VARCHAR, VARCHAR, TEXT, TEXT) TO authenticated, service_role;
