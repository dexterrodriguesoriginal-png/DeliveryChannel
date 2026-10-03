-- ==============================================================================
-- ADEGAFOOD — MIGRATION 003: TENANT ONBOARDING RPC (SECURITY DEFINER - HARDENED)
-- Objetivo: Criação atômica e segura do primeiro estabelecimento pelo usuário logado
-- Hardening:
--   - Advisory Lock por transação específico por auth.uid() (anti-concorrência)
--   - Bloqueio estrito para qualquer vínculo pré-existente (ACTIVE, SUSPENDED, INVITED)
--   - Prevenção categórica de bypass de suspensão de conta
--   - Validação estrita via auth.uid() (Zero-Trust: NÃO aceita user_id do cliente)
--   - Atribuição exclusiva da role 'OWNER' e status 'ACTIVE' pelo banco
--   - legal_name = NULL (sem misturar com nome comercial p_name)
--   - tagline = NULL (neutro para qualquer categoria comercial)
--   - Validação de slug canônico único e campos obrigatórios
--   - Transação atômica gerando tenant, settings, theme e tenant_users
--   - Registro de auditoria em public.audit_logs via log_audit_event
-- NÃO EXECUTAR AUTOMATICAMENTE. Migration local preparada para aplicação controlada.
-- ==============================================================================

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
    v_tenant_id pg_catalog.uuid;
    v_user_exists pg_catalog.bool;
    v_has_existing_membership pg_catalog.bool;
BEGIN
    -- 1. Validação de autenticação: apenas sessões válidas podem criar estabelecimentos
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    -- 2. Proteção contra Concorrência (Advisory Lock transacional por usuário)
    -- Impede que duas requisições simultâneas do mesmo usuário criem múltiplos tenants
    PERFORM pg_catalog.pg_advisory_xact_lock(
        42015,
        pg_catalog.hashtext(v_user_id::pg_catalog.text)
    );

    -- 3. Validação de existência do perfil em public.users
    SELECT EXISTS(
        SELECT 1 FROM public.users WHERE id = v_user_id
    ) INTO v_user_exists;

    IF NOT v_user_exists THEN
        RAISE EXCEPTION 'Perfil de usuário não encontrado em public.users.';
    END IF;

    -- 4. Regra de Primeiro Onboarding: bloqueia se o usuário possuir QUALQUER vínculo prévio
    -- (seja ACTIVE, SUSPENDED ou INVITED). Evita bypass de suspensão e múltiplos tenants por este fluxo.
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

    -- Permite somente letras minúsculas, números e hífens (não permite hífen no início ou fim)
    IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
        RAISE EXCEPTION 'O slug deve conter apenas letras minúsculas, números e hífens válidos (ex: adega-do-bairro).';
    END IF;

    -- Verifica duplicidade de slug
    IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_slug) THEN
        RAISE EXCEPTION 'Slug já utilizado.';
    END IF;

    -- 7. Criação do Estabelecimento em public.tenants
    -- legal_name é definido explicitamente como NULL (sem duplicar nome comercial)
    -- status e plano são impostos com segurança pelo servidor
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
        pg_catalog.lower(pg_catalog.btrim(p_email)),
        COALESCE(NULLIF(pg_catalog.btrim(p_category), ''), 'ADEGA'),
        'ACTIVE',
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
    -- tagline é definida como NULL para não impor slogan específico de segmento
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

    -- 10. Criação do vínculo exclusivo de OWNER em public.tenant_users
    -- Role e status são definidos exclusivamente no banco (nunca vindos do cliente)
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

    -- 11. Registro forense de auditoria (somente após criação bem-sucedida)
    PERFORM public.log_audit_event(
        'TENANT_CREATED'::pg_catalog.varchar,
        'tenants'::pg_catalog.varchar,
        ('Estabelecimento "' || p_name || '" criado via onboarding pelo usuário ' || v_user_id::text)::pg_catalog.text,
        v_tenant_id::pg_catalog.varchar,
        NULL::pg_catalog.text,
        pg_catalog.jsonb_build_object(
            'tenantId', v_tenant_id,
            'name', p_name,
            'slug', v_slug,
            'role', 'OWNER'
        )::pg_catalog.text,
        v_tenant_id
    );

    -- 12. Retorno limpo e seguro em JSONB para o cliente
    RETURN pg_catalog.jsonb_build_object(
        'tenantId', v_tenant_id,
        'slug', v_slug,
        'name', p_name,
        'role', 'OWNER'
    );
END;
$$;

-- 13. Permissões de Segurança
-- Revogar execução pública da função
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

-- Conceder EXECUTE estritamente a usuários autenticados (protegidos por auth.uid())
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
