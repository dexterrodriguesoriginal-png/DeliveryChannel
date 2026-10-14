-- ============================================================================
-- ROLLBACK MANUAL DA N3 — NÃO É MIGRATION. NUNCA EXECUTADO AUTOMATICAMENTE.
-- Uso: BEGIN; SET LOCAL n1n6.rollback_confirm = 'N3'; \i supabase/rollback/n3_rollback.sql; COMMIT;
-- Pré-requisito: N4–N6 revertidas e os buckets marketing/marketing-public VAZIOS
-- (remova os arquivos pela API do Storage antes; o script aborta se houver objetos).
-- PERDA DE DADOS: remove marketing_media_assets e marketing_media_publication_log (trilha de
-- publicação). Exporte antes (pg_dump -t) se houver uso real. audit_logs é preservado.
-- ============================================================================
DO $rb$
BEGIN
    IF current_setting('n1n6.rollback_confirm', true) IS DISTINCT FROM 'N3' THEN
        RAISE EXCEPTION 'Rollback N3 não confirmado: SET LOCAL n1n6.rollback_confirm = ''N3''.';
    END IF;
    IF to_regclass('public.promotion_carousels') IS NOT NULL THEN
        RAISE EXCEPTION 'Rollback N3 abortado: N4 ainda aplicada.';
    END IF;
    IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id IN ('marketing','marketing-public')) THEN
        RAISE EXCEPTION 'Rollback N3 abortado: existem arquivos nos buckets marketing/marketing-public. Remova pela API do Storage.';
    END IF;
END
$rb$;
DROP POLICY IF EXISTS marketing_private_insert ON storage.objects;
DROP POLICY IF EXISTS marketing_private_select ON storage.objects;
DROP POLICY IF EXISTS marketing_private_delete ON storage.objects;
DROP POLICY IF EXISTS marketing_public_insert ON storage.objects;
DROP POLICY IF EXISTS marketing_public_delete ON storage.objects;
DROP POLICY IF EXISTS marketing_public_select_om ON storage.objects;
DROP FUNCTION IF EXISTS public.archive_marketing_asset(uuid,text);
DROP FUNCTION IF EXISTS public.unpublish_marketing_asset(uuid,text);
DROP FUNCTION IF EXISTS public.confirm_publish_marketing_asset(uuid);
DROP FUNCTION IF EXISTS public.request_publish_marketing_asset(uuid);
DROP FUNCTION IF EXISTS public.confirm_marketing_upload(uuid,integer,integer,numeric);
DROP FUNCTION IF EXISTS public._mime_matches_extension(text,text);
DROP FUNCTION IF EXISTS public.register_marketing_asset(uuid,text,text,text,bigint);
DROP FUNCTION IF EXISTS public._lock_marketing_asset(uuid);
DROP FUNCTION IF EXISTS public._log_media_publication(uuid,text,text,text,text);
DROP FUNCTION IF EXISTS public.can_delete_marketing_object(text,text);
DROP FUNCTION IF EXISTS public.can_read_marketing_private(text);
DROP FUNCTION IF EXISTS public.can_write_marketing_object(text,text);
DROP TABLE IF EXISTS public.marketing_media_publication_log;
DROP TABLE IF EXISTS public.marketing_media_assets;
DROP FUNCTION IF EXISTS public.marketing_path_tenant(text);
DROP FUNCTION IF EXISTS public.is_valid_marketing_path(text,text);
DELETE FROM storage.buckets WHERE id IN ('marketing','marketing-public');
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261006000300';
