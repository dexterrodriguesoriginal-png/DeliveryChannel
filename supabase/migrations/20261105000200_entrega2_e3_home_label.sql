-- Entrega 2 E3: rótulo editável do bloco "Cardápio" da tela inicial do QR.
-- Reaproveita tenant_settings.menu_options (E2): mesma RLS/guard (OWNER/MANAGER do próprio tenant).
-- homeLabel é opcional no JSON armazenado (linhas anteriores seguem válidas); a projeção pública
-- sempre devolve um rótulo (padrão "Cardápio").
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public._menu_options_valid(jsonb)') IS NULL OR
    position('homeLabel' IN pg_catalog.pg_get_functiondef('public._menu_options_valid(jsonb)'::regprocedure))>0 THEN
  RAISE EXCEPTION 'HOME_LABEL_PRECHECK: baseline E2 ausente ou migração já aplicada.';
 END IF;
END $$;

CREATE FUNCTION public._menu_home_label_valid(p_label text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_label IS NOT NULL
  AND char_length(p_label) BETWEEN 1 AND 24
  AND p_label=btrim(p_label)
  AND p_label !~ '[<>]'
  AND p_label !~ '&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);'
  AND p_label !~ '[[:cntrl:]]'
  AND p_label !~ '[[:space:]]{2,}';
$$;

CREATE OR REPLACE FUNCTION public._menu_options_valid(p_options jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_options IS NULL OR jsonb_typeof(p_options)<>'object' OR pg_column_size(p_options)>512 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_options) AS keys(key) WHERE key<>ALL(ARRAY['totemMode','idleSeconds','homeLabel'])) THEN RETURN false; END IF;
 IF jsonb_typeof(p_options->'totemMode') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 IF jsonb_typeof(p_options->'idleSeconds') IS DISTINCT FROM 'number' OR (p_options->>'idleSeconds')!~'^[0-9]{2,3}$' THEN RETURN false; END IF;
 IF (p_options->>'idleSeconds')::integer NOT BETWEEN 30 AND 300 THEN RETURN false; END IF;
 IF p_options ? 'homeLabel' AND (jsonb_typeof(p_options->'homeLabel') IS DISTINCT FROM 'string' OR NOT public._menu_home_label_valid(p_options->>'homeLabel')) THEN RETURN false; END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public._menu_options_public(p_options jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN public._menu_options_valid(p_options) THEN jsonb_build_object(
  'totemMode',p_options->'totemMode','idleSeconds',p_options->'idleSeconds',
  'homeLabel',COALESCE(p_options->'homeLabel',to_jsonb('Cardápio'::text)))
 ELSE public._menu_options_default()||jsonb_build_object('homeLabel','Cardápio') END;
$$;

REVOKE ALL ON FUNCTION public._menu_home_label_valid(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._menu_home_label_valid(text) TO authenticated,service_role;
-- CREATE OR REPLACE preserva os GRANTs de _menu_options_valid/_public.
NOTIFY pgrst,'reload schema';
COMMIT;
