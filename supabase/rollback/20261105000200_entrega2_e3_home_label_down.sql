-- Reversão exata (corpo E2) somente enquanto nenhum rótulo foi personalizado.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.tenant_settings WHERE menu_options ? 'homeLabel') THEN
  RAISE EXCEPTION 'ROLLBACK_BLOCKED: preserve os rótulos personalizados do cardápio antes de reverter.';
 END IF;
END $$;

-- A constraint chama _menu_options_valid; o corpo E2 não conhece homeLabel (nenhuma linha o possui).
CREATE OR REPLACE FUNCTION public._menu_options_valid(p_options jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_options IS NULL OR jsonb_typeof(p_options)<>'object' OR pg_column_size(p_options)>512 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_options) AS keys(key) WHERE key<>ALL(ARRAY['totemMode','idleSeconds'])) THEN RETURN false; END IF;
 IF jsonb_typeof(p_options->'totemMode') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 IF jsonb_typeof(p_options->'idleSeconds') IS DISTINCT FROM 'number' OR (p_options->>'idleSeconds')!~'^[0-9]{2,3}$' THEN RETURN false; END IF;
 IF (p_options->>'idleSeconds')::integer NOT BETWEEN 30 AND 300 THEN RETURN false; END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public._menu_options_public(p_options jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN public._menu_options_valid(p_options) THEN jsonb_build_object(
  'totemMode',p_options->'totemMode','idleSeconds',p_options->'idleSeconds')
 ELSE public._menu_options_default() END;
$$;
DROP FUNCTION public._menu_home_label_valid(text);
NOTIFY pgrst,'reload schema';
COMMIT;
