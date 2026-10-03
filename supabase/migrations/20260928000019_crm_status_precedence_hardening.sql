-- ==============================================================================
-- ADEGAFOOD — MIGRATION 019: CRM CUSTOMER LIFECYCLE STATUS HARDENING
-- Correção cirúrgica da precedência de classificação do status do cliente:
-- PRIORIDADE 1: INATIVO (último pedido válido há mais de 60 dias)
-- PRIORIDADE 2: RECORRENTE (não inativo e >= 2 pedidos válidos)
-- PRIORIDADE 3: NOVO (não inativo e 0 ou 1 pedido válido)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_tenant_customers_summary(
    p_tenant_id UUID,
    p_search_term TEXT DEFAULT NULL,
    p_origin TEXT DEFAULT NULL,
    p_limit INT DEFAULT 50,
    p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_result JSONB;
    v_total_count INT := 0;
    v_customers JSONB;
    v_clean_search TEXT := NULLIF(trim(p_search_term), '');
    v_clean_origin TEXT := NULLIF(trim(p_origin), '');
BEGIN
    -- 1. Validação de autenticação
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
    END IF;

    -- 2. Validação estrita de Tenant Isolation e Permissões (OWNER, MANAGER, CASHIER ou CEO)
    IF NOT (
        public.is_ceo(v_user_id) OR 
        public.has_tenant_role(v_user_id, p_tenant_id, ARRAY['OWNER', 'MANAGER', 'CASHIER'])
    ) THEN
        RAISE EXCEPTION 'Permissão negada: você não possui acesso aos clientes deste estabelecimento.';
    END IF;

    -- 3. Contagem total de clientes filtrados para paginação
    SELECT COUNT(c.id)
    INTO v_total_count
    FROM public.customers c
    WHERE c.tenant_id = p_tenant_id
      AND (
          v_clean_search IS NULL OR
          c.name ILIKE ('%' || v_clean_search || '%') OR
          c.phone ILIKE ('%' || v_clean_search || '%') OR
          c.email ILIKE ('%' || v_clean_search || '%')
      )
      AND (
          v_clean_origin IS NULL OR
          v_clean_origin = 'ALL' OR
          c.origin = v_clean_origin
      );

    -- 4. Agregação de clientes com métricas oficiais e regra rigorosa de precedência de status
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', c.id,
                'tenantId', c.tenant_id,
                'userId', c.user_id,
                'name', c.name,
                'phone', c.phone,
                'email', c.email,
                'origin', c.origin,
                'totalOrders', COALESCE(ord.valid_orders_count, 0),
                'ltvAmount', COALESCE(ord.valid_ltv_sum, 0.00),
                'averageTicket', CASE 
                    WHEN COALESCE(ord.valid_orders_count, 0) > 0 THEN 
                        ROUND(COALESCE(ord.valid_ltv_sum, 0.00) / ord.valid_orders_count, 2)
                    ELSE 0.00 
                END,
                'firstOrderDate', ord.first_order_date,
                'lastOrderDate', ord.last_order_date,
                'hasLgpdConsent', EXISTS (
                    SELECT 1 FROM public.customer_consents cc 
                    WHERE cc.customer_id = c.id AND cc.accepted = true
                ),
                'status', CASE
                    -- PRIORIDADE 1: INATIVO se possui último pedido válido há mais de 60 dias
                    WHEN ord.last_order_date IS NOT NULL AND ord.last_order_date < (CURRENT_DATE - INTERVAL '60 days') THEN 'INATIVO'
                    -- PRIORIDADE 2: RECORRENTE se não inativo e possui 2 ou mais pedidos válidos
                    WHEN COALESCE(ord.valid_orders_count, 0) >= 2 THEN 'RECORRENTE'
                    -- PRIORIDADE 3: NOVO para qualquer cliente não inativo com 0 ou 1 pedido válido
                    ELSE 'NOVO'
                END,
                'createdAt', c.created_at
            )
            ORDER BY c.created_at DESC
        ),
        '[]'::jsonb
    )
    INTO v_customers
    FROM (
        SELECT c.*
        FROM public.customers c
        WHERE c.tenant_id = p_tenant_id
          AND (
              v_clean_search IS NULL OR
              c.name ILIKE ('%' || v_clean_search || '%') OR
              c.phone ILIKE ('%' || v_clean_search || '%') OR
              c.email ILIKE ('%' || v_clean_search || '%')
          )
          AND (
              v_clean_origin IS NULL OR
              v_clean_origin = 'ALL' OR
              c.origin = v_clean_origin
          )
        ORDER BY c.created_at DESC
        LIMIT p_limit OFFSET p_offset
    ) c
    LEFT JOIN LATERAL (
        SELECT 
            COUNT(o.id) as valid_orders_count,
            COALESCE(SUM(o.total_amount), 0.00) as valid_ltv_sum,
            MIN(o.created_at) as first_order_date,
            MAX(o.created_at) as last_order_date
        FROM public.orders o
        WHERE o.tenant_id = p_tenant_id
          AND o.customer_id = c.id
          AND o.status != 'CANCELLED'
    ) ord ON true;

    v_result := jsonb_build_object(
        'totalCount', v_total_count,
        'customers', v_customers,
        'limit', p_limit,
        'offset', p_offset
    );

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_customers_summary(UUID, TEXT, TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_customers_summary(UUID, TEXT, TEXT, INT, INT) TO authenticated;
