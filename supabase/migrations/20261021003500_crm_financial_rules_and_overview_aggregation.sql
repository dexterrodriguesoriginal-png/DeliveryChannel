-- Migration: 20261021003500_crm_financial_rules_and_overview_aggregation.sql
-- Reviewable migration for CRM canonical financial calculation rules, store-wide metrics RPC, and safe manual-digital collision handling.
-- NOTE: Do NOT apply directly to production without staging validation and user approval.

BEGIN;

-- 1. Store-wide overview metrics RPC
-- Calculates metrics across ALL customers of the tenant, independent of UI pagination.
CREATE OR REPLACE FUNCTION public.crm_get_overview_metrics(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_result jsonb;
BEGIN
    IF v_uid IS NULL OR NOT public._customer_crm_can_manage_tenant(v_uid, p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado aos indicadores desta loja.' USING ERRCODE = '42501';
    END IF;

    WITH customer_orders AS (
        SELECT
            c.id AS customer_id,
            cp.is_manual,
            cp.contact_consent,
            (
                cp.recorded_lgpd_consent
                OR EXISTS (
                    SELECT 1 FROM public.customer_consents cc
                    WHERE cc.customer_id = c.id AND cc.accepted
                )
            ) AS has_lgpd_consent,
            EXISTS (
                SELECT 1
                FROM pg_catalog.unnest(COALESCE(cp.tags, ARRAY[]::text[])) AS t(tag)
                WHERE pg_catalog.upper(pg_catalog.btrim(t.tag)) IN ('VIP', 'CLIENTE VIP')
            ) AS has_vip_tag,
            COALESCE(orders.valid_count, 0) AS total_orders,
            COALESCE(orders.valid_spent, 0) AS total_spent,
            orders.last_order_at
        FROM public.customers c
        JOIN public.customer_crm_profiles cp
          ON cp.tenant_id = c.tenant_id AND cp.customer_id = c.id
        LEFT JOIN LATERAL (
            SELECT
                count(o.id)::integer AS valid_count,
                COALESCE(sum(o.total_amount), 0)::numeric AS valid_spent,
                max(o.created_at) AS last_order_at
            FROM public.orders o
            WHERE o.tenant_id = c.tenant_id
              AND o.customer_id = c.id
              AND o.status <> 'CANCELLED'
              AND (
                  o.payment_status = 'PAID'
                  OR (o.payment_status IS NULL AND o.status = 'DELIVERED')
              )
        ) orders ON true
        WHERE c.tenant_id = p_tenant_id
          AND cp.hidden_at IS NULL
          AND NOT EXISTS (
              SELECT 1
              FROM public.customer_account_deletion_requests dr
              WHERE dr.user_id = c.user_id AND dr.status IN ('PENDING', 'PROCESSED')
          )
    ),
    classified AS (
        SELECT
            customer_id,
            is_manual,
            contact_consent,
            has_lgpd_consent,
            total_orders,
            total_spent,
            last_order_at,
            CASE
                WHEN total_orders <= 0 THEN
                    CASE WHEN has_vip_tag THEN 'VIP' ELSE 'SEM_PEDIDOS' END
                WHEN last_order_at IS NOT NULL AND last_order_at < (pg_catalog.now() - interval '45 days') THEN
                    'INATIVO'
                WHEN total_orders >= 5 OR total_spent >= 500 OR has_vip_tag THEN
                    'VIP'
                WHEN total_orders >= 2 THEN
                    'RECORRENTE'
                ELSE
                    'NOVO'
            END AS segment
        FROM customer_orders
    )
    SELECT jsonb_build_object(
        'totalCustomers', count(*)::integer,
        'customersWithOrders', count(*) FILTER (WHERE total_orders > 0)::integer,
        'vipCustomers', count(*) FILTER (WHERE segment = 'VIP')::integer,
        'recurringCustomers', count(*) FILTER (WHERE total_orders >= 2)::integer,
        'newCustomers', count(*) FILTER (WHERE segment = 'NOVO')::integer,
        'inactiveCustomers', count(*) FILTER (WHERE segment = 'INATIVO')::integer,
        'withoutOrdersCustomers', count(*) FILTER (WHERE segment = 'SEM_PEDIDOS')::integer,
        'manualCustomers', count(*) FILTER (WHERE is_manual)::integer,
        'appCustomers', count(*) FILTER (WHERE NOT is_manual)::integer,
        'contactConsentCount', count(*) FILTER (WHERE contact_consent)::integer,
        'lgpdConsentCount', count(*) FILTER (WHERE has_lgpd_consent)::integer,
        'totalRevenue', COALESCE(sum(total_spent), 0)::numeric,
        'totalOrdersCount', COALESCE(sum(total_orders), 0)::integer,
        'averageTicket', CASE
            WHEN sum(total_orders) > 0 THEN round(COALESCE(sum(total_spent) / sum(total_orders), 0), 2)::numeric
            ELSE 0::numeric
        END,
        'averageLtvPerBuyer', CASE
            WHEN count(*) FILTER (WHERE total_orders > 0) > 0 THEN round(COALESCE(sum(total_spent) / count(*) FILTER (WHERE total_orders > 0), 0), 2)::numeric
            ELSE 0::numeric
        END
    )
    INTO v_result
    FROM classified;

    RETURN COALESCE(v_result, jsonb_build_object(
        'totalCustomers', 0,
        'customersWithOrders', 0,
        'vipCustomers', 0,
        'recurringCustomers', 0,
        'newCustomers', 0,
        'inactiveCustomers', 0,
        'withoutOrdersCustomers', 0,
        'manualCustomers', 0,
        'appCustomers', 0,
        'contactConsentCount', 0,
        'lgpdConsentCount', 0,
        'totalRevenue', 0,
        'totalOrdersCount', 0,
        'averageTicket', 0,
        'averageLtvPerBuyer', 0
    ));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_get_overview_metrics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_get_overview_metrics(uuid) TO authenticated;

-- 2. Update crm_list_customers with canonical financial rule
CREATE OR REPLACE FUNCTION public.crm_list_customers(
    p_tenant_id uuid,
    p_search text DEFAULT NULL,
    p_origin text DEFAULT NULL,
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_search text := NULLIF(btrim(p_search), '');
    v_origin text := NULLIF(btrim(p_origin), '');
    v_total integer;
    v_customers jsonb;
BEGIN
    IF v_uid IS NULL OR NOT public._customer_crm_can_manage_tenant(v_uid, p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado aos clientes desta loja.' USING ERRCODE = '42501';
    END IF;

    IF p_limit < 1 OR p_limit > 100 OR p_offset < 0 THEN
        RAISE EXCEPTION 'Parâmetros de paginação inválidos.' USING ERRCODE = '22023';
    END IF;

    SELECT count(*)::integer
    INTO v_total
    FROM public.customers c
    JOIN public.customer_crm_profiles cp
      ON cp.tenant_id = c.tenant_id AND cp.customer_id = c.id
    WHERE c.tenant_id = p_tenant_id
      AND cp.hidden_at IS NULL
      AND NOT EXISTS (
          SELECT 1
          FROM public.customer_account_deletion_requests dr
          WHERE dr.user_id = c.user_id AND dr.status IN ('PENDING', 'PROCESSED')
      )
      AND (
          v_search IS NULL
          OR c.name ILIKE ('%' || v_search || '%')
          OR c.phone ILIKE ('%' || v_search || '%')
      )
      AND (v_origin IS NULL OR v_origin = 'ALL' OR c.origin = v_origin);

    SELECT COALESCE(jsonb_agg(customer_row ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_customers
    FROM (
        SELECT
            c.created_at,
            jsonb_build_object(
                'id', c.id,
                'name', c.name,
                'phone', c.phone,
                'email', CASE WHEN cp.is_manual THEN c.email ELSE NULL END,
                'origin', c.origin,
                'totalOrders', COALESCE(orders.valid_count, 0),
                'totalSpent', COALESCE(orders.valid_total, 0),
                'lastOrderAt', orders.last_order_at,
                'contactConsent', cp.contact_consent,
                'hasLgpdConsent', (
                    cp.recorded_lgpd_consent
                    OR EXISTS (
                        SELECT 1 FROM public.customer_consents cc
                        WHERE cc.customer_id = c.id AND cc.accepted
                    )
                ),
                'isManual', cp.is_manual,
                'notes', cp.private_notes,
                'tags', to_jsonb(cp.tags)
            ) AS customer_row
        FROM public.customers c
        JOIN public.customer_crm_profiles cp
          ON cp.tenant_id = c.tenant_id AND cp.customer_id = c.id
        LEFT JOIN LATERAL (
            SELECT
                count(o.id)::integer AS valid_count,
                COALESCE(sum(o.total_amount), 0) AS valid_total,
                max(o.created_at) AS last_order_at
            FROM public.orders o
            WHERE o.tenant_id = c.tenant_id
              AND o.customer_id = c.id
              AND o.status <> 'CANCELLED'
              AND (
                  o.payment_status = 'PAID'
                  OR (o.payment_status IS NULL AND o.status = 'DELIVERED')
              )
        ) orders ON true
        WHERE c.tenant_id = p_tenant_id
          AND cp.hidden_at IS NULL
          AND NOT EXISTS (
              SELECT 1
              FROM public.customer_account_deletion_requests dr
              WHERE dr.user_id = c.user_id AND dr.status IN ('PENDING', 'PROCESSED')
          )
          AND (
              v_search IS NULL
              OR c.name ILIKE ('%' || v_search || '%')
              OR c.phone ILIKE ('%' || v_search || '%')
          )
          AND (v_origin IS NULL OR v_origin = 'ALL' OR c.origin = v_origin)
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT p_limit OFFSET p_offset
    ) rows_page;

    RETURN jsonb_build_object(
        'totalCount', v_total,
        'customers', v_customers,
        'limit', p_limit,
        'offset', p_offset
    );
END;
$$;
REVOKE ALL ON FUNCTION public.crm_list_customers(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_list_customers(uuid, text, text, integer, integer) TO authenticated;

-- 3. Update crm_export_customers with canonical financial rule
CREATE OR REPLACE FUNCTION public.crm_export_customers(
    p_tenant_id uuid,
    p_search text DEFAULT NULL,
    p_origin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_customers jsonb;
BEGIN
    IF v_uid IS NULL OR NOT public._customer_crm_can_manage_tenant(v_uid, p_tenant_id, true) THEN
        RAISE EXCEPTION 'Somente o proprietário pode exportar clientes.' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', c.name,
        'phone', c.phone,
        'origin', c.origin,
        'totalOrders', COALESCE(orders.valid_count, 0),
        'totalSpent', COALESCE(orders.valid_total, 0),
        'lastOrderAt', orders.last_order_at,
        'contactConsent', cp.contact_consent
    ) ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_customers
    FROM public.customers c
    JOIN public.customer_crm_profiles cp
      ON cp.tenant_id = c.tenant_id AND cp.customer_id = c.id
    LEFT JOIN LATERAL (
        SELECT
            count(o.id)::integer AS valid_count,
            COALESCE(sum(o.total_amount), 0) AS valid_total,
            max(o.created_at) AS last_order_at
        FROM public.orders o
        WHERE o.tenant_id = c.tenant_id
          AND o.customer_id = c.id
          AND o.status <> 'CANCELLED'
          AND (
              o.payment_status = 'PAID'
              OR (o.payment_status IS NULL AND o.status = 'DELIVERED')
          )
    ) orders ON true
    WHERE c.tenant_id = p_tenant_id
      AND cp.hidden_at IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.customer_account_deletion_requests dr
          WHERE dr.user_id = c.user_id AND dr.status IN ('PENDING', 'PROCESSED')
      )
      AND (NULLIF(btrim(p_search), '') IS NULL OR c.name ILIKE ('%' || btrim(p_search) || '%') OR c.phone ILIKE ('%' || btrim(p_search) || '%'))
      AND (NULLIF(btrim(p_origin), '') IS NULL OR p_origin = 'ALL' OR c.origin = p_origin);

    PERFORM public._customer_crm_audit(p_tenant_id, NULL, 'customer_exported');
    RETURN v_customers;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_export_customers(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_export_customers(uuid, text, text) TO authenticated;

-- 4. Update crm_get_customer_orders to return payment_status and fulfillment_type
CREATE OR REPLACE FUNCTION public.crm_get_customer_orders(p_tenant_id uuid, p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_orders jsonb;
BEGIN
    IF v_uid IS NULL OR NOT public._customer_crm_can_manage_tenant(v_uid, p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado ao histórico desta loja.' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.customers c
        JOIN public.customer_crm_profiles cp
          ON cp.tenant_id = c.tenant_id AND cp.customer_id = c.id
        WHERE c.id = p_customer_id
          AND c.tenant_id = p_tenant_id
          AND cp.hidden_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.customer_account_deletion_requests dr
              WHERE dr.user_id = c.user_id AND dr.status IN ('PENDING', 'PROCESSED')
          )
    ) THEN
        RAISE EXCEPTION 'Cliente não encontrado nesta loja.' USING ERRCODE = 'P0002';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'orderNumber', o.order_number,
        'createdAt', o.created_at,
        'status', o.status,
        'paymentStatus', o.payment_status,
        'fulfillmentType', o.fulfillment_type,
        'totalAmount', o.total_amount
    ) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_orders
    FROM public.orders o
    WHERE o.tenant_id = p_tenant_id
      AND o.customer_id = p_customer_id;

    RETURN v_orders;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_get_customer_orders(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_get_customer_orders(uuid, uuid) TO authenticated;

-- 5. Hardened crm_register_my_store_customer with safe manual collision detection
CREATE OR REPLACE FUNCTION public.crm_register_my_store_customer(
    p_tenant_id uuid,
    p_name text,
    p_phone text,
    p_lgpd_consent boolean,
    p_contact_consent boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_name text := btrim(COALESCE(p_name, ''));
    v_phone text := pg_catalog.regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
    v_existing_customer record;
    v_customer_id uuid;
    v_tenant_active boolean;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501';
    END IF;
    IF p_lgpd_consent IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'O consentimento LGPD para cadastro nesta loja é obrigatório.' USING ERRCODE = '22023';
    END IF;
    IF length(v_name) < 2 OR length(v_name) > 255 OR length(v_phone) < 10 OR length(v_phone) > 13 THEN
        RAISE EXCEPTION 'Informe nome e telefone válidos.' USING ERRCODE = '22023';
    END IF;

    SELECT (t.status = 'ACTIVE') INTO v_tenant_active
    FROM public.tenants t
    WHERE t.id = p_tenant_id;
    IF v_tenant_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Esta loja não está disponível para cadastro.' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.customer_account_deletion_requests dr
        WHERE dr.user_id = v_uid AND dr.status IN ('PENDING', 'PROCESSED')
    ) THEN
        RAISE EXCEPTION 'Uma solicitação de exclusão está pendente para esta conta.' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_tenant_id::text || ':' || v_phone, 0)
    );

    -- Check if a record with this phone already exists in this tenant
    SELECT c.id, c.user_id INTO v_existing_customer
    FROM public.customers c
    WHERE c.tenant_id = p_tenant_id AND c.phone = v_phone
    LIMIT 1;

    IF v_existing_customer.id IS NOT NULL THEN
        -- If already linked to the current user, simply update consent
        IF v_existing_customer.user_id = v_uid THEN
            v_customer_id := v_existing_customer.id;
        ELSIF v_existing_customer.user_id IS NOT NULL THEN
            -- Linked to another digital account
            RAISE EXCEPTION 'PHONE_ALREADY_REGISTERED: Este telefone já está associado a outra conta digital nesta loja.'
                USING ERRCODE = '23505';
        ELSE
            -- Manual record created by establishment; cannot blindly overwrite or hijack
            RAISE EXCEPTION 'PHONE_MANUAL_RECORD_CONFLICT: Já existe um cadastro interno do estabelecimento com este telefone. Por segurança, solicite ao estabelecimento a validação do vínculo.'
                USING ERRCODE = '23505';
        END IF;
    ELSE
        -- No phone collision, insert digital customer
        INSERT INTO public.customers (tenant_id, user_id, name, phone, origin)
        VALUES (p_tenant_id, v_uid, v_name, v_phone, 'qr_code')
        ON CONFLICT (tenant_id, user_id) WHERE user_id IS NOT NULL DO NOTHING
        RETURNING id INTO v_customer_id;

        IF v_customer_id IS NULL THEN
            SELECT c.id INTO v_customer_id
            FROM public.customers c
            WHERE c.tenant_id = p_tenant_id AND c.user_id = v_uid;
        END IF;
    END IF;

    -- Update consent
    UPDATE public.customer_crm_profiles
    SET recorded_lgpd_consent = true,
        contact_consent = COALESCE(p_contact_consent, false),
        contact_consent_at = CASE WHEN p_contact_consent THEN pg_catalog.now() ELSE NULL END,
        updated_at = pg_catalog.now()
    WHERE tenant_id = p_tenant_id AND customer_id = v_customer_id;

    IF NOT EXISTS (
        SELECT 1
        FROM public.customer_consents cc
        WHERE cc.customer_id = v_customer_id
          AND cc.consent_type = 'CRM_STORE_REGISTRATION'
          AND cc.accepted
    ) THEN
        INSERT INTO public.customer_consents (customer_id, consent_type, accepted, ip_address)
        VALUES (v_customer_id, 'CRM_STORE_REGISTRATION', true, 'CUSTOMER_APP');
    END IF;

    RETURN v_customer_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_register_my_store_customer(uuid, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_register_my_store_customer(uuid, text, text, boolean, boolean) TO authenticated;

COMMIT;
