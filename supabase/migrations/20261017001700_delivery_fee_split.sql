-- 20261017001700_delivery_fee_split.sql
-- Taxa de entrega fixa R$ 7,00: cliente R$ 3,50 + loja R$ 3,50; entregador recebe R$ 7,00.
-- tenant_settings.delivery_fee passa a significar só "cobra entrega" (>0) ou "entrega grátis" (0).
-- Frete grátis (taxa 0 ou limite atingido): cliente 0, loja assume 7,00. Retirada: tudo 0.
-- Pedidos antigos ficam com NULL nas colunas novas (nada é reescrito).
-- Rollback: supabase/rollback/20261017001700_delivery_fee_split_down.sql
BEGIN;

-- Política da plataforma (não editável pela loja): total 7,00 = cliente 3,50 + loja 3,50; entregador recebe 7,00.
CREATE OR REPLACE FUNCTION public._delivery_fee_policy() RETURNS jsonb
    LANGUAGE sql IMMUTABLE SET search_path TO ''
    AS $$ SELECT jsonb_build_object('total', 7.00, 'customer', 3.50, 'store', 3.50, 'driver_payout', 7.00) $$;

-- Parte do cliente: 0 se a loja oferece entrega grátis (taxa configurada 0); senão a parte fixa da política.
CREATE OR REPLACE FUNCTION public._delivery_fee_customer_part(p_tenant_fee numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE SET search_path TO ''
    AS $$ SELECT CASE WHEN COALESCE(p_tenant_fee, 0) <= 0 THEN 0::numeric
                      ELSE (public._delivery_fee_policy() ->> 'customer')::numeric END $$;

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS store_delivery_share numeric(10,2),
    ADD COLUMN IF NOT EXISTS driver_payout numeric(10,2);
DO $c$ BEGIN
    ALTER TABLE public.orders ADD CONSTRAINT orders_fee_split_nonneg
        CHECK (COALESCE(store_delivery_share, 0) >= 0 AND COALESCE(driver_payout, 0) >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $c$;
COMMENT ON COLUMN public.orders.store_delivery_share IS '1700: parte da taxa de entrega paga pela loja (NULL = pedido anterior à divisão).';
COMMENT ON COLUMN public.orders.driver_payout IS '1700: valor que o entregador recebe pela entrega (NULL = pedido anterior; usar delivery_fee).';

-- Preenche a divisão em todo INSERT (todos os caminhos de checkout). Imutável depois (_orders_protect_columns).
CREATE OR REPLACE FUNCTION public._orders_fee_split() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO ''
    AS $$
DECLARE v_pol jsonb := public._delivery_fee_policy();
BEGIN
    IF NEW.fulfillment_type = 'DELIVERY' THEN
        NEW.driver_payout := (v_pol ->> 'driver_payout')::numeric;
        NEW.store_delivery_share := GREATEST(0, (v_pol ->> 'total')::numeric - COALESCE(NEW.delivery_fee, 0));
    ELSE
        NEW.driver_payout := 0;
        NEW.store_delivery_share := 0;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._orders_fee_split(), public._delivery_fee_policy(), public._delivery_fee_customer_part(numeric) FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_orders_a_fee_split ON public.orders;
CREATE TRIGGER trg_orders_a_fee_split BEFORE INSERT ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public._orders_fee_split();

CREATE OR REPLACE FUNCTION public._checkout_core(p_tenant_slug text, p_customer_name text, p_customer_phone text, p_delivery_address text, p_address_details jsonb, p_payment_method text, p_fulfillment_type text, p_notes text, p_origin text, p_items jsonb, p_coupon_code text, p_idempotency_key uuid, p_card_id uuid, p_customer_email_fallback text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
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
        -- 1700: taxa fixa da plataforma; cliente paga a parte dele (3,50). Frete grátis da loja = cliente 0.
        v_delivery_fee := public._delivery_fee_customer_part(v_tenant.delivery_fee);
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
$_$;

CREATE OR REPLACE FUNCTION public.process_promotional_checkout_atomic(p_store_slug text, p_campaign_id uuid, p_card_id uuid, p_offer_id uuid, p_quantity integer, p_customer_name text, p_customer_phone text, p_delivery_address text, p_address_details jsonb, p_payment_method text, p_fulfillment_type text, p_notes text, p_coupon_code text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
    v_user_id UUID := auth.uid();
    v_email TEXT;
    v_phone TEXT;
    v_address TEXT;
    v_tenant RECORD;
    v_existing UUID;
    v_terms RECORD;
    v_subtotal NUMERIC;
    v_base NUMERIC := 0;
    v_delivery_fee NUMERIC := 0;
    v_discount NUMERIC := 0;
    v_total NUMERIC;
    v_coupon RECORD;
    v_coupon_id UUID;
    v_coupon_code TEXT;
    v_customer_id UUID;
    v_used INT;
    v_order_id UUID;
    v_result JSONB;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: é necessário estar conectado para finalizar o pedido.' USING ERRCODE = '42501';
    END IF;
    IF NOT public._rate_limit_hit('promo_checkout', public._sha256_hex(v_user_id::text), NULL, 10, 60) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas de pedido; aguarde um minuto.';
    END IF;
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
    SELECT NULLIF(btrim(email), '') INTO v_email FROM auth.users WHERE id = v_user_id;

    SELECT t.id, s.is_open, COALESCE(s.min_order_value, 0) AS min_order_value, COALESCE(s.delivery_fee, 0) AS delivery_fee,
           s.free_delivery_threshold, s.default_prep_time_minutes
    INTO v_tenant
    FROM public.tenants t LEFT JOIN public.tenant_settings s ON s.tenant_id = t.id
    WHERE t.slug = p_store_slug AND t.status = 'ACTIVE';
    IF v_tenant.id IS NULL THEN
        RAISE EXCEPTION 'STORE_UNAVAILABLE: estabelecimento não encontrado ou indisponível para pedidos.';
    END IF;
    IF v_tenant.is_open IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'STORE_CLOSED: a loja está fechada no momento.';
    END IF;

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
    -- Serializa compras promocionais do mesmo cliente nesta loja (limite por cliente)
    PERFORM pg_advisory_xact_lock(hashtextextended('promo:' || v_tenant.id::text || ':' || v_user_id::text, 0));

    -- Cadeia + locks (cards -> offers -> products)
    SELECT * INTO v_terms FROM public._resolve_promotional_terms(v_tenant.id, p_campaign_id, p_card_id, p_offer_id, p_quantity, true);
    IF v_terms.r_fulfillment <> 'BOTH' AND v_terms.r_fulfillment <> p_fulfillment_type THEN
        RAISE EXCEPTION 'PROMO_FULFILLMENT: esta promoção só vale para %.', v_terms.r_fulfillment;
    END IF;
    IF v_terms.r_max_qty IS NOT NULL AND p_quantity > v_terms.r_max_qty THEN
        RAISE EXCEPTION 'PROMO_QTY_EXCEEDED: máximo de % unidade(s) por pedido.', v_terms.r_max_qty;
    END IF;
    IF v_terms.r_stock IS NOT NULL AND v_terms.r_stock < p_quantity THEN
        RAISE EXCEPTION 'OUT_OF_STOCK: estoque insuficiente para o produto "%". Disponível: %, solicitado: %',
            v_terms.r_name, v_terms.r_stock, p_quantity;
    END IF;

    v_subtotal := round(v_terms.r_unit_price * p_quantity, 2);
    IF NOT v_terms.r_is_promotional THEN
        v_base := v_subtotal;
    END IF;
    IF v_tenant.min_order_value > 0 AND v_subtotal < v_tenant.min_order_value THEN
        RAISE EXCEPTION 'MIN_ORDER_NOT_MET: valor mínimo do pedido é R$ % (subtotal R$ %).', v_tenant.min_order_value, v_subtotal;
    END IF;
    IF p_fulfillment_type = 'DELIVERY' THEN
        -- 1700: taxa fixa da plataforma; cliente paga a parte dele (3,50). Frete grátis da loja = cliente 0.
        v_delivery_fee := public._delivery_fee_customer_part(v_tenant.delivery_fee);
        IF v_tenant.free_delivery_threshold IS NOT NULL AND v_subtotal >= v_tenant.free_delivery_threshold THEN
            v_delivery_fee := 0;
        END IF;
    END IF;

    -- Cupom (depois dos produtos na ordem de locks). Com preço promocional: recusado (decisão 8).
    IF public.normalize_coupon_code(p_coupon_code) IS NOT NULL THEN
        IF v_terms.r_is_promotional THEN
            RAISE EXCEPTION 'COUPON_NOT_APPLICABLE_PROMO: %', public._coupon_message('COUPON_NOT_APPLICABLE_PROMO');
        END IF;
    END IF;

    -- Cliente (lock por último)
    SELECT id INTO v_customer_id FROM public.customers WHERE tenant_id = v_tenant.id AND user_id = v_user_id FOR UPDATE;

    IF public.normalize_coupon_code(p_coupon_code) IS NOT NULL THEN
        SELECT * INTO v_coupon FROM public._coupon_lock_and_quote(v_tenant.id, p_coupon_code, v_customer_id, v_base, false);
        v_discount := v_coupon.r_discount;
        v_coupon_id := v_coupon.r_coupon_id;
        v_coupon_code := v_coupon.r_code;
    END IF;

    -- Limite por cliente: soma das quantidades em pedidos VÁLIDOS anteriores + esta compra
    IF v_terms.r_limit_per_customer IS NOT NULL THEN
        SELECT COALESCE(sum(oi.quantity), 0) INTO v_used
        FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
        WHERE o.tenant_id = v_tenant.id AND o.customer_id = v_customer_id AND v_customer_id IS NOT NULL
          AND o.status <> 'CANCELLED' AND o.payment_status <> 'REFUNDED'
          AND ((v_terms.r_limit_scope = 'OFFER' AND oi.offer_id = v_terms.r_offer_id AND oi.item_kind = 'OFFER')
            OR (v_terms.r_limit_scope = 'CARD' AND oi.card_id = v_terms.r_card_id AND oi.item_kind IN ('CUSTOM','CARD_PRODUCT')));
        IF v_used + p_quantity > v_terms.r_limit_per_customer THEN
            RAISE EXCEPTION 'PROMO_CUSTOMER_LIMIT: limite por cliente desta promoção atingido.';
        END IF;
    END IF;

    v_total := v_subtotal - v_discount + v_delivery_fee;

    PERFORM set_config('app.internal_customer_update', 'true', true);
    IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (tenant_id, user_id, name, phone, email, origin, total_orders, ltv_amount,
                                      first_order_date, last_order_date)
        VALUES (v_tenant.id, v_user_id, btrim(p_customer_name), v_phone, v_email, 'direct', 1, v_total, CURRENT_DATE, CURRENT_DATE)
        RETURNING id INTO v_customer_id;
    ELSE
        UPDATE public.customers
        SET total_orders = total_orders + 1, ltv_amount = ltv_amount + v_total, last_order_date = CURRENT_DATE,
            name = COALESCE(NULLIF(btrim(p_customer_name), ''), name), phone = v_phone, email = COALESCE(v_email, email),
            updated_at = now()
        WHERE id = v_customer_id AND user_id = v_user_id;
    END IF;
    PERFORM set_config('app.internal_customer_update', 'false', true);

    INSERT INTO public.orders (tenant_id, customer_id, customer_name, customer_phone, customer_email, delivery_address,
                               address_details, subtotal, delivery_fee, discount, total_amount, payment_method, payment_status,
                               fulfillment_type, status, notes, origin, prep_time_minutes, idempotency_key, coupon_id, coupon_code,
                               campaign_id, card_id, offer_id, attribution_source)
    VALUES (v_tenant.id, v_customer_id, btrim(p_customer_name), v_phone, v_email, v_address, p_address_details,
            v_subtotal, v_delivery_fee, v_discount, v_total, p_payment_method,
            CASE WHEN p_payment_method = 'PIX' THEN 'PENDING' ELSE 'PAYMENT_ON_DELIVERY' END,
            p_fulfillment_type, 'PENDING', NULLIF(btrim(COALESCE(p_notes, '')), ''), 'storefront_promo',
            v_tenant.default_prep_time_minutes, p_idempotency_key, v_coupon_id, v_coupon_code,
            v_terms.r_campaign_id, v_terms.r_card_id, v_terms.r_offer_id,
            CASE WHEN v_terms.r_card_id IS NOT NULL THEN 'CARD' ELSE 'OFFER' END)
    RETURNING id INTO v_order_id;

    PERFORM public._insert_order_lines(v_order_id, v_tenant.id,
        jsonb_build_array(jsonb_build_object('product_id', v_terms.r_product_id, 'quantity', p_quantity, 'notes', NULL,
            'name', v_terms.r_name, 'unit', v_terms.r_unit, 'unit_price', v_terms.r_unit_price,
            'original_price', v_terms.r_original_price, 'is_promotional', v_terms.r_is_promotional,
            'item_kind', v_terms.r_item_kind, 'offer_id', v_terms.r_offer_id, 'card_id', v_terms.r_card_id)),
        v_discount, v_base, 'Sistema (checkout promocional)');

    -- Contadores promocionais com guarda de limite (UPDATE ... WHERE times_used + q <= limite)
    PERFORM public._promo_counter_adjust(v_order_id, 1);
    IF v_coupon_id IS NOT NULL THEN
        PERFORM public._coupon_consume(v_tenant.id, v_coupon_id, v_order_id, v_customer_id, v_discount, 'ONLINE', NULL);
    END IF;

    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (v_order_id, 'PENDING', 'Pedido promocional confirmado pelo checkout online', 'Checkout Público');
    PERFORM public._record_server_campaign_event(v_order_id, 'PURCHASE');

    v_result := public._checkout_order_summary(v_order_id, false);
    RETURN v_result || jsonb_build_object('promotion', jsonb_build_object(
        'campaign_id', v_terms.r_campaign_id, 'card_id', v_terms.r_card_id, 'offer_id', v_terms.r_offer_id,
        'item_kind', v_terms.r_item_kind));
END;
$_$;

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

NOTIFY pgrst, 'reload schema';
COMMIT;
