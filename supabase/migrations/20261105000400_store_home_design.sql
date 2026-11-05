-- Design Studio da Tela Inicial: rascunho/publicado por tenant, sem bucket novo.
-- Imagens usam o fluxo existente de marketing (marketing-public). Sem IA.
BEGIN;

CREATE TABLE public.store_home_designs (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  published jsonb,
  revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT store_home_draft_object CHECK (jsonb_typeof(draft) = 'object'),
  CONSTRAINT store_home_published_object CHECK (published IS NULL OR jsonb_typeof(published) = 'object'),
  CONSTRAINT store_home_revision_nonneg CHECK (revision >= 0)
);

COMMENT ON TABLE public.store_home_designs IS 'Design da Tela Inicial: draft privado e published público por tenant.';

ALTER TABLE public.store_home_designs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_home_designs FROM PUBLIC, anon, authenticated, service_role;

-- Validação: somente campos conhecidos, números limitados, URLs https, sem HTML/CSS livre.
CREATE FUNCTION public._store_home_https_url(p_url text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT p_url IS NULL OR p_url = '' OR (
    pg_catalog.length(p_url) BETWEEN 1 AND 2048
    AND p_url ~* '^https://[A-Za-z0-9._~:/?#\[\]@!$&''()*+,;=%-]+$'
    AND p_url !~* 'javascript:'
    AND p_url !~* 'data:'
  );
$$;

CREATE FUNCTION public._store_home_design_valid(p_design jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text;
DECLARE action text;
DECLARE allowed text[] := ARRAY[
  'version','templateId','headerTitle','title','subtitle','tagline','footerTitle',
  'backgroundMode','backgroundUrl','topBannerUrl','bottomBannerUrl',
  'backgroundPositionY','overlayOpacity','backgroundBlur','logoSize','logoPosition',
  'showFooter','actions'
];
DECLARE allowed_actions text[] := ARRAY['MENU','TABLE','PICKUP','DELIVERY','ACCOUNT','WAITER','BILL'];
BEGIN
  IF p_design IS NULL OR jsonb_typeof(p_design) <> 'object' OR pg_catalog.pg_column_size(p_design) > 16000 THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_design) AS keys(key) WHERE key <> ALL (allowed)) THEN
    RETURN false;
  END IF;
  IF COALESCE(p_design->>'version','') <> '1' THEN RETURN false; END IF;
  IF jsonb_typeof(p_design->'templateId') IS DISTINCT FROM 'string'
     OR pg_catalog.length(COALESCE(p_design->>'templateId','')) = 0
     OR pg_catalog.length(p_design->>'templateId') > 100 THEN
    RETURN false;
  END IF;
  FOREACH k IN ARRAY ARRAY['headerTitle','title','subtitle','tagline','footerTitle'] LOOP
    IF p_design ? k AND (jsonb_typeof(p_design->k) IS DISTINCT FROM 'string'
       OR pg_catalog.length(p_design->>k) > CASE WHEN k='subtitle' THEN 150 WHEN k='tagline' THEN 120 ELSE 100 END) THEN
      RETURN false;
    END IF;
  END LOOP;
  IF p_design ? 'backgroundMode' AND (p_design->>'backgroundMode') NOT IN ('full','sections') THEN RETURN false; END IF;
  IF p_design ? 'logoPosition' AND (p_design->>'logoPosition') NOT IN ('center','left') THEN RETURN false; END IF;
  IF p_design ? 'showFooter' AND jsonb_typeof(p_design->'showFooter') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['backgroundUrl','topBannerUrl','bottomBannerUrl'] LOOP
    IF p_design ? k AND (jsonb_typeof(p_design->k) IS DISTINCT FROM 'string'
       OR NOT public._store_home_https_url(p_design->>k)) THEN
      RETURN false;
    END IF;
  END LOOP;
  IF p_design ? 'backgroundPositionY' AND (
       jsonb_typeof(p_design->'backgroundPositionY') IS DISTINCT FROM 'number'
       OR (p_design->>'backgroundPositionY') !~ '^[0-9]{1,3}(\.[0-9]+)?$'
       OR (p_design->>'backgroundPositionY')::numeric < 0
       OR (p_design->>'backgroundPositionY')::numeric > 100) THEN
    RETURN false;
  END IF;
  IF p_design ? 'overlayOpacity' AND (
       jsonb_typeof(p_design->'overlayOpacity') IS DISTINCT FROM 'number'
       OR (p_design->>'overlayOpacity')::numeric < 0.2
       OR (p_design->>'overlayOpacity')::numeric > 0.9) THEN
    RETURN false;
  END IF;
  IF p_design ? 'backgroundBlur' AND (
       jsonb_typeof(p_design->'backgroundBlur') IS DISTINCT FROM 'number'
       OR (p_design->>'backgroundBlur') !~ '^[0-9]{1,2}(\.[0-9]+)?$'
       OR (p_design->>'backgroundBlur')::numeric < 0
       OR (p_design->>'backgroundBlur')::numeric > 20) THEN
    RETURN false;
  END IF;
  IF p_design ? 'logoSize' AND (
       jsonb_typeof(p_design->'logoSize') IS DISTINCT FROM 'number'
       OR (p_design->>'logoSize') !~ '^[0-9]{2,3}(\.[0-9]+)?$'
       OR (p_design->>'logoSize')::numeric < 56
       OR (p_design->>'logoSize')::numeric > 136) THEN
    RETURN false;
  END IF;
  IF NOT (p_design ? 'actions') OR jsonb_typeof(p_design->'actions') <> 'array'
     OR jsonb_array_length(p_design->'actions') < 1
     OR jsonb_array_length(p_design->'actions') > 7 THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_design->'actions') a WHERE a = 'MENU'
  ) THEN
    RETURN false;
  END IF;
  FOR action IN SELECT jsonb_array_elements_text(p_design->'actions') LOOP
    IF action <> ALL (allowed_actions) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

-- Projeção pública: só campos permitidos (sem PII).
CREATE FUNCTION public._store_home_design_public(p_design jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN public._store_home_design_valid(p_design) THEN jsonb_build_object(
    'version', 1,
    'templateId', p_design->'templateId',
    'headerTitle', COALESCE(p_design->'headerTitle', '""'::jsonb),
    'title', COALESCE(p_design->'title', '""'::jsonb),
    'subtitle', COALESCE(p_design->'subtitle', '""'::jsonb),
    'tagline', COALESCE(p_design->'tagline', '""'::jsonb),
    'footerTitle', COALESCE(p_design->'footerTitle', '""'::jsonb),
    'backgroundMode', COALESCE(p_design->'backgroundMode', '"full"'::jsonb),
    'backgroundUrl', COALESCE(p_design->'backgroundUrl', '""'::jsonb),
    'topBannerUrl', COALESCE(p_design->'topBannerUrl', '""'::jsonb),
    'bottomBannerUrl', COALESCE(p_design->'bottomBannerUrl', '""'::jsonb),
    'backgroundPositionY', COALESCE(p_design->'backgroundPositionY', '50'::jsonb),
    'overlayOpacity', COALESCE(p_design->'overlayOpacity', '0.5'::jsonb),
    'backgroundBlur', COALESCE(p_design->'backgroundBlur', '0'::jsonb),
    'logoSize', COALESCE(p_design->'logoSize', '92'::jsonb),
    'logoPosition', COALESCE(p_design->'logoPosition', '"center"'::jsonb),
    'showFooter', COALESCE(p_design->'showFooter', 'true'::jsonb),
    'actions', p_design->'actions'
  ) ELSE NULL END;
$$;

CREATE FUNCTION public.store_home_can_edit(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL
    AND COALESCE(public._tenant_role_of_caller(p_tenant), '') IN ('OWNER', 'MANAGER');
$$;

CREATE FUNCTION public.store_home_get_private(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.store_home_can_edit(p_tenant) THEN
    RAISE EXCEPTION 'FORBIDDEN: Sem permissão para editar a tela inicial desta loja.' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'draft', d.draft,
    'published', CASE WHEN d.published IS NULL THEN NULL ELSE public._store_home_design_public(d.published) END,
    'revision', d.revision
  ) INTO v_result
  FROM public.store_home_designs d
  WHERE d.tenant_id = p_tenant;
  RETURN COALESCE(v_result, jsonb_build_object('draft', '{}'::jsonb, 'published', NULL, 'revision', 0));
END $$;

CREATE FUNCTION public.store_home_save_draft(p_tenant uuid, p_design jsonb, p_expected_revision integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_revision integer;
DECLARE v_clean jsonb;
BEGIN
  IF NOT public.store_home_can_edit(p_tenant) THEN
    RAISE EXCEPTION 'FORBIDDEN: Sem permissão para salvar a tela inicial desta loja.' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'INVALID_REVISION' USING ERRCODE = '22023';
  END IF;
  IF NOT public._store_home_design_valid(p_design) THEN
    RAISE EXCEPTION 'INVALID_HOME_DESIGN: confira textos, imagens e opções da tela inicial.' USING ERRCODE = '22023';
  END IF;
  v_clean := public._store_home_design_public(p_design);
  IF v_clean IS NULL THEN
    RAISE EXCEPTION 'INVALID_HOME_DESIGN: confira textos, imagens e opções da tela inicial.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.store_home_designs (tenant_id, draft, revision)
  VALUES (p_tenant, v_clean, 1)
  ON CONFLICT (tenant_id) DO UPDATE SET
    draft = EXCLUDED.draft,
    revision = public.store_home_designs.revision + 1,
    updated_at = now()
  WHERE public.store_home_designs.revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    RAISE EXCEPTION 'DESIGN_VERSION_CONFLICT: recarregue o design antes de salvar.' USING ERRCODE = '40001';
  END IF;
  RETURN v_revision;
END $$;

CREATE FUNCTION public.store_home_publish(p_tenant uuid, p_expected_revision integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_published jsonb;
DECLARE v_clean jsonb;
BEGIN
  IF NOT public.store_home_can_edit(p_tenant) THEN
    RAISE EXCEPTION 'FORBIDDEN: Sem permissão para publicar a tela inicial desta loja.' USING ERRCODE = '42501';
  END IF;
  SELECT public._store_home_design_public(d.draft) INTO v_clean
  FROM public.store_home_designs d
  WHERE d.tenant_id = p_tenant AND d.revision = p_expected_revision;
  IF v_clean IS NULL THEN
    RAISE EXCEPTION 'Não foi possível publicar: rascunho ausente, inválido ou desatualizado.' USING ERRCODE = '40001';
  END IF;
  UPDATE public.store_home_designs d
  SET published = v_clean,
      published_at = now(),
      updated_at = now(),
      revision = d.revision + 1
  WHERE d.tenant_id = p_tenant AND d.revision = p_expected_revision
  RETURNING public._store_home_design_public(d.published) INTO v_published;
  IF v_published IS NULL THEN
    RAISE EXCEPTION 'Não foi possível publicar: rascunho ausente ou desatualizado.' USING ERRCODE = '40001';
  END IF;
  RETURN v_published;
END $$;

-- Público: somente published de loja ACTIVE. Sem PII.
CREATE FUNCTION public.store_home_get_published(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public._store_home_design_public(d.published)
  FROM public.store_home_designs d
  JOIN public.tenants t ON t.id = d.tenant_id
  WHERE t.slug = lower(pg_catalog.btrim(p_slug))
    AND t.status = 'ACTIVE'
    AND d.published IS NOT NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public._store_home_https_url(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._store_home_design_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._store_home_design_public(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.store_home_can_edit(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.store_home_get_private(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.store_home_save_draft(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.store_home_publish(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.store_home_get_published(text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.store_home_can_edit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_home_get_private(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_home_save_draft(uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_home_publish(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_home_get_published(text) TO anon, authenticated;
-- Validadores usáveis pelo backend (CHECK / testes), sem exposição a anon.
GRANT EXECUTE ON FUNCTION public._store_home_design_valid(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._store_home_https_url(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
