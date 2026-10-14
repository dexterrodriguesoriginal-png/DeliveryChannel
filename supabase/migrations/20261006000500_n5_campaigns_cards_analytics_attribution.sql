-- ============================================================================
-- N5 — CAMPANHAS, CARDS, ANALYTICS (SEM EFEITO FINANCEIRO) E ATRIBUIÇÃO
-- DESIGN_N1_N6_ARQUITETURA_v3 (decisões 3, 10, 16; F2). Regras 35–38.
--
-- Cria:      campaigns, campaign_cards, campaign_analytics_events (sem coluna de IP);
--            coupons.campaign_id; atribuição em orders (campaign_id, card_id, offer_id,
--            attribution_source) e order_items (offer_id, card_id); order_items.product_id
--            passa a aceitar NULL só para item CUSTOM (CHECK); funções de visibilidade
--            (ponto único para frequency_rules), cadeia de card, transição de status,
--            track_campaign_event (só INSERT em analytics), evento PURCHASE do servidor,
--            métricas (receita de orders válidos) e ajuste de contadores promocionais.
-- Redefine:  _orders_promo_lifecycle (N2) e _checkout_core (N2, só para atribuição + PURCHASE).
-- Intocado:  preços, estoque, cupons e pedidos não são alterados por analytics.
-- Também:   get_promo_offer_performance (desempenho por card/oferta, OWNER/MANAGER) e
--            índice idx_orders_tenant_offer_created (aba Marketing → Desempenho & Vendas).
-- Rollback:  supabase/rollback/n5_rollback.sql (manual).
-- ============================================================================
DO $pre$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006000400') THEN
        RAISE EXCEPTION 'N5 PRE: N4 (20261006000400) não registrada; abortado.';
    END IF;
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version > '20261006000400') THEN
        RAISE EXCEPTION 'N5 PRE: há migrations posteriores à N4 registradas; ordem inesperada.';
    END IF;
    IF to_regclass('public.campaigns') IS NOT NULL OR to_regclass('public.campaign_cards') IS NOT NULL
       OR to_regclass('public.campaign_analytics_events') IS NOT NULL THEN
        RAISE EXCEPTION 'N5 PRE: tabelas de campanha já existem; abortado.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND (
        (table_name='orders' AND column_name IN ('campaign_id','card_id','offer_id','attribution_source'))
        OR (table_name='order_items' AND column_name IN ('offer_id','card_id'))
        OR (table_name='coupons' AND column_name = 'campaign_id'))) THEN
        RAISE EXCEPTION 'N5 PRE: colunas de atribuição já existem; abortado.';
    END IF;
    IF position('@@N5_ATTR_RESOLVE@@' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure(
        'public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)'))) = 0 THEN
        RAISE EXCEPTION 'N5 PRE: _checkout_core não corresponde à versão da N2; abortado.';
    END IF;
END
$pre$;

CREATE TABLE public.campaigns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    public_title    VARCHAR(255),
    internal_notes  TEXT,
    status          VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SCHEDULED','ACTIVE','PAUSED','ENDED','ARCHIVED')),
    start_at        TIMESTAMPTZ,
    end_at          TIMESTAMPTZ,
    timezone        VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    channel         VARCHAR(16) CHECK (channel IS NULL OR channel IN ('STOREFRONT','QR','LINK','WHATSAPP','EMAIL','SOCIAL')),
    share_slug      VARCHAR(64) CHECK (share_slug IS NULL OR share_slug ~ '^[a-z0-9-]{3,64}$'),
    display_order   INTEGER NOT NULL DEFAULT 0,
    created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
    published_at    TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT campaigns_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT campaigns_window CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at),
    CONSTRAINT campaigns_share_slug_key UNIQUE (tenant_id, share_slug)
);
CREATE INDEX idx_campaigns_tenant_status ON public.campaigns (tenant_id, status, display_order);

CREATE TABLE public.campaign_cards (
    id                               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    campaign_id                      UUID NOT NULL,
    commercial_mode                  VARCHAR(16) NOT NULL CHECK (commercial_mode IN ('OFFER','PRODUCT','CUSTOM','BANNER_ONLY')),
    offer_id                         UUID,
    product_id                       UUID,
    coupon_id                        UUID,
    title                            VARCHAR(255) NOT NULL,
    subtitle                         VARCHAR(255),
    cta_label                        VARCHAR(40),
    media_asset_id                   UUID,
    auto_overlay                     BOOLEAN NOT NULL DEFAULT true,
    show_coupon_code                 BOOLEAN NOT NULL DEFAULT false,
    card_promotional_price           NUMERIC(10,2) CHECK (card_promotional_price IS NULL OR card_promotional_price > 0),
    custom_name                      VARCHAR(255),
    custom_price                     NUMERIC(10,2) CHECK (custom_price IS NULL OR custom_price > 0),
    custom_original_price            NUMERIC(10,2),
    custom_usage_limit               INTEGER CHECK (custom_usage_limit IS NULL OR custom_usage_limit > 0),
    custom_usage_limit_per_customer  INTEGER CHECK (custom_usage_limit_per_customer IS NULL OR custom_usage_limit_per_customer > 0),
    custom_times_used                INTEGER NOT NULL DEFAULT 0,
    custom_fulfillment               VARCHAR(16) CHECK (custom_fulfillment IS NULL OR custom_fulfillment IN ('DELIVERY','PICKUP','BOTH')),
    custom_max_qty_per_order         INTEGER CHECK (custom_max_qty_per_order IS NULL OR custom_max_qty_per_order > 0),
    display_order                    INTEGER NOT NULL DEFAULT 0,
    is_active                        BOOLEAN NOT NULL DEFAULT true,
    start_at                         TIMESTAMPTZ,
    end_at                           TIMESTAMPTZ,
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT campaign_cards_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT campaign_cards_window CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at),
    CONSTRAINT campaign_cards_custom_original CHECK (custom_original_price IS NULL OR custom_price IS NULL OR custom_original_price >= custom_price),
    CONSTRAINT campaign_cards_times_used CHECK (custom_times_used >= 0 AND (custom_usage_limit IS NULL OR custom_times_used <= custom_usage_limit)),
    CONSTRAINT campaign_cards_mode CHECK (
        (commercial_mode = 'OFFER' AND offer_id IS NOT NULL AND card_promotional_price IS NULL
            AND custom_name IS NULL AND custom_price IS NULL AND custom_original_price IS NULL)
     OR (commercial_mode = 'PRODUCT' AND product_id IS NOT NULL AND offer_id IS NULL
            AND custom_name IS NULL AND custom_price IS NULL AND custom_original_price IS NULL)
     OR (commercial_mode = 'CUSTOM' AND offer_id IS NULL AND product_id IS NULL AND custom_name IS NOT NULL
            AND custom_price IS NOT NULL AND card_promotional_price IS NULL)
     OR (commercial_mode = 'BANNER_ONLY' AND offer_id IS NULL AND product_id IS NULL AND custom_price IS NULL
            AND card_promotional_price IS NULL)),
    CONSTRAINT campaign_cards_campaign_fk FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT campaign_cards_offer_fk FOREIGN KEY (tenant_id, offer_id) REFERENCES public.offers (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT campaign_cards_product_fk FOREIGN KEY (tenant_id, product_id) REFERENCES public.products (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT campaign_cards_coupon_fk FOREIGN KEY (tenant_id, coupon_id) REFERENCES public.coupons (tenant_id, id) ON DELETE SET NULL (coupon_id),
    CONSTRAINT campaign_cards_media_fk FOREIGN KEY (tenant_id, media_asset_id) REFERENCES public.marketing_media_assets (tenant_id, id) ON DELETE SET NULL (media_asset_id)
);
CREATE INDEX idx_campaign_cards_campaign ON public.campaign_cards (campaign_id, display_order);
CREATE INDEX idx_campaign_cards_offer ON public.campaign_cards (tenant_id, offer_id) WHERE offer_id IS NOT NULL;
CREATE INDEX idx_campaign_cards_product ON public.campaign_cards (tenant_id, product_id) WHERE product_id IS NOT NULL;

CREATE TABLE public.campaign_analytics_events (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    campaign_id   UUID,
    card_id       UUID,
    offer_id      UUID,
    order_id      UUID,
    event_type    VARCHAR(32) NOT NULL CHECK (event_type IN ('IMPRESSION','CARD_VIEW','CARD_CLICK','VIDEO_PLAY','COUPON_COPY','CHECKOUT_START','PURCHASE')),
    source        VARCHAR(8) NOT NULL CHECK (source IN ('CLIENT','SERVER')),
    session_hash  TEXT,
    user_hash     TEXT,
    dedupe_key    TEXT NOT NULL,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(metadata::text) <= 1024),
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cae_purchase_server_only CHECK (event_type <> 'PURCHASE' OR source = 'SERVER'),
    CONSTRAINT uq_events_dedupe UNIQUE (tenant_id, dedupe_key),
    CONSTRAINT cae_campaign_fk FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT cae_card_fk FOREIGN KEY (tenant_id, card_id) REFERENCES public.campaign_cards (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT cae_offer_fk FOREIGN KEY (tenant_id, offer_id) REFERENCES public.offers (tenant_id, id) ON DELETE SET NULL (offer_id),
    CONSTRAINT cae_order_fk FOREIGN KEY (tenant_id, order_id) REFERENCES public.orders (tenant_id, id) ON DELETE SET NULL (order_id)
);
CREATE INDEX idx_events_campaign ON public.campaign_analytics_events (tenant_id, campaign_id, event_type, occurred_at);
CREATE INDEX idx_events_card ON public.campaign_analytics_events (tenant_id, card_id, occurred_at);

ALTER TABLE public.coupons ADD COLUMN campaign_id UUID;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_campaign_fk FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES public.campaigns (tenant_id, id) ON DELETE SET NULL (campaign_id);
GRANT INSERT (campaign_id), UPDATE (campaign_id) ON public.coupons TO authenticated;

ALTER TABLE public.orders
    ADD COLUMN campaign_id UUID,
    ADD COLUMN card_id UUID,
    ADD COLUMN offer_id UUID,
    ADD COLUMN attribution_source VARCHAR(16) CHECK (attribution_source IS NULL OR attribution_source IN ('CARD','OFFER','CAROUSEL','COUPON','DIRECT'));
ALTER TABLE public.orders
    ADD CONSTRAINT orders_campaign_fk FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns (tenant_id, id) ON DELETE SET NULL (campaign_id),
    ADD CONSTRAINT orders_card_fk FOREIGN KEY (tenant_id, card_id) REFERENCES public.campaign_cards (tenant_id, id) ON DELETE SET NULL (card_id),
    ADD CONSTRAINT orders_offer_fk FOREIGN KEY (tenant_id, offer_id) REFERENCES public.offers (tenant_id, id) ON DELETE SET NULL (offer_id);
CREATE INDEX idx_orders_campaign ON public.orders (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX idx_orders_card ON public.orders (card_id) WHERE card_id IS NOT NULL;
CREATE INDEX idx_orders_offer ON public.orders (offer_id) WHERE offer_id IS NOT NULL;

ALTER TABLE public.order_items
    ADD COLUMN offer_id UUID REFERENCES public.offers(id) ON DELETE SET NULL,
    ADD COLUMN card_id UUID REFERENCES public.campaign_cards(id) ON DELETE SET NULL;
ALTER TABLE public.order_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_custom_product CHECK ((item_kind = 'CUSTOM') = (product_id IS NULL));

CREATE TRIGGER trg_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_campaign_cards_updated_at BEFORE UPDATE ON public.campaign_cards FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaigns_om_select ON public.campaigns FOR SELECT TO authenticated USING (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY campaigns_om_insert ON public.campaigns FOR INSERT TO authenticated WITH CHECK (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY campaigns_om_update ON public.campaigns FOR UPDATE TO authenticated USING (public.is_tenant_owner_or_manager(tenant_id)) WITH CHECK (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY campaigns_om_delete ON public.campaigns FOR DELETE TO authenticated USING (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY campaign_cards_om_select ON public.campaign_cards FOR SELECT TO authenticated USING (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY campaign_cards_om_insert ON public.campaign_cards FOR INSERT TO authenticated WITH CHECK (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY campaign_cards_om_update ON public.campaign_cards FOR UPDATE TO authenticated USING (public.is_tenant_owner_or_manager(tenant_id)) WITH CHECK (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY campaign_cards_om_delete ON public.campaign_cards FOR DELETE TO authenticated USING (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY cae_om_select ON public.campaign_analytics_events FOR SELECT TO authenticated USING (public.is_tenant_owner_or_manager(tenant_id));
REVOKE ALL ON public.campaigns, public.campaign_cards, public.campaign_analytics_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns, public.campaign_cards TO authenticated;
GRANT SELECT ON public.campaign_analytics_events TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. VISIBILIDADE, CADEIA E STATUS
-- ----------------------------------------------------------------------------
-- Oferta "no ar" (colunas da 001 + N4) e com vínculo de produto do mesmo tenant (F1-A).
CREATE OR REPLACE FUNCTION public._offer_is_live(p_offer_id UUID, p_at TIMESTAMPTZ)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.offers o
        WHERE o.id = p_offer_id AND o.is_active
          AND (o.start_at IS NULL OR o.start_at <= p_at) AND (o.end_at IS NULL OR o.end_at > p_at)
          AND (o.start_date IS NULL OR o.start_date <= (p_at AT TIME ZONE 'America/Sao_Paulo')::date)
          AND (o.end_date IS NULL OR o.end_date >= (p_at AT TIME ZONE 'America/Sao_Paulo')::date)
          AND (o.product_id IS NULL OR EXISTS (SELECT 1 FROM public.products p
                                               WHERE p.id = o.product_id AND p.tenant_id = o.tenant_id)));
$$;

-- Ponto ÚNICO de visibilidade de card (decisão 16: frequency_rules entram aqui no futuro).
CREATE OR REPLACE FUNCTION public._campaign_card_visible_at(p_card_id UUID, p_at TIMESTAMPTZ)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.campaign_cards c
        JOIN public.campaigns k ON k.id = c.campaign_id AND k.tenant_id = c.tenant_id
        JOIN public.tenants t ON t.id = c.tenant_id AND t.status = 'ACTIVE'
        WHERE c.id = p_card_id AND c.is_active AND k.status = 'ACTIVE'
          AND (k.start_at IS NULL OR k.start_at <= p_at) AND (k.end_at IS NULL OR k.end_at > p_at)
          AND (c.start_at IS NULL OR c.start_at <= p_at) AND (c.end_at IS NULL OR c.end_at > p_at)
          AND (c.offer_id IS NULL OR public._offer_is_live(c.offer_id, p_at))
          -- @@FREQUENCY_RULES@@ (reservado: campaign_schedule_rules, §3.12)
    );
$$;

CREATE OR REPLACE FUNCTION public._campaign_cards_chain_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_offer RECORD;
    v_camp RECORD;
BEGIN
    IF NEW.offer_id IS NOT NULL THEN
        SELECT o.product_id, p.tenant_id AS product_tenant INTO v_offer
        FROM public.offers o LEFT JOIN public.products p ON p.id = o.product_id
        WHERE o.id = NEW.offer_id AND o.tenant_id = NEW.tenant_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'CARD_CHAIN_INVALID: oferta não pertence a esta loja.';
        END IF;
        -- F1-A: oferta legada com produto de outro tenant não pode ser usada em card
        IF v_offer.product_id IS NOT NULL AND v_offer.product_tenant IS DISTINCT FROM NEW.tenant_id THEN
            RAISE EXCEPTION 'CARD_CHAIN_INVALID: a oferta tem vínculo de produto inválido e não pode ser usada.';
        END IF;
        IF NEW.product_id IS NOT NULL AND NEW.product_id IS DISTINCT FROM v_offer.product_id THEN
            RAISE EXCEPTION 'CARD_CHAIN_INVALID: produto do card diferente do produto da oferta.';
        END IF;
    END IF;
    SELECT start_at, end_at INTO v_camp FROM public.campaigns WHERE id = NEW.campaign_id AND tenant_id = NEW.tenant_id;
    IF (v_camp.start_at IS NOT NULL AND NEW.start_at IS NOT NULL AND NEW.start_at < v_camp.start_at)
       OR (v_camp.end_at IS NOT NULL AND NEW.end_at IS NOT NULL AND NEW.end_at > v_camp.end_at)
       OR (v_camp.end_at IS NOT NULL AND NEW.start_at IS NOT NULL AND NEW.start_at >= v_camp.end_at) THEN
        RAISE EXCEPTION 'CARD_WINDOW_INVALID: a janela do card precisa estar dentro da janela da campanha.';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_campaign_cards_chain_check
    BEFORE INSERT OR UPDATE ON public.campaign_cards
    FOR EACH ROW EXECUTE FUNCTION public._campaign_cards_chain_check();

-- Contador só pelo servidor. INVOKER de propósito: current_user é o papel da API em chamada direta
-- e o dono da função quando o ajuste vem de RPC SECURITY DEFINER (_promo_counter_adjust).
CREATE OR REPLACE FUNCTION public._campaign_cards_protect_counter()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF current_user IN ('anon','authenticated') THEN
        IF TG_OP = 'INSERT' THEN
            NEW.custom_times_used := 0;
        ELSIF NEW.custom_times_used IS DISTINCT FROM OLD.custom_times_used THEN
            RAISE EXCEPTION 'COUNTER_PROTECTED: custom_times_used é mantido pelo servidor.' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_campaign_cards_protect_counter
    BEFORE INSERT OR UPDATE OF custom_times_used ON public.campaign_cards
    FOR EACH ROW EXECUTE FUNCTION public._campaign_cards_protect_counter();
CREATE TRIGGER trg_campaign_cards_media_reference
    BEFORE INSERT OR UPDATE OF media_asset_id ON public.campaign_cards
    FOR EACH ROW EXECUTE FUNCTION public._media_reference_check('media_asset_id');

CREATE OR REPLACE FUNCTION public._campaigns_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ok BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status NOT IN ('DRAFT','SCHEDULED','ACTIVE') THEN
            RAISE EXCEPTION 'CAMPAIGN_STATUS_INVALID: campanha nova só pode nascer DRAFT, SCHEDULED ou ACTIVE.';
        END IF;
        NEW.created_by := auth.uid();
        IF NEW.created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.created_by) THEN
            NEW.created_by := NULL;
        END IF;
        NEW.published_at := CASE WHEN NEW.status = 'ACTIVE' THEN now() END;
        NEW.ended_at := NULL;
        RETURN NEW;
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.published_at := OLD.published_at;
    NEW.ended_at := OLD.ended_at;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        v_ok := CASE OLD.status
            WHEN 'DRAFT'     THEN NEW.status IN ('SCHEDULED','ACTIVE','ARCHIVED')
            WHEN 'SCHEDULED' THEN NEW.status IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')
            WHEN 'ACTIVE'    THEN NEW.status IN ('PAUSED','ENDED')
            WHEN 'PAUSED'    THEN NEW.status IN ('ACTIVE','ENDED','ARCHIVED')
            WHEN 'ENDED'     THEN NEW.status IN ('ARCHIVED')
            ELSE false END;
        IF NOT v_ok THEN
            RAISE EXCEPTION 'CAMPAIGN_STATUS_TRANSITION: transição % -> % não permitida.', OLD.status, NEW.status;
        END IF;
        IF NEW.status = 'ACTIVE' THEN
            NEW.published_at := COALESCE(OLD.published_at, now());
        ELSIF NEW.status = 'ENDED' THEN
            NEW.ended_at := now();
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_campaigns_status_transition
    BEFORE INSERT OR UPDATE ON public.campaigns
    FOR EACH ROW EXECUTE FUNCTION public._campaigns_status_transition();

-- ----------------------------------------------------------------------------
-- 3. ANALYTICS (decisão 10): só INSERT em campaign_analytics_events; sem efeito financeiro
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sanitize_event_metadata(p_meta JSONB)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_out JSONB := '{}'::jsonb;
    v_num NUMERIC;
BEGIN
    IF p_meta IS NULL OR jsonb_typeof(p_meta) <> 'object' THEN
        RETURN v_out;
    END IF;
    IF jsonb_typeof(p_meta -> 'placement') = 'string' THEN
        v_out := v_out || jsonb_build_object('placement', left(regexp_replace(p_meta ->> 'placement', '[^A-Za-z0-9_-]', '', 'g'), 40));
    END IF;
    IF jsonb_typeof(p_meta -> 'position') = 'number' THEN
        v_num := (p_meta ->> 'position')::numeric;
        IF v_num BETWEEN 0 AND 1000 THEN v_out := v_out || jsonb_build_object('position', floor(v_num)::int); END IF;
    END IF;
    IF jsonb_typeof(p_meta -> 'video_seconds') = 'number' THEN
        v_num := (p_meta ->> 'video_seconds')::numeric;
        IF v_num BETWEEN 0 AND 3600 THEN v_out := v_out || jsonb_build_object('video_seconds', round(v_num, 1)); END IF;
    END IF;
    IF (p_meta ->> 'viewport') IN ('mobile','tablet','desktop') THEN
        v_out := v_out || jsonb_build_object('viewport', p_meta ->> 'viewport');
    END IF;
    IF (p_meta ->> 'referrer') IN ('qr','link','whatsapp','instagram','direct','other') THEN
        v_out := v_out || jsonb_build_object('referrer', p_meta ->> 'referrer');
    END IF;
    RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.track_campaign_event(
    p_store_slug TEXT, p_event_type TEXT, p_session_id UUID, p_campaign_id UUID DEFAULT NULL,
    p_card_id UUID DEFAULT NULL, p_offer_id UUID DEFAULT NULL, p_metadata JSONB DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant UUID;
    v_card RECORD;
    v_campaign UUID := p_campaign_id;
    v_offer UUID := p_offer_id;
    v_session_hash TEXT;
    v_ip_hash TEXT;
    v_meta JSONB;
    v_minute TEXT := to_char(date_trunc('minute', now()) AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI');
BEGIN
    -- Whitelist: somente os 6 eventos de cliente. PURCHASE do navegador é descartado (regra 37).
    IF p_event_type IS NULL OR p_event_type NOT IN ('IMPRESSION','CARD_VIEW','CARD_CLICK','VIDEO_PLAY','COUPON_COPY','CHECKOUT_START')
       OR p_session_id IS NULL THEN
        RETURN;
    END IF;
    SELECT id INTO v_tenant FROM public.tenants WHERE slug = p_store_slug AND status = 'ACTIVE';
    IF v_tenant IS NULL THEN
        RETURN;
    END IF;
    IF p_campaign_id IS NULL AND p_card_id IS NULL AND p_offer_id IS NULL THEN
        RETURN;
    END IF;
    -- IDs do tenant e visíveis agora (#43)
    IF p_card_id IS NOT NULL THEN
        SELECT c.id, c.campaign_id, c.offer_id INTO v_card
        FROM public.campaign_cards c WHERE c.id = p_card_id AND c.tenant_id = v_tenant;
        IF v_card.id IS NULL OR NOT public._campaign_card_visible_at(v_card.id, now())
           OR (p_campaign_id IS NOT NULL AND p_campaign_id <> v_card.campaign_id)
           OR (p_offer_id IS NOT NULL AND v_card.offer_id IS NOT NULL AND p_offer_id <> v_card.offer_id) THEN
            RETURN;
        END IF;
        v_campaign := v_card.campaign_id;
        v_offer := COALESCE(p_offer_id, v_card.offer_id);
    ELSIF p_campaign_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.campaigns k WHERE k.id = p_campaign_id AND k.tenant_id = v_tenant
                       AND k.status = 'ACTIVE' AND (k.start_at IS NULL OR k.start_at <= now())
                       AND (k.end_at IS NULL OR k.end_at > now())) THEN
            RETURN;
        END IF;
    END IF;
    IF v_offer IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.offers o WHERE o.id = v_offer AND o.tenant_id = v_tenant)
           OR NOT public._offer_is_live(v_offer, now()) THEN
            RETURN;
        END IF;
    END IF;
    -- Rate limit: 1ª camada por sessão; 2ª por HMAC do IP (salt diário; nunca IP puro; só em security_rate_limits)
    v_session_hash := public._sha256_hex(p_session_id::text);
    IF NOT public._rate_limit_hit('track_session', v_session_hash, v_tenant, 120, 60) THEN
        RETURN;
    END IF;
    v_ip_hash := public._request_ip_hash();
    IF v_ip_hash IS NOT NULL AND NOT public._rate_limit_hit('track_ip', v_ip_hash, v_tenant, 600, 60) THEN
        RETURN;
    END IF;
    v_meta := public._sanitize_event_metadata(p_metadata);
    IF octet_length(v_meta::text) > 1024 THEN
        v_meta := '{}'::jsonb;
    END IF;
    INSERT INTO public.campaign_analytics_events (tenant_id, campaign_id, card_id, offer_id, event_type, source,
                                                  session_hash, user_hash, dedupe_key, metadata)
    VALUES (v_tenant, v_campaign, p_card_id, v_offer, p_event_type, 'CLIENT', v_session_hash,
            public._sha256_hex(auth.uid()::text),
            public._sha256_hex(concat_ws('|', v_session_hash, p_event_type, v_campaign, p_card_id, v_offer, v_minute)),
            v_meta)
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
END;
$$;

-- PURCHASE: somente o servidor, a partir de um pedido real já gravado (regra 37).
CREATE OR REPLACE FUNCTION public._record_server_campaign_event(p_order_id UUID, p_event TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_o RECORD;
BEGIN
    IF p_event IS DISTINCT FROM 'PURCHASE' THEN
        RAISE EXCEPTION 'INVALID_SERVER_EVENT: %', p_event;
    END IF;
    SELECT id, tenant_id, campaign_id, card_id, offer_id INTO v_o FROM public.orders WHERE id = p_order_id;
    IF v_o.id IS NULL OR (v_o.campaign_id IS NULL AND v_o.card_id IS NULL AND v_o.offer_id IS NULL) THEN
        RETURN;
    END IF;
    INSERT INTO public.campaign_analytics_events (tenant_id, campaign_id, card_id, offer_id, order_id, event_type, source,
                                                  user_hash, dedupe_key, metadata)
    VALUES (v_o.tenant_id, v_o.campaign_id, v_o.card_id, v_o.offer_id, v_o.id, 'PURCHASE', 'SERVER',
            public._sha256_hex(auth.uid()::text), 'server:PURCHASE:' || v_o.id::text, '{}'::jsonb)
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
END;
$$;

-- Métricas: topo de funil = estimativa (eventos); compras e receita = orders válidos (nunca o navegador).
CREATE OR REPLACE FUNCTION public.get_campaign_metrics(p_campaign_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant UUID;
    v_funnel JSONB;
    v_orders JSONB;
BEGIN
    SELECT tenant_id INTO v_tenant FROM public.campaigns WHERE id = p_campaign_id;
    IF v_tenant IS NULL OR NOT public.is_tenant_owner_or_manager(v_tenant) THEN
        RAISE EXCEPTION 'FORBIDDEN: campanha não encontrada ou sem permissão.' USING ERRCODE = '42501';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '400 days' THEN
        RAISE EXCEPTION 'INVALID_PERIOD: período inválido (máximo 400 dias).';
    END IF;
    SELECT COALESCE(jsonb_object_agg(event_type, n), '{}'::jsonb) INTO v_funnel
    FROM (SELECT event_type, count(*) AS n FROM public.campaign_analytics_events
          WHERE tenant_id = v_tenant AND campaign_id = p_campaign_id AND source = 'CLIENT'
            AND occurred_at >= p_from AND occurred_at < p_to GROUP BY event_type) e;
    SELECT jsonb_build_object(
             'valid_orders', count(*) FILTER (WHERE status <> 'CANCELLED' AND payment_status <> 'REFUNDED'),
             'revenue', COALESCE(sum(total_amount) FILTER (WHERE status <> 'CANCELLED' AND payment_status <> 'REFUNDED'), 0),
             'paid_revenue', COALESCE(sum(total_amount) FILTER (WHERE status <> 'CANCELLED' AND payment_status = 'PAID'), 0),
             'invalidated_orders', count(*) FILTER (WHERE status = 'CANCELLED' OR payment_status = 'REFUNDED'))
    INTO v_orders
    FROM public.orders WHERE tenant_id = v_tenant AND campaign_id = p_campaign_id
      AND created_at >= p_from AND created_at < p_to;
    RETURN jsonb_build_object('campaign_id', p_campaign_id, 'from', p_from, 'to', p_to,
                              'funnel_estimate', v_funnel, 'funnel_is_estimate', true,
                              'orders', v_orders, 'revenue_source', 'orders');
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. CONTADORES PROMOCIONAIS (decisão 1: mesma semântica do cupom)
--    p_direction = +1 (consumo com guarda de limite) | -1 (estorno; nunca abaixo de 0).
--    Itens OFFER contam em offers.promo_times_used; itens CUSTOM/CARD_PRODUCT em
--    campaign_cards.custom_times_used. Locks em ordem fixa (cards -> offers).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._promo_counter_adjust(p_order_id UUID, p_direction INT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
BEGIN
    IF p_direction NOT IN (1, -1) THEN
        RAISE EXCEPTION 'INVALID_DIRECTION';
    END IF;
    FOR r IN SELECT card_id AS id, sum(quantity)::int AS q FROM public.order_items
             WHERE order_id = p_order_id AND card_id IS NOT NULL AND item_kind IN ('CUSTOM','CARD_PRODUCT')
             GROUP BY card_id ORDER BY card_id LOOP
        IF p_direction = 1 THEN
            UPDATE public.campaign_cards SET custom_times_used = custom_times_used + r.q
            WHERE id = r.id AND (custom_usage_limit IS NULL OR custom_times_used + r.q <= custom_usage_limit);
            IF NOT FOUND THEN
                RAISE EXCEPTION 'PROMO_EXHAUSTED: limite de uso da promoção atingido.';
            END IF;
        ELSE
            UPDATE public.campaign_cards SET custom_times_used = GREATEST(custom_times_used - r.q, 0) WHERE id = r.id;
        END IF;
    END LOOP;
    FOR r IN SELECT offer_id AS id, sum(quantity)::int AS q FROM public.order_items
             WHERE order_id = p_order_id AND offer_id IS NOT NULL AND item_kind = 'OFFER'
             GROUP BY offer_id ORDER BY offer_id LOOP
        IF p_direction = 1 THEN
            UPDATE public.offers SET promo_times_used = promo_times_used + r.q
            WHERE id = r.id AND (promo_usage_limit IS NULL OR promo_times_used + r.q <= promo_usage_limit);
            IF NOT FOUND THEN
                RAISE EXCEPTION 'PROMO_EXHAUSTED: limite de uso da promoção atingido.';
            END IF;
        ELSE
            UPDATE public.offers SET promo_times_used = GREATEST(promo_times_used - r.q, 0) WHERE id = r.id;
        END IF;
    END LOOP;
END;
$$;

-- Redefinição da N2: estorno do cupom E dos contadores promocionais (válido -> inválido).
CREATE OR REPLACE FUNCTION public._orders_promo_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old_valid BOOLEAN := OLD.status <> 'CANCELLED' AND OLD.payment_status <> 'REFUNDED';
    v_new_valid BOOLEAN := NEW.status <> 'CANCELLED' AND NEW.payment_status <> 'REFUNDED';
BEGIN
    IF v_old_valid AND NOT v_new_valid THEN
        PERFORM public._coupon_reverse_for_order(NEW.id,
            CASE WHEN NEW.status = 'CANCELLED' THEN 'ORDER_CANCELLED' ELSE 'ORDER_REFUNDED' END);
        PERFORM public._promo_counter_adjust(NEW.id, -1);
    ELSIF NOT v_old_valid AND v_new_valid THEN
        RAISE EXCEPTION 'ORDER_REOPEN_FORBIDDEN: pedido cancelado/estornado não pode voltar a ser válido.' USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. REDEFINIÇÕES DA N2 (mesma assinatura): itens com offer_id/card_id e item CUSTOM
--    (sem produto => sem baixa de estoque); checkout de carrinho com atribuição a card
--    visível (não financeira; card inválido é ignorado) e PURCHASE do servidor.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._insert_order_lines(p_order_id UUID, p_tenant UUID, p_lines JSONB,
                                                      p_discount NUMERIC, p_eligible_base NUMERIC, p_actor TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_line JSONB;
    v_total NUMERIC;
    v_share NUMERIC;
    v_allocated NUMERIC := 0;
    v_eligible_left INT;
    v_prev INT;
    v_out JSONB := '[]'::jsonb;
    v_pid UUID;
    v_qty INT;
BEGIN
    SELECT count(*) INTO v_eligible_left FROM jsonb_array_elements(p_lines) l WHERE NOT (l ->> 'is_promotional')::boolean;
    FOR v_line IN SELECT l FROM jsonb_array_elements(p_lines) l ORDER BY l ->> 'product_id' NULLS LAST, l ->> 'card_id' LOOP
        v_pid := NULLIF(v_line ->> 'product_id', '')::uuid;
        v_qty := (v_line ->> 'quantity')::int;
        v_total := round((v_line ->> 'unit_price')::numeric * v_qty, 2);
        v_share := 0;
        IF COALESCE(p_discount, 0) > 0 AND NOT (v_line ->> 'is_promotional')::boolean THEN
            v_eligible_left := v_eligible_left - 1;
            IF v_eligible_left = 0 THEN
                v_share := p_discount - v_allocated;
            ELSE
                v_share := round(p_discount * v_total / p_eligible_base, 2);
            END IF;
            v_allocated := v_allocated + v_share;
        END IF;

        INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, notes, unit,
                                        original_unit_price, discount_amount, item_kind, offer_id, card_id)
        VALUES (p_order_id, v_pid, v_line ->> 'name', v_qty, (v_line ->> 'unit_price')::numeric, v_total,
                v_line ->> 'notes', COALESCE(v_line ->> 'unit', 'un'), (v_line ->> 'original_price')::numeric, v_share,
                COALESCE(v_line ->> 'item_kind', 'PRODUCT'), NULLIF(v_line ->> 'offer_id', '')::uuid,
                NULLIF(v_line ->> 'card_id', '')::uuid);

        IF v_pid IS NOT NULL THEN
            SELECT stock_quantity INTO v_prev FROM public.products WHERE id = v_pid AND tenant_id = p_tenant FOR UPDATE;
            IF v_prev < v_qty THEN
                RAISE EXCEPTION 'OUT_OF_STOCK: estoque insuficiente para o produto "%". Disponível: %, solicitado: %',
                    v_line ->> 'name', v_prev, v_qty;
            END IF;
            UPDATE public.products SET stock_quantity = v_prev - v_qty, updated_at = now() WHERE id = v_pid AND tenant_id = p_tenant;
            INSERT INTO public.inventory_movements (tenant_id, product_id, product_name, quantity, type, reference_id, reason,
                                                    previous_stock, new_stock, created_by_name)
            VALUES (p_tenant, v_pid, v_line ->> 'name', -v_qty, 'VENDA', p_order_id::text,
                    'Baixa atômica por venda - Pedido #' || p_order_id::text, v_prev, v_prev - v_qty, p_actor);
        END IF;

        v_out := v_out || jsonb_build_object('product_id', v_pid, 'quantity', v_qty,
            'unit_price', (v_line ->> 'unit_price')::numeric, 'original_unit_price', (v_line ->> 'original_price')::numeric,
            'is_promotional', (v_line ->> 'is_promotional')::boolean, 'discount_amount', v_share);
    END LOOP;
    RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public._checkout_core(
    p_tenant_slug TEXT, p_customer_name TEXT, p_customer_phone TEXT, p_delivery_address TEXT, p_address_details JSONB,
    p_payment_method TEXT, p_fulfillment_type TEXT, p_notes TEXT, p_origin TEXT, p_items JSONB,
    p_coupon_code TEXT, p_idempotency_key UUID, p_card_id UUID, p_customer_email_fallback TEXT DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_email TEXT;
    v_phone TEXT;
    v_address TEXT;
    v_tenant RECORD;
    v_existing UUID;
    v_lines JSONB := '[]'::jsonb;
    v_line RECORD;
    v_subtotal NUMERIC := 0;
    v_base NUMERIC := 0;
    v_delivery_fee NUMERIC := 0;
    v_discount NUMERIC := 0;
    v_total NUMERIC;
    v_coupon RECORD;
    v_coupon_id UUID;
    v_coupon_code TEXT;
    v_customer_id UUID;
    v_order_id UUID;
    v_items_out JSONB;
    v_card RECORD;
    v_attr_campaign UUID;
    v_attr_card UUID;
BEGIN
    -- 1. Identidade: somente auth.uid() (não existe checkout anônimo)
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: é necessário estar conectado para finalizar o pedido.' USING ERRCODE = '42501';
    END IF;
    -- 2. Rate limit por usuário
    IF NOT public._rate_limit_hit('checkout', public._sha256_hex(v_user_id::text), NULL, 10, 60) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas de pedido; aguarde um minuto.';
    END IF;
    -- Dados do cliente (mesmas regras da 009)
    IF p_customer_name IS NULL OR btrim(p_customer_name) = '' OR length(btrim(p_customer_name)) > 120 THEN
        RAISE EXCEPTION 'INVALID_CUSTOMER: o nome do cliente é obrigatório (até 120 caracteres).';
    END IF;
    v_phone := regexp_replace(COALESCE(p_customer_phone, ''), '[^0-9]', '', 'g');
    IF length(v_phone) < 10 OR length(v_phone) > 15 THEN
        RAISE EXCEPTION 'INVALID_PHONE: número de WhatsApp inválido. Informe um número com DDD.';
    END IF;
    IF p_fulfillment_type IS NULL OR p_fulfillment_type NOT IN ('DELIVERY','PICKUP') THEN
        RAISE EXCEPTION 'INVALID_FULFILLMENT: tipo de entrega "%" inválido. Valores aceitos: DELIVERY, PICKUP.', p_fulfillment_type;
    END IF;
    IF p_payment_method IS NULL OR p_payment_method NOT IN ('PIX','CREDIT_CARD','DEBIT_CARD','CASH') THEN
        RAISE EXCEPTION 'INVALID_PAYMENT_METHOD: forma de pagamento "%" inválida.', p_payment_method;
    END IF;
    v_address := btrim(COALESCE(p_delivery_address, ''));
    IF length(v_address) > 500 OR length(COALESCE(p_notes, '')) > 500 THEN
        RAISE EXCEPTION 'INVALID_INPUT: endereço ou observação com mais de 500 caracteres.';
    END IF;
    IF p_fulfillment_type = 'DELIVERY' AND v_address = '' THEN
        RAISE EXCEPTION 'ADDRESS_REQUIRED: endereço de entrega é obrigatório para DELIVERY.';
    ELSIF v_address = '' THEN
        v_address := 'Retirada no Balcão';
    END IF;
    SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
    v_email := COALESCE(NULLIF(btrim(v_email), ''), NULLIF(btrim(p_customer_email_fallback), ''));

    -- 3. Tenant ACTIVE pelo slug e loja aberta
    SELECT t.id, s.is_open, COALESCE(s.min_order_value, 0) AS min_order_value, COALESCE(s.delivery_fee, 0) AS delivery_fee,
           s.free_delivery_threshold, s.default_prep_time_minutes
    INTO v_tenant
    FROM public.tenants t LEFT JOIN public.tenant_settings s ON s.tenant_id = t.id
    WHERE t.slug = p_tenant_slug AND t.status = 'ACTIVE';
    IF v_tenant.id IS NULL THEN
        RAISE EXCEPTION 'STORE_UNAVAILABLE: estabelecimento não encontrado ou indisponível para pedidos.';
    END IF;
    IF v_tenant.is_open IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'STORE_CLOSED: a loja está fechada no momento.';
    END IF;

    -- 4. Idempotência
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant.id::text || ':' || p_idempotency_key::text, 0));
        SELECT o.id INTO v_existing FROM public.orders o WHERE o.tenant_id = v_tenant.id AND o.idempotency_key = p_idempotency_key;
        IF v_existing IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM public.orders o JOIN public.customers c ON c.id = o.customer_id
                           WHERE o.id = v_existing AND c.user_id = v_user_id) THEN
                RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: chave de idempotência já utilizada.';
            END IF;
            RETURN public._checkout_order_summary(v_existing, true);
        END IF;
    END IF;

    -- 5–8. Itens, lock em ordem de id, preço autoritativo e estoque
    FOR v_line IN SELECT * FROM public._price_items(v_tenant.id, p_items, true) LOOP
        IF v_line.r_stock < v_line.r_quantity THEN
            RAISE EXCEPTION 'OUT_OF_STOCK: estoque insuficiente para o produto "%". Disponível: %, solicitado: %',
                v_line.r_name, v_line.r_stock, v_line.r_quantity;
        END IF;
        v_subtotal := v_subtotal + round(v_line.r_unit_price * v_line.r_quantity, 2);
        IF NOT v_line.r_is_promotional THEN
            v_base := v_base + round(v_line.r_unit_price * v_line.r_quantity, 2);
        END IF;
        v_lines := v_lines || jsonb_build_object('product_id', v_line.r_product_id, 'quantity', v_line.r_quantity,
            'notes', v_line.r_notes, 'name', v_line.r_name, 'unit', v_line.r_unit, 'unit_price', v_line.r_unit_price,
            'original_price', v_line.r_original_price, 'is_promotional', v_line.r_is_promotional, 'item_kind', 'PRODUCT');
    END LOOP;

    IF v_tenant.min_order_value > 0 AND v_subtotal < v_tenant.min_order_value THEN
        RAISE EXCEPTION 'MIN_ORDER_NOT_MET: valor mínimo do pedido é R$ % (subtotal R$ %).', v_tenant.min_order_value, v_subtotal;
    END IF;

    -- 9. Taxa de entrega (regra da 009)
    IF p_fulfillment_type = 'DELIVERY' THEN
        v_delivery_fee := v_tenant.delivery_fee;
        IF v_tenant.free_delivery_threshold IS NOT NULL AND v_subtotal >= v_tenant.free_delivery_threshold THEN
            v_delivery_fee := 0;
        END IF;
    END IF;

    -- 10. Cliente pelo vínculo customers.user_id (modelo 009, anti-takeover)
    SELECT id INTO v_customer_id FROM public.customers WHERE tenant_id = v_tenant.id AND user_id = v_user_id;

    -- 12a. Cupom: trava e calcula (base = itens não promocionais)
    IF public.normalize_coupon_code(p_coupon_code) IS NOT NULL THEN
        SELECT * INTO v_coupon FROM public._coupon_lock_and_quote(v_tenant.id, p_coupon_code, v_customer_id, v_base, false);
        v_discount := v_coupon.r_discount;
        v_coupon_id := v_coupon.r_coupon_id;
        v_coupon_code := v_coupon.r_code;
    END IF;

    -- N5: atribuição a card (não financeira). Card de outro tenant, invisível ou inexistente é ignorado.
    IF p_card_id IS NOT NULL THEN
        SELECT c.id, c.campaign_id INTO v_card FROM public.campaign_cards c
        WHERE c.id = p_card_id AND c.tenant_id = v_tenant.id;
        IF v_card.id IS NOT NULL AND public._campaign_card_visible_at(v_card.id, now()) THEN
            v_attr_campaign := v_card.campaign_id;
            v_attr_card := v_card.id;
        END IF;
    END IF;

    v_total := v_subtotal - v_discount + v_delivery_fee;

    PERFORM set_config('app.internal_customer_update', 'true', true);
    IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (tenant_id, user_id, name, phone, email, origin, total_orders, ltv_amount,
                                      first_order_date, last_order_date)
        VALUES (v_tenant.id, v_user_id, btrim(p_customer_name), v_phone, v_email,
                -- customers.origin tem CHECK próprio (001): origens fora da lista viram 'direct'
                CASE WHEN p_origin IN ('qr_code','whatsapp','instagram','direct','marketplace','google','indicacao','direto','outros')
                     THEN p_origin ELSE 'direct' END, 1, v_total,
                CURRENT_DATE, CURRENT_DATE)
        RETURNING id INTO v_customer_id;
    ELSE
        UPDATE public.customers
        SET total_orders = total_orders + 1, ltv_amount = ltv_amount + v_total, last_order_date = CURRENT_DATE,
            name = COALESCE(NULLIF(btrim(p_customer_name), ''), name), phone = v_phone, email = COALESCE(v_email, email),
            updated_at = now()
        WHERE id = v_customer_id AND user_id = v_user_id;
    END IF;
    PERFORM set_config('app.internal_customer_update', 'false', true);

    -- 11. Pedido
    INSERT INTO public.orders (tenant_id, customer_id, customer_name, customer_phone, customer_email, delivery_address,
                               address_details, subtotal, delivery_fee, discount, total_amount, payment_method, payment_status,
                               fulfillment_type, status, notes, origin, prep_time_minutes, idempotency_key, coupon_id, coupon_code
                               , campaign_id, card_id, attribution_source)
    VALUES (v_tenant.id, v_customer_id, btrim(p_customer_name), v_phone, v_email, v_address, p_address_details,
            v_subtotal, v_delivery_fee, v_discount, v_total, p_payment_method,
            CASE WHEN p_payment_method = 'PIX' THEN 'PENDING' ELSE 'PAYMENT_ON_DELIVERY' END,
            p_fulfillment_type, 'PENDING', NULLIF(btrim(COALESCE(p_notes, '')), ''), COALESCE(p_origin, 'direct'),
            v_tenant.default_prep_time_minutes, p_idempotency_key, v_coupon_id, v_coupon_code
            , v_attr_campaign, v_attr_card,
            CASE WHEN v_attr_card IS NOT NULL THEN 'CARD' WHEN v_coupon_id IS NOT NULL THEN 'COUPON' ELSE 'DIRECT' END)
    RETURNING id INTO v_order_id;

    v_items_out := public._insert_order_lines(v_order_id, v_tenant.id, v_lines, v_discount, v_base, 'Sistema (checkout)');

    -- 12b. Consumo do cupom (contador com guarda + histórico)
    IF v_coupon_id IS NOT NULL THEN
        PERFORM public._coupon_consume(v_tenant.id, v_coupon_id, v_order_id, v_customer_id, v_discount, 'ONLINE', NULL);
    END IF;

    -- 15. Histórico
    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (v_order_id, 'PENDING', 'Pedido confirmado com sucesso pelo checkout online', 'Checkout Público');
    IF v_attr_card IS NOT NULL THEN
        PERFORM public._record_server_campaign_event(v_order_id, 'PURCHASE');
    END IF;

    RETURN public._checkout_order_summary(v_order_id, false);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5b. DESEMPENHO DOS CARDS PROMOCIONAIS (offers) — aba Marketing → Desempenho & Vendas
--     Agregação no servidor, só OWNER/MANAGER da própria loja (F2: sem CEO/SUPER_ADMIN).
--     Atribuição = orders.offer_id, gravado APENAS por process_promotional_checkout_atomic (N6),
--     com cadeia tenant→campanha→card→oferta→produto validada no servidor; imutável (N1
--     _orders_protect_columns; INSERT/UPDATE revogados). Um pedido tem no máximo 1 offer_id,
--     logo conta uma única vez. Vendas comuns do produto (sem offer_id) nunca entram.
--     Válido = status <> CANCELLED e payment_status <> REFUNDED (estes já tiveram
--     contadores/cupom revertidos por _orders_promo_lifecycle).
--     revenue = total_amount - delivery_fee; redeemed_units = soma de quantity dos itens
--     OFFER (mesma unidade de offers.promo_times_used); discount = (preço original - preço
--     cobrado) x qtd + desconto de cupom rateado no item. last_valid_order_at ignora o período.
-- ----------------------------------------------------------------------------
CREATE INDEX idx_orders_tenant_offer_created ON public.orders (tenant_id, created_at) WHERE offer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_promo_offer_performance(p_tenant_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_rows JSONB;
BEGIN
    IF auth.uid() IS NULL OR p_tenant_id IS NULL OR NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
        RAISE EXCEPTION 'FORBIDDEN: sem permissão para o desempenho desta loja.' USING ERRCODE = '42501';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '400 days' THEN
        RAISE EXCEPTION 'INVALID_PERIOD: período inválido (máximo 400 dias).';
    END IF;

    WITH o AS (
        SELECT od.id, od.offer_id, od.created_at,
               (od.status <> 'CANCELLED' AND od.payment_status <> 'REFUNDED') AS valid,
               GREATEST(od.total_amount - od.delivery_fee, 0) AS revenue
        FROM public.orders od
        JOIN public.offers f ON f.id = od.offer_id AND f.tenant_id = od.tenant_id
        WHERE od.tenant_id = p_tenant_id AND od.offer_id IS NOT NULL
          AND od.created_at >= p_from AND od.created_at < p_to
    ), it AS (
        SELECT o.id AS order_id,
               COALESCE(sum(oi.quantity) FILTER (WHERE oi.item_kind = 'OFFER'), 0) AS units,
               COALESCE(sum(GREATEST(COALESCE(oi.original_unit_price, oi.unit_price) - oi.unit_price, 0) * oi.quantity
                            + oi.discount_amount), 0) AS discount
        FROM o JOIN public.order_items oi ON oi.order_id = o.id AND oi.offer_id = o.offer_id
        WHERE o.valid
        GROUP BY o.id
    ), agg AS (
        SELECT o.offer_id,
               count(*) FILTER (WHERE o.valid) AS valid_orders,
               count(*) FILTER (WHERE NOT o.valid) AS invalidated_orders,
               COALESCE(sum(o.revenue) FILTER (WHERE o.valid), 0) AS revenue,
               COALESCE(sum(it.units), 0) AS redeemed_units,
               COALESCE(sum(it.discount), 0) AS discount
        FROM o LEFT JOIN it ON it.order_id = o.id
        GROUP BY o.offer_id
    ), last_sale AS (
        SELECT od.offer_id, max(od.created_at) AS last_valid_order_at
        FROM public.orders od
        WHERE od.tenant_id = p_tenant_id AND od.offer_id IS NOT NULL
          AND od.status <> 'CANCELLED' AND od.payment_status <> 'REFUNDED'
        GROUP BY od.offer_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'offer_id', f.id,
               'valid_orders', COALESCE(a.valid_orders, 0),
               'invalidated_orders', COALESCE(a.invalidated_orders, 0),
               'revenue', round(COALESCE(a.revenue, 0), 2),
               'redeemed_units', COALESCE(a.redeemed_units, 0),
               'discount', round(COALESCE(a.discount, 0), 2),
               'last_valid_order_at', l.last_valid_order_at) ORDER BY f.id), '[]'::jsonb)
    INTO v_rows
    FROM public.offers f
    LEFT JOIN agg a ON a.offer_id = f.id
    LEFT JOIN last_sale l ON l.offer_id = f.id
    WHERE f.tenant_id = p_tenant_id AND (a.offer_id IS NOT NULL OR l.offer_id IS NOT NULL);

    RETURN jsonb_build_object('tenant_id', p_tenant_id, 'from', p_from, 'to', p_to,
                              'attribution', 'orders.offer_id (servidor)', 'revenue_rule', 'total_amount - delivery_fee',
                              'rows', v_rows);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. PRIVILÉGIOS DE FUNÇÕES
-- ----------------------------------------------------------------------------
DO $grants$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public._offer_is_live(uuid,timestamp with time zone)',
        'public._campaign_card_visible_at(uuid,timestamp with time zone)',
        'public._campaign_cards_chain_check()',
        'public._campaign_cards_protect_counter()',
        'public._campaigns_status_transition()',
        'public._sanitize_event_metadata(jsonb)',
        'public.track_campaign_event(text,text,uuid,uuid,uuid,uuid,jsonb)',
        'public._record_server_campaign_event(uuid,text)',
        'public.get_campaign_metrics(uuid,timestamp with time zone,timestamp with time zone)',
        'public.get_promo_offer_performance(uuid,timestamp with time zone,timestamp with time zone)',
        'public._promo_counter_adjust(uuid,integer)',
        'public._orders_promo_lifecycle()',
        'public._insert_order_lines(uuid,uuid,jsonb,numeric,numeric,text)',
        'public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    END LOOP;
END
$grants$;
GRANT EXECUTE ON FUNCTION public.track_campaign_event(text,text,uuid,uuid,uuid,uuid,jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_metrics(uuid,timestamp with time zone,timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_promo_offer_performance(uuid,timestamp with time zone,timestamp with time zone) TO authenticated;
-- Fim da N5.
