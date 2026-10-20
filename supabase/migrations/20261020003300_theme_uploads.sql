-- ==============================================================================
-- Migration: 20261020003300_theme_uploads.sql
-- Módulo: Design do App & Storage de Imagens de Tema (Logo, Capa e Fundo)
-- Caminho estruturado: <tenantId>/theme/<tipo>-<timestamp>.<ext> no bucket 'catalog'
-- Políticas de RLS estritas: Upload permitido apenas para OWNER ou MANAGER do tenant
-- ==============================================================================

BEGIN;

-- 1. Bucket 'catalog' limits (5 MB, jpeg/png/webp) already enforced server-side since 20260926000012; not modified here.

-- 2. Função auxiliar de segurança para validação estrita de upload de temas
CREATE OR REPLACE FUNCTION public.can_manage_theme_storage(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_first_segment TEXT;
    v_second_segment TEXT;
    v_tenant_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN false;
    END IF;

    -- Extrai o tenant_id e o diretório 'theme' do caminho: <tenant_id>/theme/<file>
    v_first_segment := split_part(p_name, '/', 1);
    v_second_segment := split_part(p_name, '/', 2);

    -- Validação de formato UUID
    IF v_first_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RETURN false;
    END IF;

    -- Apenas caminhos dentro de 'theme' são geridos por esta política
    IF v_second_segment IS DISTINCT FROM 'theme' OR split_part(p_name, '/', 3) = ''
       OR split_part(p_name, '/', 4) <> '' THEN
        RETURN false; -- other catalog paths keep their existing policies
    END IF;

    v_tenant_id := v_first_segment::uuid;

    -- Validação estrita de papéis: Apenas OWNER e MANAGER da respectiva loja
    RETURN public.has_tenant_role(v_user_id, v_tenant_id, ARRAY['OWNER', 'MANAGER']);
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_theme_storage(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_theme_storage(TEXT) TO authenticated;

-- 3. Policy explícita de inserção para assets de tema
DROP POLICY IF EXISTS "catalog_theme_owner_manager_insert" ON storage.objects;
CREATE POLICY "catalog_theme_owner_manager_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'catalog'
    AND public.can_manage_theme_storage(name)
);

-- 4. Policy de atualização para assets de tema
DROP POLICY IF EXISTS "catalog_theme_owner_manager_update" ON storage.objects;
CREATE POLICY "catalog_theme_owner_manager_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'catalog'
    AND public.can_manage_theme_storage(name)
)
WITH CHECK (
    bucket_id = 'catalog'
    AND public.can_manage_theme_storage(name)
);

NOTIFY pgrst, 'reload schema';

COMMIT;
