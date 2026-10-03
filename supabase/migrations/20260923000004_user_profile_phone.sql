-- ==============================================================================
-- ADEGAFOOD — MIGRATION 004: USER PROFILE PHONE NUMBER
-- Objetivo: Adicionar campo opcional de telefone de contato ao perfil em public.users
-- Observação: Telefone é estritamente dado cadastral de perfil (sem impacto em RBAC/autorização)
-- NÃO EXECUTAR AUTOMATICAMENTE. Migration local preparada para aplicação controlada.
-- ==============================================================================

-- 1. Adiciona coluna phone à tabela public.users de forma idempotente
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS phone VARCHAR(32);

-- 2. Atualiza a função handle_new_auth_user para extrair telefone de raw_user_meta_data
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

    -- Insere ou atualiza de forma idempotente em public.users sincronizando telefone
    INSERT INTO public.users (
        id,
        name,
        email,
        phone,
        avatar_url,
        created_at,
        updated_at
    ) VALUES (
        NEW.id,
        v_name,
        NEW.email,
        NEW.raw_user_meta_data->>'phone',
        NEW.raw_user_meta_data->>'avatar_url',
        pg_catalog.now(),
        pg_catalog.now()
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = COALESCE(EXCLUDED.phone, public.users.phone),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
        updated_at = pg_catalog.now();

    RETURN NEW;
END;
$$;
