-- ==============================================================================
-- MIGRATION 20260928000015: ATIVAÇÃO DE TENANT VIA IDENTIDADE GOOGLE VERIFICADA
-- ==============================================================================
-- 1. Cria a RPC public.confirm_pending_tenant_after_verified_google().
-- 2. Permite a ativação do primeiro estabelecimento para contas autenticadas
--    via Google OAuth que já possuem e-mail verificado (auth.users.email_confirmed_at),
--    eliminando o envio redundante de Magic Link e contornando o erro de rate limit.
-- 3. Não afeta usuários de e-mail/senha, que continuam utilizando o fluxo de Magic Link.
-- 4. Não ativa registros automaticamente nesta migration; os tenants serão ativados
--    quando os respectivos proprietários autenticados concluírem o fluxo.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.confirm_pending_tenant_after_verified_google()
RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id pg_catalog.uuid := auth.uid();
    v_user_email pg_catalog.text;
    v_email_confirmed_at pg_catalog.timestamptz;
    v_app_meta pg_catalog.jsonb;
    v_is_google_verified pg_catalog.bool := false;
    v_tenant RECORD;
    v_confirmation RECORD;
BEGIN
    -- 1. Verifica autenticação
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    -- 2. Obtém dados do usuário autenticado no auth.users
    SELECT email, email_confirmed_at, raw_app_meta_data
    INTO v_user_email, v_email_confirmed_at, v_app_meta
    FROM auth.users
    WHERE id = v_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuário não encontrado na base de autenticação.';
    END IF;

    -- 3. Valida se o e-mail está confirmado na conta
    IF v_email_confirmed_at IS NULL THEN
        RAISE EXCEPTION 'A ativação por Google exige que o e-mail da conta esteja verificado.';
    END IF;

    -- 4. Valida se a conta possui identidade Google verificada
    IF (v_app_meta->>'provider' = 'google')
       OR (v_app_meta->'providers' ? 'google')
       OR EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_user_id AND provider = 'google') THEN
        v_is_google_verified := true;
    END IF;

    IF NOT v_is_google_verified THEN
        RAISE EXCEPTION 'Acesso negado: a ativação automática é exclusiva para contas autenticadas com identidade Google verificada.';
    END IF;

    -- 5. Localiza o tenant PENDING que pertence exclusivamente ao usuário autenticado como OWNER
    -- Proteção estrita: não aceita parâmetro externo, busca diretamente no banco
    SELECT t.id, t.name, t.slug, t.status, t.email
    INTO v_tenant
    FROM public.tenants t
    JOIN public.tenant_users tu ON tu.tenant_id = t.id
    WHERE tu.user_id = v_user_id
      AND tu.role_id = 'OWNER'
      AND t.status = 'PENDING'
    ORDER BY t.created_at DESC
    LIMIT 1
    FOR UPDATE OF t;

    IF NOT FOUND THEN
        -- Idempotência: caso o tenant já esteja ativo
        IF EXISTS (
            SELECT 1 FROM public.tenants t
            JOIN public.tenant_users tu ON tu.tenant_id = t.id
            WHERE tu.user_id = v_user_id AND tu.role_id = 'OWNER' AND t.status = 'ACTIVE'
        ) THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'message', 'Estabelecimento já se encontra ativo.',
                'status', 'ACTIVE',
                'alreadyConfirmed', true
            );
        END IF;

        RAISE EXCEPTION 'Nenhum estabelecimento pendente de confirmação encontrado para o usuário autenticado.';
    END IF;

    -- 6. Localiza o registro de confirmação em tenant_email_confirmations
    SELECT id, tenant_id, user_id, email, status, expires_at
    INTO v_confirmation
    FROM public.tenant_email_confirmations
    WHERE tenant_id = v_tenant.id
      AND user_id = v_user_id
    ORDER BY requested_at DESC
    LIMIT 1
    FOR UPDATE;

    -- Se existir confirmação registrada, valida se o e-mail corresponde ao e-mail autenticado
    IF FOUND THEN
        IF LOWER(TRIM(v_confirmation.email)) <> LOWER(TRIM(v_user_email)) THEN
            RAISE EXCEPTION 'O e-mail da confirmação não corresponde ao e-mail autenticado.';
        END IF;

        -- Atualiza tenant_email_confirmations para CONFIRMED e preenche confirmed_at
        UPDATE public.tenant_email_confirmations
        SET 
            status = 'CONFIRMED',
            confirmed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = v_confirmation.id;
    END IF;

    -- 7. Atualiza tenants.status para ACTIVE
    UPDATE public.tenants
    SET 
        status = 'ACTIVE',
        updated_at = pg_catalog.now()
    WHERE id = v_tenant.id;

    -- 8. Garante que o vínculo em tenant_users permaneça ACTIVE
    UPDATE public.tenant_users
    SET 
        status = 'ACTIVE',
        updated_at = pg_catalog.now()
    WHERE tenant_id = v_tenant.id 
      AND user_id = v_user_id;

    -- 9. Registra log de auditoria oficial
    PERFORM public.log_audit_event(
        'TENANT_ACTIVATED'::pg_catalog.varchar,
        'tenants'::pg_catalog.varchar,
        'Estabelecimento ativado após autenticação Google verificada.'::pg_catalog.text,
        v_tenant.id::pg_catalog.varchar,
        'PENDING',
        'ACTIVE',
        v_tenant.id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'tenantId', v_tenant.id,
        'slug', v_tenant.slug,
        'name', v_tenant.name,
        'status', 'ACTIVE',
        'email', v_tenant.email
    );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_pending_tenant_after_verified_google() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_pending_tenant_after_verified_google() TO authenticated;
