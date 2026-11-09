-- Totem do salão: tela de boas-vindas (capa) antes do cardápio.
-- Aditivo: uma coluna jsonb nova em tenant_settings + RPCs dedicadas. Sem patch em get_public_store.
-- Escrita somente por OWNER/MANAGER do próprio tenant (RPC + trigger guard, mesmo padrão de menu_cover_url).
-- Mídias: somente URLs HTTPS do bucket marketing-public na pasta do próprio tenant (reaproveita
-- public._menu_cover_url_valid da migração 20261109000100). Leitura pública só dos campos visuais.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public._tenant_role_of_caller(uuid)') IS NULL OR
    to_regprocedure('public._menu_cover_url_valid(uuid,text)') IS NULL OR
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenant_settings'
           AND column_name='totem_welcome') THEN
  RAISE EXCEPTION 'TOTEM_WELCOME_PRECHECK: baseline incompatível (aplique 20261109000100 antes) ou migração já aplicada.';
 END IF;
END $$;

CREATE FUNCTION public._totem_welcome_default() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT '{"slides":[],"imageSeconds":6,"buttonText":"Toque para começar","buttonStyle":"BAR","buttonBg":null,"buttonFg":null,"idleSeconds":90}'::jsonb;
$$;

-- Validação: chaves conhecidas, até 12 mídias da própria loja, textos curtos sem HTML, cores #RRGGBB ou null.
CREATE FUNCTION public._totem_welcome_valid(p_tenant uuid, p_cfg jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE s jsonb; k text;
BEGIN
 IF p_cfg IS NULL OR jsonb_typeof(p_cfg)<>'object' OR pg_catalog.length(p_cfg::text)>20000 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_cfg) AS keys(key)
   WHERE key<>ALL(ARRAY['slides','imageSeconds','buttonText','buttonStyle','buttonBg','buttonFg','idleSeconds'])) THEN RETURN false; END IF;
 IF jsonb_typeof(p_cfg->'slides') IS DISTINCT FROM 'array' OR jsonb_array_length(p_cfg->'slides')>12 THEN RETURN false; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_cfg->'slides') LOOP
  IF jsonb_typeof(s)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(s) AS keys(key) WHERE key<>ALL(ARRAY['url','kind'])) THEN RETURN false; END IF;
  IF jsonb_typeof(s->'url') IS DISTINCT FROM 'string' OR (s->>'url')='' OR NOT public._menu_cover_url_valid(p_tenant, s->>'url') THEN RETURN false; END IF;
  IF (s->>'kind') IS NULL OR (s->>'kind')<>ALL(ARRAY['IMAGE','VIDEO']) THEN RETURN false; END IF;
 END LOOP;
 IF jsonb_typeof(p_cfg->'imageSeconds') IS DISTINCT FROM 'number' OR (p_cfg->>'imageSeconds')!~'^[0-9]{1,3}$'
    OR (p_cfg->>'imageSeconds')::integer NOT BETWEEN 2 AND 120 THEN RETURN false; END IF;
 IF jsonb_typeof(p_cfg->'idleSeconds') IS DISTINCT FROM 'number' OR (p_cfg->>'idleSeconds')!~'^[0-9]{2,3}$'
    OR (p_cfg->>'idleSeconds')::integer NOT BETWEEN 30 AND 300 THEN RETURN false; END IF;
 IF jsonb_typeof(p_cfg->'buttonText') IS DISTINCT FROM 'string' OR char_length(p_cfg->>'buttonText') NOT BETWEEN 1 AND 32
    OR (p_cfg->>'buttonText')<>btrim(p_cfg->>'buttonText') OR (p_cfg->>'buttonText')~'[<>]' OR (p_cfg->>'buttonText')~'[[:cntrl:]]' THEN RETURN false; END IF;
 IF jsonb_typeof(p_cfg->'buttonStyle') IS DISTINCT FROM 'string' OR (p_cfg->>'buttonStyle')<>ALL(ARRAY['BAR','PILL','OUTLINE']) THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['buttonBg','buttonFg'] LOOP
  IF NOT (p_cfg ? k) THEN RETURN false; END IF;
  IF jsonb_typeof(p_cfg->k)<>'null' AND (jsonb_typeof(p_cfg->k)<>'string' OR (p_cfg->>k)!~'^#[0-9a-fA-F]{6}$') THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

ALTER TABLE public.tenant_settings ADD COLUMN totem_welcome jsonb;
ALTER TABLE public.tenant_settings ADD CONSTRAINT tenant_settings_totem_welcome_valid
 CHECK (totem_welcome IS NULL OR public._totem_welcome_valid(tenant_id, totem_welcome));
COMMENT ON COLUMN public.tenant_settings.totem_welcome IS 'Totem do salão: capa (mídias marketing-public do tenant, segundos por imagem, texto/estilo/cores do botão, inatividade). NULL = padrão.';

CREATE FUNCTION public._totem_welcome_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.totem_welcome IS NOT NULL) OR
    (TG_OP='UPDATE' AND NEW.totem_welcome IS DISTINCT FROM OLD.totem_welcome) THEN
  IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(NEW.tenant_id),'') NOT IN('OWNER','MANAGER') THEN
   RAISE EXCEPTION 'FORBIDDEN: somente dono ou gerente da loja altera a capa do totem.' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER totem_welcome_write_guard BEFORE INSERT OR UPDATE ON public.tenant_settings
 FOR EACH ROW EXECUTE FUNCTION public._totem_welcome_write_guard();

CREATE FUNCTION public.get_totem_welcome(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(p_tenant),'') NOT IN('OWNER','MANAGER') THEN
  RAISE EXCEPTION 'FORBIDDEN: capa do totem indisponível.' USING ERRCODE='42501';
 END IF;
 RETURN COALESCE((SELECT s.totem_welcome FROM public.tenant_settings s WHERE s.tenant_id=p_tenant), public._totem_welcome_default());
END $$;

CREATE FUNCTION public.set_totem_welcome(p_tenant uuid, p_cfg jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(p_tenant),'') NOT IN('OWNER','MANAGER') THEN
  RAISE EXCEPTION 'FORBIDDEN: somente dono ou gerente da loja altera a capa do totem.' USING ERRCODE='42501';
 END IF;
 IF NOT public._totem_welcome_valid(p_tenant, p_cfg) THEN
  RAISE EXCEPTION 'INVALID_TOTEM_WELCOME: confira as mídias, os tempos, o texto e as cores do botão.' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.tenant_settings(tenant_id, totem_welcome, address, phone_whatsapp)
 VALUES (p_tenant, p_cfg, '', '')
 ON CONFLICT (tenant_id) DO UPDATE SET totem_welcome=EXCLUDED.totem_welcome;
 RETURN p_cfg;
END $$;

-- Público: somente loja ACTIVE e somente a configuração visual validada. Sem PII.
CREATE FUNCTION public.get_public_totem_welcome(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN s.totem_welcome IS NOT NULL AND public._totem_welcome_valid(t.id, s.totem_welcome)
             THEN s.totem_welcome ELSE public._totem_welcome_default() END
 FROM public.tenants t
 LEFT JOIN public.tenant_settings s ON s.tenant_id = t.id
 WHERE t.slug = lower(pg_catalog.btrim(p_slug)) AND t.status = 'ACTIVE'
 LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public._totem_welcome_default(), public._totem_welcome_valid(uuid,jsonb),
 public._totem_welcome_write_guard(), public.get_totem_welcome(uuid), public.set_totem_welcome(uuid,jsonb),
 public.get_public_totem_welcome(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._totem_welcome_valid(uuid,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_totem_welcome(uuid), public.set_totem_welcome(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_totem_welcome(text) TO anon, authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
