-- ==============================================================================
-- ADEGAFOOD — MIGRATION 020: PUBLIC CUSTOMER ORDER TRACKING RPC
-- Permite que o cliente final autenticado (auth.uid()) consulte com segurança máxima
-- (SECURITY DEFINER) os dados completos do seu próprio pedido recém-criado ou histórico,
-- eliminando bloqueios de RLS no pós-checkout e erradicando qualquer fallback zerado (R$ 0,00).
-- ==============================================================================

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
    v_result JSONB;
BEGIN
    -- 1. Validação estrita de autenticação: auth.uid() é obrigatório
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
    END IF;

    -- 2. Localiza o pedido garantindo isolamento total por customer e tenant
    -- O pedido deve pertencer a um customer vinculado diretamente ao auth.uid()
    SELECT 
        o.id,
        o.order_number,
        o.tenant_id,
        o.customer_id,
        o.customer_name,
        o.customer_phone,
        o.customer_email,
        o.delivery_address,
        o.address_details,
        o.subtotal,
        o.delivery_fee,
        o.discount,
        o.total_amount,
        o.payment_method,
        o.payment_status,
        o.fulfillment_type,
        o.status,
        o.notes,
        o.origin,
        o.created_at,
        o.updated_at
    INTO v_order
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
    WHERE o.id = p_order_id
      AND c.user_id = v_user_id;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado ou acesso não autorizado.';
    END IF;

    -- 3. Recupera itens oficiais do pedido com valores reais do banco
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'productId', oi.product_id,
                'productName', oi.product_name,
                'quantity', oi.quantity,
                'unitPrice', oi.unit_price,
                'totalPrice', oi.total_price,
                'notes', oi.notes,
                'unit', oi.unit
            )
            ORDER BY oi.id ASC
        ),
        '[]'::jsonb
    )
    INTO v_items
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id;

    -- 4. Recupera histórico oficial de status do pedido
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'status', osh.status,
                'timestamp', osh.created_at,
                'note', osh.note,
                'changedBy', osh.changed_by
            )
            ORDER BY osh.created_at ASC
        ),
        '[]'::jsonb
    )
    INTO v_history
    FROM public.order_status_history osh
    WHERE osh.order_id = v_order.id;

    -- 5. Monta o objeto oficial estruturado
    v_result := jsonb_build_object(
        'id', v_order.id,
        'orderNumber', v_order.order_number,
        'tenantId', v_order.tenant_id,
        'customerId', v_order.customer_id,
        'customerName', v_order.customer_name,
        'customerPhone', v_order.customer_phone,
        'customerEmail', v_order.customer_email,
        'deliveryAddress', v_order.delivery_address,
        'addressDetails', v_order.address_details,
        'subtotal', v_order.subtotal,
        'deliveryFee', v_order.delivery_fee,
        'discount', v_order.discount,
        'totalAmount', v_order.total_amount,
        'paymentMethod', v_order.payment_method,
        'paymentStatus', v_order.payment_status,
        'fulfillmentType', v_order.fulfillment_type,
        'status', v_order.status,
        'notes', v_order.notes,
        'origin', v_order.origin,
        'items', v_items,
        'statusHistory', v_history,
        'createdAt', v_order.created_at,
        'updatedAt', v_order.updated_at
    );

    RETURN v_result;
END;
$$;

-- Permissões rigorosas
REVOKE ALL ON FUNCTION public.get_customer_order_by_id(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_order_by_id(UUID) TO authenticated;
