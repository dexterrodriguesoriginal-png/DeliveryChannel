-- Entrega 2.B: outdoor independente do aplicativo, usando somente mídia publicada governada.
-- Reversão: supabase/rollback/20261104000800_entrega2_menu_outdoor_down.sql.
-- Nenhuma linha existente é alterada. Desativar preserva o histórico do outdoor.
CREATE TABLE IF NOT EXISTS public.menu_outdoor_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  asset_id uuid NOT NULL,
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 120),
  product_id uuid,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_outdoor_slide_schedule CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT menu_outdoor_slide_asset_tenant FOREIGN KEY (tenant_id,asset_id) REFERENCES public.marketing_media_assets(tenant_id,id),
  CONSTRAINT menu_outdoor_slide_product_tenant FOREIGN KEY (tenant_id,product_id) REFERENCES public.products(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS menu_outdoor_slides_tenant_order_idx ON public.menu_outdoor_slides(tenant_id,sort_order,id);
ALTER TABLE public.menu_outdoor_slides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_outdoor_slides FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.menu_outdoor_slides TO authenticated;
CREATE POLICY menu_outdoor_staff_read ON public.menu_outdoor_slides FOR SELECT TO authenticated
  USING (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY menu_outdoor_staff_insert ON public.menu_outdoor_slides FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY menu_outdoor_staff_update ON public.menu_outdoor_slides FOR UPDATE TO authenticated
  USING (public.is_tenant_owner_or_manager(tenant_id)) WITH CHECK (public.is_tenant_owner_or_manager(tenant_id));

-- Mesmo uma escrita direta privilegiada deve respeitar a origem e o tenant da mídia.
CREATE FUNCTION public._validate_menu_outdoor_slide() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.marketing_media_assets a
    WHERE a.id=NEW.asset_id AND a.tenant_id=NEW.tenant_id
      AND a.kind='CREATIVE' AND (NOT NEW.active OR a.status='PUBLISHED')
      AND (NOT NEW.active OR (public.is_valid_marketing_path(a.public_path,'marketing-public')
      AND split_part(a.public_path,'/',1)=NEW.tenant_id::text
      AND split_part(split_part(a.public_path,'/',3),'.',1)=a.id::text))
  ) THEN
    RAISE EXCEPTION 'MEDIA_INVALID: selecione uma mídia publicada desta loja.' USING ERRCODE='22023';
  END IF;
  IF NEW.product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.products p WHERE p.id=NEW.product_id AND p.tenant_id=NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'PRODUCT_INVALID: produto não pertence a esta loja.' USING ERRCODE='22023';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at) THEN
    RAISE EXCEPTION 'SLIDE_IDENTITY_IMMUTABLE: a origem do outdoor não pode ser alterada.' USING ERRCODE='22023';
  END IF;
  NEW.title=btrim(NEW.title);
  NEW.updated_at=now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._validate_menu_outdoor_slide() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER menu_outdoor_slide_validate BEFORE INSERT OR UPDATE ON public.menu_outdoor_slides
  FOR EACH ROW EXECUTE FUNCTION public._validate_menu_outdoor_slide();

CREATE FUNCTION public.list_menu_outdoor_slides(p_tenant_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: somente o dono ou gerente desta loja pode gerenciar o outdoor.' USING ERRCODE='42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object(
    'media_type',a.media_type,
    'public_path',CASE WHEN a.status='PUBLISHED' AND public.is_valid_marketing_path(a.public_path,'marketing-public')
      AND split_part(a.public_path,'/',1)=s.tenant_id::text
      AND split_part(split_part(a.public_path,'/',3),'.',1)=a.id::text THEN a.public_path ELSE NULL END
  ) ORDER BY s.sort_order,s.id),'[]'::jsonb)
  FROM public.menu_outdoor_slides s JOIN public.marketing_media_assets a ON a.tenant_id=s.tenant_id AND a.id=s.asset_id
  WHERE s.tenant_id=p_tenant_id);
END $$;

CREATE FUNCTION public.save_menu_outdoor_slide(
  p_tenant_id uuid,p_id uuid,p_asset_id uuid,p_title text,p_product_id uuid,
  p_sort_order integer,p_active boolean,p_starts_at timestamptz,p_ends_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_row public.menu_outdoor_slides;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: somente o dono ou gerente desta loja pode gerenciar o outdoor.' USING ERRCODE='42501';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.menu_outdoor_slides(tenant_id,asset_id,title,product_id,sort_order,active,starts_at,ends_at)
    VALUES(p_tenant_id,p_asset_id,coalesce(p_title,''),p_product_id,p_sort_order,p_active,p_starts_at,p_ends_at)
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_row FROM public.menu_outdoor_slides WHERE id=p_id AND tenant_id=p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SLIDE_NOT_FOUND: outdoor não encontrado nesta loja.' USING ERRCODE='22023';
    END IF;
    UPDATE public.menu_outdoor_slides SET asset_id=p_asset_id,title=coalesce(p_title,''),product_id=p_product_id,
      sort_order=p_sort_order,active=p_active,starts_at=p_starts_at,ends_at=p_ends_at
    WHERE id=p_id AND tenant_id=p_tenant_id RETURNING id INTO v_id;
  END IF;
  RETURN (SELECT e FROM jsonb_array_elements(public.list_menu_outdoor_slides(p_tenant_id)) e WHERE e->>'id'=v_id::text);
END $$;

-- Projeção pública explícita: nenhuma identidade, email, sessão, telefone ou dado operacional.
CREATE FUNCTION public.list_public_menu_outdoor(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'title',s.title,
    'product_id',CASE WHEN p.is_active AND (p.category_id IS NULL OR c.is_active) THEN p.id ELSE NULL END,
    'sort_order',s.sort_order,'media_type',a.media_type,'public_path',a.public_path
  ) ORDER BY s.sort_order,s.id),'[]'::jsonb)
  FROM public.tenants t
  JOIN public.menu_outdoor_slides s ON s.tenant_id=t.id
  JOIN public.marketing_media_assets a ON a.tenant_id=s.tenant_id AND a.id=s.asset_id
  LEFT JOIN public.products p ON p.id=s.product_id AND p.tenant_id=s.tenant_id
  LEFT JOIN public.categories c ON c.id=p.category_id AND c.tenant_id=s.tenant_id
  WHERE t.slug=p_slug AND t.status='ACTIVE' AND s.active
    AND (s.starts_at IS NULL OR s.starts_at<=now()) AND (s.ends_at IS NULL OR s.ends_at>now())
    AND a.kind='CREATIVE' AND a.status='PUBLISHED'
    AND public.is_valid_marketing_path(a.public_path,'marketing-public')
    AND split_part(a.public_path,'/',1)=s.tenant_id::text
    AND split_part(split_part(a.public_path,'/',3),'.',1)=a.id::text;
$$;
REVOKE ALL ON FUNCTION public.list_menu_outdoor_slides(uuid),
  public.save_menu_outdoor_slide(uuid,uuid,uuid,text,uuid,integer,boolean,timestamptz,timestamptz),
  public.list_public_menu_outdoor(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_menu_outdoor_slides(uuid),
  public.save_menu_outdoor_slide(uuid,uuid,uuid,text,uuid,integer,boolean,timestamptz,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_menu_outdoor(text) TO anon,authenticated;
