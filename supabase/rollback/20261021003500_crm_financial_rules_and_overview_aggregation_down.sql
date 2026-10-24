-- Rollback 20261021003500: drop overview RPC, restore 20261020003000 definitions of the CRM RPCs it replaced.
BEGIN;
DROP FUNCTION IF EXISTS public.crm_get_overview_metrics(uuid);

CREATE OR REPLACE FUNCTION public.crm_list_customers(
    p_tenant_id uuid,
    p_search text DEFAULT NULL,
    p_origin text DEFAULT NULL,
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
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
                sum(o.total_amount) AS valid_total,
                max(o.created_at) AS last_order_at
            FROM public.orders o
            WHERE o.tenant_id = c.tenant_id
              AND o.customer_id = c.id
              AND o.status <> 'CANCELLED'
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
DECLARE v_uid uuid := auth.uid(); v_customers jsonb;
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
        SELECT count(o.id)::integer AS valid_count, sum(o.total_amount) AS valid_total, max(o.created_at) AS last_order_at
        FROM public.orders o
        WHERE o.tenant_id = c.tenant_id AND o.customer_id = c.id AND o.status <> 'CANCELLED'
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

CREATE OR REPLACE FUNCTION public.crm_get_customer_orders(p_tenant_id uuid, p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_uid uuid := auth.uid(); v_orders jsonb;
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
        pg_catalog.hashtextextended(p_tenant_id::text || ':' || v_uid::text, 0)
    );
    INSERT INTO public.customers (tenant_id, user_id, name, phone, origin)
    VALUES (p_tenant_id, v_uid, v_name, v_phone, 'qr_code')
    ON CONFLICT (tenant_id, user_id) WHERE user_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_customer_id;

    IF v_customer_id IS NULL THEN
        SELECT c.id INTO v_customer_id
        FROM public.customers c
        WHERE c.tenant_id = p_tenant_id AND c.user_id = v_uid;
    END IF;
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

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261021003500';
NOTIFY pgrst, 'reload schema';
COMMIT;
