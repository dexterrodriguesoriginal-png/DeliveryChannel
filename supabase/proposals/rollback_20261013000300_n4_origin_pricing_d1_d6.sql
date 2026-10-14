-- ROLLBACK da proposta 20261013000300_n4_origin_pricing_d1_d6.sql
-- Restaura _checkout_core exatamente como na proposta 20261013000100 (marcador [FULFILLMENT], _price_items da N2)
-- e remove os objetos criados: coupons.stack_with_pickup_discount e a tabela order_line_origins.
-- ATENÇÃO: isso descarta o rastreio de origem de pedidos já feitos e a regra de acumulação dos cupons; se houver
-- pedidos/cupons reais, prefira manter (comente o bloco 3).
-- Se a proposta 0200 estava aplicada antes, reaplique-a depois deste rollback (somente em banco SEM N4).

-- 1. _checkout_core da 0100
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


-- 2. Funções
DROP FUNCTION IF EXISTS public.get_public_campaign_carousels(text);
DROP FUNCTION IF EXISTS public._price_items_by_origin(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public._campaign_item_price(uuid, uuid, uuid, timestamptz);

-- 3. Colunas
DROP TABLE IF EXISTS public.order_line_origins;
ALTER TABLE public.coupons DROP COLUMN IF EXISTS stack_with_pickup_discount;

DO $post$
BEGIN
    IF position('[N4ORIGIN]' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)'))) > 0 THEN
        RAISE EXCEPTION 'ROLLBACK N4ORIGIN: _checkout_core ainda tem o marcador.';
    END IF;
END
$post$;
