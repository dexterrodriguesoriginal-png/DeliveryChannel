-- ==============================================================================
-- ADEGAFOOD — MIGRATION 010: PUBLIC SLUG, TENANT ACCESS & IMMUTABILITY HARDENING
-- ==============================================================================
-- Objetivo:
--   1. Conceder permissões SELECT aos usuários autenticados nas tabelas de tenant
--      (public.tenants, public.tenant_settings, public.tenant_themes) para permitir
--      que o usuário lojista carregue seus dados reais sem cair em fallbacks fictícios.
--      (Segurança preservada: RLS continua ativo e filtrando estritamente por membership).
--   2. Garantir índice único e unicidade canônica em public.tenants(slug).
--   3. Proteger a coluna public.tenants.slug contra UPDATE (slug imutável pós-criação).
--   4. Atualizar a RPC public.create_tenant_for_current_user para resolução
--      determinística de colisão de slugs (-2, -3, etc.).
-- ==============================================================================

-- 1. CONCEDER PRIVILÉGIOS DE LEITURA (SELECT) E ATUALIZAÇÃO RESTRITA A USUÁRIOS AUTENTICADOS
-- PostgREST necessita do GRANT de objeto para avaliar as políticas RLS existentes
GRANT SELECT ON TABLE public.tenants TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.tenant_settings TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.tenant_themes TO authenticated;

-- 2. GARANTIR ÍNDICE ÚNICO EM SLUG
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_slug ON public.tenants(slug);

-- 3. TRIGGER DE PROTEÇÃO CONTRA ALTERAÇÃO DO SLUG (SLUG IMUTÁVEL)
CREATE OR REPLACE FUNCTION public.check_tenant_slug_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.slug IS DISTINCT FROM OLD.slug THEN
        RAISE EXCEPTION 'O identificador público (slug) do estabelecimento é imutável após a criação para proteger URLs e QR Codes existentes.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_tenant_slug_immutable ON public.tenants;
CREATE TRIGGER trg_check_tenant_slug_immutable
BEFORE UPDATE ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.check_tenant_slug_immutable();

-- 4. ATUALIZAR RPC create_tenant_for_current_user COM RESOLUÇÃO DETERMINÍSTICA DE COLISÃO
CREATE OR REPLACE FUNCTION public.create_tenant_for_current_user(
    p_name pg_catalog.text,
    p_slug pg_catalog.text,
    p_document pg_catalog.text,
    p_phone pg_catalog.text,
    p_email pg_catalog.text,
    p_category pg_catalog.text,
    p_address pg_catalog.text,
    p_city pg_catalog.text,
    p_phone_whatsapp pg_catalog.text
)
RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id pg_catalog.uuid := auth.uid();
    v_slug pg_catalog.varchar(64);
    v_base_slug pg_catalog.varchar(64);
    v_suffix pg_catalog.int4 := 2;
    v_tenant_id pg_catalog.uuid;
    v_user_exists pg_catalog.bool;
    v_has_existing_membership pg_catalog.bool;
    v_clean_email pg_catalog.varchar(255);
    v_auth_email pg_catalog.varchar(255);
BEGIN
    -- 1. Validação de autenticação
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    -- 2. Proteção contra Concorrência (Advisory Lock transacional por usuário)
    PERFORM pg_catalog.pg_advisory_xact_lock(
        42015,
        pg_catalog.hashtext(v_user_id::pg_catalog.text)
    );

    -- 3. Validação de existência do perfil em public.users e captura segura do e-mail da CONTA AUTENTICADA
    SELECT pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt()->>'email', u.email)))
    INTO v_auth_email
    FROM public.users u
    WHERE u.id = v_user_id;

    IF v_auth_email IS NULL OR v_auth_email = '' THEN
        v_auth_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt()->>'email', '')));
    END IF;

    IF v_auth_email IS NULL OR v_auth_email = '' THEN
        RAISE EXCEPTION 'Não foi possível identificar o e-mail da conta autenticada para confirmação.';
    END IF;

    -- 4. Regra de Primeiro Onboarding: bloqueia se o usuário possuir QUALQUER vínculo prévio
    SELECT EXISTS(
        SELECT 1 FROM public.tenant_users WHERE user_id = v_user_id
    ) INTO v_has_existing_membership;

    IF v_has_existing_membership THEN
        RAISE EXCEPTION 'Usuário já possui vínculo com estabelecimento. Utilize o fluxo apropriado para gerenciamento de estabelecimentos.';
    END IF;

    -- 5. Validação dos dados obrigatórios
    IF pg_catalog.btrim(COALESCE(p_name, '')) = '' THEN
        RAISE EXCEPTION 'Nome do estabelecimento é obrigatório.';
    END IF;

    IF pg_catalog.btrim(COALESCE(p_document, '')) = '' THEN
        RAISE EXCEPTION 'CPF ou CNPJ é obrigatório.';
    END IF;

    IF pg_catalog.btrim(COALESCE(p_phone, '')) = '' THEN
        RAISE EXCEPTION 'Telefone de contato é obrigatório.';
    END IF;

    IF pg_catalog.btrim(COALESCE(p_email, '')) = '' THEN
        RAISE EXCEPTION 'E-mail do estabelecimento é obrigatório.';
    END IF;

    IF pg_catalog.btrim(COALESCE(p_address, '')) = '' THEN
        RAISE EXCEPTION 'Endereço é obrigatório.';
    END IF;

    IF pg_catalog.btrim(COALESCE(p_phone_whatsapp, '')) = '' THEN
        RAISE EXCEPTION 'WhatsApp para atendimento é obrigatório.';
    END IF;

    -- 6. Validação estrita do Slug
    v_slug := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_slug, '')));

    IF v_slug = '' THEN
        RAISE EXCEPTION 'Slug do estabelecimento é obrigatório.';
    END IF;

    IF pg_catalog.length(v_slug) < 3 OR pg_catalog.length(v_slug) > 64 THEN
        RAISE EXCEPTION 'O slug deve conter entre 3 e 64 caracteres.';
    END IF;

    IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
        RAISE EXCEPTION 'O slug deve conter apenas letras minúsculas, números e hífens válidos (ex: adega-do-bairro).';
    END IF;

    -- Resolução determinística de colisão de slug (ex: churrasco-grego -> churrasco-grego-2 -> churrasco-grego-3)
    IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_slug) THEN
        v_base_slug := v_slug;
        v_suffix := 2;
        WHILE EXISTS (SELECT 1 FROM public.tenants WHERE slug = (v_base_slug || '-' || v_suffix::pg_catalog.text)) LOOP
            v_suffix := v_suffix + 1;
        END LOOP;
        v_slug := pg_catalog.substr((v_base_slug || '-' || v_suffix::pg_catalog.text), 1, 64)::pg_catalog.varchar(64);
    END IF;

    v_clean_email := pg_catalog.lower(pg_catalog.btrim(p_email));

    -- 7. Criação do Estabelecimento em public.tenants com STATUS = 'PENDING'
    INSERT INTO public.tenants (
        name,
        slug,
        legal_name,
        document,
        phone,
        email,
        category,
        status,
        plan_tier,
        created_at,
        updated_at
    ) VALUES (
        pg_catalog.btrim(p_name),
        v_slug,
        NULL,
        pg_catalog.btrim(p_document),
        pg_catalog.btrim(p_phone),
        v_clean_email,
        COALESCE(NULLIF(pg_catalog.btrim(p_category), ''), 'ADEGA'),
        'PENDING',
        'FREE',
        pg_catalog.now(),
        pg_catalog.now()
    ) RETURNING id INTO v_tenant_id;

    -- 8. Criação das configurações operacionais em public.tenant_settings
    INSERT INTO public.tenant_settings (
        tenant_id,
        is_open,
        min_order_value,
        delivery_fee,
        free_delivery_threshold,
        estimated_delivery_time,
        address,
        city,
        phone_whatsapp,
        pix_key,
        created_at,
        updated_at
    ) VALUES (
        v_tenant_id,
        true,
        0.00,
        0.00,
        NULL,
        '30-45 min',
        pg_catalog.btrim(p_address),
        COALESCE(NULLIF(pg_catalog.btrim(p_city), ''), 'São Paulo'),
        pg_catalog.btrim(p_phone_whatsapp),
        NULL,
        pg_catalog.now(),
        pg_catalog.now()
    );

    -- 9. Criação do tema visual padrão em public.tenant_themes
    INSERT INTO public.tenant_themes (
        tenant_id,
        store_name,
        tagline,
        logo_url,
        banner_url,
        primary_color,
        secondary_color,
        background_color,
        card_color,
        button_color,
        text_color,
        border_radius,
        font_family,
        updated_at
    ) VALUES (
        v_tenant_id,
        pg_catalog.btrim(p_name),
        NULL,
        NULL,
        NULL,
        '#15803d',
        '#166534',
        '#f8fafc',
        '#ffffff',
        '#15803d',
        '#0f172a',
        '1rem',
        'Inter',
        pg_catalog.now()
    );

    -- 10. Criação do vínculo de OWNER em public.tenant_users
    INSERT INTO public.tenant_users (
        user_id,
        tenant_id,
        role_id,
        status,
        created_at,
        updated_at
    ) VALUES (
        v_user_id,
        v_tenant_id,
        'OWNER',
        'ACTIVE',
        pg_catalog.now(),
        pg_catalog.now()
    );

    -- 11. Registro do estado da solicitação de confirmação de e-mail
    INSERT INTO public.tenant_email_confirmations (
        tenant_id,
        user_id,
        email,
        status,
        requested_at,
        expires_at,
        created_at,
        updated_at
    ) VALUES (
        v_tenant_id,
        v_user_id,
        v_auth_email,
        'PENDING',
        pg_catalog.now(),
        pg_catalog.now() + interval '24 hours',
        pg_catalog.now(),
        pg_catalog.now()
    );

    -- 12. Registro forense de auditoria
    PERFORM public.log_audit_event(
        'TENANT_EMAIL_CONFIRMATION_REQUESTED'::pg_catalog.varchar,
        'tenants'::pg_catalog.varchar,
        ('Estabelecimento "' || p_name || '" criado com status PENDING. Slug atribuído: ' || v_slug || '. Confirmação solicitada para ' || v_auth_email)::pg_catalog.text,
        v_tenant_id::pg_catalog.varchar,
        NULL::pg_catalog.text,
        pg_catalog.jsonb_build_object(
            'tenantId', v_tenant_id,
            'name', p_name,
            'slug', v_slug,
            'role', 'OWNER',
            'status', 'PENDING',
            'authAccountEmail', v_auth_email,
            'commercialEmail', v_clean_email
        )::pg_catalog.text,
        v_tenant_id
    );

    -- 13. Retorno com o slug resolvido
    RETURN pg_catalog.jsonb_build_object(
        'tenantId', v_tenant_id,
        'slug', v_slug,
        'name', p_name,
        'role', 'OWNER',
        'status', 'PENDING',
        'confirmationEmail', v_auth_email,
        'commercialEmail', v_clean_email
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_tenant_for_current_user(
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_tenant_for_current_user(
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text,
    pg_catalog.text
) TO authenticated;
