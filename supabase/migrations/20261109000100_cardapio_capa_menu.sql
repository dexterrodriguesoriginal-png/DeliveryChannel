-- Cardápio: capa da loja (estilo Facebook/YouTube) e modo do menu de categorias.
-- Aditivo: duas colunas novas em tenant_settings, RPCs dedicadas, sem patch em get_public_store.
-- Escrita somente por OWNER/MANAGER do próprio tenant (RPC + trigger guard, igual menu_theme/menu_options).
-- Capa: somente URL pública HTTPS do bucket marketing-public dentro da pasta do próprio tenant.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public._tenant_role_of_caller(uuid)') IS NULL OR
    to_regprocedure('public._store_home_https_url(text)') IS NULL OR
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenant_settings'
           AND column_name IN ('menu_cover_url','menu_category_mode')) THEN
  RAISE EXCEPTION 'MENU_COVER_PRECHECK: baseline incompatível ou migração já aplicada.';
 END IF;
END $$;

CREATE FUNCTION public._menu_cover_url_valid(p_tenant uuid, p_url text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_url IS NULL OR (
   public._store_home_https_url(p_url)
   AND pg_catalog.length(p_url) BETWEEN 1 AND 1024
   AND position(('/storage/v1/object/public/marketing-public/' || p_tenant::text || '/') IN p_url) > 0
 );
$$;

ALTER TABLE public.tenant_settings ADD COLUMN menu_cover_url text;
ALTER TABLE public.tenant_settings ADD COLUMN menu_category_mode text NOT NULL DEFAULT 'ICON';
ALTER TABLE public.tenant_settings ADD CONSTRAINT tenant_settings_menu_category_mode_valid
 CHECK (menu_category_mode IN ('ICON','IMAGE'));
ALTER TABLE public.tenant_settings ADD CONSTRAINT tenant_settings_menu_cover_url_valid
 CHECK (public._menu_cover_url_valid(tenant_id, menu_cover_url));
COMMENT ON COLUMN public.tenant_settings.menu_cover_url IS 'Capa do cardápio (1600x500, marketing-public do próprio tenant). NULL = cabeçalho padrão.';
COMMENT ON COLUMN public.tenant_settings.menu_category_mode IS 'Menu lateral do cardápio: ICON (ícone padrão) ou IMAGE (imagem própria da categoria).';

CREATE FUNCTION public._menu_cover_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (TG_OP='INSERT' AND (NEW.menu_cover_url IS NOT NULL OR NEW.menu_category_mode IS DISTINCT FROM 'ICON')) OR
    (TG_OP='UPDATE' AND (NEW.menu_cover_url IS DISTINCT FROM OLD.menu_cover_url
                         OR NEW.menu_category_mode IS DISTINCT FROM OLD.menu_category_mode)) THEN
  IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(NEW.tenant_id),'') NOT IN('OWNER','MANAGER') THEN
   RAISE EXCEPTION 'FORBIDDEN: somente dono ou gerente da loja altera a capa do cardápio.' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER menu_cover_write_guard BEFORE INSERT OR UPDATE ON public.tenant_settings
 FOR EACH ROW EXECUTE FUNCTION public._menu_cover_write_guard();

CREATE FUNCTION public.get_menu_header(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(p_tenant),'') NOT IN('OWNER','MANAGER') THEN
  RAISE EXCEPTION 'FORBIDDEN: capa do cardápio indisponível.' USING ERRCODE='42501';
 END IF;
 RETURN COALESCE(
  (SELECT jsonb_build_object('coverUrl', s.menu_cover_url, 'categoryMenuMode', s.menu_category_mode)
   FROM public.tenant_settings s WHERE s.tenant_id=p_tenant),
  jsonb_build_object('coverUrl', NULL, 'categoryMenuMode', 'ICON'));
END $$;

CREATE FUNCTION public.set_menu_header(p_tenant uuid, p_cover_url text, p_category_mode text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_url text := NULLIF(pg_catalog.btrim(COALESCE(p_cover_url,'')),'');
BEGIN
 IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(p_tenant),'') NOT IN('OWNER','MANAGER') THEN
  RAISE EXCEPTION 'FORBIDDEN: somente dono ou gerente da loja altera a capa do cardápio.' USING ERRCODE='42501';
 END IF;
 IF p_category_mode IS NULL OR p_category_mode NOT IN ('ICON','IMAGE') THEN
  RAISE EXCEPTION 'INVALID_MENU_HEADER: escolha ícone padrão ou imagem própria.' USING ERRCODE='22023';
 END IF;
 IF NOT public._menu_cover_url_valid(p_tenant, v_url) THEN
  RAISE EXCEPTION 'INVALID_MENU_HEADER: envie a capa novamente pelo painel.' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.tenant_settings(tenant_id, menu_cover_url, menu_category_mode, address, phone_whatsapp)
 VALUES (p_tenant, v_url, p_category_mode, '', '')
 ON CONFLICT (tenant_id) DO UPDATE SET menu_cover_url=EXCLUDED.menu_cover_url, menu_category_mode=EXCLUDED.menu_category_mode;
 RETURN jsonb_build_object('coverUrl', v_url, 'categoryMenuMode', p_category_mode);
END $$;

-- Público: somente loja ACTIVE, somente os dois campos visuais. Sem PII.
CREATE FUNCTION public.get_public_menu_header(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
   'coverUrl', CASE WHEN public._menu_cover_url_valid(t.id, s.menu_cover_url) THEN s.menu_cover_url END,
   'categoryMenuMode', COALESCE(s.menu_category_mode, 'ICON'))
 FROM public.tenants t
 LEFT JOIN public.tenant_settings s ON s.tenant_id = t.id
 WHERE t.slug = lower(pg_catalog.btrim(p_slug)) AND t.status = 'ACTIVE'
 LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public._menu_cover_url_valid(uuid,text), public._menu_cover_write_guard(),
 public.get_menu_header(uuid), public.set_menu_header(uuid,text,text), public.get_public_menu_header(text)
 FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._menu_cover_url_valid(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_menu_header(uuid), public.set_menu_header(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_menu_header(text) TO anon, authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
