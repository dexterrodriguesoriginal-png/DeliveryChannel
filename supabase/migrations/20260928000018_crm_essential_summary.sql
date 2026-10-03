-- ==============================================================================
-- ADEGAFOOD — MIGRATION 018: CRM ESSENTIAL RPCs
-- Consultas agregadas e seguras de clientes, métricas reais de pedidos e histórico
-- ==============================================================================

-- 1. RPC para listar clientes com métricas reais derivadas de pedidos válidos
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
    -- Validação de autenticação
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
    END IF;

    -- Validação estrita de Tenant Isolation e Permissões (OWNER, MANAGER, CASHIER ou CEO)
    IF NOT (
        public.is_ceo(v_user_id) OR 
        public.has_tenant_role(v_user_id, p_tenant_id, ARRAY['OWNER', 'MANAGER', 'CASHIER'])
    ) THEN
        RAISE EXCEPTION 'Permissão negada: você não possui acesso aos clientes deste estabelecimento.';
    END IF;

    -- Contagem total de clientes filtrados para paginação
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

    -- Agregação de clientes com métricas oficiais de pedidos válidos (status != 'CANCELLED')
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
                    WHEN COALESCE(ord.valid_orders_count, 0) = 0 THEN 'NOVO'
                    WHEN ord.last_order_date < (CURRENT_DATE - INTERVAL '60 days') THEN 'INATIVO'
                    WHEN ord.valid_orders_count >= 2 THEN 'RECORRENTE'
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


-- 2. RPC para consultar histórico de pedidos de um cliente específico
CREATE OR REPLACE FUNCTION public.get_customer_orders_history(
    p_tenant_id UUID,
    p_customer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_orders JSONB;
BEGIN
    -- Validação de autenticação
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
    END IF;

    -- Validação estrita de Tenant Isolation e Permissões
    IF NOT (
        public.is_ceo(v_user_id) OR 
        public.has_tenant_role(v_user_id, p_tenant_id, ARRAY['OWNER', 'MANAGER', 'CASHIER'])
    ) THEN
        RAISE EXCEPTION 'Permissão negada: você não possui acesso a estes pedidos.';
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', o.id,
                'orderNumber', o.order_number,
                'createdAt', o.created_at,
                'status', o.status,
                'subtotal', o.subtotal,
                'discount', o.discount,
                'deliveryFee', o.delivery_fee,
                'totalAmount', o.total_amount,
                'paymentMethod', o.payment_method,
                'fulfillmentType', o.fulfillment_type
            )
            ORDER BY o.created_at DESC
        ),
        '[]'::jsonb
    )
    INTO v_orders
    FROM public.orders o
    WHERE o.tenant_id = p_tenant_id
      AND o.customer_id = p_customer_id;

    RETURN v_orders;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_orders_history(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_orders_history(UUID, UUID) TO authenticated;


-- 3. RPC para cadastro manual de cliente pelo lojista
CREATE OR REPLACE FUNCTION public.create_tenant_customer_manual(
    p_tenant_id UUID,
    p_name VARCHAR(255),
    p_phone VARCHAR(32),
    p_email VARCHAR(255) DEFAULT NULL,
    p_origin VARCHAR(32) DEFAULT 'whatsapp',
    p_consent_lgpd BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_clean_phone VARCHAR(32);
    v_customer_id UUID;
    v_existing_id UUID;
    v_result JSONB;
BEGIN
    -- Validação de autenticação
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
    END IF;

    -- Validação estrita de permissões (Apenas OWNER e MANAGER)
    IF NOT (
        public.is_ceo(v_user_id) OR 
        public.has_tenant_role(v_user_id, p_tenant_id, ARRAY['OWNER', 'MANAGER'])
    ) THEN
        RAISE EXCEPTION 'Permissão negada: apenas proprietários e gerentes podem cadastrar clientes manualmente.';
    END IF;

    -- Validação e normalização de dados
    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION 'O nome do cliente é obrigatório.';
    END IF;

    IF p_phone IS NULL OR trim(p_phone) = '' THEN
        RAISE EXCEPTION 'O telefone do cliente é obrigatório.';
    END IF;

    v_clean_phone := regexp_replace(p_phone, '[^\d]', '', 'g');
    IF length(v_clean_phone) < 10 THEN
        RAISE EXCEPTION 'Número de telefone inválido. Informe o DDD e pelo menos 8 ou 9 dígitos.';
    END IF;

    -- Verifica se já existe cliente com este telefone no tenant
    SELECT id INTO v_existing_id
    FROM public.customers
    WHERE tenant_id = p_tenant_id AND phone = v_clean_phone;

    IF v_existing_id IS NOT NULL THEN
        RAISE EXCEPTION 'Já existe um cliente cadastrado com este telefone neste estabelecimento.';
    END IF;

    -- Inserção segura do novo cliente
    INSERT INTO public.customers (
        tenant_id,
        user_id,
        name,
        phone,
        email,
        origin,
        total_orders,
        ltv_amount,
        first_order_date,
        last_order_date
    ) VALUES (
        p_tenant_id,
        NULL,
        trim(p_name),
        v_clean_phone,
        NULLIF(trim(p_email), ''),
        COALESCE(p_origin, 'whatsapp'),
        0,
        0.00,
        NULL,
        NULL
    ) RETURNING id INTO v_customer_id;

    -- Se consentimento foi explicitamente informado pelo lojista (ex: aceite verbal ou termo assinado no balcão)
    IF p_consent_lgpd THEN
        INSERT INTO public.customer_consents (
            customer_id,
            consent_type,
            accepted,
            ip_address,
            accepted_at
        ) VALUES (
            v_customer_id,
            'MANUAL_STAFF_REGISTRATION',
            true,
            'BALCAO_STAFF',
            NOW()
        );
    END IF;

    v_result := jsonb_build_object(
        'id', v_customer_id,
        'tenantId', p_tenant_id,
        'name', trim(p_name),
        'phone', v_clean_phone,
        'email', NULLIF(trim(p_email), ''),
        'origin', COALESCE(p_origin, 'whatsapp'),
        'totalOrders', 0,
        'ltvAmount', 0.00,
        'averageTicket', 0.00,
        'hasLgpdConsent', p_consent_lgpd,
        'status', 'NOVO'
    );

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_tenant_customer_manual(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_customer_manual(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, BOOLEAN) TO authenticated;
