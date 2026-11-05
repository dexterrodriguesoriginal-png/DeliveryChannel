-- Reversão de 20261105000400_store_home_design.
-- Recusa se houver design publicado ou rascunho não-vazio (preserva dados).
BEGIN;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.store_home_designs
    WHERE published IS NOT NULL OR draft <> '{}'::jsonb
  ) THEN
    RAISE EXCEPTION 'STORE_HOME_ROLLBACK_HAS_DATA: existem designs da tela inicial; reversão recusada para preservar os dados.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.store_home_get_published(text);
DROP FUNCTION IF EXISTS public.store_home_publish(uuid, integer);
DROP FUNCTION IF EXISTS public.store_home_save_draft(uuid, jsonb, integer);
DROP FUNCTION IF EXISTS public.store_home_get_private(uuid);
DROP FUNCTION IF EXISTS public.store_home_can_edit(uuid);
DROP FUNCTION IF EXISTS public._store_home_design_public(jsonb);
DROP FUNCTION IF EXISTS public._store_home_design_valid(jsonb);
DROP FUNCTION IF EXISTS public._store_home_https_url(text);
DROP TABLE IF EXISTS public.store_home_designs;

NOTIFY pgrst, 'reload schema';
COMMIT;
