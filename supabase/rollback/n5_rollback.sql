-- ============================================================================
-- ROLLBACK MANUAL DA N5 — NÃO É MIGRATION. NUNCA EXECUTADO AUTOMATICAMENTE.
-- Uso: BEGIN; SET LOCAL n1n6.rollback_confirm = 'N5';
--      SET LOCAL n1n6.rollback_export_done = 'yes';   -- somente após exportar campaigns/cards/events
--      \i supabase/rollback/n5_rollback.sql; COMMIT;
-- Pré-requisito: N6 revertida. Restaura _checkout_core, _insert_order_lines e
-- _orders_promo_lifecycle exatamente como na N2.
-- PERDA DE DADOS: campaigns, campaign_cards e campaign_analytics_events (exportar antes).
-- Colunas de atribuição em orders/order_items e coupons.campaign_id: removidas SOMENTE se
-- estiverem vazias; com dados históricos ficam (sem FK) e a reaplicação da N5 abortará no precheck.
-- order_items.product_id volta a NOT NULL somente se não houver item CUSTOM.
-- ============================================================================
DO $rb$
BEGIN
    IF current_setting('n1n6.rollback_confirm', true) IS DISTINCT FROM 'N5' THEN
        RAISE EXCEPTION 'Rollback N5 não confirmado: SET LOCAL n1n6.rollback_confirm = ''N5''.';
    END IF;
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version > '20261006000500') THEN
        RAISE EXCEPTION 'Rollback N5 abortado: N6 (ou posterior) ainda registrada.';
    END IF;
    IF (EXISTS (SELECT 1 FROM public.campaigns) OR EXISTS (SELECT 1 FROM public.campaign_analytics_events))
       AND current_setting('n1n6.rollback_export_done', true) IS DISTINCT FROM 'yes' THEN
        RAISE EXCEPTION 'Rollback N5 abortado: há campanhas/eventos. Exporte e confirme com SET LOCAL n1n6.rollback_export_done = ''yes''.';
    END IF;
END
$rb$;

-- Versão da N2 (restaurada literalmente)
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

-- Versão da N2 (restaurada literalmente)
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

-- Versão da N2 (restaurada literalmente)
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

REVOKE ALL ON FUNCTION public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._insert_order_lines(uuid,uuid,jsonb,numeric,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._orders_promo_lifecycle() FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.track_campaign_event(text,text,uuid,uuid,uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS public.get_campaign_metrics(uuid,timestamp with time zone,timestamp with time zone);
DROP FUNCTION IF EXISTS public.get_promo_offer_performance(uuid,timestamp with time zone,timestamp with time zone);
DROP INDEX IF EXISTS public.idx_orders_tenant_offer_created;
DROP FUNCTION IF EXISTS public._record_server_campaign_event(uuid,text);
DROP FUNCTION IF EXISTS public._promo_counter_adjust(uuid,integer);
DROP FUNCTION IF EXISTS public._sanitize_event_metadata(jsonb);

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_campaign_fk, DROP CONSTRAINT IF EXISTS orders_card_fk,
                          DROP CONSTRAINT IF EXISTS orders_offer_fk;
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_card_id_fkey, DROP CONSTRAINT IF EXISTS order_items_offer_id_fkey;
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_campaign_fk;

DROP TABLE IF EXISTS public.campaign_analytics_events;
DROP TABLE IF EXISTS public.campaign_cards;
DROP TABLE IF EXISTS public.campaigns;
DROP FUNCTION IF EXISTS public._campaign_card_visible_at(uuid,timestamp with time zone);
DROP FUNCTION IF EXISTS public._offer_is_live(uuid,timestamp with time zone);
DROP FUNCTION IF EXISTS public._campaign_cards_chain_check();
DROP FUNCTION IF EXISTS public._campaign_cards_protect_counter();
DROP FUNCTION IF EXISTS public._campaigns_status_transition();

DO $cols$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE campaign_id IS NOT NULL OR card_id IS NOT NULL OR offer_id IS NOT NULL
                                                   OR attribution_source IS NOT NULL) THEN
        DROP INDEX IF EXISTS public.idx_orders_campaign;
        DROP INDEX IF EXISTS public.idx_orders_card;
        DROP INDEX IF EXISTS public.idx_orders_offer;
        ALTER TABLE public.orders DROP COLUMN campaign_id, DROP COLUMN card_id, DROP COLUMN offer_id, DROP COLUMN attribution_source;
    ELSE
        RAISE NOTICE 'Rollback N5: orders tem atribuição histórica; colunas mantidas (sem FK).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE offer_id IS NOT NULL OR card_id IS NOT NULL) THEN
        ALTER TABLE public.order_items DROP COLUMN offer_id, DROP COLUMN card_id;
    ELSE
        RAISE NOTICE 'Rollback N5: order_items tem offer_id/card_id históricos; colunas mantidas (sem FK).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.coupons WHERE campaign_id IS NOT NULL) THEN
        ALTER TABLE public.coupons DROP COLUMN campaign_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE product_id IS NULL) THEN
        ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_custom_product;
        ALTER TABLE public.order_items ALTER COLUMN product_id SET NOT NULL;
    ELSE
        RAISE NOTICE 'Rollback N5: há itens CUSTOM (product_id NULL); product_id permanece nullable.';
    END IF;
END
$cols$;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261006000500';
