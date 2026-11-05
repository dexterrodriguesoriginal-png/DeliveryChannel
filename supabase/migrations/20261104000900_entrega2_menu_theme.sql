-- Entrega 2 C: visual público do cardápio, independente do Design do App.
-- Escrita somente por RPC com vínculo ACTIVE de OWNER/MANAGER do próprio tenant.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.get_public_store(text)') IS NULL OR
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenant_settings' AND column_name='menu_theme') OR
    to_regclass('public._entrega2_menu_theme_restore') IS NOT NULL THEN
  RAISE EXCEPTION 'MENU_THEME_PRECHECK: baseline incompatível ou migração já aplicada.';
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public._entrega2_menu_theme_restore(signature text PRIMARY KEY,definition text NOT NULL,acl jsonb NOT NULL);
ALTER TABLE public._entrega2_menu_theme_restore ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._entrega2_menu_theme_restore FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public._entrega2_menu_theme_restore
SELECT p.oid::regprocedure::text,pg_catalog.pg_get_functiondef(p.oid),
 COALESCE((SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
  'privilege',a.privilege_type,'grantable',a.is_grantable)) FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb)
FROM pg_catalog.pg_proc p WHERE p.oid='public.get_public_store(text)'::regprocedure;

CREATE FUNCTION public._menu_theme_default() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT '{"background":"#FFF8F0","surface":"#FFFFFF","text":"#241B16","accent":"#C2410C","accentText":"#FFFFFF","categoryActiveBg":"#C2410C","fontFamily":"Inter","radius":20,"layout":"comfortable"}'::jsonb;
$$;

CREATE FUNCTION public._menu_theme_valid(p_theme jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text;
BEGIN
 IF p_theme IS NULL OR jsonb_typeof(p_theme)<>'object' OR pg_column_size(p_theme)>2048 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_theme) AS keys(key) WHERE key<>ALL(ARRAY['background','surface','text','accent','accentText','categoryActiveBg','fontFamily','radius','layout'])) THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['background','surface','text','accent','accentText','categoryActiveBg'] LOOP
  IF jsonb_typeof(p_theme->k) IS DISTINCT FROM 'string' OR (p_theme->>k)!~'^#[0-9a-fA-F]{6}$' THEN RETURN false; END IF;
 END LOOP;
 IF jsonb_typeof(p_theme->'fontFamily') IS DISTINCT FROM 'string' OR (p_theme->>'fontFamily')<>ALL(ARRAY['Inter','Poppins','Montserrat','Roboto','Playfair Display','Outfit','Plus Jakarta Sans']) THEN RETURN false; END IF;
 IF jsonb_typeof(p_theme->'radius') IS DISTINCT FROM 'number' OR (p_theme->>'radius')!~'^[0-9]{1,2}$' THEN RETURN false; END IF;
 IF (p_theme->>'radius')::integer NOT BETWEEN 0 AND 32 THEN RETURN false; END IF;
 IF jsonb_typeof(p_theme->'layout') IS DISTINCT FROM 'string' OR (p_theme->>'layout')<>ALL(ARRAY['comfortable','compact']) THEN RETURN false; END IF;
 RETURN true;
END $$;

-- Projeção explícita: mesmo um JSON alterado fora da aplicação não publica campos adicionais.
CREATE FUNCTION public._menu_theme_public(p_theme jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN public._menu_theme_valid(p_theme) THEN jsonb_build_object(
  'background',p_theme->'background','surface',p_theme->'surface','text',p_theme->'text',
  'accent',p_theme->'accent','accentText',p_theme->'accentText','categoryActiveBg',p_theme->'categoryActiveBg',
  'fontFamily',p_theme->'fontFamily','radius',p_theme->'radius','layout',p_theme->'layout')
 ELSE public._menu_theme_default() END;
$$;

ALTER TABLE public.tenant_settings ADD COLUMN IF NOT EXISTS menu_theme jsonb NOT NULL
 DEFAULT '{"background":"#FFF8F0","surface":"#FFFFFF","text":"#241B16","accent":"#C2410C","accentText":"#FFFFFF","categoryActiveBg":"#C2410C","fontFamily":"Inter","radius":20,"layout":"comfortable"}'::jsonb;
ALTER TABLE public.tenant_settings ADD CONSTRAINT tenant_settings_menu_theme_valid CHECK(public._menu_theme_valid(menu_theme));
COMMENT ON COLUMN public.tenant_settings.menu_theme IS 'Design do Cardápio: somente tokens públicos, separado de tenant_themes/theme_tokens.';

CREATE FUNCTION public._menu_theme_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.menu_theme IS DISTINCT FROM public._menu_theme_default()) OR
    (TG_OP='UPDATE' AND (NEW.menu_theme IS DISTINCT FROM OLD.menu_theme OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id)) THEN
  IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(NEW.tenant_id),'') NOT IN('OWNER','MANAGER') OR
     (TG_OP='UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
   RAISE EXCEPTION 'FORBIDDEN: somente dono ou gerente da loja altera o Design do Cardápio.' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER menu_theme_write_guard BEFORE INSERT OR UPDATE ON public.tenant_settings
 FOR EACH ROW EXECUTE FUNCTION public._menu_theme_write_guard();

CREATE FUNCTION public.get_menu_theme(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(p_tenant),'') NOT IN('OWNER','MANAGER') THEN
  RAISE EXCEPTION 'FORBIDDEN: Design do Cardápio indisponível.' USING ERRCODE='42501';
 END IF;
 RETURN COALESCE((SELECT public._menu_theme_public(s.menu_theme) FROM public.tenant_settings s WHERE s.tenant_id=p_tenant),public._menu_theme_default());
END $$;

CREATE FUNCTION public.set_menu_theme(p_tenant uuid,p_theme jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(p_tenant),'') NOT IN('OWNER','MANAGER') THEN
  RAISE EXCEPTION 'FORBIDDEN: somente dono ou gerente da loja altera o Design do Cardápio.' USING ERRCODE='42501';
 END IF;
 IF NOT public._menu_theme_valid(p_theme) THEN
  RAISE EXCEPTION 'INVALID_MENU_THEME: confira as cores, a fonte e o formato do cardápio.' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.tenant_settings(tenant_id,menu_theme,address,phone_whatsapp) VALUES(p_tenant,p_theme,'','')
 ON CONFLICT(tenant_id) DO UPDATE SET menu_theme=EXCLUDED.menu_theme;
 RETURN public._menu_theme_public(p_theme);
END $$;

-- Ancoragem verificada: preserva o restante da RPC, inclusive isolamento e projeção N6.
DO $$ DECLARE source text; anchor text := '''theme'', to_jsonb(v_theme),'; patched text;
BEGIN
 SELECT pg_catalog.pg_get_functiondef('public.get_public_store(text)'::regprocedure) INTO source;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 OR
    position('''menuTheme''' IN source)>0 THEN
  RAISE EXCEPTION 'MENU_THEME_PATCH_MISMATCH: get_public_store divergente; nenhuma alteração aplicada.';
 END IF;
 patched:=replace(source,anchor,anchor||E'\n        ''menuTheme'', public._menu_theme_public((SELECT s.menu_theme FROM public.tenant_settings s WHERE s.tenant_id=v_tenant.id)),');
 EXECUTE patched;
END $$;

REVOKE ALL ON FUNCTION public._menu_theme_default(),public._menu_theme_valid(jsonb),public._menu_theme_public(jsonb),public._menu_theme_write_guard(),public.get_menu_theme(uuid),public.set_menu_theme(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_menu_theme(uuid),public.set_menu_theme(uuid,jsonb) TO authenticated;
-- CHECK também é avaliado nas alterações das configurações antigas permitidas por coluna.
-- O backend mantém as escritas operacionais existentes; o trigger exige membership
-- autenticado para personalizar menu_theme mesmo com BYPASSRLS.
GRANT EXECUTE ON FUNCTION public._menu_theme_valid(jsonb) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
