-- Store-scoped CRM controls. Customer account data remains owned by the customer.
BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_crm_profiles (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    is_manual boolean NOT NULL DEFAULT false,
    private_notes text NOT NULL DEFAULT '',
    tags text[] NOT NULL DEFAULT '{}',
    hidden_at timestamptz,
    contact_consent boolean NOT NULL DEFAULT false,
    contact_consent_at timestamptz,
    recorded_lgpd_consent boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, customer_id),
    CHECK (length(private_notes) <= 5000),
    CHECK (cardinality(tags) <= 10)
);

CREATE INDEX IF NOT EXISTS idx_customer_crm_profiles_visible
    ON public.customer_crm_profiles (tenant_id, hidden_at, customer_id);

CREATE TABLE IF NOT EXISTS public.customer_crm_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
    actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    action text NOT NULL CHECK (action IN ('note_updated', 'customer_hidden', 'customer_created', 'customer_edited', 'customer_exported')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_crm_audit_tenant_created
    ON public.customer_crm_audit (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public._customer_crm_can_manage_tenant(
    p_user_id uuid,
    p_tenant_id uuid,
    p_owner_only boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.tenant_users tu
        WHERE tu.user_id = p_user_id
          AND tu.tenant_id = p_tenant_id
          AND tu.status = 'ACTIVE'
          AND (
              tu.role_id = 'OWNER'
              OR (NOT p_owner_only AND tu.role_id = 'MANAGER')
          )
    );
$$;
REVOKE ALL ON FUNCTION public._customer_crm_can_manage_tenant(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.customer_crm_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_crm_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.customer_crm_profiles, public.customer_crm_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.customer_crm_profiles, public.customer_crm_audit TO authenticated;

DROP POLICY IF EXISTS customer_crm_profiles_tenant_read ON public.customer_crm_profiles;
CREATE POLICY customer_crm_profiles_tenant_read ON public.customer_crm_profiles
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.tenant_users tu
            WHERE tu.user_id = (SELECT auth.uid())
              AND tu.tenant_id = customer_crm_profiles.tenant_id
              AND tu.status = 'ACTIVE'
              AND tu.role_id IN ('OWNER', 'MANAGER')
        )
    );

DROP POLICY IF EXISTS customer_crm_audit_tenant_read ON public.customer_crm_audit;
CREATE POLICY customer_crm_audit_tenant_read ON public.customer_crm_audit
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.tenant_users tu
            WHERE tu.user_id = (SELECT auth.uid())
              AND tu.tenant_id = customer_crm_audit.tenant_id
              AND tu.status = 'ACTIVE'
              AND tu.role_id IN ('OWNER', 'MANAGER')
        )
    );

CREATE OR REPLACE FUNCTION public._customer_crm_seed_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
    INSERT INTO public.customer_crm_profiles (tenant_id, customer_id)
    VALUES (NEW.tenant_id, NEW.id)
    ON CONFLICT (tenant_id, customer_id) DO NOTHING;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._customer_crm_seed_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS customer_crm_seed_profile ON public.customers;
CREATE TRIGGER customer_crm_seed_profile
    AFTER INSERT ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public._customer_crm_seed_profile();

INSERT INTO public.customer_crm_profiles (tenant_id, customer_id)
SELECT c.tenant_id, c.id
FROM public.customers c
ON CONFLICT (tenant_id, customer_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public._customer_crm_protect_app_customer_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
    IF pg_catalog.current_setting('app.internal_customer_update', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF EXISTS (
            SELECT 1
            FROM public.tenant_users tu
            WHERE tu.user_id = auth.uid()
              AND tu.tenant_id = OLD.tenant_id
              AND tu.status = 'ACTIVE'
              AND tu.role_id IN ('OWNER', 'MANAGER')
        ) THEN
            RAISE EXCEPTION 'Clientes não podem ser excluídos pelo lojista; remova-os somente da lista da loja.'
                USING ERRCODE = '42501';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.user_id IS NOT NULL
       AND auth.uid() IS NOT NULL
       AND auth.uid() <> OLD.user_id
       AND EXISTS (
           SELECT 1
           FROM public.tenant_users tu
           WHERE tu.user_id = auth.uid()
             AND tu.tenant_id = OLD.tenant_id
             AND tu.status = 'ACTIVE'
             AND tu.role_id IN ('OWNER', 'MANAGER')
       )
       AND (
           NEW.name IS DISTINCT FROM OLD.name
           OR NEW.phone IS DISTINCT FROM OLD.phone
           OR NEW.email IS DISTINCT FROM OLD.email
           OR NEW.cpf IS DISTINCT FROM OLD.cpf
           OR NEW.user_id IS DISTINCT FROM OLD.user_id
           OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
           OR NEW.id IS DISTINCT FROM OLD.id
       ) THEN
        RAISE EXCEPTION 'Dados da conta de clientes registrados no app só podem ser alterados pelo próprio cliente.'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._customer_crm_protect_app_customer_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS customer_crm_protect_app_customer_fields ON public.customers;
CREATE TRIGGER customer_crm_protect_app_customer_fields
    BEFORE UPDATE OR DELETE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public._customer_crm_protect_app_customer_fields();

UPDATE public.customer_crm_profiles cp
SET hidden_at = pg_catalog.now()
FROM public.customers c
WHERE c.id = cp.customer_id
  AND c.tenant_id = cp.tenant_id
  AND EXISTS (
      SELECT 1
      FROM public.customer_account_deletion_requests dr
      WHERE dr.user_id = c.user_id AND dr.status IN ('PENDING', 'PROCESSED')
  );

CREATE OR REPLACE FUNCTION public._customer_crm_hide_deleted_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
    IF NEW.user_id IS NULL THEN
        RETURN NEW;
    END IF;
    UPDATE public.customer_crm_profiles cp
    SET hidden_at = COALESCE(cp.hidden_at, pg_catalog.now()),
        updated_at = pg_catalog.now()
    FROM public.customers c
    WHERE c.user_id = NEW.user_id
      AND c.tenant_id = cp.tenant_id
      AND c.id = cp.customer_id;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._customer_crm_hide_deleted_account() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS customer_crm_hide_deleted_account ON public.customer_account_deletion_requests;
CREATE TRIGGER customer_crm_hide_deleted_account
    AFTER INSERT ON public.customer_account_deletion_requests
    FOR EACH ROW
    EXECUTE FUNCTION public._customer_crm_hide_deleted_account();

CREATE OR REPLACE FUNCTION public._customer_crm_audit(
    p_tenant_id uuid,
    p_customer_id uuid,
    p_action text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
    INSERT INTO public.customer_crm_audit (tenant_id, customer_id, actor_user_id, action)
    VALUES (p_tenant_id, p_customer_id, auth.uid(), p_action);
$$;
REVOKE ALL ON FUNCTION public._customer_crm_audit(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

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

CREATE OR REPLACE FUNCTION public.crm_create_manual_customer(
    p_tenant_id uuid,
    p_name text,
    p_phone text,
    p_email text,
    p_origin text,
    p_lgpd_consent boolean,
    p_contact_consent boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_phone text := pg_catalog.regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
    v_customer_id uuid;
BEGIN
    IF v_uid IS NULL OR NOT public._customer_crm_can_manage_tenant(v_uid, p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado para cadastrar cliente.' USING ERRCODE = '42501';
    END IF;
    IF p_lgpd_consent IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'O consentimento LGPD registrado é obrigatório.' USING ERRCODE = '22023';
    END IF;
    IF p_name IS NULL OR length(btrim(p_name)) < 2 OR length(btrim(p_name)) > 255 THEN
        RAISE EXCEPTION 'Informe um nome válido.' USING ERRCODE = '22023';
    END IF;
    IF length(v_phone) < 10 OR length(v_phone) > 13 THEN
        RAISE EXCEPTION 'Informe um telefone válido com DDD.' USING ERRCODE = '22023';
    END IF;
    IF p_email IS NOT NULL AND length(p_email) > 255 THEN
        RAISE EXCEPTION 'E-mail deve ter até 255 caracteres.' USING ERRCODE = '22023';
    END IF;
    IF p_origin IS NULL OR p_origin NOT IN ('whatsapp', 'direct', 'direto', 'indicacao', 'outros') THEN
        RAISE EXCEPTION 'Canal manual inválido.' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_tenant_id::text || ':' || v_phone, 0)
    );
    IF EXISTS (
        SELECT 1 FROM public.customers c
        WHERE c.tenant_id = p_tenant_id AND c.phone = v_phone
    ) THEN
        RAISE EXCEPTION 'Já existe um cliente cadastrado com este telefone.' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.customers (tenant_id, name, phone, email, origin)
    VALUES (p_tenant_id, btrim(p_name), v_phone, NULLIF(btrim(p_email), ''), p_origin)
    RETURNING id INTO v_customer_id;

    UPDATE public.customer_crm_profiles
    SET is_manual = true,
        contact_consent = COALESCE(p_contact_consent, false),
        contact_consent_at = CASE WHEN p_contact_consent THEN pg_catalog.now() ELSE NULL END,
        recorded_lgpd_consent = true,
        updated_at = pg_catalog.now()
    WHERE tenant_id = p_tenant_id AND customer_id = v_customer_id;

    INSERT INTO public.customer_consents (customer_id, consent_type, accepted, ip_address)
    VALUES (v_customer_id, 'CRM_MANUAL_REGISTRATION', true, 'STORE_RECORDED');

    PERFORM public._customer_crm_audit(p_tenant_id, v_customer_id, 'customer_created');
    RETURN jsonb_build_object('id', v_customer_id);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_create_manual_customer(uuid, text, text, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_create_manual_customer(uuid, text, text, text, text, boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_update_manual_customer(
    p_tenant_id uuid,
    p_customer_id uuid,
    p_name text,
    p_phone text,
    p_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_uid uuid := auth.uid(); v_phone text := pg_catalog.regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
BEGIN
    IF v_uid IS NULL OR NOT public._customer_crm_can_manage_tenant(v_uid, p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado para editar cliente.' USING ERRCODE = '42501';
    END IF;
    IF p_name IS NULL OR length(btrim(p_name)) < 2 OR length(btrim(p_name)) > 255
       OR length(v_phone) < 10 OR length(v_phone) > 13 THEN
        RAISE EXCEPTION 'Nome ou telefone inválido.' USING ERRCODE = '22023';
    END IF;
    IF p_email IS NOT NULL AND length(p_email) > 255 THEN
        RAISE EXCEPTION 'E-mail deve ter até 255 caracteres.' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_tenant_id::text || ':' || v_phone, 0)
    );
    IF EXISTS (
        SELECT 1 FROM public.customers c
        WHERE c.tenant_id = p_tenant_id AND c.phone = v_phone AND c.id <> p_customer_id
    ) THEN
        RAISE EXCEPTION 'Já existe um cliente cadastrado com este telefone.' USING ERRCODE = '23505';
    END IF;
    UPDATE public.customers c
    SET name = btrim(p_name), phone = v_phone, email = NULLIF(btrim(p_email), '')
    FROM public.customer_crm_profiles cp
    WHERE c.id = p_customer_id
      AND c.tenant_id = p_tenant_id
      AND cp.tenant_id = p_tenant_id
      AND cp.customer_id = c.id
      AND cp.is_manual
      AND c.user_id IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Somente registros manuais desta loja podem ser editados.' USING ERRCODE = '42501';
    END IF;
    PERFORM public._customer_crm_audit(p_tenant_id, p_customer_id, 'customer_edited');
END;
$$;
REVOKE ALL ON FUNCTION public.crm_update_manual_customer(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_update_manual_customer(uuid, uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_save_customer_private_data(
    p_tenant_id uuid,
    p_customer_id uuid,
    p_notes text,
    p_tags text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_uid uuid := auth.uid(); v_tags text[];
BEGIN
    IF v_uid IS NULL OR NOT public._customer_crm_can_manage_tenant(v_uid, p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado para atualizar observações.' USING ERRCODE = '42501';
    END IF;
    IF p_notes IS NULL OR length(p_notes) > 5000 THEN
        RAISE EXCEPTION 'Observação deve ter até 5.000 caracteres.' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT btrim(tag)), '{}')
    INTO v_tags
    FROM unnest(COALESCE(p_tags, '{}')) tag
    WHERE btrim(tag) <> '';
    IF cardinality(v_tags) > 10 OR EXISTS (SELECT 1 FROM unnest(v_tags) tag WHERE length(tag) > 32) THEN
        RAISE EXCEPTION 'Use até 10 etiquetas, com no máximo 32 caracteres cada.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.customer_crm_profiles cp
    SET private_notes = p_notes, tags = v_tags, updated_at = pg_catalog.now()
    FROM public.customers c
    WHERE cp.tenant_id = p_tenant_id
      AND cp.customer_id = p_customer_id
      AND cp.hidden_at IS NULL
      AND c.id = cp.customer_id
      AND c.tenant_id = cp.tenant_id
      AND NOT EXISTS (
          SELECT 1 FROM public.customer_account_deletion_requests dr
          WHERE dr.user_id = c.user_id AND dr.status IN ('PENDING', 'PROCESSED')
      );
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cliente não encontrado nesta loja.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public._customer_crm_audit(p_tenant_id, p_customer_id, 'note_updated');
END;
$$;
REVOKE ALL ON FUNCTION public.crm_save_customer_private_data(uuid, uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_save_customer_private_data(uuid, uuid, text, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_hide_customer(p_tenant_id uuid, p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL OR NOT public._customer_crm_can_manage_tenant(v_uid, p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado para remover cliente da lista.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.customer_crm_profiles cp
    SET hidden_at = pg_catalog.now(), updated_at = pg_catalog.now()
    FROM public.customers c
    WHERE cp.tenant_id = p_tenant_id
      AND cp.customer_id = p_customer_id
      AND cp.hidden_at IS NULL
      AND c.id = cp.customer_id
      AND c.tenant_id = cp.tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cliente não encontrado nesta loja.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public._customer_crm_audit(p_tenant_id, p_customer_id, 'customer_hidden');
END;
$$;
REVOKE ALL ON FUNCTION public.crm_hide_customer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_hide_customer(uuid, uuid) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.crm_set_my_contact_consent(p_tenant_id uuid, p_accepted boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.customer_crm_profiles cp
    SET contact_consent = p_accepted,
        contact_consent_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    FROM public.customers c
    WHERE cp.tenant_id = p_tenant_id
      AND cp.customer_id = c.id
      AND c.tenant_id = p_tenant_id
      AND c.user_id = v_uid
      AND NOT EXISTS (
          SELECT 1 FROM public.customer_account_deletion_requests dr
          WHERE dr.user_id = v_uid AND dr.status IN ('PENDING', 'PROCESSED')
      );
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cadastro do cliente não encontrado nesta loja.' USING ERRCODE = 'P0002';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_set_my_contact_consent(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_set_my_contact_consent(uuid, boolean) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.crm_get_my_contact_consent(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_uid uuid := auth.uid(); v_consent boolean; v_registered boolean := false;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501';
    END IF;
    SELECT true, cp.contact_consent
    INTO v_registered, v_consent
    FROM public.customers c
    JOIN public.customer_crm_profiles cp
      ON cp.tenant_id = c.tenant_id AND cp.customer_id = c.id
    WHERE c.tenant_id = p_tenant_id AND c.user_id = v_uid
      AND NOT EXISTS (
          SELECT 1 FROM public.customer_account_deletion_requests dr
          WHERE dr.user_id = v_uid AND dr.status IN ('PENDING', 'PROCESSED')
      )
    LIMIT 1;
    RETURN jsonb_build_object(
        'registered', COALESCE(v_registered, false),
        'contactConsent', COALESCE(v_consent, false)
    );
END;
$$;
REVOKE ALL ON FUNCTION public.crm_get_my_contact_consent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_get_my_contact_consent(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_get_customer_contact_target(p_tenant_id uuid, p_customer_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_uid uuid := auth.uid(); v_phone text;
BEGIN
    IF v_uid IS NULL OR NOT public._customer_crm_can_manage_tenant(v_uid, p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado ao contato deste cliente.' USING ERRCODE = '42501';
    END IF;
    SELECT c.phone
    INTO v_phone
    FROM public.customers c
    JOIN public.customer_crm_profiles cp
      ON cp.tenant_id = c.tenant_id AND cp.customer_id = c.id
    WHERE c.id = p_customer_id
      AND c.tenant_id = p_tenant_id
      AND cp.contact_consent
      AND cp.hidden_at IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.customer_account_deletion_requests dr
          WHERE dr.user_id = c.user_id AND dr.status IN ('PENDING', 'PROCESSED')
      );
    IF v_phone IS NULL THEN
        RAISE EXCEPTION 'O cliente não autorizou contato ou não está disponível.' USING ERRCODE = '42501';
    END IF;
    RETURN v_phone;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_get_customer_contact_target(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_get_customer_contact_target(uuid, uuid) TO authenticated;

-- The legacy CRM endpoints return broader customer data and must not bypass the new consent/hide rules.
REVOKE ALL ON FUNCTION public.get_tenant_customers_summary(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_customer_orders_history(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_tenant_customer_manual(uuid, character varying, character varying, character varying, character varying, boolean) FROM PUBLIC, anon, authenticated;

COMMIT;
