-- ==============================================================================
-- Rollback: 20261020003300_theme_uploads_down.sql
-- Remove políticas de storage e função can_manage_theme_storage
-- ==============================================================================

BEGIN;

DROP POLICY IF EXISTS "catalog_theme_owner_manager_update" ON storage.objects;
DROP POLICY IF EXISTS "catalog_theme_owner_manager_insert" ON storage.objects;
DROP FUNCTION IF EXISTS public.can_manage_theme_storage(TEXT);

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261020003300';

NOTIFY pgrst, 'reload schema';

COMMIT;
