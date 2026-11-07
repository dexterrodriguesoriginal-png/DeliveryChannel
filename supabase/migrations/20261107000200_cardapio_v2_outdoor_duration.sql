-- Cardápio V2: duração controlável apenas para IMAGEM do Outdoor.
-- Vídeos publicados avançam no evento ended do navegador; nunca com timer de imagem.
BEGIN;
ALTER TABLE public.menu_outdoor_slides
 ADD COLUMN image_duration_seconds integer NOT NULL DEFAULT 6
 CONSTRAINT menu_outdoor_image_duration_check CHECK (image_duration_seconds BETWEEN 1 AND 120);
CREATE OR REPLACE FUNCTION public.list_menu_outdoor_slides(p_tenant_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: somente o dono ou gerente desta loja pode gerenciar o outdoor.' USING ERRCODE='42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object(
    'media_type',CASE WHEN s.media_kind='YOUTUBE' THEN 'YOUTUBE' ELSE a.media_type END,
    'image_duration_seconds',s.image_duration_seconds,
    'public_path',CASE WHEN s.media_kind='ASSET' AND a.status='PUBLISHED' AND public.is_valid_marketing_path(a.public_path,'marketing-public')
      AND split_part(a.public_path,'/',1)=s.tenant_id::text
      AND split_part(split_part(a.public_path,'/',3),'.',1)=a.id::text THEN a.public_path ELSE NULL END
  ) ORDER BY s.sort_order,s.id),'[]'::jsonb)
  FROM public.menu_outdoor_slides s LEFT JOIN public.marketing_media_assets a ON a.tenant_id=s.tenant_id AND a.id=s.asset_id
  WHERE s.tenant_id=p_tenant_id);
END $$;
CREATE OR REPLACE FUNCTION public.list_public_menu_outdoor(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'title',s.title,
    'product_id',CASE WHEN p.is_active AND (p.category_id IS NULL OR c.is_active) THEN p.id ELSE NULL END,
    'sort_order',s.sort_order,'image_duration_seconds',s.image_duration_seconds,
    'media_type',CASE WHEN s.media_kind='YOUTUBE' THEN 'YOUTUBE' ELSE a.media_type END,
    'public_path',CASE WHEN s.media_kind='ASSET' THEN a.public_path END,
    'youtube_id',CASE WHEN s.media_kind='YOUTUBE' THEN s.youtube_id END
  ) ORDER BY s.sort_order,s.id),'[]'::jsonb)
  FROM public.tenants t
  JOIN public.menu_outdoor_slides s ON s.tenant_id=t.id
  LEFT JOIN public.marketing_media_assets a ON a.tenant_id=s.tenant_id AND a.id=s.asset_id
  LEFT JOIN public.products p ON p.id=s.product_id AND p.tenant_id=s.tenant_id
  LEFT JOIN public.categories c ON c.id=p.category_id AND c.tenant_id=s.tenant_id
  WHERE t.slug=p_slug AND t.status='ACTIVE' AND s.active
    AND (s.starts_at IS NULL OR s.starts_at<=now()) AND (s.ends_at IS NULL OR s.ends_at>now())
    AND ((s.media_kind='YOUTUBE' AND s.youtube_id ~ '^[A-Za-z0-9_-]{11}$')
      OR (s.media_kind='ASSET' AND a.kind='CREATIVE' AND a.status='PUBLISHED'
        AND public.is_valid_marketing_path(a.public_path,'marketing-public')
        AND split_part(a.public_path,'/',1)=s.tenant_id::text
        AND split_part(split_part(a.public_path,'/',3),'.',1)=a.id::text));
$$;
DROP FUNCTION public.save_menu_outdoor_slide(uuid,uuid,uuid,text,uuid,integer,boolean,timestamptz,timestamptz,text);
CREATE FUNCTION public.save_menu_outdoor_slide(
  p_tenant_id uuid,p_id uuid,p_asset_id uuid,p_title text,p_product_id uuid,
  p_sort_order integer,p_active boolean,p_starts_at timestamptz,p_ends_at timestamptz,p_youtube_id text DEFAULT NULL,
  p_image_duration_seconds integer DEFAULT 6
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_row public.menu_outdoor_slides; v_kind text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: somente o dono ou gerente desta loja pode gerenciar o outdoor.' USING ERRCODE='42501';
  END IF;
  IF (p_asset_id IS NULL) = (p_youtube_id IS NULL) THEN
    RAISE EXCEPTION 'MEDIA_INVALID: escolha uma mídia publicada ou um link do YouTube.' USING ERRCODE='22023';
  END IF;
  IF p_image_duration_seconds IS NULL OR p_image_duration_seconds NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'IMAGE_DURATION_INVALID: informe 1 a 120 segundos.' USING ERRCODE='22023';
  END IF;
  v_kind := CASE WHEN p_youtube_id IS NOT NULL THEN 'YOUTUBE' ELSE 'ASSET' END;
  IF p_id IS NULL THEN
    INSERT INTO public.menu_outdoor_slides(tenant_id,media_kind,asset_id,youtube_id,title,product_id,sort_order,active,starts_at,ends_at,image_duration_seconds)
    VALUES(p_tenant_id,v_kind,p_asset_id,p_youtube_id,coalesce(p_title,''),p_product_id,p_sort_order,p_active,p_starts_at,p_ends_at,p_image_duration_seconds)
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_row FROM public.menu_outdoor_slides WHERE id=p_id AND tenant_id=p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SLIDE_NOT_FOUND: outdoor não encontrado nesta loja.' USING ERRCODE='22023';
    END IF;
    UPDATE public.menu_outdoor_slides SET media_kind=v_kind,asset_id=p_asset_id,youtube_id=p_youtube_id,title=coalesce(p_title,''),
      product_id=p_product_id,sort_order=p_sort_order,active=p_active,starts_at=p_starts_at,ends_at=p_ends_at,image_duration_seconds=p_image_duration_seconds
    WHERE id=p_id AND tenant_id=p_tenant_id RETURNING id INTO v_id;
  END IF;
  RETURN (SELECT e FROM jsonb_array_elements(public.list_menu_outdoor_slides(p_tenant_id)) e WHERE e->>'id'=v_id::text);
END $$;
REVOKE ALL ON FUNCTION public.save_menu_outdoor_slide(uuid,uuid,uuid,text,uuid,integer,boolean,timestamptz,timestamptz,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_menu_outdoor_slide(uuid,uuid,uuid,text,uuid,integer,boolean,timestamptz,timestamptz,text,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;