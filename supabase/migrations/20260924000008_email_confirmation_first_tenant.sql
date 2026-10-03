-- ==============================================================================
-- ADEGAFOOD — MIGRATION 008: EMAIL CONFIRMATION FOR FIRST TENANT (ZERO-TRUST FINAL)
-- ==============================================================================
-- Versão: 3.0 Hardened Final (Supabase Auth Magic Link & AMR Verification)
--
-- REGRAS ARQUITETURAIS DEFINITIVAS:
--   1. Sem token próprio em texto puro: a prova criptográfica de confirmação do
--      e-mail é conferida exclusivamente pelo Supabase Auth via Magic Link.
--   2. A tabela public.tenant_email_confirmations atua estritamente como registro
--      auditável de estado da solicitação (PENDING, CONFIRMED, EXPIRED, CANCELLED).
--   3. Único caminho de confirmação (Single Path):
--      Magic Link -> Supabase cria sessão de e-mail -> JWT com claim 'amr' ->
--      auth.uid() validado -> RPC confirm_pending_tenant_after_email ->
--      verificação de amr ('magiclink' / 'otp' / 'email') -> PENDING -> ACTIVE.
--   4. Rejeição categórica de sessões onde o único método de autenticação seja 'oauth'
--      (Google isolado não pode ativar tenant PENDING sem validar e-mail).
--   5. Separação de responsabilidades: o PostgreSQL não executa chamadas HTTP/JS.
--      A procedure resend_tenant_confirmation_email valida cooldown no banco e
--      autoriza o frontend a disparar supabase.auth.signInWithOtp({ shouldCreateUser: false }).
--   6. Isolamento multi-tenant estrito: a confirmação opera apenas sobre o tenant
--      PENDING explicitamente identificado pertencente a auth.uid() como OWNER.
--   7. Idempotência: caso o tenant já esteja ACTIVE, retorna sucesso sem duplicar registros.
--   8. Bloqueio RLS no banco: enquanto status = 'PENDING', todas as operações de catálogo,
--      pedidos, produtos, financeiro, clientes e equipe permanecem inacessíveis.
--
-- ATENÇÃO CRÍTICA:
--   ESTA MIGRATION NÃO DEVE SER EXECUTADA NO BANCO REMOTO AUTOMATICAMENTE.
--   Preservar somente localmente até aprovação explícita.
-- ==============================================================================

-- 1. TABELA DE AUDITORIA DE ESTADO DA CONFIRMAÇÃO DO ESTABELECIMENTO
CREATE TABLE IF NOT EXISTS public.tenant_email_confirmations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_tenant_email_confirmations_tenant ON public.tenant_email_confirmations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_email_confirmations_user ON public.tenant_email_confirmations(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_email_confirmations_status ON public.tenant_email_confirmations(status);

-- 2. HABILITAR ROW LEVEL SECURITY (RLS) E PRIVILÉGIOS RESTRITOS
ALTER TABLE public.tenant_email_confirmations ENABLE ROW LEVEL SECURITY;

-- Usuário autenticado pode apenas CONSULTAR suas próprias confirmações (ou CEO Global)
DROP POLICY IF EXISTS "tenant_email_confirmations_select_self" ON public.tenant_email_confirmations;
CREATE POLICY "tenant_email_confirmations_select_self" ON public.tenant_email_confirmations
    FOR SELECT USING (
        user_id = auth.uid() OR public.is_ceo(auth.uid())
    );

-- Revoga qualquer privilégio direto de escrita de usuários comuns.
-- O cliente PostgREST NÃO pode executar INSERT, UPDATE ou DELETE diretamente nesta tabela.
REVOKE ALL ON TABLE public.tenant_email_confirmations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tenant_email_confirmations TO authenticated;

-- 3. PERMISSÃO DE LEITURA DO TENANT PENDENTE PELO PRÓPRIO PROPRIETÁRIO
-- Permite que o criador consulte seu tenant enquanto estiver PENDING para exibição do card de confirmação
DROP POLICY IF EXISTS "tenants_owner_select_pending" ON public.tenants;
CREATE POLICY "tenants_owner_select_pending" ON public.tenants
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.tenant_users tu
            WHERE tu.user_id = auth.uid() AND tu.tenant_id = public.tenants.id
        )
    );

-- 4. ATUALIZAR FUNÇÃO DE VERIFICAÇÃO DE PAPÉIS (HAS_TENANT_ROLE)
-- Hardening: exige expressamente que public.tenants.status = 'ACTIVE' para liberar permissões de staff/owner.
-- Se o tenant for 'PENDING', has_tenant_role retorna FALSE, impedindo acesso via RLS a pedidos, produtos, financeiro, etc.
CREATE OR REPLACE FUNCTION public.has_tenant_role(
    p_user_id UUID,
    p_tenant_id UUID,
    p_roles TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tenant_users tu
        JOIN public.tenants t ON t.id = tu.tenant_id
        WHERE tu.user_id = auth.uid() 
          AND (
            (tu.tenant_id = p_tenant_id AND tu.role_id = ANY(p_roles) AND tu.status = 'ACTIVE' AND t.status = 'ACTIVE')
            OR 
            (tu.role_id IN ('CEO', 'SUPER_ADMIN') AND tu.status = 'ACTIVE')
          )
    );
$$;

-- 5. ATUALIZAR FUNÇÃO DE PERMISSÃO GRANULAR (HAS_TENANT_PERMISSION)
-- Exige que t.status = 'ACTIVE' para qualquer permissão operacional
CREATE OR REPLACE FUNCTION public.has_tenant_permission(
    p_user_id UUID,
    p_tenant_id UUID,
    p_permission TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tenant_users tu
        JOIN public.tenants t ON t.id = tu.tenant_id
        WHERE tu.user_id = auth.uid() 
          AND (tu.tenant_id = p_tenant_id OR tu.role_id IN ('CEO', 'SUPER_ADMIN'))
          AND tu.status = 'ACTIVE'
          AND (t.status = 'ACTIVE' OR tu.role_id IN ('CEO', 'SUPER_ADMIN'))
          AND (
            tu.role_id IN ('CEO', 'SUPER_ADMIN')
            OR (tu.role_id = 'OWNER')
            OR (tu.role_id = 'MANAGER' AND p_permission IN ('view_dashboard', 'manage_catalog', 'manage_orders', 'view_customers', 'view_reports', 'manage_inventory'))
            OR (tu.role_id = 'OPERATOR' AND p_permission IN ('manage_orders', 'view_orders'))
            OR (tu.role_id = 'CASHIER' AND p_permission IN ('view_orders', 'manage_orders', 'view_finances'))
            OR (tu.role_id = 'DELIVERY_MANAGER' AND p_permission IN ('view_orders', 'dispatch_orders'))
            OR (tu.role_id = 'DRIVER' AND p_permission IN ('view_assigned_orders', 'deliver_orders'))
          )
    );
$$;

-- 6. RPC DE CRIAÇÃO DO PRIMEIRO ESTABELECIMENTO
-- Cria o tenant atomicamente com status = 'PENDING'
-- Registra a solicitação de confirmação em public.tenant_email_confirmations
-- O disparo do Magic Link é de responsabilidade do frontend via Supabase Auth client.
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

    IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_slug) THEN
        RAISE EXCEPTION 'Slug já utilizado.';
    END IF;

    v_clean_email := pg_catalog.lower(pg_catalog.btrim(p_email));

    -- 7. Criação do Estabelecimento em public.tenants com STATUS = 'PENDING'
    -- REGRA ARQUITETURAL: public.tenants.email = e-mail comercial do estabelecimento (p_email)
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
    -- O vínculo de proprietário é estabelecido, mas o tenant permanece PENDING
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

    -- 11. Registro do estado da solicitação de confirmação de e-mail (sem token em texto)
    -- REGRA ARQUITETURAL: public.tenant_email_confirmations.email = e-mail da CONTA AUTENTICADA (v_auth_email)
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
        ('Estabelecimento "' || p_name || '" criado com status PENDING. Confirmação solicitada para o e-mail da conta ' || v_auth_email)::pg_catalog.text,
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

    -- 13. Retorno para o frontend autorizar o disparo de signInWithOtp no e-mail da conta autenticada
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

-- 7. ÚNICA RPC RESPONSÁVEL PELA ATIVAÇÃO DO TENANT PENDING (SINGLE PATH)
-- Valida auth.uid(), o vínculo de OWNER, a posse do tenant e o claim auth.jwt()->'amr'
-- Aceita exclusivamente 'magiclink', 'otp' ou 'email'.
-- Rejeita estritamente quando o único método for 'oauth'.
-- Valida a expiração real (expires_at) com lock FOR UPDATE dentro da transação.
CREATE OR REPLACE FUNCTION public.confirm_pending_tenant_after_email(
    p_tenant_id pg_catalog.uuid DEFAULT NULL
)
RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id pg_catalog.uuid := auth.uid();
    v_target_tenant_id pg_catalog.uuid := p_tenant_id;
    v_tenant RECORD;
    v_confirmation RECORD;
    v_has_email_auth pg_catalog.bool := false;
BEGIN
    -- 1. auth.uid()
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    -- 2. validação do amr
    -- Prova criptográfica de autenticação por e-mail no JWT (claim amr)
    -- Verifica se no array de métodos consta 'magiclink', 'otp' ou 'email'
    SELECT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(COALESCE(auth.jwt()->'amr', '[]'::pg_catalog.jsonb)) elem
        WHERE (elem->>'method' IN ('magiclink', 'otp', 'email'))
           OR (elem #>> '{}' IN ('magiclink', 'otp', 'email'))
    ) INTO v_has_email_auth;

    IF NOT v_has_email_auth THEN
        RAISE EXCEPTION 'Acesso negado: a ativação do primeiro estabelecimento exige autenticação por Magic Link ou código de e-mail (claim amr inválido ou ausente).';
    END IF;

    -- 3. localizar tenant pertencente ao auth.uid() como OWNER
    -- Proteção contra spoofing de p_tenant_id: sempre valida tu.user_id = auth.uid() e tu.role_id = 'OWNER'
    IF v_target_tenant_id IS NOT NULL THEN
        SELECT t.id, t.name, t.status, t.email
        INTO v_tenant
        FROM public.tenants t
        JOIN public.tenant_users tu ON tu.tenant_id = t.id
        WHERE t.id = v_target_tenant_id 
          AND tu.user_id = v_user_id 
          AND tu.role_id = 'OWNER'
        FOR UPDATE OF t;
    ELSE
        SELECT t.id, t.name, t.status, t.email
        INTO v_tenant
        FROM public.tenants t
        JOIN public.tenant_users tu ON tu.tenant_id = t.id
        WHERE tu.user_id = v_user_id 
          AND tu.role_id = 'OWNER' 
          AND t.status = 'PENDING'
        ORDER BY t.created_at DESC
        LIMIT 1
        FOR UPDATE OF t;
    END IF;

    IF NOT FOUND THEN
        -- Idempotência: verifica se o tenant já foi ativado previamente
        IF v_target_tenant_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.tenants t
            JOIN public.tenant_users tu ON tu.tenant_id = t.id
            WHERE t.id = v_target_tenant_id AND tu.user_id = v_user_id AND t.status = 'ACTIVE'
        ) THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'message', 'Estabelecimento já se encontra ativo.',
                'tenantId', v_target_tenant_id,
                'status', 'ACTIVE',
                'alreadyConfirmed', true
            );
        END IF;

        RAISE EXCEPTION 'Estabelecimento pendente de confirmação não encontrado para o usuário autenticado.';
    END IF;

    -- Idempotência direta
    IF v_tenant.status = 'ACTIVE' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'message', 'Estabelecimento já se encontra ativo.',
            'tenantId', v_tenant.id,
            'status', 'ACTIVE',
            'alreadyConfirmed', true
        );
    END IF;

    IF v_tenant.status <> 'PENDING' THEN
        RAISE EXCEPTION 'O estabelecimento não se encontra em estado de aprovação pendente (status atual: %).', v_tenant.status;
    END IF;

    -- 4. localizar a confirmação PENDING correspondente
    -- 5. FOR UPDATE na confirmação
    SELECT id, tenant_id, user_id, email, status, expires_at
    INTO v_confirmation
    FROM public.tenant_email_confirmations
    WHERE tenant_id = v_tenant.id
      AND user_id = v_user_id
      AND status = 'PENDING'
    ORDER BY requested_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registro de confirmação pendente não encontrado para este estabelecimento.';
    END IF;

    -- 6. verificar expires_at
    -- 7. se expirado: status = EXPIRED, atualizar updated_at, NÃO ativar o tenant, lançar erro
    IF v_confirmation.expires_at <= pg_catalog.now() THEN
        UPDATE public.tenant_email_confirmations
        SET 
            status = 'EXPIRED',
            updated_at = pg_catalog.now()
        WHERE id = v_confirmation.id;

        PERFORM public.log_audit_event(
            'TENANT_EMAIL_CONFIRMATION_EXPIRED'::pg_catalog.varchar,
            'tenants'::pg_catalog.varchar,
            ('Tentativa de confirmação com link expirado para o estabelecimento "' || v_tenant.name || '"')::pg_catalog.text,
            v_tenant.id::pg_catalog.varchar,
            'PENDING',
            'EXPIRED',
            v_tenant.id
        );

        RAISE EXCEPTION 'O link de confirmação expirou. Por favor, solicite um novo link de confirmação.';
    END IF;

    -- 8. se válido: status = CONFIRMED, confirmed_at = now(), depois tenant.status = ACTIVE
    UPDATE public.tenant_email_confirmations
    SET 
        status = 'CONFIRMED',
        confirmed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = v_confirmation.id;

    UPDATE public.tenants
    SET 
        status = 'ACTIVE',
        updated_at = pg_catalog.now()
    WHERE id = v_tenant.id;

    -- Registros forenses de auditoria
    PERFORM public.log_audit_event(
        'TENANT_EMAIL_CONFIRMED'::pg_catalog.varchar,
        'tenants'::pg_catalog.varchar,
        ('Confirmação de e-mail validada com sucesso via Magic Link (amr) para o estabelecimento "' || v_tenant.name || '"')::pg_catalog.text,
        v_tenant.id::pg_catalog.varchar,
        'PENDING',
        'CONFIRMED',
        v_tenant.id
    );

    PERFORM public.log_audit_event(
        'TENANT_ACTIVATED'::pg_catalog.varchar,
        'tenants'::pg_catalog.varchar,
        ('Estabelecimento "' || v_tenant.name || '" ativado definitivamente após confirmação de e-mail')::pg_catalog.text,
        v_tenant.id::pg_catalog.varchar,
        'PENDING',
        'ACTIVE',
        v_tenant.id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'tenantId', v_tenant.id,
        'status', 'ACTIVE',
        'email', v_tenant.email
    );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_pending_tenant_after_email(pg_catalog.uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_pending_tenant_after_email(pg_catalog.uuid) TO authenticated;

-- 8. RPC DE AUTORIZAÇÃO E REGISTRO DE REENVIO DO LINK DE CONFIRMAÇÃO
-- Valida o cooldown de 60 segundos no banco e atualiza requested_at e expires_at
-- Opera estritamente com o e-mail da CONTA AUTENTICADA (v_auth_email)
-- O envio real do Magic Link é efetuado pelo frontend via supabase.auth.signInWithOtp()
CREATE OR REPLACE FUNCTION public.resend_tenant_confirmation_email(
    p_tenant_id pg_catalog.uuid DEFAULT NULL
)
RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id pg_catalog.uuid := auth.uid();
    v_record RECORD;
    v_target_tenant_id pg_catalog.uuid := p_tenant_id;
    v_auth_email pg_catalog.varchar(255);
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    -- Obtém o e-mail da conta autenticada de forma segura
    SELECT pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt()->>'email', u.email)))
    INTO v_auth_email
    FROM public.users u
    WHERE u.id = v_user_id;

    IF v_auth_email IS NULL OR v_auth_email = '' THEN
        v_auth_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt()->>'email', '')));
    END IF;

    IF v_auth_email IS NULL OR v_auth_email = '' THEN
        RAISE EXCEPTION 'Não foi possível identificar o e-mail da conta autenticada para reenvio.';
    END IF;

    -- Localiza o tenant pendente associado ao usuário como OWNER
    IF v_target_tenant_id IS NULL THEN
        SELECT t.id INTO v_target_tenant_id
        FROM public.tenants t
        JOIN public.tenant_users tu ON tu.tenant_id = t.id
        WHERE tu.user_id = v_user_id AND tu.role_id = 'OWNER' AND t.status = 'PENDING'
        ORDER BY t.created_at DESC
        LIMIT 1;

        IF v_target_tenant_id IS NULL THEN
            RAISE EXCEPTION 'Nenhum estabelecimento pendente de confirmação encontrado para o usuário.';
        END IF;
    ELSE
        -- Quando p_tenant_id é informado explicitamente, verifica propriedade e status
        DECLARE
            v_actual_status pg_catalog.varchar(32);
            v_is_owner pg_catalog.bool := false;
        BEGIN
            SELECT t.status, (tu.role_id = 'OWNER')
            INTO v_actual_status, v_is_owner
            FROM public.tenants t
            JOIN public.tenant_users tu ON tu.tenant_id = t.id
            WHERE t.id = v_target_tenant_id AND tu.user_id = v_user_id;

            IF v_actual_status IS NULL OR NOT v_is_owner THEN
                RAISE EXCEPTION 'Estabelecimento não encontrado ou acesso negado.';
            END IF;

            IF v_actual_status = 'ACTIVE' THEN
                RAISE EXCEPTION 'Este estabelecimento já está ativo e confirmado. Não é permitido reenviar link de confirmação.';
            END IF;

            IF v_actual_status <> 'PENDING' THEN
                RAISE EXCEPTION 'O estabelecimento não está com status pendente de confirmação (status atual: %).', v_actual_status;
            END IF;
        END;
    END IF;

    -- Busca registro de confirmação existente (PENDING ou EXPIRED)
    SELECT id, email, requested_at, status, expires_at
    INTO v_record
    FROM public.tenant_email_confirmations
    WHERE tenant_id = v_target_tenant_id 
      AND user_id = v_user_id
      AND status IN ('PENDING', 'EXPIRED')
    ORDER BY requested_at DESC
    LIMIT 1
    FOR UPDATE;

    -- Cooldown estrito de 60 segundos para reenvio
    IF FOUND AND v_record.requested_at > (pg_catalog.now() - interval '60 seconds') THEN
        RAISE EXCEPTION 'Por favor, aguarde 60 segundos antes de solicitar um novo link de confirmação.';
    END IF;

    IF FOUND THEN
        UPDATE public.tenant_email_confirmations
        SET 
            email = v_auth_email,
            status = 'PENDING',
            requested_at = pg_catalog.now(),
            expires_at = pg_catalog.now() + interval '24 hours',
            updated_at = pg_catalog.now()
        WHERE id = v_record.id;
    ELSE
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
            v_target_tenant_id,
            v_user_id,
            v_auth_email,
            'PENDING',
            pg_catalog.now(),
            pg_catalog.now() + interval '24 hours',
            pg_catalog.now(),
            pg_catalog.now()
        );
    END IF;

    -- Registro forense de auditoria
    PERFORM public.log_audit_event(
        'TENANT_EMAIL_CONFIRMATION_RESENT'::pg_catalog.varchar,
        'tenants'::pg_catalog.varchar,
        ('Reenvio de confirmação autorizado para o estabelecimento ID ' || v_target_tenant_id::text || ' no e-mail da conta ' || v_auth_email)::pg_catalog.text,
        v_target_tenant_id::pg_catalog.varchar,
        'PENDING',
        'PENDING',
        v_target_tenant_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'tenantId', v_target_tenant_id,
        'email', v_auth_email,
        'message', 'Solicitação de confirmação autorizada e registrada com sucesso.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.resend_tenant_confirmation_email(pg_catalog.uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resend_tenant_confirmation_email(pg_catalog.uuid) TO authenticated;
