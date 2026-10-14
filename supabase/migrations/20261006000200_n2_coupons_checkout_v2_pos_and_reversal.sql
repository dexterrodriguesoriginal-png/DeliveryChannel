-- ============================================================================
-- N2 — CUPONS, CHECKOUT v2, PDV NO SERVIDOR E ESTORNO ATÔMICO DE CUPOM
-- DESIGN_N1_N6_ARQUITETURA_v3 (decisões 1, 7, 8, 9; F4, F5).
--
-- Cria:      coupons, coupon_redemptions; colunas orders.coupon_id/coupon_code e
--            order_items.original_unit_price/discount_amount/item_kind; funções de
--            preço autoritativo, cupom (prévia, consumo, estorno), _checkout_core,
--            process_checkout_atomic_v2, process_pos_sale_atomic, audit_coupon_counters,
--            trigger de ciclo de vida (estorno de cupom ao cancelar/estornar).
-- Substitui: process_checkout_atomic (009) — MESMA assinatura e RETURNS UUID; vira
--            wrapper de _checkout_core e nunca aplica cupom.
-- Intocado:  dados existentes (nenhum UPDATE/DELETE); get_public_store; RPCs de motorista.
-- Desvio do design: _coupon_reconsume_for_order NÃO é criada — com F5 (cancelado não
--            reabre) e REFUNDED terminal não existe transição inválido→válido; a trigger
--            de ciclo de vida recusa essa transição explicitamente.
-- Rollback:  supabase/rollback/n2_rollback.sql (manual).
-- ============================================================================

DO $pre$
DECLARE v_md5 TEXT;
BEGIN
    IF current_setting('server_version_num')::int < 150000 THEN
        RAISE EXCEPTION 'N2: requer PostgreSQL >= 15 (ON DELETE SET NULL (coluna)).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006000100') THEN
        RAISE EXCEPTION 'N2 PRE: N1 (20261006000100) não registrada; abortado.';
    END IF;
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version > '20261006000100') THEN
        RAISE EXCEPTION 'N2 PRE: há migrations posteriores à N1 registradas; ordem inesperada.';
    END IF;
    IF to_regclass('public.tenant_payment_settings') IS NULL OR to_regprocedure('public.has_tenant_scoped_role(uuid,text[])') IS NULL THEN
        RAISE EXCEPTION 'N2 PRE: objetos da N1 ausentes.';
    END IF;
    IF to_regclass('public.coupons') IS NOT NULL OR to_regclass('public.coupon_redemptions') IS NOT NULL THEN
        RAISE EXCEPTION 'N2 PRE: tabelas coupons/coupon_redemptions já existem; abortado.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
               AND ((table_name='orders' AND column_name IN ('coupon_id','coupon_code'))
                 OR (table_name='order_items' AND column_name IN ('original_unit_price','discount_amount','item_kind')))) THEN
        RAISE EXCEPTION 'N2 PRE: colunas de cupom já existem em orders/order_items; abortado.';
    END IF;
    SELECT md5(regexp_replace(prosrc, '\s+', '', 'g')) INTO v_md5 FROM pg_proc
    WHERE oid = to_regprocedure('public.process_checkout_atomic(text,character varying,character varying,character varying,text,jsonb,character varying,character varying,text,character varying,jsonb)');
    IF v_md5 IS DISTINCT FROM 'dbf628fdc378c41ab3c21d737c90ff9b' THEN
        RAISE EXCEPTION 'N2 PRE: process_checkout_atomic difere da 009 (md5 %); abortado.', v_md5;
    END IF;
END
$pre$;

-- ----------------------------------------------------------------------------
-- 1. TABELAS
-- ----------------------------------------------------------------------------
CREATE TABLE public.coupons (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    code                      VARCHAR(50) NOT NULL CHECK (code ~ '^[A-Z0-9_-]{3,50}$'),
    description               TEXT,
    discount_type             VARCHAR(16) NOT NULL CHECK (discount_type IN ('PERCENTAGE','FIXED_AMOUNT')),
    discount_value            NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
    max_discount_amount       NUMERIC(10,2) CHECK (max_discount_amount IS NULL OR max_discount_amount > 0),
    min_order_value           NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (min_order_value >= 0),
    usage_limit               INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
    usage_limit_per_customer  INTEGER CHECK (usage_limit_per_customer IS NULL OR usage_limit_per_customer > 0),
    times_used                INTEGER NOT NULL DEFAULT 0 CHECK (times_used >= 0),
    first_order_only          BOOLEAN NOT NULL DEFAULT false,
    start_at                  TIMESTAMPTZ,
    end_at                    TIMESTAMPTZ,
    status                    VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
    created_by                UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT coupons_percentage_max CHECK (discount_type <> 'PERCENTAGE' OR discount_value <= 100),
    CONSTRAINT coupons_usage_within_limit CHECK (usage_limit IS NULL OR times_used <= usage_limit),
    CONSTRAINT coupons_window CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at),
    CONSTRAINT coupons_tenant_code_key UNIQUE (tenant_id, code),
    CONSTRAINT coupons_tenant_id_id_key UNIQUE (tenant_id, id)
);
CREATE INDEX idx_coupons_tenant_status ON public.coupons (tenant_id, status);

CREATE TABLE public.coupon_redemptions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    coupon_id        UUID NOT NULL,
    order_id         UUID NOT NULL,
    customer_id      UUID,
    channel          VARCHAR(8) NOT NULL CHECK (channel IN ('ONLINE','POS')),
    applied_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
    discount_amount  NUMERIC(10,2) NOT NULL CHECK (discount_amount >= 0),
    status           VARCHAR(16) NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED','REVERSED')),
    applied_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    reversed_at      TIMESTAMPTZ,
    reversal_reason  VARCHAR(32) CHECK (reversal_reason IS NULL OR reversal_reason IN ('ORDER_CANCELLED','ORDER_REFUNDED')),
    reapplied_count  INTEGER NOT NULL DEFAULT 0 CHECK (reapplied_count >= 0),
    CONSTRAINT coupon_redemptions_order_key UNIQUE (order_id),
    CONSTRAINT coupon_redemptions_reversed_consistency CHECK ((status = 'REVERSED') = (reversed_at IS NOT NULL)),
    -- NO ACTION (histórico preservado): cupom com uso não pode ser apagado (arquive) e pedido com cupom
    -- não pode ser apagado; a exclusão do tenant inteiro continua funcionando em cascata.
    CONSTRAINT coupon_redemptions_coupon_fk FOREIGN KEY (tenant_id, coupon_id) REFERENCES public.coupons (tenant_id, id),
    CONSTRAINT coupon_redemptions_order_fk  FOREIGN KEY (tenant_id, order_id)  REFERENCES public.orders (tenant_id, id),
    CONSTRAINT coupon_redemptions_customer_fk FOREIGN KEY (tenant_id, customer_id) REFERENCES public.customers (tenant_id, id)
        ON DELETE SET NULL (customer_id)
);
CREATE INDEX idx_coupon_redemptions_coupon ON public.coupon_redemptions (coupon_id, status);
CREATE INDEX idx_coupon_redemptions_customer ON public.coupon_redemptions (coupon_id, customer_id) WHERE status = 'APPLIED';
CREATE INDEX idx_coupon_redemptions_tenant ON public.coupon_redemptions (tenant_id, applied_at DESC);

ALTER TABLE public.orders
    ADD COLUMN coupon_id UUID,
    ADD COLUMN coupon_code VARCHAR(50);
ALTER TABLE public.orders
    ADD CONSTRAINT orders_coupon_fk FOREIGN KEY (tenant_id, coupon_id) REFERENCES public.coupons (tenant_id, id)
        ON DELETE SET NULL (coupon_id);
CREATE INDEX idx_orders_coupon ON public.orders (coupon_id) WHERE coupon_id IS NOT NULL;

ALTER TABLE public.order_items
    ADD COLUMN original_unit_price NUMERIC(10,2),
    ADD COLUMN discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    ADD COLUMN item_kind VARCHAR(16) NOT NULL DEFAULT 'PRODUCT' CHECK (item_kind IN ('PRODUCT','OFFER','CARD_PRODUCT','CUSTOM'));

CREATE TRIGGER trg_coupons_updated_at
    BEFORE UPDATE ON public.coupons
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. RLS: somente OWNER/MANAGER do tenant (sem CEO/SUPER_ADMIN — F2). CASHIER usa RPC.
-- ----------------------------------------------------------------------------
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY coupons_om_select ON public.coupons FOR SELECT TO authenticated
    USING (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY coupons_om_insert ON public.coupons FOR INSERT TO authenticated
    WITH CHECK (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY coupons_om_update ON public.coupons FOR UPDATE TO authenticated
    USING (public.is_tenant_owner_or_manager(tenant_id))
    WITH CHECK (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY coupons_om_delete ON public.coupons FOR DELETE TO authenticated
    USING (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY coupon_redemptions_om_select ON public.coupon_redemptions FOR SELECT TO authenticated
    USING (public.is_tenant_owner_or_manager(tenant_id));

REVOKE ALL ON public.coupons, public.coupon_redemptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.coupons TO authenticated;
-- times_used, id, created_at/updated_at e created_by NÃO são graváveis pela API (contador só no servidor).
GRANT INSERT (tenant_id, code, description, discount_type, discount_value, max_discount_amount, min_order_value,
              usage_limit, usage_limit_per_customer, first_order_only, start_at, end_at, status)
    ON public.coupons TO authenticated;
GRANT UPDATE (code, description, discount_type, discount_value, max_discount_amount, min_order_value,
              usage_limit, usage_limit_per_customer, first_order_only, start_at, end_at, status)
    ON public.coupons TO authenticated;
GRANT SELECT ON public.coupon_redemptions TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. FUNÇÕES BÁSICAS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_coupon_code(p_code TEXT)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT NULLIF(upper(regexp_replace(COALESCE(p_code, ''), '\s+', '', 'g')), '');
$$;

-- Normaliza o código e registra o autor na criação (coluna created_by não é gravável pela API).
CREATE OR REPLACE FUNCTION public._coupons_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.code := public.normalize_coupon_code(NEW.code);
    IF TG_OP = 'INSERT' THEN
        NEW.created_by := COALESCE(NEW.created_by, auth.uid());
        IF current_setting('role', true) IN ('anon','authenticated') THEN
            NEW.times_used := 0;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_coupons_before_write
    BEFORE INSERT OR UPDATE OF code ON public.coupons
    FOR EACH ROW EXECUTE FUNCTION public._coupons_before_write();

-- Preço autoritativo (decisão 8). N2: preço de tabela ou promotional_price válido (regra 001/009).
-- Redefinida na N4 para considerar item de carrossel ativo (vence o menor preço promocional válido).
CREATE OR REPLACE FUNCTION public._effective_product_price(p_tenant UUID, p_product UUID, p_at TIMESTAMPTZ)
RETURNS TABLE(unit_price NUMERIC, original_price NUMERIC, is_promotional BOOLEAN, price_source TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT CASE WHEN p.promotional_price IS NOT NULL AND p.promotional_price > 0 AND p.promotional_price <= p.price
                THEN p.promotional_price ELSE p.price END,
           p.price,
           (p.promotional_price IS NOT NULL AND p.promotional_price > 0 AND p.promotional_price < p.price),
           CASE WHEN p.promotional_price IS NOT NULL AND p.promotional_price > 0 AND p.promotional_price < p.price
                THEN 'PRODUCT_PROMO' ELSE 'BASE' END
    FROM public.products p
    WHERE p.id = p_product AND p.tenant_id = p_tenant;
$$;

CREATE OR REPLACE FUNCTION public._coupon_compute_discount(p_coupon public.coupons, p_eligible_base NUMERIC)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v NUMERIC;
BEGIN
    IF p_eligible_base IS NULL OR p_eligible_base <= 0 THEN
        RETURN 0;
    END IF;
    IF p_coupon.discount_type = 'PERCENTAGE' THEN
        v := round(p_eligible_base * p_coupon.discount_value / 100.0, 2);
        IF p_coupon.max_discount_amount IS NOT NULL THEN
            v := LEAST(v, p_coupon.max_discount_amount);
        END IF;
    ELSE
        v := p_coupon.discount_value;
    END IF;
    RETURN round(GREATEST(LEAST(v, p_eligible_base), 0), 2);
END;
$$;

-- Normaliza e precifica os itens no servidor. Aceita SOMENTE {productId, quantity, notes}.
-- p_lock = true: trava os produtos (FOR UPDATE) em ordem de id (anti-deadlock).
CREATE OR REPLACE FUNCTION public._price_items(p_tenant UUID, p_items JSONB, p_lock BOOLEAN)
RETURNS TABLE(r_product_id UUID, r_quantity INT, r_notes TEXT, r_name TEXT, r_unit TEXT, r_stock INT,
              r_unit_price NUMERIC, r_original_price NUMERIC, r_is_promotional BOOLEAN, r_price_source TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_elem JSONB;
    v_key TEXT;
    v_agg RECORD;
    v_prod RECORD;
    v_price RECORD;
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
            IF v_key NOT IN ('productId','quantity','notes') THEN
                RAISE EXCEPTION 'UNEXPECTED_FIELD: campo "%" não é aceito nos itens (preço e desconto são calculados no servidor).', v_key;
            END IF;
        END LOOP;
        IF jsonb_typeof(v_elem -> 'productId') IS DISTINCT FROM 'string'
           OR (v_elem ->> 'productId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
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
    END LOOP;

    FOR v_agg IN
        SELECT (e ->> 'productId')::uuid AS pid,
               sum((e ->> 'quantity')::int)::int AS qty,
               string_agg(NULLIF(btrim(e ->> 'notes'), ''), ' | ') AS notes
        FROM jsonb_array_elements(p_items) e
        GROUP BY (e ->> 'productId')::uuid
        ORDER BY (e ->> 'productId')::uuid
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
        SELECT * INTO v_price FROM public._effective_product_price(p_tenant, v_agg.pid, now());
        r_product_id := v_agg.pid; r_quantity := v_agg.qty; r_notes := v_agg.notes;
        r_name := v_prod.name; r_unit := v_prod.unit; r_stock := v_prod.stock_quantity;
        r_unit_price := v_price.unit_price; r_original_price := v_price.original_price;
        r_is_promotional := v_price.is_promotional; r_price_source := v_price.price_source;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- Avalia um cupom (sem consumir). Nunca lança erro por regra de cupom: devolve {ok, reason, discount}.
CREATE OR REPLACE FUNCTION public._coupon_evaluate(p_coupon public.coupons, p_customer_id UUID, p_eligible_base NUMERIC,
                                                   p_require_identified BOOLEAN)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uses INT;
    v_discount NUMERIC;
BEGIN
    IF p_coupon.id IS NULL OR p_coupon.status <> 'ACTIVE' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'COUPON_INVALID');
    END IF;
    IF p_coupon.start_at IS NOT NULL AND now() < p_coupon.start_at THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'COUPON_NOT_STARTED');
    END IF;
    IF p_coupon.end_at IS NOT NULL AND now() >= p_coupon.end_at THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'COUPON_EXPIRED');
    END IF;
    IF p_coupon.usage_limit IS NOT NULL AND p_coupon.times_used >= p_coupon.usage_limit THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'COUPON_EXHAUSTED');
    END IF;
    IF COALESCE(p_eligible_base, 0) <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'COUPON_NOT_APPLICABLE_PROMO');
    END IF;
    IF p_eligible_base < p_coupon.min_order_value THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'COUPON_MIN_ORDER', 'min_order_value', p_coupon.min_order_value);
    END IF;
    IF (p_coupon.first_order_only OR p_coupon.usage_limit_per_customer IS NOT NULL) AND p_require_identified AND p_customer_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'COUPON_REQUIRES_IDENTIFIED_CUSTOMER');
    END IF;
    IF p_coupon.first_order_only AND p_customer_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.orders o WHERE o.tenant_id = p_coupon.tenant_id AND o.customer_id = p_customer_id
          AND o.status <> 'CANCELLED') THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'COUPON_FIRST_ORDER_ONLY');
    END IF;
    IF p_coupon.usage_limit_per_customer IS NOT NULL AND p_customer_id IS NOT NULL THEN
        SELECT count(*) INTO v_uses FROM public.coupon_redemptions r
        WHERE r.coupon_id = p_coupon.id AND r.customer_id = p_customer_id AND r.status = 'APPLIED';
        IF v_uses >= p_coupon.usage_limit_per_customer THEN
            RETURN jsonb_build_object('ok', false, 'reason', 'COUPON_CUSTOMER_LIMIT');
        END IF;
    END IF;
    v_discount := public._coupon_compute_discount(p_coupon, p_eligible_base);
    IF v_discount <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'COUPON_NOT_APPLICABLE_PROMO');
    END IF;
    RETURN jsonb_build_object('ok', true, 'reason', NULL, 'discount', v_discount, 'code', p_coupon.code,
                              'discount_type', p_coupon.discount_type, 'discount_value', p_coupon.discount_value,
                              'eligible_base', p_eligible_base);
END;
$$;

CREATE OR REPLACE FUNCTION public._coupon_message(p_reason TEXT)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_reason
        WHEN 'COUPON_INVALID' THEN 'Cupom inválido ou indisponível.'
        WHEN 'COUPON_NOT_STARTED' THEN 'Este cupom ainda não está válido.'
        WHEN 'COUPON_EXPIRED' THEN 'Este cupom expirou.'
        WHEN 'COUPON_EXHAUSTED' THEN 'Este cupom esgotou.'
        WHEN 'COUPON_NOT_APPLICABLE_PROMO' THEN 'Cupom não se aplica a itens já em promoção.'
        WHEN 'COUPON_MIN_ORDER' THEN 'O valor dos itens elegíveis não atinge o mínimo do cupom.'
        WHEN 'COUPON_FIRST_ORDER_ONLY' THEN 'Cupom válido somente na primeira compra.'
        WHEN 'COUPON_CUSTOMER_LIMIT' THEN 'Limite de uso deste cupom por cliente atingido.'
        WHEN 'COUPON_REQUIRES_IDENTIFIED_CUSTOMER' THEN 'Este cupom exige cliente identificado.'
        ELSE 'Cupom indisponível.' END;
$$;

-- Prévia para o cliente (nunca consome). Exige login.
CREATE OR REPLACE FUNCTION public.validate_coupon(p_tenant_slug TEXT, p_code TEXT, p_items JSONB)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant UUID;
    v_code TEXT := public.normalize_coupon_code(p_code);
    v_coupon public.coupons;
    v_customer UUID;
    v_base NUMERIC := 0;
    v_res JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: faça login para usar cupons.' USING ERRCODE = '42501';
    END IF;
    IF NOT public._rate_limit_hit('validate_coupon', public._sha256_hex(auth.uid()::text), NULL, 10, 60) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas; aguarde um minuto.';
    END IF;
    SELECT id INTO v_tenant FROM public.tenants WHERE slug = p_tenant_slug AND status = 'ACTIVE';
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'STORE_UNAVAILABLE: loja indisponível.';
    END IF;
    SELECT COALESCE(sum(r_unit_price * r_quantity) FILTER (WHERE NOT r_is_promotional), 0) INTO v_base
    FROM public._price_items(v_tenant, p_items, false);
    IF v_code IS NOT NULL THEN
        SELECT * INTO v_coupon FROM public.coupons WHERE tenant_id = v_tenant AND code = v_code;
    END IF;
    SELECT id INTO v_customer FROM public.customers WHERE tenant_id = v_tenant AND user_id = auth.uid();
    v_res := public._coupon_evaluate(v_coupon, v_customer, v_base, false);
    RETURN jsonb_build_object('valid', (v_res ->> 'ok')::boolean, 'reason', v_res ->> 'reason',
                              'message', CASE WHEN (v_res ->> 'ok')::boolean THEN 'Cupom aplicado.' ELSE public._coupon_message(v_res ->> 'reason') END,
                              'code', CASE WHEN (v_res ->> 'ok')::boolean THEN v_coupon.code END,
                              'discount', COALESCE((v_res ->> 'discount')::numeric, 0),
                              'eligible_base', v_base);
END;
$$;

-- Prévia no PDV: OWNER, MANAGER ou CASHIER do tenant (F4).
CREATE OR REPLACE FUNCTION public.validate_coupon_pos(p_tenant_id UUID, p_code TEXT, p_items JSONB, p_customer_id UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code TEXT := public.normalize_coupon_code(p_code);
    v_coupon public.coupons;
    v_base NUMERIC := 0;
    v_res JSONB;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_tenant_scoped_role(p_tenant_id, ARRAY['OWNER','MANAGER','CASHIER']) THEN
        RAISE EXCEPTION 'POS_FORBIDDEN: somente OWNER, MANAGER ou CASHIER da loja.' USING ERRCODE = '42501';
    END IF;
    IF NOT public._rate_limit_hit('validate_coupon_pos', public._sha256_hex(auth.uid()::text), p_tenant_id, 30, 60) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas; aguarde um minuto.';
    END IF;
    IF p_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'CUSTOMER_NOT_FOUND: cliente não encontrado nesta loja.';
    END IF;
    SELECT COALESCE(sum(r_unit_price * r_quantity) FILTER (WHERE NOT r_is_promotional), 0) INTO v_base
    FROM public._price_items(p_tenant_id, p_items, false);
    IF v_code IS NOT NULL THEN
        SELECT * INTO v_coupon FROM public.coupons WHERE tenant_id = p_tenant_id AND code = v_code;
    END IF;
    v_res := public._coupon_evaluate(v_coupon, p_customer_id, v_base, true);
    RETURN jsonb_build_object('valid', (v_res ->> 'ok')::boolean, 'reason', v_res ->> 'reason',
                              'message', CASE WHEN (v_res ->> 'ok')::boolean THEN 'Cupom aplicado.' ELSE public._coupon_message(v_res ->> 'reason') END,
                              'code', CASE WHEN (v_res ->> 'ok')::boolean THEN v_coupon.code END,
                              'discount', COALESCE((v_res ->> 'discount')::numeric, 0),
                              'eligible_base', v_base);
END;
$$;

-- Trava o cupom (FOR UPDATE) e calcula o desconto; lança erro se inválido (aborta o pedido inteiro).
CREATE OR REPLACE FUNCTION public._coupon_lock_and_quote(p_tenant UUID, p_code TEXT, p_customer_id UUID, p_eligible_base NUMERIC,
                                                         p_require_identified BOOLEAN)
RETURNS TABLE(r_coupon_id UUID, r_code TEXT, r_discount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_coupon public.coupons;
    v_res JSONB;
BEGIN
    SELECT * INTO v_coupon FROM public.coupons
    WHERE tenant_id = p_tenant AND code = public.normalize_coupon_code(p_code)
    FOR UPDATE;
    v_res := public._coupon_evaluate(v_coupon, p_customer_id, p_eligible_base, p_require_identified);
    IF NOT (v_res ->> 'ok')::boolean THEN
        RAISE EXCEPTION '%: %', v_res ->> 'reason', public._coupon_message(v_res ->> 'reason');
    END IF;
    r_coupon_id := v_coupon.id; r_code := v_coupon.code; r_discount := (v_res ->> 'discount')::numeric;
    RETURN NEXT;
END;
$$;

-- Consumo atômico: guarda de limite no próprio UPDATE; 0 linhas => erro (rollback do pedido).
CREATE OR REPLACE FUNCTION public._coupon_consume(p_tenant UUID, p_coupon_id UUID, p_order_id UUID, p_customer_id UUID,
                                                  p_discount NUMERIC, p_channel TEXT, p_applied_by UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.coupons SET times_used = times_used + 1
    WHERE id = p_coupon_id AND tenant_id = p_tenant AND status = 'ACTIVE'
      AND (usage_limit IS NULL OR times_used < usage_limit);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'COUPON_EXHAUSTED: %', public._coupon_message('COUPON_EXHAUSTED');
    END IF;
    INSERT INTO public.coupon_redemptions (tenant_id, coupon_id, order_id, customer_id, channel, applied_by, discount_amount)
    VALUES (p_tenant, p_coupon_id, p_order_id, p_customer_id, p_channel, p_applied_by, p_discount);
END;
$$;

-- Estorno idempotente: a linha de histórico é mantida (APPLIED -> REVERSED) e o contador volta.
CREATE OR REPLACE FUNCTION public._coupon_reverse_for_order(p_order_id UUID, p_reason TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_coupon UUID;
BEGIN
    UPDATE public.coupon_redemptions
    SET status = 'REVERSED', reversed_at = now(), reversal_reason = p_reason
    WHERE order_id = p_order_id AND status = 'APPLIED'
    RETURNING coupon_id INTO v_coupon;
    IF v_coupon IS NULL THEN
        RETURN; -- nada aplicado ou já estornado
    END IF;
    UPDATE public.coupons SET times_used = times_used - 1 WHERE id = v_coupon AND times_used > 0;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. GRAVAÇÃO DE ITENS + ESTOQUE (compartilhada por checkout, PDV e promocional)
--    p_lines: [{product_id, quantity, notes, name, unit, unit_price, original_price,
--               is_promotional, item_kind}] já precificadas e com estoque travado.
--    O desconto do cupom é rateado só entre linhas NÃO promocionais.
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
    FOR v_line IN SELECT l FROM jsonb_array_elements(p_lines) l ORDER BY l ->> 'product_id' LOOP
        v_pid := (v_line ->> 'product_id')::uuid;
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
                                        original_unit_price, discount_amount, item_kind)
        VALUES (p_order_id, v_pid, v_line ->> 'name', v_qty, (v_line ->> 'unit_price')::numeric, v_total,
                v_line ->> 'notes', COALESCE(v_line ->> 'unit', 'un'), (v_line ->> 'original_price')::numeric, v_share,
                COALESCE(v_line ->> 'item_kind', 'PRODUCT'));

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

        v_out := v_out || jsonb_build_object('product_id', v_pid, 'quantity', v_qty,
            'unit_price', (v_line ->> 'unit_price')::numeric, 'original_unit_price', (v_line ->> 'original_price')::numeric,
            'is_promotional', (v_line ->> 'is_promotional')::boolean, 'discount_amount', v_share);
    END LOOP;
    RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public._checkout_order_summary(p_order_id UUID, p_replayed BOOLEAN)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object(
        'order_id', o.id, 'order_number', o.order_number, 'subtotal', o.subtotal, 'discount', o.discount,
        'delivery_fee', o.delivery_fee, 'total_amount', o.total_amount, 'status', o.status,
        'payment_status', o.payment_status,
        'coupon', CASE WHEN o.coupon_code IS NULL THEN NULL ELSE jsonb_build_object('code', o.coupon_code, 'discount', o.discount) END,
        'prep_time_minutes', o.prep_time_minutes,
        'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id', oi.product_id, 'quantity', oi.quantity,
                     'unit_price', oi.unit_price, 'original_unit_price', oi.original_unit_price,
                     'is_promotional', (oi.original_unit_price IS NOT NULL AND oi.unit_price < oi.original_unit_price),
                     'discount_amount', oi.discount_amount) ORDER BY oi.product_id)
                   FROM public.order_items oi WHERE oi.order_id = o.id), '[]'::jsonb),
        'payment', jsonb_build_object('method', o.payment_method,
                     'pix_available', (o.payment_method = 'PIX' AND EXISTS (SELECT 1 FROM public.tenant_payment_settings ps
                                       WHERE ps.tenant_id = o.tenant_id AND ps.pix_enabled))),
        'replayed', p_replayed)
    FROM public.orders o WHERE o.id = p_order_id;
$$;

-- ----------------------------------------------------------------------------
-- 5. NÚCLEO DO CHECKOUT DE CARRINHO (Apêndice A.1)
-- ----------------------------------------------------------------------------
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

    -- @@N5_ATTR_RESOLVE@@

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
                               /*@@N5_ORDER_COLS@@*/)
    VALUES (v_tenant.id, v_customer_id, btrim(p_customer_name), v_phone, v_email, v_address, p_address_details,
            v_subtotal, v_delivery_fee, v_discount, v_total, p_payment_method,
            CASE WHEN p_payment_method = 'PIX' THEN 'PENDING' ELSE 'PAYMENT_ON_DELIVERY' END,
            p_fulfillment_type, 'PENDING', NULLIF(btrim(COALESCE(p_notes, '')), ''), COALESCE(p_origin, 'direct'),
            v_tenant.default_prep_time_minutes, p_idempotency_key, v_coupon_id, v_coupon_code
            /*@@N5_ORDER_VALS@@*/)
    RETURNING id INTO v_order_id;

    v_items_out := public._insert_order_lines(v_order_id, v_tenant.id, v_lines, v_discount, v_base, 'Sistema (checkout)');

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

-- Substitui a 009: MESMA assinatura e retorno; wrapper do núcleo; nunca aplica cupom.
CREATE OR REPLACE FUNCTION public.process_checkout_atomic(
    p_tenant_slug TEXT, p_customer_name VARCHAR, p_customer_phone VARCHAR, p_customer_email VARCHAR,
    p_delivery_address TEXT, p_address_details JSONB, p_payment_method VARCHAR, p_fulfillment_type VARCHAR,
    p_notes TEXT, p_origin VARCHAR, p_items JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN (public._checkout_core(p_tenant_slug, p_customer_name, p_customer_phone, p_delivery_address, p_address_details,
                                  p_payment_method, p_fulfillment_type, p_notes, p_origin, p_items,
                                  NULL, NULL, NULL, p_customer_email) ->> 'order_id')::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_checkout_atomic_v2(
    p_tenant_slug TEXT, p_customer_name TEXT, p_customer_phone TEXT, p_delivery_address TEXT, p_address_details JSONB,
    p_payment_method TEXT, p_fulfillment_type TEXT, p_notes TEXT, p_items JSONB,
    p_coupon_code TEXT DEFAULT NULL, p_idempotency_key UUID DEFAULT NULL, p_card_id UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public._checkout_core(p_tenant_slug, p_customer_name, p_customer_phone, p_delivery_address, p_address_details,
                                 p_payment_method, p_fulfillment_type, p_notes, 'storefront', p_items,
                                 p_coupon_code, p_idempotency_key, p_card_id, NULL);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. PDV NO SERVIDOR (Apêndice A.3; F4: somente OWNER, MANAGER, CASHIER)
--    Substitui o INSERT direto do front (preço do cliente, order_number por count, prep ?? 30).
--    PIX no balcão: payment_status PENDING até o caixa confirmar (update_order_payment_status),
--    para que get_order_pix_payload gere o QR; demais formas: PAID (comportamento atual do PDV).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_pos_sale_atomic(
    p_tenant_id UUID, p_items JSONB, p_payment_method TEXT, p_customer_name TEXT DEFAULT NULL,
    p_customer_phone TEXT DEFAULT NULL, p_customer_id UUID DEFAULT NULL, p_coupon_code TEXT DEFAULT NULL,
    p_idempotency_key UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_role TEXT;
    v_actor TEXT;
    v_existing UUID;
    v_cust_id UUID;
    v_cust_name TEXT;
    v_cust_phone TEXT;
    v_name TEXT;
    v_phone TEXT;
    v_lines JSONB := '[]'::jsonb;
    v_line RECORD;
    v_subtotal NUMERIC := 0;
    v_base NUMERIC := 0;
    v_discount NUMERIC := 0;
    v_coupon RECORD;
    v_coupon_id UUID;
    v_coupon_code TEXT;
    v_total NUMERIC;
    v_order_id UUID;
    v_result JSONB;
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE = '42501';
    END IF;
    v_role := public._tenant_role_of_caller(p_tenant_id);
    IF v_role IS NULL OR v_role NOT IN ('OWNER','MANAGER','CASHIER') THEN
        RAISE EXCEPTION 'POS_FORBIDDEN: somente OWNER, MANAGER ou CASHIER da loja podem registrar vendas no PDV.' USING ERRCODE = '42501';
    END IF;
    IF p_payment_method IS NULL OR p_payment_method NOT IN ('PIX','CREDIT_CARD','DEBIT_CARD','CASH') THEN
        RAISE EXCEPTION 'INVALID_PAYMENT_METHOD: forma de pagamento "%" inválida.', p_payment_method;
    END IF;
    IF NOT public._rate_limit_hit('pos_sale', public._sha256_hex(v_user::text), p_tenant_id, 60, 60) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas vendas em sequência; aguarde.';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_idempotency_key::text, 0));
        SELECT id INTO v_existing FROM public.orders WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
        IF v_existing IS NOT NULL THEN
            RETURN public._checkout_order_summary(v_existing, true);
        END IF;
    END IF;

    IF p_customer_id IS NOT NULL THEN
        SELECT id, name, phone INTO v_cust_id, v_cust_name, v_cust_phone
        FROM public.customers WHERE id = p_customer_id AND tenant_id = p_tenant_id;
        IF v_cust_id IS NULL THEN
            RAISE EXCEPTION 'CUSTOMER_NOT_FOUND: cliente não encontrado nesta loja.';
        END IF;
    END IF;
    v_name := left(COALESCE(NULLIF(btrim(p_customer_name), ''), v_cust_name, 'Cliente Balcão'), 120);
    v_phone := left(COALESCE(NULLIF(regexp_replace(COALESCE(p_customer_phone, ''), '[^0-9]', '', 'g'), ''), v_cust_phone, ''), 32);

    FOR v_line IN SELECT * FROM public._price_items(p_tenant_id, p_items, true) LOOP
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

    IF public.normalize_coupon_code(p_coupon_code) IS NOT NULL THEN
        SELECT * INTO v_coupon FROM public._coupon_lock_and_quote(p_tenant_id, p_coupon_code, p_customer_id, v_base, true);
        v_discount := v_coupon.r_discount;
        v_coupon_id := v_coupon.r_coupon_id;
        v_coupon_code := v_coupon.r_code;
    END IF;
    v_total := v_subtotal - v_discount;

    SELECT COALESCE(NULLIF(u.name, ''), u.email, 'Equipe') INTO v_actor FROM public.users u WHERE u.id = v_user;
    v_actor := COALESCE(v_actor, 'Equipe') || ' (' || v_role || ')';

    INSERT INTO public.orders (tenant_id, customer_id, customer_name, customer_phone, customer_email, delivery_address,
                               address_details, subtotal, delivery_fee, discount, total_amount, payment_method, payment_status,
                               fulfillment_type, status, notes, origin, prep_time_minutes, idempotency_key, coupon_id, coupon_code)
    VALUES (p_tenant_id, p_customer_id, v_name, v_phone, NULL, 'Venda no Balcão (PDV)', NULL,
            v_subtotal, 0, v_discount, v_total, p_payment_method,
            CASE WHEN p_payment_method = 'PIX' THEN 'PENDING' ELSE 'PAID' END,
            'PICKUP', 'DELIVERED', NULL, 'pos', NULL, p_idempotency_key, v_coupon_id, v_coupon_code)
    RETURNING id INTO v_order_id;

    PERFORM public._insert_order_lines(v_order_id, p_tenant_id, v_lines, v_discount, v_base, v_actor);

    IF v_coupon_id IS NOT NULL THEN
        PERFORM public._coupon_consume(p_tenant_id, v_coupon_id, v_order_id, p_customer_id, v_discount, 'POS', v_user);
    END IF;

    IF p_customer_id IS NOT NULL THEN
        PERFORM set_config('app.internal_customer_update', 'true', true);
        UPDATE public.customers
        SET total_orders = total_orders + 1, ltv_amount = ltv_amount + v_total,
            first_order_date = COALESCE(first_order_date, CURRENT_DATE), last_order_date = CURRENT_DATE, updated_at = now()
        WHERE id = p_customer_id AND tenant_id = p_tenant_id;
        PERFORM set_config('app.internal_customer_update', 'false', true);
    END IF;

    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (v_order_id, 'DELIVERED', 'Venda registrada no PDV', v_actor);

    v_result := public._checkout_order_summary(v_order_id, false);
    RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. AUDITORIA DE CONTADORES (somente leitura, OWNER/MANAGER)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_coupon_counters(p_tenant_id UUID)
RETURNS TABLE(coupon_id UUID, code TEXT, times_used INT, applied_count BIGINT, drift INT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
        RAISE EXCEPTION 'FORBIDDEN: somente OWNER/MANAGER.' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT c.id, c.code::text, c.times_used,
           (SELECT count(*) FROM public.coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'APPLIED'),
           c.times_used - (SELECT count(*) FROM public.coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'APPLIED')::int
    FROM public.coupons c WHERE c.tenant_id = p_tenant_id
    ORDER BY c.code;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. CICLO DE VIDA: estorno de cupom quando o pedido deixa de ser válido (Apêndice A.4)
--    Válido = status <> CANCELLED e payment_status <> REFUNDED. Inválido -> válido é recusado (F5).
--    Redefinida na N5 para ajustar também os contadores promocionais.
-- ----------------------------------------------------------------------------
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
    ELSIF NOT v_old_valid AND v_new_valid THEN
        RAISE EXCEPTION 'ORDER_REOPEN_FORBIDDEN: pedido cancelado/estornado não pode voltar a ser válido.' USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_orders_promo_lifecycle
    AFTER UPDATE OF status, payment_status ON public.orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.payment_status IS DISTINCT FROM NEW.payment_status)
    EXECUTE FUNCTION public._orders_promo_lifecycle();

-- ----------------------------------------------------------------------------
-- 9. PRIVILÉGIOS DE FUNÇÕES
-- ----------------------------------------------------------------------------
DO $grants$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.normalize_coupon_code(text)',
        'public._coupons_before_write()',
        'public._effective_product_price(uuid,uuid,timestamp with time zone)',
        'public._coupon_compute_discount(public.coupons,numeric)',
        'public._price_items(uuid,jsonb,boolean)',
        'public._coupon_evaluate(public.coupons,uuid,numeric,boolean)',
        'public._coupon_message(text)',
        'public.validate_coupon(text,text,jsonb)',
        'public.validate_coupon_pos(uuid,text,jsonb,uuid)',
        'public._coupon_lock_and_quote(uuid,text,uuid,numeric,boolean)',
        'public._coupon_consume(uuid,uuid,uuid,uuid,numeric,text,uuid)',
        'public._coupon_reverse_for_order(uuid,text)',
        'public._insert_order_lines(uuid,uuid,jsonb,numeric,numeric,text)',
        'public._checkout_order_summary(uuid,boolean)',
        'public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)',
        'public.process_checkout_atomic(text,character varying,character varying,character varying,text,jsonb,character varying,character varying,text,character varying,jsonb)',
        'public.process_checkout_atomic_v2(text,text,text,text,jsonb,text,text,text,jsonb,text,uuid,uuid)',
        'public.process_pos_sale_atomic(uuid,jsonb,text,text,text,uuid,text,uuid)',
        'public.audit_coupon_counters(uuid)',
        'public._orders_promo_lifecycle()'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    END LOOP;
END
$grants$;

GRANT EXECUTE ON FUNCTION public.normalize_coupon_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon_pos(uuid,text,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_checkout_atomic(text,character varying,character varying,character varying,text,jsonb,character varying,character varying,text,character varying,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_checkout_atomic_v2(text,text,text,text,jsonb,text,text,text,jsonb,text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_pos_sale_atomic(uuid,jsonb,text,text,text,uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_coupon_counters(uuid) TO authenticated;
-- Fim da N2.
