-- ============================================================================
-- PROPOSTA (NÃO É MIGRATION ATIVA) — 20261013000300_n4_origin_pricing_d1_d6.sql
-- DeliveryChannel — Preço por origem sobre o esquema de campanhas N4 + decisões comerciais D1–D6.
--
-- Local: supabase/proposals/ (fora de supabase/migrations: não entra em `db push`). NÃO aplicar em produção
-- sem revisão do fundador. Rollback: rollback_20261013000300_n4_origin_pricing_d1_d6.sql
--
-- PRÉ-REQUISITOS (abortará se faltarem):
--   001–020 + N1 v3 + N2 v3 reconciliada + N3 (marketing_media_assets, exigida pela N4) + N4
--   + proposta 20261013000100 (marcador [FULFILLMENT]).
--   A proposta 20261013000200 NÃO é pré-requisito: esta proposta a SUBSTITUI quando a N4 existe
--   (a 0200 aborta se as tabelas de carrossel existirem). Se a 0200 estiver aplicada, esta redefine _checkout_core
--   sem a chamada [ORIGIN] e remove _origin_normalize_items.
--
-- O QUE FAZ
--   D1  coupons.stack_with_pickup_discount (padrão false). Retirada é aplicada primeiro; cupom não acumulável
--       não incide sobre itens que receberam desconto de retirada (sem duplicidade). Se não sobrar item elegível
--       => COUPON_NOT_STACKABLE_WITH_PICKUP.
--   D2  Cupom genérico só sobre itens NÃO promocionais antes do checkout (promoção própria do produto ou campanha).
--       O desconto de retirada não muda r_is_promotional.
--   D4  Exceções de retirada por oferta valem também para itens de campanha (campaignItemId em
--       tenant_settings.pickup_discount_excluded_offer_ids), além de produto e "excluir promocionais".
--   D6  Frete grátis avaliado sobre v_subtotal = soma dos preços efetivos pela origem, antes de retirada e cupom
--       (preço de lista anterior à promoção nunca é usado).
--   ORIGEM  _price_items_by_origin: catálogo => preço vigente do produto (regra N2, SEM carrossel);
--           campanha => preço do item N4 exatamente referenciado (_campaign_item_price), validado
--           (tenant, carrossel e item ativos, show_in_store, janelas start_at/end_at do item E do carrossel,
--           produto do item, discount_type <> NONE, 0 < preço < preço cheio). NUNCA escolhe o menor preço.
--           Não usa a _effective_product_price da N4 (que escolhe o menor entre promoção e carrossel) — a N4 NÃO é editada.
--   VITRINE get_public_campaign_carousels(p_slug): campanhas visíveis com o preço calculado no servidor (anon/auth).
--   RASTREIO public.order_line_origins (order_items é imutável pela N1; não é alterado).
--
-- NÃO FAZ: D3 e D5 no checkout promocional independente dependem da RPC do card (N6 _promo_checkout / 026 legado),
--   que não existe na produção assumida; ficam documentados no relatório. Nada é apagado; nenhum dado é alterado.
-- Espelho do front: src/lib/pricing/fulfillmentPricing.ts, purchaseOrigin.ts, n4Campaign.ts
-- ============================================================================

-- 0. PRECHECK ESTRUTURAL
DO $pre$
DECLARE v_src TEXT;
BEGIN
    IF to_regprocedure('public._price_items(uuid,jsonb,boolean)') IS NULL
       OR to_regprocedure('public._insert_order_lines(uuid,uuid,jsonb,numeric,numeric,text)') IS NULL
       OR to_regprocedure('public._coupon_lock_and_quote(uuid,text,uuid,numeric,boolean)') IS NULL
       OR to_regclass('public.coupons') IS NULL THEN
        RAISE EXCEPTION 'N4ORIGIN PRE: objetos da N2 ausentes. Abortado.';
    END IF;
    SELECT prosrc INTO v_src FROM pg_proc
    WHERE oid = to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)');
    IF v_src IS NULL OR position('[FULFILLMENT]' IN v_src) = 0 THEN
        RAISE EXCEPTION 'N4ORIGIN PRE: proposta 20261013000100 (modalidade/retirada) não aplicada. Abortado.';
    END IF;
    IF to_regclass('public.promotion_carousels') IS NULL OR to_regclass('public.promotion_carousel_items') IS NULL THEN
        RAISE EXCEPTION 'N4ORIGIN PRE: tabelas de campanha da N4 ausentes. Aplique a N4 antes. Abortado.';
    END IF;
    -- Esquema N4 (não 022): preço derivado de discount_type/discount_value; validade start_at/end_at.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='promotion_carousel_items' AND column_name='start_at')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='promotion_carousels' AND column_name='end_at')
       OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='promotion_carousel_items' AND column_name IN ('promotional_price','start_date')) THEN
        RAISE EXCEPTION 'N4ORIGIN PRE: promotion_carousel_items não está no esquema N4 (parece 022). Não misturar esquemas. Abortado.';
    END IF;
    -- Esta proposta redefine _checkout_core a partir do corpo da 0100; se N5/N6 já injetaram atribuição, refazer sobre o corpo real.
    IF position('@@N5_ATTR_DECL@@' IN v_src) = 0 THEN
        RAISE EXCEPTION 'N4ORIGIN PRE: _checkout_core já foi alterado pela N5/N6 (marcadores @@N5_*@@ substituídos). Refazer a proposta sobre o corpo atual. Abortado.';
    END IF;
END
$pre$;

-- 1. D1: regra do cupom autoriza (ou não) acumular com o desconto de retirada.
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS stack_with_pickup_discount BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.coupons.stack_with_pickup_discount IS
    'D1: true = o cupom acumula com o desconto de retirada (aplicado depois dele). false = não incide sobre itens que receberam retirada.';
-- N2: coupons só tem GRANT SELECT, DELETE para authenticated (escrita via RPC de cupom). Leitura da nova coluna já coberta.

-- 2. Rastreio da origem por linha do pedido. order_items é IMUTÁVEL (N1 _order_items_protect) — por isso uma tabela
--    própria, só INSERT pelo checkout (SECURITY DEFINER). campaign_item_id SEM FK: referência histórica (apagar uma
--    campanha não pode alterar pedidos).
CREATE TABLE IF NOT EXISTS public.order_line_origins (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    order_id          UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id        UUID NOT NULL,
    quantity          INTEGER NOT NULL CHECK (quantity > 0),
    unit_price        NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    price_source      VARCHAR(16) NOT NULL CHECK (price_source IN ('BASE','PRODUCT_PROMO','CAMPAIGN')),
    campaign_item_id  UUID,
    got_pickup_discount BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT order_line_origins_campaign_ref CHECK ((price_source = 'CAMPAIGN') = (campaign_item_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_order_line_origins_order ON public.order_line_origins (order_id);
CREATE INDEX IF NOT EXISTS idx_order_line_origins_campaign ON public.order_line_origins (tenant_id, campaign_item_id) WHERE campaign_item_id IS NOT NULL;
ALTER TABLE public.order_line_origins ENABLE ROW LEVEL SECURITY;
DO $pol$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_line_origins' AND policyname='order_line_origins_om_select') THEN
        CREATE POLICY order_line_origins_om_select ON public.order_line_origins FOR SELECT TO authenticated
            USING (public.is_tenant_owner_or_manager(tenant_id));
    END IF;
END
$pol$;
REVOKE ALL ON public.order_line_origins FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_line_origins TO authenticated;

-- 3. Preço de UM item de campanha N4 exatamente referenciado (nunca procura o menor).
--    Devolve unit_price ou reason (sem lançar), para ser usado tanto no checkout quanto na vitrine.
CREATE OR REPLACE FUNCTION public._campaign_item_price(p_tenant UUID, p_item UUID, p_product UUID, p_at TIMESTAMPTZ)
RETURNS TABLE(unit_price NUMERIC, original_price NUMERIC, carousel_id UUID, reason TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_i RECORD;
    v_price NUMERIC;
    v_unit NUMERIC;
BEGIN
    SELECT i.*, c.is_active AS c_active, c.show_in_store AS c_show, c.start_at AS c_start, c.end_at AS c_end,
           c.tenant_id AS c_tenant, pr.price AS p_price, pr.tenant_id AS p_tenant_id
    INTO v_i
    FROM public.promotion_carousel_items i
    JOIN public.promotion_carousels c ON c.id = i.carousel_id AND c.tenant_id = i.tenant_id
    JOIN public.products pr ON pr.id = i.product_id AND pr.tenant_id = i.tenant_id
    WHERE i.id = p_item;
    IF NOT FOUND THEN
        unit_price := NULL; original_price := NULL; carousel_id := NULL; reason := 'CAMPAIGN_ITEM_NOT_FOUND'; RETURN NEXT; RETURN;
    END IF;
    carousel_id := v_i.carousel_id; original_price := v_i.p_price; unit_price := NULL;
    IF v_i.tenant_id <> p_tenant OR v_i.c_tenant <> p_tenant THEN reason := 'CAMPAIGN_OTHER_TENANT'; RETURN NEXT; RETURN; END IF;
    IF v_i.product_id <> p_product THEN reason := 'CAMPAIGN_PRODUCT_MISMATCH'; RETURN NEXT; RETURN; END IF;
    IF NOT v_i.is_active OR NOT v_i.c_active OR NOT v_i.c_show OR v_i.discount_type = 'NONE' THEN
        reason := 'CAMPAIGN_INACTIVE'; RETURN NEXT; RETURN;
    END IF;
    IF (v_i.start_at IS NOT NULL AND v_i.start_at > p_at) OR (v_i.c_start IS NOT NULL AND v_i.c_start > p_at) THEN
        reason := 'CAMPAIGN_NOT_STARTED'; RETURN NEXT; RETURN;
    END IF;
    IF (v_i.end_at IS NOT NULL AND v_i.end_at <= p_at) OR (v_i.c_end IS NOT NULL AND v_i.c_end <= p_at) THEN
        reason := 'CAMPAIGN_EXPIRED'; RETURN NEXT; RETURN;
    END IF;
    v_price := v_i.p_price;
    v_unit := round(CASE v_i.discount_type
                        WHEN 'PERCENTAGE' THEN v_price * (1 - v_i.discount_value / 100.0)
                        WHEN 'FIXED_AMOUNT' THEN v_price - v_i.discount_value
                        WHEN 'PROMOTIONAL_PRICE' THEN v_i.discount_value END, 2);
    IF v_unit IS NULL OR v_unit <= 0 OR v_unit >= v_price THEN
        reason := 'CAMPAIGN_PRICE_INVALID'; RETURN NEXT; RETURN;
    END IF;
    unit_price := v_unit; reason := NULL;
    RETURN NEXT;
END;
$$;

-- 4. Itens do checkout com origem. Mesmas validações da _price_items (N2) + source/campaignItemId.
--    Linhas = (produto, origem, item de campanha). Lock dos produtos em ordem de id. Estoque validado pelo TOTAL do produto.
CREATE OR REPLACE FUNCTION public._price_items_by_origin(p_tenant UUID, p_items JSONB, p_lock BOOLEAN)
RETURNS TABLE(r_product_id UUID, r_quantity INT, r_notes TEXT, r_name TEXT, r_unit TEXT, r_stock INT,
              r_unit_price NUMERIC, r_original_price NUMERIC, r_is_promotional BOOLEAN, r_price_source TEXT,
              r_campaign_item_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_elem JSONB;
    v_key TEXT;
    v_src TEXT;
    v_agg RECORD;
    v_prod RECORD;
    v_camp RECORD;
    v_pid UUID;
    v_total INT;
    v_uuid_re CONSTANT TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'EMPTY_CART: a sacola de compras não pode estar vazia.';
    END IF;
    IF jsonb_array_length(p_items) > 100 THEN
        RAISE EXCEPTION 'TOO_MANY_ITEMS: máximo de 100 linhas por pedido.';
    END IF;
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        IF jsonb_typeof(v_elem) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'INVALID_ITEM: item do pedido inválido.';
        END IF;
        FOR v_key IN SELECT jsonb_object_keys(v_elem) LOOP
            IF v_key NOT IN ('productId','quantity','notes','source','campaignItemId') THEN
                RAISE EXCEPTION 'UNEXPECTED_FIELD: campo "%" não é aceito nos itens (preço e desconto são calculados no servidor).', v_key;
            END IF;
        END LOOP;
        IF jsonb_typeof(v_elem -> 'productId') IS DISTINCT FROM 'string' OR (v_elem ->> 'productId') !~* v_uuid_re THEN
            RAISE EXCEPTION 'INVALID_ITEM: ID do produto inválido no pedido.';
        END IF;
        IF jsonb_typeof(v_elem -> 'quantity') IS DISTINCT FROM 'number' OR (v_elem ->> 'quantity') !~ '^[0-9]+$'
           OR (v_elem ->> 'quantity')::numeric < 1 OR (v_elem ->> 'quantity')::numeric > 999 THEN
            RAISE EXCEPTION 'INVALID_QUANTITY: a quantidade do item deve ser um inteiro entre 1 e 999.';
        END IF;
        IF v_elem ? 'notes' AND jsonb_typeof(v_elem -> 'notes') NOT IN ('string','null') THEN
            RAISE EXCEPTION 'INVALID_ITEM: observação do item inválida.';
        END IF;
        IF length(COALESCE(v_elem ->> 'notes', '')) > 300 THEN
            RAISE EXCEPTION 'INVALID_ITEM: observação do item com mais de 300 caracteres.';
        END IF;
        IF v_elem ? 'source' AND jsonb_typeof(v_elem -> 'source') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'INVALID_ITEM_SOURCE: origem do item inválida.';
        END IF;
        v_src := COALESCE(v_elem ->> 'source', 'catalog');
        IF v_src NOT IN ('catalog','campaign') THEN
            RAISE EXCEPTION 'INVALID_ITEM_SOURCE: origem "%" inválida. Valores aceitos: catalog, campaign.', v_src;
        END IF;
        IF v_src = 'catalog' AND v_elem ? 'campaignItemId' THEN
            RAISE EXCEPTION 'INVALID_ITEM_SOURCE: campaignItemId só é aceito com source = campaign.';
        END IF;
        IF v_src = 'campaign' AND (jsonb_typeof(v_elem -> 'campaignItemId') IS DISTINCT FROM 'string'
                                   OR (v_elem ->> 'campaignItemId') !~* v_uuid_re) THEN
            RAISE EXCEPTION 'CAMPAIGN_ITEM_INVALID: referência da oferta (campaignItemId) ausente ou inválida.';
        END IF;
    END LOOP;

    -- Quantidade total por produto (limite 999 e estoque consideram todas as origens juntas).
    FOR v_agg IN
        SELECT (e ->> 'productId')::uuid AS pid, sum((e ->> 'quantity')::int)::int AS qty
        FROM jsonb_array_elements(p_items) e GROUP BY 1 ORDER BY 1
    LOOP
        IF v_agg.qty > 999 THEN
            RAISE EXCEPTION 'INVALID_QUANTITY: quantidade máxima por produto é 999.';
        END IF;
        IF p_lock THEN
            SELECT p.* INTO v_prod FROM public.products p WHERE p.id = v_agg.pid AND p.tenant_id = p_tenant FOR UPDATE;
        ELSE
            SELECT p.* INTO v_prod FROM public.products p WHERE p.id = v_agg.pid AND p.tenant_id = p_tenant;
        END IF;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRODUCT_NOT_FOUND: produto % não encontrado no catálogo deste estabelecimento.', v_agg.pid;
        END IF;
        IF NOT v_prod.is_active THEN
            RAISE EXCEPTION 'PRODUCT_UNAVAILABLE: o produto "%" está temporariamente indisponível.', v_prod.name;
        END IF;
        IF v_prod.stock_quantity < v_agg.qty THEN
            RAISE EXCEPTION 'OUT_OF_STOCK: estoque insuficiente para o produto "%". Disponível: %, solicitado: %',
                v_prod.name, v_prod.stock_quantity, v_agg.qty;
        END IF;
    END LOOP;

    FOR v_agg IN
        SELECT (e ->> 'productId')::uuid AS pid,
               COALESCE(e ->> 'source', 'catalog') AS src,
               NULLIF(e ->> 'campaignItemId', '')::uuid AS ciid,
               sum((e ->> 'quantity')::int)::int AS qty,
               string_agg(NULLIF(btrim(e ->> 'notes'), ''), ' | ') AS notes
        FROM jsonb_array_elements(p_items) e
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3
    LOOP
        SELECT p.* INTO v_prod FROM public.products p WHERE p.id = v_agg.pid AND p.tenant_id = p_tenant;
        r_product_id := v_agg.pid; r_quantity := v_agg.qty; r_notes := v_agg.notes;
        r_name := v_prod.name; r_unit := v_prod.unit; r_stock := v_prod.stock_quantity;
        r_original_price := v_prod.price;
        IF v_agg.src = 'campaign' THEN
            SELECT * INTO v_camp FROM public._campaign_item_price(p_tenant, v_agg.ciid, v_agg.pid, now());
            IF v_camp.reason IS NOT NULL THEN
                RAISE EXCEPTION 'CAMPAIGN_ITEM_INVALID: % (produto "%"). Atualize a sacola e tente novamente.', v_camp.reason, v_prod.name;
            END IF;
            r_unit_price := v_camp.unit_price; r_is_promotional := true; r_price_source := 'CAMPAIGN';
            r_campaign_item_id := v_agg.ciid;
        ELSE
            -- Preço vigente do CATÁLOGO (regra N2), independente de carrossel.
            r_unit_price := CASE WHEN v_prod.promotional_price IS NOT NULL AND v_prod.promotional_price > 0
                                      AND v_prod.promotional_price <= v_prod.price
                                 THEN v_prod.promotional_price ELSE v_prod.price END;
            r_is_promotional := (v_prod.promotional_price IS NOT NULL AND v_prod.promotional_price > 0
                                 AND v_prod.promotional_price < v_prod.price);
            r_price_source := CASE WHEN r_is_promotional THEN 'PRODUCT_PROMO' ELSE 'BASE' END;
            r_campaign_item_id := NULL;
        END IF;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- 5. Vitrine: campanhas visíveis com preço autorizado pelo servidor (mesma função do checkout).
CREATE OR REPLACE FUNCTION public.get_public_campaign_carousels(p_slug TEXT)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH t AS (SELECT id FROM public.tenants WHERE slug = p_slug AND status = 'ACTIVE'),
    items AS (
        SELECT i.carousel_id, i.display_order, jsonb_build_object(
                 'id', i.id, 'carouselId', i.carousel_id, 'productId', i.product_id, 'tenantId', i.tenant_id,
                 'discountType', i.discount_type, 'discountValue', i.discount_value,
                 'promotionalPrice', cp.unit_price,
                 'calculatedDiscountPercentage', round((cp.original_price - cp.unit_price) / cp.original_price * 100),
                 'showDiscountBadge', i.show_discount_badge, 'showPromotionalPrice', true,
                 'startDate', i.start_at, 'endDate', i.end_at, 'isActive', true, 'displayOrder', i.display_order,
                 'product', jsonb_build_object('id', pr.id, 'tenantId', pr.tenant_id, 'name', pr.name, 'description', pr.description,
                                               'price', pr.price, 'promotionalPrice', pr.promotional_price,
                                               'imageUrl', pr.image_url, 'unit', pr.unit, 'isActive', pr.is_active,
                                               'stockQuantity', pr.stock_quantity, 'categoryId', pr.category_id)) AS j
        FROM t
        JOIN public.promotion_carousel_items i ON i.tenant_id = t.id
        JOIN public.products pr ON pr.id = i.product_id AND pr.tenant_id = t.id AND pr.is_active
        CROSS JOIN LATERAL public._campaign_item_price(t.id, i.id, i.product_id, now()) cp
        WHERE cp.reason IS NULL
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', c.id, 'tenantId', c.tenant_id, 'name', c.name, 'description', c.description,
               'isActive', true, 'showInStore', true, 'displayOrder', c.display_order,
               'startDate', c.start_at, 'endDate', c.end_at,
               'items', (SELECT jsonb_agg(it.j ORDER BY it.display_order) FROM items it WHERE it.carousel_id = c.id))
             ORDER BY c.display_order), '[]'::jsonb)
    FROM t JOIN public.promotion_carousels c ON c.tenant_id = t.id
    WHERE c.is_active AND c.show_in_store
      AND (c.start_at IS NULL OR c.start_at <= now()) AND (c.end_at IS NULL OR c.end_at > now())
      AND EXISTS (SELECT 1 FROM items it WHERE it.carousel_id = c.id);
$$;

-- 6. _checkout_core = corpo da 0100 + [N4ORIGIN][D1D6]. MESMA assinatura e retorno.
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
    -- [FULFILLMENT] modalidade + desconto de retirada (proposta 20261013000100)
    v_pickup_pct NUMERIC := 0;
    v_elig_promo NUMERIC := 0;
    v_elig_nonpromo NUMERIC := 0;
    v_pickup_nonpromo NUMERIC := 0;
    v_pickup_promo NUMERIC := 0;
    v_pickup NUMERIC := 0;
    v_line_total NUMERIC;
    -- [N4ORIGIN][D1D6] proposta 20261013000300
    v_gets_pickup BOOLEAN;
    v_nonpromo_nopickup NUMERIC := 0;
    v_coupon_stack BOOLEAN := false;
    v_coupon_base NUMERIC := 0;
    v_alloc_base NUMERIC := 0;
    v_alloc_lines JSONB := '[]'::jsonb;
    v_l JSONB;
    -- @@N5_ATTR_DECL@@
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
           s.free_delivery_threshold, s.default_prep_time_minutes,
           COALESCE(s.delivery_enabled, true) AS delivery_enabled, COALESCE(s.pickup_enabled, true) AS pickup_enabled,
           COALESCE(s.pickup_discount_enabled, false) AS pickup_discount_enabled,
           COALESCE(s.pickup_discount_percent, 0) AS pickup_discount_percent,
           COALESCE(s.pickup_discount_exclude_promotional, false) AS pickup_discount_exclude_promotional,
           COALESCE(s.pickup_discount_excluded_product_ids, '{}'::uuid[]) AS pickup_discount_excluded_product_ids,
           COALESCE(s.pickup_discount_excluded_offer_ids, '{}'::uuid[]) AS pickup_discount_excluded_offer_ids
    INTO v_tenant
    FROM public.tenants t LEFT JOIN public.tenant_settings s ON s.tenant_id = t.id
    WHERE t.slug = p_tenant_slug AND t.status = 'ACTIVE';
    IF v_tenant.id IS NULL THEN
        RAISE EXCEPTION 'STORE_UNAVAILABLE: estabelecimento não encontrado ou indisponível para pedidos.';
    END IF;
    IF v_tenant.is_open IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'STORE_CLOSED: a loja está fechada no momento.';
    END IF;
    -- [FULFILLMENT] modalidade validada contra a configuração DESTE tenant (nunca do navegador)
    IF NOT v_tenant.delivery_enabled AND NOT v_tenant.pickup_enabled THEN
        RAISE EXCEPTION 'FULFILLMENT_UNAVAILABLE: o estabelecimento não está aceitando pedidos para entrega nem para retirada.';
    ELSIF p_fulfillment_type = 'DELIVERY' AND NOT v_tenant.delivery_enabled THEN
        RAISE EXCEPTION 'FULFILLMENT_UNAVAILABLE: este estabelecimento não está fazendo entregas no momento.';
    ELSIF p_fulfillment_type = 'PICKUP' AND NOT v_tenant.pickup_enabled THEN
        RAISE EXCEPTION 'FULFILLMENT_UNAVAILABLE: este estabelecimento não está aceitando retirada no momento.';
    END IF;
    IF p_fulfillment_type = 'PICKUP' AND v_tenant.pickup_discount_enabled
       AND v_tenant.pickup_discount_percent > 0 AND v_tenant.pickup_discount_percent <= 50 THEN
        v_pickup_pct := v_tenant.pickup_discount_percent;
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
    -- [N4ORIGIN] preço pela ORIGEM (catálogo ou item de campanha N4 referenciado); nunca o menor.
    FOR v_line IN SELECT * FROM public._price_items_by_origin(v_tenant.id, p_items, true) LOOP
        IF v_line.r_stock < v_line.r_quantity THEN
            RAISE EXCEPTION 'OUT_OF_STOCK: estoque insuficiente para o produto "%". Disponível: %, solicitado: %',
                v_line.r_name, v_line.r_stock, v_line.r_quantity;
        END IF;
        v_subtotal := v_subtotal + round(v_line.r_unit_price * v_line.r_quantity, 2);
        IF NOT v_line.r_is_promotional THEN
            v_base := v_base + round(v_line.r_unit_price * v_line.r_quantity, 2);
        END IF;
        -- [FULFILLMENT][D4] base elegível ao desconto de retirada (exceções por produto, por oferta/item de campanha,
        -- e "excluir itens promocionais"). Retirada NÃO altera r_is_promotional (D2).
        v_line_total := round(v_line.r_unit_price * v_line.r_quantity, 2);
        v_gets_pickup := v_pickup_pct > 0
           AND NOT (v_line.r_product_id = ANY (v_tenant.pickup_discount_excluded_product_ids))
           AND NOT (v_line.r_campaign_item_id IS NOT NULL AND v_line.r_campaign_item_id = ANY (v_tenant.pickup_discount_excluded_offer_ids))
           AND NOT (v_tenant.pickup_discount_exclude_promotional AND v_line.r_is_promotional);
        IF v_gets_pickup THEN
            IF v_line.r_is_promotional THEN
                v_elig_promo := v_elig_promo + v_line_total;
            ELSE
                v_elig_nonpromo := v_elig_nonpromo + v_line_total;
            END IF;
        ELSIF NOT v_line.r_is_promotional THEN
            v_nonpromo_nopickup := v_nonpromo_nopickup + v_line_total;
        END IF;
        v_lines := v_lines || jsonb_build_object('product_id', v_line.r_product_id, 'quantity', v_line.r_quantity,
            'notes', v_line.r_notes, 'name', v_line.r_name, 'unit', v_line.r_unit, 'unit_price', v_line.r_unit_price,
            'original_price', v_line.r_original_price, 'is_promotional', v_line.r_is_promotional, 'item_kind', 'PRODUCT',
            'gets_pickup', v_gets_pickup, 'campaign_item_id', v_line.r_campaign_item_id, 'price_source', v_line.r_price_source);
    END LOOP;

    -- [FULFILLMENT] desconto de retirada: uma única vez, arredondado por grupo (espelho de fulfillmentPricing.ts)
    IF v_pickup_pct > 0 THEN
        v_pickup_nonpromo := round(v_elig_nonpromo * v_pickup_pct / 100.0, 2);
        v_pickup_promo := round(v_elig_promo * v_pickup_pct / 100.0, 2);
        v_pickup := v_pickup_nonpromo + v_pickup_promo;
    END IF;

    IF v_tenant.min_order_value > 0 AND v_subtotal < v_tenant.min_order_value THEN
        RAISE EXCEPTION 'MIN_ORDER_NOT_MET: valor mínimo do pedido é R$ % (subtotal R$ %).', v_tenant.min_order_value, v_subtotal;
    END IF;

    -- 9. Taxa de entrega (regra da 009). [D6] v_subtotal = preços efetivos pela origem, ANTES de retirada e cupom.
    IF p_fulfillment_type = 'DELIVERY' THEN
        v_delivery_fee := v_tenant.delivery_fee;
        IF v_tenant.free_delivery_threshold IS NOT NULL AND v_subtotal >= v_tenant.free_delivery_threshold THEN
            v_delivery_fee := 0;
        END IF;
    END IF;

    -- 10. Cliente pelo vínculo customers.user_id (modelo 009, anti-takeover)
    SELECT id INTO v_customer_id FROM public.customers WHERE tenant_id = v_tenant.id AND user_id = v_user_id;

    -- 12a. Cupom [D1][D2]: retirada já aplicada; base = itens NÃO promocionais (antes do checkout).
    --      Acumulável: líquidos da retirada. Não acumulável: só os que NÃO receberam retirada (sem duplicidade).
    IF public.normalize_coupon_code(p_coupon_code) IS NOT NULL THEN
        SELECT COALESCE(c.stack_with_pickup_discount, false) INTO v_coupon_stack
        FROM public.coupons c WHERE c.tenant_id = v_tenant.id AND c.code = public.normalize_coupon_code(p_coupon_code);
        v_coupon_stack := COALESCE(v_coupon_stack, false);
        IF v_coupon_stack OR v_pickup = 0 THEN
            v_coupon_base := GREATEST(v_base - v_pickup_nonpromo, 0);
            v_alloc_base := v_base;
            v_alloc_lines := v_lines;
        ELSE
            v_coupon_base := v_nonpromo_nopickup;
            v_alloc_base := v_nonpromo_nopickup;
            -- rateio do cupom (_insert_order_lines da N2 usa is_promotional): linhas com retirada ficam fora do rateio.
            FOR v_l IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
                v_alloc_lines := v_alloc_lines || jsonb_build_array(
                    CASE WHEN (v_l ->> 'gets_pickup')::boolean THEN jsonb_set(v_l, '{is_promotional}', 'true'::jsonb) ELSE v_l END);
            END LOOP;
            IF v_coupon_base <= 0 AND v_base > 0 THEN
                RAISE EXCEPTION 'COUPON_NOT_STACKABLE_WITH_PICKUP: este cupom não acumula com o desconto de retirada.';
            END IF;
        END IF;
        SELECT * INTO v_coupon FROM public._coupon_lock_and_quote(v_tenant.id, p_coupon_code, v_customer_id, v_coupon_base, false);
        v_discount := v_coupon.r_discount;
        v_coupon_id := v_coupon.r_coupon_id;
        v_coupon_code := v_coupon.r_code;
    ELSE
        v_alloc_base := v_base;
        v_alloc_lines := v_lines;
    END IF;

    -- @@N5_ATTR_RESOLVE@@

    -- [FULFILLMENT] retirada nunca cobra taxa (já garantido: taxa só em DELIVERY); total nunca negativo
    v_total := GREATEST(v_subtotal - v_discount - v_pickup, 0) + v_delivery_fee;

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
                               fulfillment_type, status, notes, origin, prep_time_minutes, idempotency_key, coupon_id, coupon_code,
                               pickup_discount
                               /*@@N5_ORDER_COLS@@*/)
    VALUES (v_tenant.id, v_customer_id, btrim(p_customer_name), v_phone, v_email, v_address, p_address_details,
            v_subtotal, v_delivery_fee, LEAST(v_discount + v_pickup, v_subtotal), v_total, p_payment_method,
            CASE WHEN p_payment_method = 'PIX' THEN 'PENDING' ELSE 'PAYMENT_ON_DELIVERY' END,
            p_fulfillment_type, 'PENDING', NULLIF(btrim(COALESCE(p_notes, '')), ''), COALESCE(p_origin, 'direct'),
            v_tenant.default_prep_time_minutes, p_idempotency_key, v_coupon_id, v_coupon_code,
            v_pickup
            /*@@N5_ORDER_VALS@@*/)
    RETURNING id INTO v_order_id;

    v_items_out := public._insert_order_lines(v_order_id, v_tenant.id, v_alloc_lines, v_discount, v_alloc_base, 'Sistema (checkout)');
    -- [N4ORIGIN] rastreio da origem por linha (append-only; order_items continua imutável e inalterado).
    INSERT INTO public.order_line_origins (tenant_id, order_id, product_id, quantity, unit_price, price_source, campaign_item_id, got_pickup_discount)
    SELECT v_tenant.id, v_order_id, (l ->> 'product_id')::uuid, (l ->> 'quantity')::int, (l ->> 'unit_price')::numeric,
           l ->> 'price_source', NULLIF(l ->> 'campaign_item_id', '')::uuid, COALESCE((l ->> 'gets_pickup')::boolean, false)
    FROM jsonb_array_elements(v_lines) l;

    -- 12b. Consumo do cupom (contador com guarda + histórico)
    IF v_coupon_id IS NOT NULL THEN
        PERFORM public._coupon_consume(v_tenant.id, v_coupon_id, v_order_id, v_customer_id, v_discount, 'ONLINE', NULL);
    END IF;

    -- 15. Histórico
    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (v_order_id, 'PENDING', 'Pedido confirmado com sucesso pelo checkout online', 'Checkout Público');
    -- @@N5_PURCHASE@@

    RETURN public._checkout_order_summary(v_order_id, false);
END;
$$;

REVOKE ALL ON FUNCTION public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)
    FROM PUBLIC, anon, authenticated;


REVOKE ALL ON FUNCTION public._campaign_item_price(uuid,uuid,uuid,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._price_items_by_origin(uuid,jsonb,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_campaign_carousels(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_campaign_carousels(text) TO anon, authenticated;
-- Se a proposta 0200 estiver aplicada, sua função auxiliar deixa de ser usada.
DROP FUNCTION IF EXISTS public._origin_normalize_items(uuid, jsonb);

-- 7. Pós-verificação
DO $post$
DECLARE v_src TEXT;
BEGIN
    SELECT prosrc INTO v_src FROM pg_proc
    WHERE oid = to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)');
    IF position('[N4ORIGIN]' IN v_src) = 0 OR position('[FULFILLMENT]' IN v_src) = 0 OR position('[ORIGIN]' IN v_src) > 0
       OR to_regprocedure('public._price_items_by_origin(uuid,jsonb,boolean)') IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='coupons' AND column_name='stack_with_pickup_discount') THEN
        RAISE EXCEPTION 'N4ORIGIN POST: verificação falhou.';
    END IF;
END
$post$;
-- Fim da proposta.
