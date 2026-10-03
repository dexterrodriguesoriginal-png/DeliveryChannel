-- ==============================================================================
-- ADEGAFOOD — MIGRATION 017: REPORTS ESSENTIAL SUMMARY RPC
-- Agregação oficial de relatórios de desempenho, produtos e categorias
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_tenant_reports_summary(
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
    v_total_orders INT := 0;
    v_total_revenue NUMERIC(10,2) := 0.00;
    v_average_ticket NUMERIC(10,2) := 0.00;
    v_active_customers INT := 0;
    v_daily_sales JSONB;
    v_top_products JSONB;
    v_sales_by_category JSONB;
BEGIN
    -- 1. Validação de autenticação
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
    END IF;

    -- 2. Validação estrita de Tenant Isolation e Permissões (OWNER, MANAGER, ou CEO/SUPER_ADMIN)
    IF NOT public.has_tenant_role(v_user_id, p_tenant_id, ARRAY['OWNER', 'MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada: você não possui acesso aos relatórios deste estabelecimento.';
    END IF;

    -- 3. Agregação de Pedidos Válidos (status != 'CANCELLED')
    SELECT 
        COUNT(id),
        COALESCE(SUM(total_amount), 0.00),
        COUNT(DISTINCT customer_id)
    INTO 
        v_total_orders,
        v_total_revenue,
        v_active_customers
    FROM public.orders
    WHERE tenant_id = p_tenant_id
      AND status != 'CANCELLED'
      AND created_at >= p_start_date
      AND created_at < p_end_date;

    -- Cálculo seguro de Ticket Médio (evita divisão por zero)
    IF v_total_orders > 0 THEN
        v_average_ticket := ROUND(v_total_revenue / v_total_orders, 2);
    ELSE
        v_average_ticket := 0.00;
    END IF;

    -- 4. Evolução Diária das Vendas (somente pedidos válidos)
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'date', order_day::TEXT,
                'orderCount', order_cnt,
                'revenue', total_sum
            )
            ORDER BY order_day ASC
        ),
        '[]'::jsonb
    )
    INTO v_daily_sales
    FROM (
        SELECT 
            DATE(created_at) as order_day,
            COUNT(id) as order_cnt,
            COALESCE(SUM(total_amount), 0.00) as total_sum
        FROM public.orders
        WHERE tenant_id = p_tenant_id
          AND status != 'CANCELLED'
          AND created_at >= p_start_date
          AND created_at < p_end_date
        GROUP BY DATE(created_at)
    ) day_sub;

    -- 5. Top 5 Produtos Mais Vendidos (agrupado por product_id e ordenado por faturamento DESC)
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'productId', product_id,
                'productName', product_name,
                'quantitySold', qty_sum,
                'revenue', revenue_sum
            )
            ORDER BY revenue_sum DESC
        ),
        '[]'::jsonb
    )
    INTO v_top_products
    FROM (
        SELECT 
            oi.product_id,
            MAX(oi.product_name) as product_name,
            COALESCE(SUM(oi.quantity), 0) as qty_sum,
            COALESCE(SUM(oi.total_price), 0.00) as revenue_sum
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
        WHERE o.tenant_id = p_tenant_id
          AND o.status != 'CANCELLED'
          AND o.created_at >= p_start_date
          AND o.created_at < p_end_date
        GROUP BY oi.product_id
        ORDER BY revenue_sum DESC
        LIMIT 5
    ) tp_sub;

    -- 6. Vendas por Categoria (relacionamento order_items -> products -> categories)
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'categoryId', cat_id,
                'categoryName', cat_name,
                'quantitySold', qty_sum,
                'revenue', revenue_sum,
                'percentage', CASE 
                    WHEN v_total_revenue > 0 THEN ROUND((revenue_sum / v_total_revenue) * 100, 1)
                    ELSE 0.0
                END
            )
            ORDER BY revenue_sum DESC
        ),
        '[]'::jsonb
    )
    INTO v_sales_by_category
    FROM (
        SELECT 
            COALESCE(c.id::TEXT, 'uncategorized') as cat_id,
            COALESCE(c.name, 'Geral / Sem Categoria') as cat_name,
            COALESCE(SUM(oi.quantity), 0) as qty_sum,
            COALESCE(SUM(oi.total_price), 0.00) as revenue_sum
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
        LEFT JOIN public.products p ON p.id = oi.product_id
        LEFT JOIN public.categories c ON c.id = p.category_id
        WHERE o.tenant_id = p_tenant_id
          AND o.status != 'CANCELLED'
          AND o.created_at >= p_start_date
          AND o.created_at < p_end_date
        GROUP BY c.id, c.name
        ORDER BY revenue_sum DESC
        LIMIT 6
    ) cat_sub;

    -- 7. Montagem do Objeto Final
    v_result := jsonb_build_object(
        'totalOrders', v_total_orders,
        'totalRevenue', v_total_revenue,
        'averageTicket', v_average_ticket,
        'activeCustomers', v_active_customers,
        'dailySales', v_daily_sales,
        'topProducts', v_top_products,
        'salesByCategory', v_sales_by_category,
        'startDate', p_start_date,
        'endDate', p_end_date
    );

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_reports_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_reports_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
