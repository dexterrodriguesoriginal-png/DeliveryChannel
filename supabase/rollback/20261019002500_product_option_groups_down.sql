BEGIN;

DROP FUNCTION IF EXISTS public.process_pos_sale_atomic_v2(uuid,jsonb,text,text,text,uuid,text,uuid,text);
DROP FUNCTION IF EXISTS public.process_checkout_atomic_v3(text,text,text,text,jsonb,text,text,text,jsonb,text,uuid,uuid);

CREATE OR REPLACE FUNCTION public.kitchen_list_orders(p_tenant_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_t uuid := public._kitchen_resolve_tenant(p_tenant_id);
BEGIN
    RETURN COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'created_at')) FROM (
            SELECT jsonb_build_object(
                'order_id', o.id, 'order_number', o.order_number, 'status', o.status, 'fulfillment_type', o.fulfillment_type,
                'created_at', o.created_at, 'notes', o.notes,
                'customer_first_name', CASE WHEN o.fulfillment_type = 'PICKUP'
                    THEN NULLIF(split_part(btrim(COALESCE(o.customer_name, '')), ' ', 1), '') END,
                'pickup_code', CASE WHEN o.fulfillment_type = 'PICKUP' AND to_regclass('public.pickup_arrivals') IS NOT NULL
                    THEN (SELECT a.pickup_code FROM public.pickup_arrivals a WHERE a.order_id = o.id) END,
                'confirmed_at', (SELECT max(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'CONFIRMED'),
                'preparing_at', (SELECT max(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'PREPARING'),
                'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('order_item_id', i.id, 'product_name', i.product_name,
                        'quantity', i.quantity, 'unit', i.unit, 'notes', i.notes) ORDER BY i.product_name)
                    FROM public.order_items i WHERE i.order_id = o.id), '[]'::jsonb)) AS x
            FROM public.orders o
            WHERE o.tenant_id = v_t AND o.status IN ('CONFIRMED','PREPARING')
            ORDER BY o.created_at LIMIT 100) q), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_order_by_id(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_order RECORD;
    v_items JSONB;
    v_history JSONB;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.' USING ERRCODE = '42501';
    END IF;
    IF NOT public._rate_limit_hit('customer_order_read', public._sha256_hex(v_user_id::text), NULL, 120, 60) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas consultas; tente novamente em instantes.';
    END IF;
    SELECT o.id, o.order_number, o.customer_name, o.customer_phone, o.customer_email, o.delivery_address,
           o.address_details, o.subtotal, o.delivery_fee, o.discount, o.total_amount, o.payment_method,
           o.payment_status, o.fulfillment_type, o.status, o.notes, o.prep_time_minutes, o.created_at, o.updated_at
    INTO v_order
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
    WHERE o.id = p_order_id AND c.user_id = v_user_id;
    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado ou acesso não autorizado.' USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'productId', oi.product_id, 'productName', oi.product_name, 'quantity', oi.quantity,
        'unitPrice', oi.unit_price, 'totalPrice', oi.total_price, 'notes', oi.notes, 'unit', oi.unit)
        ORDER BY oi.id ASC), '[]'::jsonb)
    INTO v_items FROM public.order_items oi WHERE oi.order_id = v_order.id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('status', osh.status, 'timestamp', osh.created_at)
        ORDER BY osh.created_at ASC), '[]'::jsonb)
    INTO v_history FROM public.order_status_history osh WHERE osh.order_id = v_order.id;
    RETURN jsonb_build_object(
        'id', v_order.id, 'orderNumber', v_order.order_number, 'customerName', v_order.customer_name,
        'customerPhone', v_order.customer_phone, 'customerEmail', v_order.customer_email,
        'deliveryAddress', v_order.delivery_address, 'addressDetails', v_order.address_details,
        'subtotal', v_order.subtotal, 'deliveryFee', v_order.delivery_fee, 'discount', v_order.discount,
        'totalAmount', v_order.total_amount, 'paymentMethod', v_order.payment_method,
        'paymentStatus', v_order.payment_status, 'fulfillmentType', v_order.fulfillment_type,
        'status', v_order.status, 'notes', v_order.notes, 'prepTimeMinutes', v_order.prep_time_minutes,
        'items', v_items, 'statusHistory', v_history, 'createdAt', v_order.created_at, 'updatedAt', v_order.updated_at
    );
END;
$$;

DROP TRIGGER IF EXISTS order_item_product_options_snapshot ON public.order_items;

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
        IF jsonb_typeof(v_elem) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_ITEM: item do pedido inválido.'; END IF;
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
        SELECT (e ->> 'productId')::uuid AS pid, sum((e ->> 'quantity')::int)::int AS qty,
               string_agg(NULLIF(btrim(e ->> 'notes'), ''), ' | ') AS notes
        FROM jsonb_array_elements(p_items) e
        GROUP BY (e ->> 'productId')::uuid ORDER BY (e ->> 'productId')::uuid
    LOOP
        IF v_agg.qty > 999 THEN RAISE EXCEPTION 'INVALID_QUANTITY: quantidade máxima por produto é 999.'; END IF;
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

DROP FUNCTION IF EXISTS public._product_option_snapshot_after_order_item();
DROP FUNCTION IF EXISTS public._product_option_selection_price(uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS public.set_product_option_group_links(uuid,uuid,uuid[]);
DROP FUNCTION IF EXISTS public.change_product_options_price(uuid,uuid[],integer);
DROP FUNCTION IF EXISTS public.change_product_option_price(uuid,uuid,integer);

DROP POLICY IF EXISTS order_item_options_order_read ON public.order_item_options;
DROP POLICY IF EXISTS product_option_group_links_staff_write ON public.product_option_group_links;
DROP POLICY IF EXISTS product_option_group_links_staff_read ON public.product_option_group_links;
DROP POLICY IF EXISTS product_option_group_links_public_read ON public.product_option_group_links;
DROP POLICY IF EXISTS product_options_staff_write ON public.product_options;
DROP POLICY IF EXISTS product_options_staff_read ON public.product_options;
DROP POLICY IF EXISTS product_options_public_read ON public.product_options;
DROP POLICY IF EXISTS product_option_groups_staff_write ON public.product_option_groups;
DROP POLICY IF EXISTS product_option_groups_staff_read ON public.product_option_groups;
DROP POLICY IF EXISTS product_option_groups_public_read ON public.product_option_groups;

DROP FUNCTION IF EXISTS public._product_options_can_read_order_item(uuid,uuid);
DROP FUNCTION IF EXISTS public._product_options_public_enabled(uuid);

DROP TABLE IF EXISTS public.order_item_options;
DROP TABLE IF EXISTS public.product_option_group_links;
DROP TABLE IF EXISTS public.product_options;
DROP TABLE IF EXISTS public.product_option_groups;
DROP INDEX IF EXISTS public.products_tenant_id_id_uidx;

COMMIT;
