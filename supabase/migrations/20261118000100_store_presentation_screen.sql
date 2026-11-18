-- Tela inicial personalizada da loja (aparece depois de "Delivery Channel apresenta").
-- Aditiva: nenhuma linha existente muda. Mídia vem do fluxo governado N3 (bucket privado "marketing" com
-- caminho definido pelo servidor por tenant -> publicação em "marketing-public").
-- Leitura pública: só os campos da tela PUBLICADA, dentro de get_public_store. Escrita: só OWNER/MANAGER do tenant.
BEGIN;

DO $pre$
BEGIN
 IF to_regclass('public.tenant_presentation_screens') IS NOT NULL THEN
  RAISE EXCEPTION 'PRESENTATION PRE: tabela tenant_presentation_screens já existe; abortado.';
 END IF;
 IF to_regclass('public._presentation_20261118_restore') IS NOT NULL THEN
  RAISE EXCEPTION 'PRESENTATION PRE: tabela de restauração já existe; abortado.';
 END IF;
 IF to_regprocedure('public._presentation_store_base(text)') IS NOT NULL THEN
  RAISE EXCEPTION 'PRESENTATION PRE: _presentation_store_base já existe; abortado.';
 END IF;
 IF to_regclass('public.marketing_media_assets') IS NULL
  OR to_regprocedure('public.is_tenant_owner_or_manager(uuid)') IS NULL
  OR to_regprocedure('public._public_media_json(uuid,uuid)') IS NULL
  OR to_regprocedure('public.get_public_store(text)') IS NULL THEN
  RAISE EXCEPTION 'PRESENTATION PRE: pré-requisitos (N3/N6) ausentes; abortado.';
 END IF;
END
$pre$;

-- Definição original de get_public_store, para o rollback restaurar exatamente.
CREATE TABLE public._presentation_20261118_restore(signature text PRIMARY KEY, definition text NOT NULL);
REVOKE ALL ON public._presentation_20261118_restore FROM PUBLIC, anon, authenticated;
INSERT INTO public._presentation_20261118_restore
SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid) FROM pg_proc p
WHERE p.oid = 'public.get_public_store(text)'::regprocedure;

CREATE TABLE public.tenant_presentation_screens (
 tenant_id     uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
 asset_id      uuid NOT NULL REFERENCES public.marketing_media_assets(id) ON DELETE CASCADE,
 media_type    varchar(8) NOT NULL CHECK (media_type IN ('IMAGE','VIDEO')),
 image_seconds numeric(3,1) NOT NULL DEFAULT 2.5 CHECK (image_seconds BETWEEN 1 AND 5),
 once_per_day  boolean NOT NULL DEFAULT false,
 enabled       boolean NOT NULL DEFAULT true,
 updated_by    uuid,
 updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_presentation_screens ENABLE ROW LEVEL SECURITY;
-- Painel: dono/gerente lê a própria configuração. Escrita só pelas RPCs abaixo (sem INSERT/UPDATE/DELETE direto).
CREATE POLICY presentation_manager_read ON public.tenant_presentation_screens FOR SELECT TO authenticated
 USING (public.is_tenant_owner_or_manager(tenant_id));
REVOKE ALL ON public.tenant_presentation_screens FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tenant_presentation_screens TO authenticated;

-- Limites (também validados no navegador): imagem até 3 MB; vídeo até 15 MB e 10 s.
CREATE FUNCTION public.set_presentation_screen(p_tenant_id uuid, p_asset_id uuid, p_image_seconds numeric DEFAULT 2.5, p_once_per_day boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.marketing_media_assets; v_seconds numeric;
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL OR NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
  RAISE EXCEPTION 'FORBIDDEN: só o dono ou gerente da loja altera a tela inicial.' USING ERRCODE = '42501';
 END IF;
 SELECT * INTO a FROM public.marketing_media_assets WHERE id = p_asset_id AND tenant_id = p_tenant_id;
 IF a.id IS NULL OR a.kind <> 'CREATIVE' OR a.status <> 'PUBLISHED' OR a.public_path IS NULL THEN
  RAISE EXCEPTION 'PRESENTATION_ASSET_INVALID: mídia não publicada ou de outra loja.' USING ERRCODE = '22023';
 END IF;
 IF a.media_type = 'IMAGE' AND (a.size_bytes IS NULL OR a.size_bytes > 3145728) THEN
  RAISE EXCEPTION 'PRESENTATION_IMAGE_TOO_LARGE: a imagem deve ter até 3 MB.' USING ERRCODE = '22023';
 END IF;
 IF a.media_type = 'VIDEO' AND (a.size_bytes IS NULL OR a.size_bytes > 15728640) THEN
  RAISE EXCEPTION 'PRESENTATION_VIDEO_TOO_LARGE: o vídeo deve ter até 15 MB.' USING ERRCODE = '22023';
 END IF;
 IF a.media_type = 'VIDEO' AND (a.duration_seconds IS NULL OR a.duration_seconds > 10.05) THEN
  RAISE EXCEPTION 'PRESENTATION_VIDEO_TOO_LONG: o vídeo deve ter até 10 segundos.' USING ERRCODE = '22023';
 END IF;
 v_seconds := round(COALESCE(p_image_seconds, 2.5), 1);
 IF v_seconds < 1 OR v_seconds > 5 THEN
  RAISE EXCEPTION 'PRESENTATION_SECONDS_INVALID: tempo da imagem entre 1 e 5 segundos.' USING ERRCODE = '22023';
 END IF;
 INSERT INTO public.tenant_presentation_screens AS s (tenant_id, asset_id, media_type, image_seconds, once_per_day, enabled, updated_by, updated_at)
 VALUES (p_tenant_id, a.id, a.media_type, v_seconds, COALESCE(p_once_per_day, false), true, auth.uid(), now())
 ON CONFLICT (tenant_id) DO UPDATE SET asset_id = EXCLUDED.asset_id, media_type = EXCLUDED.media_type,
  image_seconds = EXCLUDED.image_seconds, once_per_day = EXCLUDED.once_per_day, enabled = true,
  updated_by = EXCLUDED.updated_by, updated_at = now();
 RETURN jsonb_build_object('tenantId', p_tenant_id, 'assetId', a.id, 'mediaType', a.media_type,
  'imageSeconds', v_seconds, 'oncePerDay', COALESCE(p_once_per_day, false));
END $$;

CREATE FUNCTION public.clear_presentation_screen(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL OR NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
  RAISE EXCEPTION 'FORBIDDEN: só o dono ou gerente da loja altera a tela inicial.' USING ERRCODE = '42501';
 END IF;
 DELETE FROM public.tenant_presentation_screens WHERE tenant_id = p_tenant_id;
END $$;

REVOKE ALL ON FUNCTION public.set_presentation_screen(uuid,uuid,numeric,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_presentation_screen(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_presentation_screen(uuid,uuid,numeric,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_presentation_screen(uuid) TO authenticated;

-- get_public_store: mesma resposta de antes + "presentation" (só se ativa e a mídia continua PUBLICADA).
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public.get_public_store(text)'::regprocedure) INTO d;
 EXECUTE replace(d, 'public.get_public_store(', 'public._presentation_store_base(');
END $$;
REVOKE ALL ON FUNCTION public._presentation_store_base(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_store(p_slug text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb; v_tenant uuid; v_presentation jsonb;
BEGIN
 result := public._presentation_store_base(p_slug);
 IF result IS NULL OR jsonb_typeof(result) <> 'object' THEN RETURN result; END IF;
 SELECT id INTO v_tenant FROM public.tenants WHERE slug = p_slug;
 IF v_tenant IS NULL THEN RETURN result; END IF;
 SELECT jsonb_build_object('media', m.media, 'imageSeconds', s.image_seconds, 'oncePerDay', s.once_per_day)
 INTO v_presentation
 FROM public.tenant_presentation_screens s
 CROSS JOIN LATERAL (SELECT public._public_media_json(s.tenant_id, s.asset_id) AS media) m
 WHERE s.tenant_id = v_tenant AND s.enabled AND m.media IS NOT NULL;
 RETURN result || jsonb_build_object('presentation', v_presentation);
END $$;
GRANT EXECUTE ON FUNCTION public.get_public_store(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
