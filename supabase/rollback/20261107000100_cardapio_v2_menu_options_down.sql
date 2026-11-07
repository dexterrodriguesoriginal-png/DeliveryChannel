-- Rollback da extensão v2 de menu_options; preserva dados e volta às validações anteriores.
-- Antes do rollback, NORMALIZAR menu_options dos estabelecimentos para remover as 3 novas chaves.
-- Sem isso, este rollback falha, de forma segura, por CHECK existente.
BEGIN;
-- Rollback executado pelo dono do schema; desabilita apenas o guard de opções durante a limpeza.
ALTER TABLE public.tenant_settings DISABLE TRIGGER menu_options_write_guard;
UPDATE public.tenant_settings
SET menu_options=menu_options-'serviceMode'-'productColumns'-'reuseAppBanners'
WHERE menu_options ?| ARRAY['serviceMode','productColumns','reuseAppBanners'];
ALTER TABLE public.tenant_settings ENABLE TRIGGER menu_options_write_guard;
CREATE OR REPLACE FUNCTION public._menu_options_valid(p_options jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $body$
BEGIN
 IF p_options IS NULL OR jsonb_typeof(p_options)<>'object' OR pg_column_size(p_options)>512 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_options) AS keys(key) WHERE key<>ALL(ARRAY['totemMode','idleSeconds','homeLabel'])) THEN RETURN false; END IF;
 IF jsonb_typeof(p_options->'totemMode') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 IF jsonb_typeof(p_options->'idleSeconds') IS DISTINCT FROM 'number' OR (p_options->>'idleSeconds')!~'^[0-9]{2,3}$' THEN RETURN false; END IF;
 IF (p_options->>'idleSeconds')::integer NOT BETWEEN 30 AND 300 THEN RETURN false; END IF;
 IF p_options ? 'homeLabel' AND (jsonb_typeof(p_options->'homeLabel') IS DISTINCT FROM 'string' OR NOT public._menu_home_label_valid(p_options->>'homeLabel')) THEN RETURN false; END IF;
 RETURN true;
END $body$;
CREATE OR REPLACE FUNCTION public._menu_options_public(p_options jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $body$
 SELECT CASE WHEN public._menu_options_valid(p_options) THEN jsonb_build_object(
  'totemMode',p_options->'totemMode','idleSeconds',p_options->'idleSeconds',
  'homeLabel',COALESCE(p_options->'homeLabel',to_jsonb('Cardápio'::text)))
 ELSE public._menu_options_default()||jsonb_build_object('homeLabel','Cardápio') END;
$body$;
NOTIFY pgrst,'reload schema';
COMMIT;
