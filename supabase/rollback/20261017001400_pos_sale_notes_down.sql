-- Rollback da 1400: volta process_pos_sale_atomic à versão N2 (8 args). Notas já gravadas em orders.notes permanecem.
BEGIN;
DROP FUNCTION IF EXISTS public.process_pos_sale_atomic(uuid,jsonb,text,text,text,uuid,text,uuid,text);
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
REVOKE ALL ON FUNCTION public.process_pos_sale_atomic(uuid,jsonb,text,text,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_pos_sale_atomic(uuid,jsonb,text,text,text,uuid,text,uuid) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.process_pos_sale_atomic(uuid,jsonb,text,text,text,uuid,text,uuid)') IS NULL THEN RAISE EXCEPTION 'ROLLBACK 1400 falhou'; END IF; RAISE NOTICE 'ROLLBACK 1400 OK'; END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
