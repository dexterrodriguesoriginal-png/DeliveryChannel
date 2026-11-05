-- Entrega 2 E2: modo totem do cardápio (tela cheia + retorno por inatividade).
-- Escrita somente por RPC com vínculo de OWNER/MANAGER do próprio tenant.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.get_public_store(text)') IS NULL OR
    to_regprocedure('public._menu_theme_public(jsonb)') IS NULL OR
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenant_settings' AND column_name='menu_options') OR
    to_regclass('public._entrega2_menu_options_restore') IS NOT NULL THEN
  RAISE EXCEPTION 'MENU_OPTIONS_PRECHECK: baseline incompatível ou migração já aplicada.';
 END IF;
END $$;

CREATE TABLE public._entrega2_menu_options_restore(signature text PRIMARY KEY,definition text NOT NULL,acl jsonb NOT NULL);
ALTER TABLE public._entrega2_menu_options_restore ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._entrega2_menu_options_restore FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public._entrega2_menu_options_restore
SELECT p.oid::regprocedure::text,pg_catalog.pg_get_functiondef(p.oid),
 COALESCE((SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
  'privilege',a.privilege_type,'grantable',a.is_grantable)) FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb)
FROM pg_catalog.pg_proc p WHERE p.oid='public.get_public_store(text)'::regprocedure;

CREATE FUNCTION public._menu_options_default() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT '{"totemMode":false,"idleSeconds":60}'::jsonb;
$$;

CREATE FUNCTION public._menu_options_valid(p_options jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_options IS NULL OR jsonb_typeof(p_options)<>'object' OR pg_column_size(p_options)>512 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_options) AS keys(key) WHERE key<>ALL(ARRAY['totemMode','idleSeconds'])) THEN RETURN false; END IF;
 IF jsonb_typeof(p_options->'totemMode') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 IF jsonb_typeof(p_options->'idleSeconds') IS DISTINCT FROM 'number' OR (p_options->>'idleSeconds')!~'^[0-9]{2,3}$' THEN RETURN false; END IF;
 IF (p_options->>'idleSeconds')::integer NOT BETWEEN 30 AND 300 THEN RETURN false; END IF;
 RETURN true;
END $$;

-- Projeção explícita: um JSON alterado fora da aplicação não publica campos adicionais.
CREATE FUNCTION public._menu_options_public(p_options jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN public._menu_options_valid(p_options) THEN jsonb_build_object(
  'totemMode',p_options->'totemMode','idleSeconds',p_options->'idleSeconds')
 ELSE public._menu_options_default() END;
$$;

ALTER TABLE public.tenant_settings ADD COLUMN menu_options jsonb NOT NULL DEFAULT '{"totemMode":false,"idleSeconds":60}'::jsonb;
ALTER TABLE public.tenant_settings ADD CONSTRAINT tenant_settings_menu_options_valid CHECK(public._menu_options_valid(menu_options));
COMMENT ON COLUMN public.tenant_settings.menu_options IS 'Opções do cardápio da mesa (modo totem); somente dono/gerente do tenant altera.';

CREATE FUNCTION public._menu_options_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.menu_options IS DISTINCT FROM public._menu_options_default()) OR
    (TG_OP='UPDATE' AND NEW.menu_options IS DISTINCT FROM OLD.menu_options) THEN
  IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(NEW.tenant_id),'') NOT IN('OWNER','MANAGER') THEN
   RAISE EXCEPTION 'FORBIDDEN: somente dono ou gerente da loja altera o modo totem.' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER menu_options_write_guard BEFORE INSERT OR UPDATE ON public.tenant_settings
 FOR EACH ROW EXECUTE FUNCTION public._menu_options_write_guard();

CREATE FUNCTION public.get_menu_options(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(p_tenant),'') NOT IN('OWNER','MANAGER') THEN
  RAISE EXCEPTION 'FORBIDDEN: opções do cardápio indisponíveis.' USING ERRCODE='42501';
 END IF;
 RETURN COALESCE((SELECT public._menu_options_public(s.menu_options) FROM public.tenant_settings s WHERE s.tenant_id=p_tenant),public._menu_options_default());
END $$;

CREATE FUNCTION public.set_menu_options(p_tenant uuid,p_options jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(p_tenant),'') NOT IN('OWNER','MANAGER') THEN
  RAISE EXCEPTION 'FORBIDDEN: somente dono ou gerente da loja altera o modo totem.' USING ERRCODE='42501';
 END IF;
 IF NOT public._menu_options_valid(p_options) THEN
  RAISE EXCEPTION 'INVALID_MENU_OPTIONS: confira o modo totem e o tempo de inatividade (30 a 300 s).' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.tenant_settings(tenant_id,menu_options,address,phone_whatsapp) VALUES(p_tenant,p_options,'','')
 ON CONFLICT(tenant_id) DO UPDATE SET menu_options=EXCLUDED.menu_options;
 RETURN public._menu_options_public(p_options);
END $$;

-- Ancoragem verificada: preserva o restante da RPC pública, inclusive isolamento por tenant.
DO $$ DECLARE source text; anchor text := '''menuTheme'', public._menu_theme_public((SELECT s.menu_theme FROM public.tenant_settings s WHERE s.tenant_id=v_tenant.id)),'; patched text;
BEGIN
 SELECT pg_catalog.pg_get_functiondef('public.get_public_store(text)'::regprocedure) INTO source;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 OR
    position('''menuOptions''' IN source)>0 THEN
  RAISE EXCEPTION 'MENU_OPTIONS_PATCH_MISMATCH: get_public_store divergente; nenhuma alteração aplicada.';
 END IF;
 patched:=replace(source,anchor,anchor||E'\n        ''menuOptions'', public._menu_options_public((SELECT s.menu_options FROM public.tenant_settings s WHERE s.tenant_id=v_tenant.id)),');
 EXECUTE patched;
END $$;

REVOKE ALL ON FUNCTION public._menu_options_default(),public._menu_options_valid(jsonb),public._menu_options_public(jsonb),public._menu_options_write_guard(),public.get_menu_options(uuid),public.set_menu_options(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_menu_options(uuid),public.set_menu_options(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public._menu_options_valid(jsonb) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
