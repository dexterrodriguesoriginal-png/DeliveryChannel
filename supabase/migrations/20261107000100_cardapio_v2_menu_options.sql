-- Cardápio v2 — opções públicas sanitizadas, escrita apenas OWNER/MANAGER via guard/RPC existente.
-- Nenhuma permissão nova para anon ou authenticated em tabelas.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public._menu_options_valid(jsonb)') IS NULL OR
    to_regprocedure('public._menu_options_public(jsonb)') IS NULL OR
    to_regprocedure('public._menu_home_label_valid(text)') IS NULL THEN
   RAISE EXCEPTION 'CARDAPIO_V2_PRECHECK: migrations de menu anteriores ausentes';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public._menu_options_valid(p_options jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $body$
BEGIN
 IF p_options IS NULL OR jsonb_typeof(p_options)<>'object' OR pg_column_size(p_options)>512 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_options) AS keys(key)
   WHERE key<>ALL(ARRAY['totemMode','idleSeconds','homeLabel','serviceMode','productColumns','reuseAppBanners'])) THEN RETURN false; END IF;
 IF jsonb_typeof(p_options->'totemMode') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 IF jsonb_typeof(p_options->'idleSeconds') IS DISTINCT FROM 'number'
   OR (p_options->>'idleSeconds')!~'^[0-9]{2,3}$' THEN RETURN false; END IF;
 IF (p_options->>'idleSeconds')::integer NOT BETWEEN 30 AND 300 THEN RETURN false; END IF;
 IF p_options ? 'homeLabel' AND
   (jsonb_typeof(p_options->'homeLabel') IS DISTINCT FROM 'string'
   OR NOT public._menu_home_label_valid(p_options->>'homeLabel')) THEN RETURN false; END IF;
 IF p_options ? 'serviceMode' AND
   (jsonb_typeof(p_options->'serviceMode') IS DISTINCT FROM 'string'
   OR (p_options->>'serviceMode')<>ALL(ARRAY['TABLE','COUNTER','BOTH'])) THEN RETURN false; END IF;
 IF p_options ? 'productColumns' AND
   (jsonb_typeof(p_options->'productColumns') IS DISTINCT FROM 'number'
   OR (p_options->>'productColumns')!~'^[123]$') THEN RETURN false; END IF;
 IF p_options ? 'reuseAppBanners' AND jsonb_typeof(p_options->'reuseAppBanners') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 RETURN true;
END $body$;
CREATE OR REPLACE FUNCTION public._menu_options_public(p_options jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $body$
 SELECT CASE WHEN public._menu_options_valid(p_options) THEN jsonb_build_object(
  'totemMode',p_options->'totemMode','idleSeconds',p_options->'idleSeconds',
  'homeLabel',COALESCE(p_options->'homeLabel',to_jsonb('Cardápio'::text)),
  'serviceMode',COALESCE(p_options->'serviceMode',to_jsonb('TABLE'::text)),
  'productColumns',COALESCE(p_options->'productColumns',to_jsonb(3)),
  'reuseAppBanners',COALESCE(p_options->'reuseAppBanners',to_jsonb(false)))
 ELSE public._menu_options_default()||jsonb_build_object('homeLabel','Cardápio','serviceMode','TABLE','productColumns',3,'reuseAppBanners',false) END;
$body$;

COMMENT ON COLUMN public.tenant_settings.menu_options IS 'Opções de cardápio: modo mesa/balcão, 1-3 colunas, outdoor e totem; escrita só por OWNER/MANAGER.';
NOTIFY pgrst,'reload schema';
COMMIT;
