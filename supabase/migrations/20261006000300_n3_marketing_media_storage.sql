-- ============================================================================
-- N3 — MÍDIA DE MARKETING: BUCKETS, ASSETS, PUBLICAÇÃO/DESPUBLICAÇÃO AUDITADAS
-- DESIGN_N1_N6_ARQUITETURA_v3 (decisão 4; F2). Regras 39 e 23.
--
-- Cria:      buckets marketing (privado) e marketing-public (leitura pública por URL,
--            sem listagem); tabelas marketing_media_assets e marketing_media_publication_log
--            (append-only); RPCs register/confirm_upload/request_publish/confirm_publish/
--            unpublish/archive; helpers de path; 5 policies em storage.objects.
-- Substitui: nada. Intocado: bucket catalog (012) e suas policies.
-- Fluxo:     register -> upload privado -> confirm_upload -> request_publish -> cópia
--            para marketing-public -> confirm_publish (PUBLISHED) -> unpublish (motivo
--            obrigatório) -> remoção do objeto público -> archive. Cada passo registra
--            ator, data, status de/para e motivo no log e em audit_logs.
-- Rollback:  supabase/rollback/n3_rollback.sql (manual).
-- ============================================================================
DO $pre$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006000200') THEN
        RAISE EXCEPTION 'N3 PRE: N2 (20261006000200) não registrada; abortado.';
    END IF;
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version > '20261006000200') THEN
        RAISE EXCEPTION 'N3 PRE: há migrations posteriores à N2 registradas; ordem inesperada.';
    END IF;
    IF to_regclass('public.marketing_media_assets') IS NOT NULL OR to_regclass('public.marketing_media_publication_log') IS NOT NULL THEN
        RAISE EXCEPTION 'N3 PRE: tabelas de mídia já existem; abortado.';
    END IF;
    IF EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('marketing','marketing-public')) THEN
        RAISE EXCEPTION 'N3 PRE: bucket marketing/marketing-public já existe; abortado.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'marketing%') THEN
        RAISE EXCEPTION 'N3 PRE: policies de storage marketing* já existem; abortado.';
    END IF;
END
$pre$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
    ('marketing', 'marketing', false, 36700160, ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm']),
    ('marketing-public', 'marketing-public', true, 36700160, ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm']);

CREATE TABLE public.marketing_media_assets (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    kind              VARCHAR(16) NOT NULL CHECK (kind IN ('CREATIVE','PRIVATE')),
    media_type        VARCHAR(8) NOT NULL CHECK (media_type IN ('IMAGE','VIDEO')),
    extension         VARCHAR(5) NOT NULL CHECK (extension IN ('jpg','jpeg','png','webp','mp4','webm')),
    private_path      TEXT NOT NULL UNIQUE,
    public_path       TEXT UNIQUE,
    status            VARCHAR(16) NOT NULL DEFAULT 'REGISTERED'
                      CHECK (status IN ('REGISTERED','UPLOADED','PUBLISHING','PUBLISHED','UNPUBLISHED','ARCHIVED')),
    mime_type         VARCHAR(32),
    size_bytes        BIGINT CHECK (size_bytes IS NULL OR size_bytes > 0),
    width_px          INTEGER CHECK (width_px IS NULL OR width_px > 0),
    height_px         INTEGER CHECK (height_px IS NULL OR height_px > 0),
    duration_seconds  NUMERIC(8,3) CHECK (duration_seconds IS NULL OR duration_seconds > 0),
    meta_source       VARCHAR(16) NOT NULL DEFAULT 'CLIENT_PROBE',
    aspect_ratio      VARCHAR(8),
    published_at      TIMESTAMPTZ,
    unpublished_at    TIMESTAMPTZ,
    created_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mma_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT mma_extension_matches_type CHECK (
        (media_type = 'IMAGE' AND extension IN ('jpg','jpeg','png','webp')) OR
        (media_type = 'VIDEO' AND extension IN ('mp4','webm'))),
    CONSTRAINT mma_publish_requires_creative CHECK (
        status NOT IN ('PUBLISHING','PUBLISHED') OR (kind = 'CREATIVE' AND public_path IS NOT NULL)),
    CONSTRAINT mma_published_video_duration CHECK (
        NOT (status = 'PUBLISHED' AND media_type = 'VIDEO') OR duration_seconds IS NOT NULL),
    CONSTRAINT mma_size_limits CHECK (size_bytes IS NULL OR
        (media_type = 'IMAGE' AND size_bytes <= 5242880) OR (media_type = 'VIDEO' AND size_bytes <= 36700160))
);
CREATE INDEX idx_mma_tenant_status ON public.marketing_media_assets (tenant_id, status);

CREATE TABLE public.marketing_media_publication_log (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    asset_id       UUID NOT NULL,
    action         VARCHAR(24) NOT NULL CHECK (action IN ('PUBLISH_REQUESTED','PUBLISHED','PUBLISH_FAILED','UNPUBLISHED','ARCHIVED')),
    from_status    VARCHAR(16) NOT NULL,
    to_status      VARCHAR(16) NOT NULL,
    public_path    TEXT,
    actor_user_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    reason         TEXT CHECK (reason IS NULL OR length(reason) <= 500),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NO ACTION: asset com histórico não é apagado individualmente (arquive); exclusão do tenant cascateia.
    CONSTRAINT mmpl_asset_fk FOREIGN KEY (tenant_id, asset_id) REFERENCES public.marketing_media_assets (tenant_id, id),
    CONSTRAINT mmpl_unpublish_reason CHECK (action <> 'UNPUBLISHED' OR (reason IS NOT NULL AND btrim(reason) <> ''))
);
CREATE INDEX idx_mmpl_asset ON public.marketing_media_publication_log (asset_id, created_at);
CREATE INDEX idx_mmpl_tenant ON public.marketing_media_publication_log (tenant_id, created_at DESC);

CREATE TRIGGER trg_marketing_media_assets_updated_at
    BEFORE UPDATE ON public.marketing_media_assets
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.marketing_media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_media_publication_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY mma_om_select ON public.marketing_media_assets FOR SELECT TO authenticated
    USING (public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY mmpl_om_select ON public.marketing_media_publication_log FOR SELECT TO authenticated
    USING (public.is_tenant_owner_or_manager(tenant_id));
REVOKE ALL ON public.marketing_media_assets, public.marketing_media_publication_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.marketing_media_assets, public.marketing_media_publication_log TO authenticated;

-- ----------------------------------------------------------------------------
-- FUNÇÕES
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_valid_marketing_path(p_name TEXT, p_bucket TEXT)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT p_name IS NOT NULL AND p_bucket IS NOT NULL
       AND p_name !~ '(\.\.|//|\\|%|\s|[[:cntrl:]])'
       AND p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(drafts|private|published)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|mp4|webm)$'
       AND ((p_bucket = 'marketing' AND split_part(p_name, '/', 2) IN ('drafts','private'))
         OR (p_bucket = 'marketing-public' AND split_part(p_name, '/', 2) = 'published'));
$$;

CREATE OR REPLACE FUNCTION public.marketing_path_tenant(p_name TEXT)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE WHEN split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN split_part(p_name, '/', 1)::uuid END;
$$;

-- Escrita (INSERT) em storage só para o path exato de um asset no status certo.
CREATE OR REPLACE FUNCTION public.can_write_marketing_object(p_bucket TEXT, p_name TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT public.is_valid_marketing_path(p_name, p_bucket)
       AND public.is_tenant_owner_or_manager(public.marketing_path_tenant(p_name))
       AND EXISTS (SELECT 1 FROM public.marketing_media_assets a
                   WHERE a.tenant_id = public.marketing_path_tenant(p_name)
                     AND ((p_bucket = 'marketing' AND a.private_path = p_name AND a.status = 'REGISTERED')
                       OR (p_bucket = 'marketing-public' AND a.public_path = p_name AND a.status = 'PUBLISHING')));
$$;

CREATE OR REPLACE FUNCTION public.can_read_marketing_private(p_name TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT public.is_valid_marketing_path(p_name, 'marketing')
       AND public.is_tenant_owner_or_manager(public.marketing_path_tenant(p_name));
$$;

CREATE OR REPLACE FUNCTION public.can_delete_marketing_object(p_bucket TEXT, p_name TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT public.is_valid_marketing_path(p_name, p_bucket)
       AND public.is_tenant_owner_or_manager(public.marketing_path_tenant(p_name))
       AND CASE
           WHEN p_bucket = 'marketing' THEN NOT EXISTS (
               SELECT 1 FROM public.marketing_media_assets a
               WHERE a.private_path = p_name AND a.status IN ('PUBLISHING','PUBLISHED'))
           WHEN p_bucket = 'marketing-public' THEN EXISTS (
               SELECT 1 FROM public.marketing_media_assets a
               WHERE a.public_path = p_name AND a.status IN ('UNPUBLISHED','ARCHIVED','UPLOADED'))
           ELSE false END;
$$;

CREATE OR REPLACE FUNCTION public._log_media_publication(p_asset_id UUID, p_action TEXT, p_from TEXT, p_to TEXT, p_reason TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_asset RECORD;
BEGIN
    SELECT tenant_id, public_path INTO v_asset FROM public.marketing_media_assets WHERE id = p_asset_id;
    INSERT INTO public.marketing_media_publication_log (tenant_id, asset_id, action, from_status, to_status, public_path, actor_user_id, reason)
    VALUES (v_asset.tenant_id, p_asset_id, p_action, p_from, p_to, v_asset.public_path, auth.uid(), NULLIF(btrim(COALESCE(p_reason, '')), ''));
    PERFORM public.log_audit_event('MEDIA_' || p_action, 'marketing_media_assets',
        'Mídia ' || p_action || COALESCE(': ' || left(p_reason, 200), ''), p_asset_id::text, p_from, p_to, v_asset.tenant_id);
END;
$$;

-- Asset bloqueado para OWNER/MANAGER do tenant do asset (FOR UPDATE).
CREATE OR REPLACE FUNCTION public._lock_marketing_asset(p_asset_id UUID)
RETURNS public.marketing_media_assets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v public.marketing_media_assets;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v FROM public.marketing_media_assets WHERE id = p_asset_id FOR UPDATE;
    IF v.id IS NULL OR NOT public.is_tenant_owner_or_manager(v.tenant_id) THEN
        RAISE EXCEPTION 'ASSET_NOT_FOUND: mídia não encontrada.' USING ERRCODE = '42501';
    END IF;
    RETURN v;
END;
$$;

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

CREATE OR REPLACE FUNCTION public._mime_matches_extension(p_mime TEXT, p_ext TEXT)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT (p_ext IN ('jpg','jpeg') AND p_mime = 'image/jpeg') OR (p_ext = 'png' AND p_mime = 'image/png')
        OR (p_ext = 'webp' AND p_mime = 'image/webp') OR (p_ext = 'mp4' AND p_mime = 'video/mp4')
        OR (p_ext = 'webm' AND p_mime = 'video/webm');
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

CREATE OR REPLACE FUNCTION public.request_publish_marketing_asset(p_asset_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v public.marketing_media_assets;
    v_public TEXT;
BEGIN
    v := public._lock_marketing_asset(p_asset_id);
    IF v.kind <> 'CREATIVE' THEN
        RAISE EXCEPTION 'MEDIA_PRIVATE: mídia PRIVATE nunca é publicada.';
    END IF;
    IF v.status NOT IN ('UPLOADED','UNPUBLISHED') THEN
        RAISE EXCEPTION 'MEDIA_INVALID_STATE: mídia em % não pode ser publicada.', v.status;
    END IF;
    IF v.media_type = 'VIDEO' AND v.duration_seconds IS NULL THEN
        RAISE EXCEPTION 'MEDIA_DURATION_REQUIRED: informe a duração do vídeo antes de publicar.';
    END IF;
    v_public := v.tenant_id::text || '/published/' || v.id::text || '.' || v.extension;
    UPDATE public.marketing_media_assets SET status = 'PUBLISHING', public_path = v_public WHERE id = v.id;
    PERFORM public._log_media_publication(v.id, 'PUBLISH_REQUESTED', v.status, 'PUBLISHING', NULL);
    RETURN jsonb_build_object('asset_id', v.id, 'status', 'PUBLISHING', 'source_bucket', 'marketing', 'source_path', v.private_path,
                              'target_bucket', 'marketing-public', 'target_path', v_public);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_publish_marketing_asset(p_asset_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
    v public.marketing_media_assets;
    v_meta JSONB;
BEGIN
    v := public._lock_marketing_asset(p_asset_id);
    IF v.status <> 'PUBLISHING' THEN
        RAISE EXCEPTION 'MEDIA_INVALID_STATE: mídia em % não está publicando.', v.status;
    END IF;
    SELECT o.metadata INTO v_meta FROM storage.objects o WHERE o.bucket_id = 'marketing-public' AND o.name = v.public_path;
    IF v_meta IS NOT NULL AND lower(v_meta ->> 'mimetype') = v.mime_type AND NULLIF(v_meta ->> 'size', '')::bigint = v.size_bytes THEN
        UPDATE public.marketing_media_assets SET status = 'PUBLISHED', published_at = now(), unpublished_at = NULL WHERE id = v.id;
        PERFORM public._log_media_publication(v.id, 'PUBLISHED', 'PUBLISHING', 'PUBLISHED', NULL);
        RETURN jsonb_build_object('asset_id', v.id, 'status', 'PUBLISHED', 'public_path', v.public_path);
    END IF;
    UPDATE public.marketing_media_assets SET status = 'UPLOADED' WHERE id = v.id;
    PERFORM public._log_media_publication(v.id, 'PUBLISH_FAILED', 'PUBLISHING', 'UPLOADED',
        CASE WHEN v_meta IS NULL THEN 'objeto público ausente' ELSE 'tamanho/tipo divergente do original' END);
    RETURN jsonb_build_object('asset_id', v.id, 'status', 'UPLOADED', 'error', 'PUBLISH_FAILED');
END;
$$;

CREATE OR REPLACE FUNCTION public.unpublish_marketing_asset(p_asset_id UUID, p_reason TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v public.marketing_media_assets;
BEGIN
    v := public._lock_marketing_asset(p_asset_id);
    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL OR length(p_reason) > 500 THEN
        RAISE EXCEPTION 'REASON_REQUIRED: informe o motivo da despublicação (até 500 caracteres).';
    END IF;
    IF v.status NOT IN ('PUBLISHED','PUBLISHING') THEN
        RAISE EXCEPTION 'MEDIA_INVALID_STATE: mídia em % não está publicada.', v.status;
    END IF;
    UPDATE public.marketing_media_assets SET status = 'UNPUBLISHED', unpublished_at = now() WHERE id = v.id;
    PERFORM public._log_media_publication(v.id, 'UNPUBLISHED', v.status, 'UNPUBLISHED', p_reason);
    RETURN jsonb_build_object('asset_id', v.id, 'status', 'UNPUBLISHED', 'remove_bucket', 'marketing-public', 'remove_path', v.public_path);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_marketing_asset(p_asset_id UUID, p_reason TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v public.marketing_media_assets;
    v_ref BOOLEAN := false;
BEGIN
    v := public._lock_marketing_asset(p_asset_id);
    IF v.status IN ('PUBLISHED','PUBLISHING') THEN
        RAISE EXCEPTION 'MEDIA_INVALID_STATE: despublique antes de arquivar.';
    END IF;
    IF v.status = 'ARCHIVED' THEN
        RAISE EXCEPTION 'MEDIA_INVALID_STATE: mídia já arquivada.';
    END IF;
    -- Referências ativas (tabelas/colunas criadas pela N4/N5; checagem dinâmica para não depender da ordem)
    IF to_regclass('public.campaign_cards') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.campaign_cards WHERE media_asset_id = $1 AND is_active)' INTO v_ref USING v.id;
    END IF;
    IF NOT v_ref AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='offers' AND column_name='media_asset_id') THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.offers WHERE media_asset_id = $1 AND is_active)' INTO v_ref USING v.id;
    END IF;
    IF NOT v_ref AND to_regclass('public.promotion_carousels') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.promotion_carousels WHERE cover_asset_id = $1 AND is_active)' INTO v_ref USING v.id;
    END IF;
    IF v_ref THEN
        RAISE EXCEPTION 'MEDIA_IN_USE: mídia usada por card, oferta ou carrossel ativo.';
    END IF;
    UPDATE public.marketing_media_assets SET status = 'ARCHIVED' WHERE id = v.id;
    PERFORM public._log_media_publication(v.id, 'ARCHIVED', v.status, 'ARCHIVED', p_reason);
    RETURN jsonb_build_object('asset_id', v.id, 'status', 'ARCHIVED');
END;
$$;

-- ----------------------------------------------------------------------------
-- POLICIES DE storage.objects (6). Nenhuma para anon; sem UPDATE (sem sobrescrita);
-- marketing-public sem listagem pública (o arquivo publicado é servido pela URL pública).
-- ----------------------------------------------------------------------------
CREATE POLICY marketing_private_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'marketing' AND public.can_write_marketing_object(bucket_id, name));
CREATE POLICY marketing_private_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'marketing' AND public.can_read_marketing_private(name));
CREATE POLICY marketing_private_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'marketing' AND public.can_delete_marketing_object(bucket_id, name));
CREATE POLICY marketing_public_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'marketing-public' AND public.can_write_marketing_object(bucket_id, name));
CREATE POLICY marketing_public_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'marketing-public' AND public.can_delete_marketing_object(bucket_id, name));
-- 6ª policy (desvio do design v3, que listava 5): no Storage do Supabase a remoção exige também
-- SELECT sobre o objeto. Só OWNER/MANAGER do tenant do path; anon continua sem listagem.
CREATE POLICY marketing_public_select_om ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'marketing-public' AND public.is_valid_marketing_path(name, bucket_id)
           AND public.is_tenant_owner_or_manager(public.marketing_path_tenant(name)));

DO $grants$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.is_valid_marketing_path(text,text)',
        'public.marketing_path_tenant(text)',
        'public.can_write_marketing_object(text,text)',
        'public.can_read_marketing_private(text)',
        'public.can_delete_marketing_object(text,text)',
        'public._log_media_publication(uuid,text,text,text,text)',
        'public._lock_marketing_asset(uuid)',
        'public.register_marketing_asset(uuid,text,text,text,bigint)',
        'public._mime_matches_extension(text,text)',
        'public.confirm_marketing_upload(uuid,integer,integer,numeric)',
        'public.request_publish_marketing_asset(uuid)',
        'public.confirm_publish_marketing_asset(uuid)',
        'public.unpublish_marketing_asset(uuid,text)',
        'public.archive_marketing_asset(uuid,text)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    END LOOP;
END
$grants$;
-- Funções usadas dentro das policies de storage precisam de EXECUTE para authenticated.
GRANT EXECUTE ON FUNCTION public.is_valid_marketing_path(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_path_tenant(text) TO authenticated; -- usada em policy (IMMUTABLE, não lê dados)
GRANT EXECUTE ON FUNCTION public.can_write_marketing_object(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_marketing_private(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_marketing_object(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_marketing_asset(uuid,text,text,text,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_marketing_upload(uuid,integer,integer,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_publish_marketing_asset(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_publish_marketing_asset(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpublish_marketing_asset(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_marketing_asset(uuid,text) TO authenticated;
-- Fim da N3.
