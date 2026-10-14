-- ============================================================================
-- PROPOSTA (NÃO É MIGRATION ATIVA) — 20261013000100_fulfillment_mode_and_pickup_discount.sql
-- DeliveryChannel — Modalidades de atendimento (Delivery / Retirada) e desconto para retirada.
--
-- Local: supabase/proposals/ (fora de supabase/migrations de propósito: não entra em `db push`).
-- Pré-requisito (estado real relatado): 001–020 + N1 v3 + N2 v3 reconciliadas.
-- NÃO depende de 021–026 nem de N3–N6. Se a N5 já tiver redefinido _checkout_core, ABORTA
-- (seria preciso refazer esta proposta sobre o corpo da N5).
-- Aditiva e idempotente: só ADD COLUMN IF NOT EXISTS, constraints nomeadas com guarda,
-- CREATE OR REPLACE de _checkout_core com a MESMA assinatura (wrappers process_checkout_atomic
-- e process_checkout_atomic_v2 da N2 passam a aplicar as regras sem mudar de assinatura).
-- Nada é apagado; nenhum dado existente é alterado (padrões = comportamento atual:
-- delivery e retirada habilitados, desconto desligado, 0%).
-- Espelho do front: src/lib/pricing/fulfillmentPricing.ts
-- ============================================================================

-- 0. PRECHECK ESTRUTURAL (sem depender de schema_migrations)
DO $pre$
DECLARE v_src TEXT;
BEGIN
    IF to_regclass('public.coupons') IS NULL OR to_regclass('public.tenant_payment_settings') IS NULL
       OR to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)') IS NULL
       OR to_regprocedure('public._price_items(uuid,jsonb,boolean)') IS NULL
       OR to_regprocedure('public._insert_order_lines(uuid,uuid,jsonb,numeric,numeric,text)') IS NULL
       OR to_regprocedure('public._coupon_lock_and_quote(uuid,text,uuid,numeric,boolean)') IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='idempotency_key')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='coupon_code')
    THEN
        RAISE EXCEPTION 'FULFILLMENT PRE: objetos da N1/N2 ausentes (coupons, tenant_payment_settings, _checkout_core, _price_items, _insert_order_lines, _coupon_lock_and_quote, orders.idempotency_key/coupon_code). Abortado.';
    END IF;
    SELECT p.prosrc INTO v_src FROM pg_proc p
    WHERE p.oid = to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)');
    IF position('@@N5_ATTR_RESOLVE@@' IN v_src) = 0 THEN
        RAISE EXCEPTION 'FULFILLMENT PRE: _checkout_core não é a versão N2 (provavelmente redefinida pela N5). Esta proposta precisa ser refeita sobre o corpo atual. Abortado.';
    END IF;
END
$pre$;

-- 1. tenant_settings: configuração por estabelecimento
ALTER TABLE public.tenant_settings
    ADD COLUMN IF NOT EXISTS delivery_enabled BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS pickup_enabled BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS pickup_discount_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS pickup_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pickup_discount_exclude_promotional BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS pickup_discount_excluded_product_ids UUID[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS pickup_discount_excluded_offer_ids UUID[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS pickup_instructions TEXT;

DO $c$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_settings_pickup_discount_percent_range') THEN
        ALTER TABLE public.tenant_settings ADD CONSTRAINT tenant_settings_pickup_discount_percent_range
            CHECK (pickup_discount_percent >= 0 AND pickup_discount_percent <= 50);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_settings_pickup_discount_enabled_needs_pct') THEN
        ALTER TABLE public.tenant_settings ADD CONSTRAINT tenant_settings_pickup_discount_enabled_needs_pct
            CHECK (NOT pickup_discount_enabled OR pickup_discount_percent > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_settings_pickup_exclusions_size') THEN
        ALTER TABLE public.tenant_settings ADD CONSTRAINT tenant_settings_pickup_exclusions_size
            CHECK (cardinality(pickup_discount_excluded_product_ids) <= 2000
                   AND cardinality(pickup_discount_excluded_offer_ids) <= 2000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_settings_pickup_instructions_len') THEN
        ALTER TABLE public.tenant_settings ADD CONSTRAINT tenant_settings_pickup_instructions_len
            CHECK (pickup_instructions IS NULL OR length(pickup_instructions) <= 500);
    END IF;
END
$c$;

COMMENT ON COLUMN public.tenant_settings.pickup_discount_percent IS
    'Desconto para retirada (0–50%). Aplicado no servidor (_checkout_core) somente em PICKUP e se pickup_discount_enabled.';

-- 2. orders: parcela do desconto referente à retirada (orders.discount continua = total de descontos)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pickup_discount NUMERIC(10,2) NOT NULL DEFAULT 0;
DO $c$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_pickup_discount_valid') THEN
        ALTER TABLE public.orders ADD CONSTRAINT orders_pickup_discount_valid
            CHECK (pickup_discount >= 0 AND pickup_discount <= discount AND (fulfillment_type = 'PICKUP' OR pickup_discount = 0));
    END IF;
END
$c$;

-- 3. Privilégios por coluna (N1 usa GRANT por coluna em tenant_settings). Políticas RLS existentes
--    (OWNER/MANAGER gerenciam; staff lê) continuam valendo: isolamento por tenant inalterado.
--    Leitura pública: via get_public_store (SECURITY DEFINER, to_jsonb(tenant_settings)) — sem grant a anon.
GRANT SELECT (delivery_enabled, pickup_enabled, pickup_discount_enabled, pickup_discount_percent,
              pickup_discount_exclude_promotional, pickup_discount_excluded_product_ids,
              pickup_discount_excluded_offer_ids, pickup_instructions)
    ON public.tenant_settings TO authenticated;
GRANT UPDATE (delivery_enabled, pickup_enabled, pickup_discount_enabled, pickup_discount_percent,
              pickup_discount_exclude_promotional, pickup_discount_excluded_product_ids,
              pickup_discount_excluded_offer_ids, pickup_instructions)
    ON public.tenant_settings TO authenticated;
-- orders.pickup_discount: somente leitura via API (escrita apenas pelas funções SECURITY DEFINER).
DO $g$
BEGIN
    -- Se a tabela orders usa privilégio por coluna para SELECT, inclui a nova coluna; se usa privilégio
    -- de tabela, o GRANT abaixo é redundante e inofensivo.
    EXECUTE 'GRANT SELECT (pickup_discount) ON public.orders TO authenticated';
END
$g$;

-- 4. _checkout_core (N2) + modalidade + desconto de retirada. MESMA assinatura e retorno.
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
           COALESCE(s.pickup_discount_excluded_product_ids, '{}'::uuid[]) AS pickup_discount_excluded_product_ids
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
    FOR v_line IN SELECT * FROM public._price_items(v_tenant.id, p_items, true) LOOP
        IF v_line.r_stock < v_line.r_quantity THEN
            RAISE EXCEPTION 'OUT_OF_STOCK: estoque insuficiente para o produto "%". Disponível: %, solicitado: %',
                v_line.r_name, v_line.r_stock, v_line.r_quantity;
        END IF;
        v_subtotal := v_subtotal + round(v_line.r_unit_price * v_line.r_quantity, 2);
        IF NOT v_line.r_is_promotional THEN
            v_base := v_base + round(v_line.r_unit_price * v_line.r_quantity, 2);
        END IF;
        -- [FULFILLMENT] base elegível ao desconto de retirada (exceções por produto / itens em promoção)
        IF v_pickup_pct > 0
           AND NOT (v_line.r_product_id = ANY (v_tenant.pickup_discount_excluded_product_ids))
           AND NOT (v_tenant.pickup_discount_exclude_promotional AND v_line.r_is_promotional) THEN
            v_line_total := round(v_line.r_unit_price * v_line.r_quantity, 2);
            IF v_line.r_is_promotional THEN
                v_elig_promo := v_elig_promo + v_line_total;
            ELSE
                v_elig_nonpromo := v_elig_nonpromo + v_line_total;
            END IF;
        END IF;
        v_lines := v_lines || jsonb_build_object('product_id', v_line.r_product_id, 'quantity', v_line.r_quantity,
            'notes', v_line.r_notes, 'name', v_line.r_name, 'unit', v_line.r_unit, 'unit_price', v_line.r_unit_price,
            'original_price', v_line.r_original_price, 'is_promotional', v_line.r_is_promotional, 'item_kind', 'PRODUCT');
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
        -- [FULFILLMENT] cupom depois da retirada: base = itens não promocionais líquidos do desconto de retirada
        SELECT * INTO v_coupon FROM public._coupon_lock_and_quote(v_tenant.id, p_coupon_code, v_customer_id,
                                                                  GREATEST(v_base - v_pickup_nonpromo, 0), false);
        v_discount := v_coupon.r_discount;
        v_coupon_id := v_coupon.r_coupon_id;
        v_coupon_code := v_coupon.r_code;
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

REVOKE ALL ON FUNCTION public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)
    FROM PUBLIC, anon, authenticated;

-- 5. Pós-verificação
DO $post$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenant_settings' AND column_name='pickup_discount_percent')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='pickup_discount')
       OR position('[FULFILLMENT]' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)'))) = 0
    THEN
        RAISE EXCEPTION 'FULFILLMENT POST: verificação falhou.';
    END IF;
END
$post$;
-- Fim da proposta.
