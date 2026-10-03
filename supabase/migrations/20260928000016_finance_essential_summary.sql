-- ==============================================================================
-- ADEGAFOOD — MIGRATION 016: FINANCE ESSENTIAL SUMMARY RPC
-- Agregação financeira oficial e segura direto no PostgreSQL
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_tenant_financial_summary(
    p_tenant_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_result JSONB;
    v_gross_revenue NUMERIC(10,2) := 0.00;
    v_valid_orders_count INT := 0;
    v_average_ticket NUMERIC(10,2) := 0.00;
    v_delivery_fees NUMERIC(10,2) := 0.00;
    v_cancelled_orders_count INT := 0;
    v_cancelled_amount NUMERIC(10,2) := 0.00;
    v_discounts_total NUMERIC(10,2) := 0.00;
    v_payment_breakdown JSONB;
    v_daily_sales JSONB;
BEGIN
    -- 1. Validação de autenticação
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
    END IF;

    -- 2. Validação estrita de Tenant Isolation e Permissões (OWNER, MANAGER, ou CEO/SUPER_ADMIN)
    IF NOT public.has_tenant_role(v_user_id, p_tenant_id, ARRAY['OWNER', 'MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada: você não possui acesso aos dados financeiros deste estabelecimento.';
    END IF;

    -- 3. Agregação de Pedidos Válidos (status != 'CANCELLED')
    SELECT 
        COALESCE(SUM(total_amount), 0.00),
        COUNT(id),
        COALESCE(SUM(delivery_fee), 0.00),
        COALESCE(SUM(discount), 0.00)
    INTO 
        v_gross_revenue,
        v_valid_orders_count,
        v_delivery_fees,
        v_discounts_total
    FROM public.orders
    WHERE tenant_id = p_tenant_id
      AND status != 'CANCELLED'
      AND created_at >= p_start_date
      AND created_at < p_end_date;

    -- Cálculo seguro de Ticket Médio (evita divisão por zero)
    IF v_valid_orders_count > 0 THEN
        v_average_ticket := ROUND(v_gross_revenue / v_valid_orders_count, 2);
    ELSE
        v_average_ticket := 0.00;
    END IF;

    -- 4. Agregação de Pedidos Cancelados (status = 'CANCELLED')
    SELECT 
        COUNT(id),
        COALESCE(SUM(total_amount), 0.00)
    INTO 
        v_cancelled_orders_count,
        v_cancelled_amount
    FROM public.orders
    WHERE tenant_id = p_tenant_id
      AND status = 'CANCELLED'
      AND created_at >= p_start_date
      AND created_at < p_end_date;

    -- 5. Agregação por Método de Pagamento (somente pedidos válidos)
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'paymentMethod', payment_method,
                'amount', total_sum,
                'orderCount', order_cnt,
                'percentage', CASE 
                    WHEN v_gross_revenue > 0 THEN ROUND((total_sum / v_gross_revenue) * 100, 1)
                    ELSE 0.0
                END
            )
            ORDER BY total_sum DESC
        ),
        '[]'::jsonb
    )
    INTO v_payment_breakdown
    FROM (
        SELECT 
            payment_method,
            COALESCE(SUM(total_amount), 0.00) as total_sum,
            COUNT(id) as order_cnt
        FROM public.orders
        WHERE tenant_id = p_tenant_id
          AND status != 'CANCELLED'
          AND created_at >= p_start_date
          AND created_at < p_end_date
        GROUP BY payment_method
    ) pm_sub;

    -- 6. Agregação de Vendas Diárias (para timeline/gráfico leve)
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'date', order_day::TEXT,
                'amount', total_sum,
                'orderCount', order_cnt
            )
            ORDER BY order_day ASC
        ),
        '[]'::jsonb
    )
    INTO v_daily_sales
    FROM (
        SELECT 
            DATE(created_at) as order_day,
            COALESCE(SUM(total_amount), 0.00) as total_sum,
            COUNT(id) as order_cnt
        FROM public.orders
        WHERE tenant_id = p_tenant_id
          AND status != 'CANCELLED'
          AND created_at >= p_start_date
          AND created_at < p_end_date
        GROUP BY DATE(created_at)
    ) day_sub;

    -- 7. Montagem do Objeto Final
    v_result := jsonb_build_object(
        'grossRevenue', v_gross_revenue,
        'validOrdersCount', v_valid_orders_count,
        'averageTicket', v_average_ticket,
        'deliveryFees', v_delivery_fees,
        'discountsTotal', v_discounts_total,
        'cancelledOrdersCount', v_cancelled_orders_count,
        'cancelledAmount', v_cancelled_amount,
        'paymentBreakdown', v_payment_breakdown,
        'dailySales', v_daily_sales,
        'startDate', p_start_date,
        'endDate', p_end_date
    );

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_financial_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_financial_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
