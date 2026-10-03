-- ==============================================================================
-- ADEGAFOOD — MIGRATION 002: AUTH PROVISIONING & BACKFILL (HARDENED)
-- Objetivo: Provisionar public.users a partir de auth.users (Google OAuth & Email)
-- Hardening: SET search_path = '', referências totalmente qualificadas
-- Observação: COALESCE é construto sintático SQL padrão (sem pg_catalog)
-- NÃO EXECUTAR AUTOMATICAMENTE. Migration local preparada para aplicação controlada.
-- ==============================================================================

-- 1. Função SECURITY DEFINER totalmente qualificada para provisionar public.users
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name pg_catalog.varchar(255);
BEGIN
    -- Validação estrita: email é NOT NULL em public.users
    IF NEW.email IS NULL THEN
        RAISE EXCEPTION 'O e-mail não pode ser nulo para provisionamento de usuário em public.users';
    END IF;

    -- Obtém o nome real a partir de raw_user_meta_data quando disponível
    v_name := COALESCE(
        NEW.raw_user_meta_data->>'name',
        NEW.raw_user_meta_data->>'full_name',
        pg_catalog.split_part(NEW.email, '@', 1)
    );

    -- Insere ou atualiza de forma idempotente em public.users
    -- NÃO cria tenant, NÃO cria tenant_users e NÃO atribui OWNER automaticamente.
    INSERT INTO public.users (
        id,
        name,
        email,
        avatar_url,
        created_at,
        updated_at
    ) VALUES (
        NEW.id,
        v_name,
        NEW.email,
        NEW.raw_user_meta_data->>'avatar_url',
        pg_catalog.now(),
        pg_catalog.now()
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
        updated_at = pg_catalog.now();

    RETURN NEW;
END;
$$;

-- 2. Revogar execução pública da função do trigger (apenas o trigger do sistema pode executá-la)
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;

-- 3. BACKFILL SEGURO DE CONTAS JÁ EXISTENTES EM auth.users
-- Garante que usuários autenticados previamente (ex: Google OAuth anterior) possuam registro em public.users
INSERT INTO public.users (
    id,
    name,
    email,
    avatar_url,
    created_at,
    updated_at
)
SELECT
    au.id,
    COALESCE(
        au.raw_user_meta_data->>'name',
        au.raw_user_meta_data->>'full_name',
        CASE
            WHEN au.email IS NOT NULL
            THEN split_part(au.email, '@', 1)
            ELSE 'Usuário'
        END
    ),
    au.email,
    au.raw_user_meta_data->>'avatar_url',
    COALESCE(au.created_at, NOW()),
    NOW()
FROM auth.users au
WHERE au.email IS NOT NULL
ON CONFLICT (id) DO UPDATE
SET
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
    updated_at = NOW();

-- 4. Criar trigger idempotente no schema auth para NOVOS usuários
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_auth_user();
