-- ============================================================================
-- N4 — CARROSSÉIS PROMOCIONAIS E COLUNAS NOVAS EM OFFERS (sem UPDATE de linhas)
-- DESIGN_N1_N6_ARQUITETURA_v3 (decisões 5 e 8; F1 opção A; F2).
--
-- Cria:      promotion_carousels, promotion_carousel_items (RLS só OWNER/MANAGER);
--            13 colunas em offers (ADD COLUMN; defaults constantes; nenhuma linha é
--            reescrita/atualizada); trigger de validação de mídia; proteção do contador
--            promo_times_used.
-- Redefine:  _effective_product_price (N2) para considerar item de carrossel ativo
--            (vence o MENOR preço promocional válido; nunca acumula).
-- Intocado:  as ofertas existentes (valores), policies de offers (001), get_public_store.
-- Rollback:  supabase/rollback/n4_rollback.sql (manual).
-- ============================================================================
DO $pre$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006000300') THEN
        RAISE EXCEPTION 'N4 PRE: N3 (20261006000300) não registrada; abortado.';
    END IF;
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version > '20261006000300') THEN
        RAISE EXCEPTION 'N4 PRE: há migrations posteriores à N3 registradas; ordem inesperada.';
    END IF;
    IF to_regclass('public.promotion_carousels') IS NOT NULL OR to_regclass('public.promotion_carousel_items') IS NOT NULL THEN
        RAISE EXCEPTION 'N4 PRE: tabelas de carrossel já existem; abortado.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='offers'
               AND column_name IN ('media_asset_id','start_at','end_at','auto_overlay','has_promo_checkout','promo_price',
                                   'promo_usage_limit','promo_usage_limit_per_customer','promo_max_qty_per_order',
                                   'promo_fulfillment','promo_times_used','internal_name','internal_notes','media_url','display_mode')) THEN
        RAISE EXCEPTION 'N4 PRE: colunas novas (ou de 021–027) já existem em offers; abortado.';
    END IF;
END
$pre$;

-- Diagnóstico antes/depois: prova de que nenhuma oferta é reescrita
CREATE TEMP TABLE _n4_offers_before ON COMMIT DROP AS
    SELECT id, md5(to_jsonb(o)::text) AS h FROM public.offers o;

ALTER TABLE public.offers
    ADD COLUMN media_asset_id UUID,
    ADD COLUMN start_at TIMESTAMPTZ,
    ADD COLUMN end_at TIMESTAMPTZ,
    ADD COLUMN auto_overlay BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN has_promo_checkout BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN promo_price NUMERIC(10,2),
    ADD COLUMN promo_usage_limit INTEGER,
    ADD COLUMN promo_usage_limit_per_customer INTEGER,
    ADD COLUMN promo_max_qty_per_order INTEGER,
    ADD COLUMN promo_fulfillment VARCHAR(16),
    ADD COLUMN promo_times_used INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN internal_name VARCHAR(255),
    ADD COLUMN internal_notes TEXT;
ALTER TABLE public.offers
    ADD CONSTRAINT offers_promo_price_positive CHECK (promo_price IS NULL OR promo_price > 0),
    ADD CONSTRAINT offers_promo_limits_positive CHECK ((promo_usage_limit IS NULL OR promo_usage_limit > 0)
        AND (promo_usage_limit_per_customer IS NULL OR promo_usage_limit_per_customer > 0)
        AND (promo_max_qty_per_order IS NULL OR promo_max_qty_per_order > 0)),
    ADD CONSTRAINT offers_promo_fulfillment_check CHECK (promo_fulfillment IS NULL OR promo_fulfillment IN ('DELIVERY','PICKUP','BOTH')),
    ADD CONSTRAINT offers_promo_times_used_check CHECK (promo_times_used >= 0 AND (promo_usage_limit IS NULL OR promo_times_used <= promo_usage_limit)),
    ADD CONSTRAINT offers_window_check CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at),
    ADD CONSTRAINT offers_promo_checkout_requires_price CHECK (NOT has_promo_checkout OR (promo_price IS NOT NULL AND product_id IS NOT NULL)),
    ADD CONSTRAINT offers_media_asset_fk FOREIGN KEY (tenant_id, media_asset_id)
        REFERENCES public.marketing_media_assets (tenant_id, id) ON DELETE SET NULL (media_asset_id);
COMMENT ON COLUMN public.offers.internal_name IS 'Interno; nunca exposto na vitrine.';
COMMENT ON COLUMN public.offers.internal_notes IS 'Interno; nunca exposto na vitrine.';
COMMENT ON COLUMN public.offers.promo_times_used IS 'Contador do servidor (checkout promocional). Não gravável pela API.';

DO $chk$
DECLARE v BIGINT;
BEGIN
    SELECT count(*) INTO v FROM _n4_offers_before b JOIN public.offers o ON o.id = b.id
    WHERE md5((to_jsonb(o) - ARRAY['media_asset_id','start_at','end_at','auto_overlay','has_promo_checkout','promo_price',
              'promo_usage_limit','promo_usage_limit_per_customer','promo_max_qty_per_order','promo_fulfillment',
              'promo_times_used','internal_name','internal_notes'])::text) <> b.h;
    IF v <> 0 OR (SELECT count(*) FROM public.offers) <> (SELECT count(*) FROM _n4_offers_before) THEN
        RAISE EXCEPTION 'N4: % ofertas existentes teriam valores alterados; abortado.', v;
    END IF;
END
$chk$;

-- Contador promocional só pelo servidor; API não grava nem zera.
-- current_user (e não o GUC role): dentro de função SECURITY DEFINER o current_user é o dono,
-- então o servidor consegue ajustar o contador; chamadas diretas da API (anon/authenticated) não.
CREATE OR REPLACE FUNCTION public._offers_protect_counter()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF current_user IN ('anon','authenticated') THEN
        IF TG_OP = 'INSERT' THEN
            NEW.promo_times_used := 0;
        ELSIF NEW.promo_times_used IS DISTINCT FROM OLD.promo_times_used THEN
            RAISE EXCEPTION 'COUNTER_PROTECTED: promo_times_used é mantido pelo servidor.' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_offers_protect_counter
    BEFORE INSERT OR UPDATE OF promo_times_used ON public.offers
    FOR EACH ROW EXECUTE FUNCTION public._offers_protect_counter();

CREATE TABLE public.promotion_carousels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    description     TEXT,
    cover_asset_id  UUID,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    show_in_store   BOOLEAN NOT NULL DEFAULT true,
    start_at        TIMESTAMPTZ,
    end_at          TIMESTAMPTZ,
    display_order   INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT promotion_carousels_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT promotion_carousels_window CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at),
    CONSTRAINT promotion_carousels_cover_fk FOREIGN KEY (tenant_id, cover_asset_id)
        REFERENCES public.marketing_media_assets (tenant_id, id) ON DELETE SET NULL (cover_asset_id)
);
CREATE INDEX idx_promotion_carousels_tenant ON public.promotion_carousels (tenant_id, is_active, display_order);

CREATE TABLE public.promotion_carousel_items (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    carousel_id          UUID NOT NULL,
    product_id           UUID NOT NULL,
    discount_type        VARCHAR(20) NOT NULL CHECK (discount_type IN ('PERCENTAGE','FIXED_AMOUNT','PROMOTIONAL_PRICE','NONE')),
    discount_value       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
    show_discount_badge  BOOLEAN NOT NULL DEFAULT true,
    start_at             TIMESTAMPTZ,
    end_at               TIMESTAMPTZ,
    is_active            BOOLEAN NOT NULL DEFAULT true,
    display_order        INTEGER NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pci_carousel_product_key UNIQUE (carousel_id, product_id),
    CONSTRAINT pci_percentage_max CHECK (discount_type <> 'PERCENTAGE' OR discount_value <= 100),
    CONSTRAINT pci_window CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at),
    CONSTRAINT pci_carousel_fk FOREIGN KEY (tenant_id, carousel_id) REFERENCES public.promotion_carousels (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT pci_product_fk FOREIGN KEY (tenant_id, product_id) REFERENCES public.products (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_pci_product ON public.promotion_carousel_items (tenant_id, product_id) WHERE is_active;
CREATE INDEX idx_pci_carousel ON public.promotion_carousel_items (carousel_id, display_order);

CREATE TRIGGER trg_promotion_carousels_updated_at BEFORE UPDATE ON public.promotion_carousels
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_promotion_carousel_items_updated_at BEFORE UPDATE ON public.promotion_carousel_items
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.promotion_carousels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_carousel_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY promotion_carousels_om_select ON public.promotion_carousels FOR SELECT TO authenticated USING (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY promotion_carousels_om_insert ON public.promotion_carousels FOR INSERT TO authenticated WITH CHECK (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY promotion_carousels_om_update ON public.promotion_carousels FOR UPDATE TO authenticated USING (public.is_tenant_owner_or_manager(tenant_id)) WITH CHECK (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY promotion_carousels_om_delete ON public.promotion_carousels FOR DELETE TO authenticated USING (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY pci_om_select ON public.promotion_carousel_items FOR SELECT TO authenticated USING (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY pci_om_insert ON public.promotion_carousel_items FOR INSERT TO authenticated WITH CHECK (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY pci_om_update ON public.promotion_carousel_items FOR UPDATE TO authenticated USING (public.is_tenant_owner_or_manager(tenant_id)) WITH CHECK (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY pci_om_delete ON public.promotion_carousel_items FOR DELETE TO authenticated USING (public.is_tenant_owner_or_manager(tenant_id));
REVOKE ALL ON public.promotion_carousels, public.promotion_carousel_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promotion_carousels, public.promotion_carousel_items TO authenticated;

-- Mídia referenciada: mesmo tenant, CREATIVE, não ARCHIVED (a vitrine ainda exige PUBLISHED).
-- TG_ARGV[0] = nome da coluna de referência.
CREATE OR REPLACE FUNCTION public._media_reference_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_asset UUID := NULLIF(to_jsonb(NEW) ->> TG_ARGV[0], '')::uuid;
BEGIN
    IF v_asset IS NULL THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.marketing_media_assets a
                   WHERE a.id = v_asset AND a.tenant_id = NEW.tenant_id AND a.kind = 'CREATIVE' AND a.status <> 'ARCHIVED') THEN
        RAISE EXCEPTION 'MEDIA_REFERENCE_INVALID: a mídia precisa ser CREATIVE, do mesmo tenant e não arquivada.';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_offers_media_reference
    BEFORE INSERT OR UPDATE OF media_asset_id ON public.offers
    FOR EACH ROW EXECUTE FUNCTION public._media_reference_check('media_asset_id');
CREATE TRIGGER trg_promotion_carousels_media_reference
    BEFORE INSERT OR UPDATE OF cover_asset_id ON public.promotion_carousels
    FOR EACH ROW EXECUTE FUNCTION public._media_reference_check('cover_asset_id');

-- Redefinição: preço autoritativo considerando carrossel ativo (decisão 8).
CREATE OR REPLACE FUNCTION public._effective_product_price(p_tenant UUID, p_product UUID, p_at TIMESTAMPTZ)
RETURNS TABLE(unit_price NUMERIC, original_price NUMERIC, is_promotional BOOLEAN, price_source TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH p AS (
        SELECT pr.price, pr.promotional_price FROM public.products pr WHERE pr.id = p_product AND pr.tenant_id = p_tenant
    ), cand AS (
        SELECT p.promotional_price AS v, 'PRODUCT_PROMO'::text AS src, 1 AS prio FROM p
        WHERE p.promotional_price IS NOT NULL AND p.promotional_price > 0 AND p.promotional_price < p.price
        UNION ALL
        SELECT round(CASE i.discount_type
                        WHEN 'PERCENTAGE' THEN p.price * (1 - i.discount_value / 100.0)
                        WHEN 'FIXED_AMOUNT' THEN p.price - i.discount_value
                        WHEN 'PROMOTIONAL_PRICE' THEN i.discount_value END, 2), 'CAROUSEL', 2
        FROM p, public.promotion_carousel_items i
        JOIN public.promotion_carousels c ON c.id = i.carousel_id AND c.tenant_id = i.tenant_id
        WHERE i.tenant_id = p_tenant AND i.product_id = p_product AND i.is_active AND i.discount_type <> 'NONE'
          AND c.is_active AND c.show_in_store
          AND (i.start_at IS NULL OR i.start_at <= p_at) AND (i.end_at IS NULL OR i.end_at > p_at)
          AND (c.start_at IS NULL OR c.start_at <= p_at) AND (c.end_at IS NULL OR c.end_at > p_at)
    ), best AS (
        SELECT v, src FROM cand, p WHERE v > 0 AND v < p.price ORDER BY v ASC, prio ASC LIMIT 1
    )
    SELECT COALESCE((SELECT v FROM best), p.price), p.price, EXISTS (SELECT 1 FROM best),
           COALESCE((SELECT src FROM best), 'BASE')
    FROM p;
$$;

DO $grants$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public._offers_protect_counter()',
        'public._media_reference_check()',
        'public._effective_product_price(uuid,uuid,timestamp with time zone)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    END LOOP;
END
$grants$;
-- Fim da N4.
