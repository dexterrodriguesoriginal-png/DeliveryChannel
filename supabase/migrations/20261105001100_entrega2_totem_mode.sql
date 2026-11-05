-- Entrega 2 E2: Modo totem / kiosk no cardápio da mesa
-- Configuração do dono: ativação do modo totem e tempo de inatividade (30 a 300 segundos, padrão 60)
BEGIN;

CREATE OR REPLACE FUNCTION public._menu_theme_default() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT '{"background":"#FFF8F0","surface":"#FFFFFF","text":"#241B16","accent":"#C2410C","accentText":"#FFFFFF","categoryActiveBg":"#C2410C","fontFamily":"Inter","radius":20,"layout":"comfortable","totemMode":false,"totemIdleTimeout":60}'::jsonb;
$$;

CREATE OR REPLACE FUNCTION public._menu_theme_valid(p_theme jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text;
BEGIN
 IF p_theme IS NULL OR jsonb_typeof(p_theme)<>'object' OR pg_column_size(p_theme)>2048 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_theme) AS keys(key) WHERE key<>ALL(ARRAY['background','surface','text','accent','accentText','categoryActiveBg','fontFamily','radius','layout','totemMode','totemIdleTimeout'])) THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['background','surface','text','accent','accentText','categoryActiveBg'] LOOP
  IF jsonb_typeof(p_theme->k) IS DISTINCT FROM 'string' OR (p_theme->>k)!~'^#[0-9a-fA-F]{6}$' THEN RETURN false; END IF;
 END LOOP;
 IF jsonb_typeof(p_theme->'fontFamily') IS DISTINCT FROM 'string' OR (p_theme->>'fontFamily')<>ALL(ARRAY['Inter','Poppins','Montserrat','Roboto','Playfair Display','Outfit','Plus Jakarta Sans']) THEN RETURN false; END IF;
 IF jsonb_typeof(p_theme->'radius') IS DISTINCT FROM 'number' OR (p_theme->>'radius')!~'^[0-9]{1,2}$' THEN RETURN false; END IF;
 IF (p_theme->>'radius')::integer NOT BETWEEN 0 AND 32 THEN RETURN false; END IF;
 IF jsonb_typeof(p_theme->'layout') IS DISTINCT FROM 'string' OR (p_theme->>'layout')<>ALL(ARRAY['comfortable','compact']) THEN RETURN false; END IF;
 IF p_theme ? 'totemMode' AND jsonb_typeof(p_theme->'totemMode') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 IF p_theme ? 'totemIdleTimeout' THEN
  IF jsonb_typeof(p_theme->'totemIdleTimeout') IS DISTINCT FROM 'number' OR (p_theme->>'totemIdleTimeout')!~'^[0-9]{2,3}$' THEN RETURN false; END IF;
  IF (p_theme->>'totemIdleTimeout')::integer NOT BETWEEN 30 AND 300 THEN RETURN false; END IF;
 END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public._menu_theme_public(p_theme jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN public._menu_theme_valid(p_theme) THEN jsonb_build_object(
  'background',p_theme->'background','surface',p_theme->'surface','text',p_theme->'text',
  'accent',p_theme->'accent','accentText',p_theme->'accentText','categoryActiveBg',p_theme->'categoryActiveBg',
  'fontFamily',p_theme->'fontFamily','radius',p_theme->'radius','layout',p_theme->'layout',
  'totemMode',COALESCE((p_theme->>'totemMode')::boolean,false),
  'totemIdleTimeout',COALESCE((p_theme->>'totemIdleTimeout')::integer,60))
 ELSE public._menu_theme_default() END;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
