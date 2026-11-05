-- Reversão de 20261105000300_outdoor_video_youtube. Nunca descarta dados:
-- recusa se existir banner do YouTube ou vídeo acima de 35 MiB já registrado.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.menu_outdoor_slides WHERE media_kind<>'ASSET') THEN
    RAISE EXCEPTION 'OUTDOOR_YOUTUBE_ROLLBACK_HAS_DATA: existem banners do YouTube; reversão recusada para preservar os dados.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.marketing_media_assets WHERE media_type='VIDEO' AND size_bytes>36700160) THEN
    RAISE EXCEPTION 'OUTDOOR_VIDEO_ROLLBACK_HAS_DATA: existem vídeos acima de 35 MiB; reversão recusada para preservar os dados.';
  END IF;
END $$;
DROP FUNCTION public.delete_menu_outdoor_slide(uuid,uuid);
DROP FUNCTION public.save_menu_outdoor_slide(uuid,uuid,uuid,text,uuid,integer,boolean,timestamptz,timestamptz,text);
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


CREATE OR REPLACE FUNCTION public.list_menu_outdoor_slides(p_tenant_id uuid) RETURNS jsonb
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


CREATE OR REPLACE FUNCTION public.list_public_menu_outdoor(p_slug text) RETURNS jsonb
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

CREATE OR REPLACE FUNCTION public._validate_menu_outdoor_slide() RETURNS trigger
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
REVOKE ALL ON FUNCTION public.list_menu_outdoor_slides(uuid),
  public.save_menu_outdoor_slide(uuid,uuid,uuid,text,uuid,integer,boolean,timestamptz,timestamptz),
  public.list_public_menu_outdoor(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_menu_outdoor_slides(uuid),
  public.save_menu_outdoor_slide(uuid,uuid,uuid,text,uuid,integer,boolean,timestamptz,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_menu_outdoor(text) TO anon,authenticated;
ALTER TABLE public.menu_outdoor_slides
  DROP CONSTRAINT menu_outdoor_slide_source,
  DROP CONSTRAINT menu_outdoor_slide_youtube_id,
  DROP CONSTRAINT menu_outdoor_slide_media_kind,
  DROP COLUMN youtube_id,
  DROP COLUMN media_kind,
  ALTER COLUMN asset_id SET NOT NULL;
CREATE OR REPLACE FUNCTION public.register_marketing_asset(p_tenant_id UUID, p_kind TEXT, p_media_type TEXT, p_extension TEXT, p_declared_size BIGINT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id UUID := gen_random_uuid();
    v_ext TEXT := lower(btrim(COALESCE(p_extension, '')));
    v_type TEXT := upper(btrim(COALESCE(p_media_type, '')));
    v_kind TEXT := upper(btrim(COALESCE(p_kind, '')));
    v_path TEXT;
    v_max BIGINT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
        RAISE EXCEPTION 'MEDIA_FORBIDDEN: somente OWNER/MANAGER da loja.' USING ERRCODE = '42501';
    END IF;
    IF v_kind NOT IN ('CREATIVE','PRIVATE') OR v_type NOT IN ('IMAGE','VIDEO') THEN
        RAISE EXCEPTION 'MEDIA_INVALID: tipo de mídia inválido.';
    END IF;
    IF NOT ((v_type = 'IMAGE' AND v_ext IN ('jpg','jpeg','png','webp')) OR (v_type = 'VIDEO' AND v_ext IN ('mp4','webm'))) THEN
        RAISE EXCEPTION 'MEDIA_INVALID_EXTENSION: extensão % não permitida para %.', v_ext, v_type;
    END IF;
    v_max := CASE WHEN v_type = 'IMAGE' THEN 5242880 ELSE 36700160 END;
    IF p_declared_size IS NULL OR p_declared_size <= 0 OR p_declared_size > v_max THEN
        RAISE EXCEPTION 'MEDIA_TOO_LARGE: limite de % bytes.', v_max;
    END IF;
    IF NOT public._rate_limit_hit('register_media', public._sha256_hex(auth.uid()::text), p_tenant_id, 60, 3600) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitos uploads; aguarde.';
    END IF;
    v_path := p_tenant_id::text || '/' || CASE WHEN v_kind = 'CREATIVE' THEN 'drafts' ELSE 'private' END || '/' || v_id::text || '.' || v_ext;
    INSERT INTO public.marketing_media_assets (id, tenant_id, kind, media_type, extension, private_path, created_by)
    VALUES (v_id, p_tenant_id, v_kind, v_type, v_ext, v_path, auth.uid());
    RETURN jsonb_build_object('asset_id', v_id, 'bucket', 'marketing', 'path', v_path, 'max_bytes', v_max);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_marketing_upload(p_asset_id UUID, p_width INT, p_height INT, p_duration NUMERIC)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
    v public.marketing_media_assets;
    v_obj RECORD;
    v_mime TEXT;
    v_size BIGINT;
BEGIN
    v := public._lock_marketing_asset(p_asset_id);
    IF v.status <> 'REGISTERED' THEN
        RAISE EXCEPTION 'MEDIA_INVALID_STATE: mídia em % não pode ser confirmada.', v.status;
    END IF;
    SELECT o.metadata INTO v_obj FROM storage.objects o WHERE o.bucket_id = 'marketing' AND o.name = v.private_path;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'MEDIA_NOT_UPLOADED: arquivo ainda não enviado.';
    END IF;
    v_mime := lower(v_obj.metadata ->> 'mimetype');
    v_size := NULLIF(v_obj.metadata ->> 'size', '')::bigint;
    IF v_mime IS NULL OR NOT public._mime_matches_extension(v_mime, v.extension) THEN
        RAISE EXCEPTION 'MEDIA_MIME_MISMATCH: tipo do arquivo (%) não confere com a extensão %.', v_mime, v.extension;
    END IF;
    IF v_size IS NULL OR v_size <= 0 OR v_size > (CASE WHEN v.media_type = 'IMAGE' THEN 5242880 ELSE 36700160 END) THEN
        RAISE EXCEPTION 'MEDIA_TOO_LARGE: arquivo acima do limite.';
    END IF;
    IF (p_width IS NOT NULL AND (p_width <= 0 OR p_width > 10000)) OR (p_height IS NOT NULL AND (p_height <= 0 OR p_height > 10000))
       OR (p_duration IS NOT NULL AND (p_duration <= 0 OR p_duration > 600)) THEN
        RAISE EXCEPTION 'MEDIA_INVALID_METADATA: dimensões/duração inválidas.';
    END IF;
    UPDATE public.marketing_media_assets
    SET status = 'UPLOADED', mime_type = v_mime, size_bytes = v_size, width_px = p_width, height_px = p_height,
        duration_seconds = CASE WHEN media_type = 'VIDEO' THEN p_duration ELSE NULL END,
        aspect_ratio = CASE WHEN p_width IS NOT NULL AND p_height IS NOT NULL THEN left(round(p_width::numeric / p_height, 3)::text, 8) END
    WHERE id = v.id;
    RETURN jsonb_build_object('asset_id', v.id, 'status', 'UPLOADED', 'mime_type', v_mime, 'size_bytes', v_size);
END;
$$;
ALTER TABLE public.marketing_media_assets DROP CONSTRAINT mma_size_limits;
ALTER TABLE public.marketing_media_assets ADD CONSTRAINT mma_size_limits CHECK (size_bytes IS NULL OR
        (media_type = 'IMAGE' AND size_bytes <= 5242880) OR (media_type = 'VIDEO' AND size_bytes <= 36700160));
UPDATE storage.buckets SET file_size_limit = 36700160 WHERE id IN ('marketing','marketing-public');
