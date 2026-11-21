-- Abertura opcional de loja, sem marca da plataforma, e dependente do módulo store_presentation.
-- Aditiva: nenhuma linha existente muda. Mídia vem do fluxo governado N3 (bucket privado "marketing" com
-- caminho definido pelo servidor por tenant -> publicação em "marketing-public").
-- Leitura pública: só os campos da tela PUBLICADA, dentro de get_public_store. Escrita: só OWNER/MANAGER do tenant.
BEGIN;

DO $pre$
BEGIN
 IF to_regclass('public.marketing_media_assets') IS NULL
  OR to_regclass('public.tenant_modules') IS NULL
  OR to_regprocedure('public.is_tenant_owner_or_manager(uuid)') IS NULL
  OR to_regprocedure('public._public_media_json(uuid,uuid)') IS NULL
  OR to_regprocedure('public.get_public_store(text)') IS NULL
  OR to_regprocedure('public.set_tenant_module(uuid,text,boolean,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'PRESENTATION PRE: pré-requisitos N3/N6/módulos ausentes';
 END IF;
END
$pre$;

-- Definição original de get_public_store, para o rollback restaurar exatamente.
CREATE TABLE IF NOT EXISTS public._presentation_20261118_restore(signature text PRIMARY KEY, definition text NOT NULL);
REVOKE ALL ON public._presentation_20261118_restore FROM PUBLIC, anon, authenticated;
INSERT INTO public._presentation_20261118_restore
SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid) FROM pg_proc p
WHERE p.oid IN ('public.get_public_store(text)'::regprocedure, 'public.set_tenant_module(uuid,text,boolean,jsonb)'::regprocedure)
ON CONFLICT (signature) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tenant_presentation_screens (
 tenant_id     uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
 asset_id      uuid NOT NULL REFERENCES public.marketing_media_assets(id) ON DELETE CASCADE,
 media_type    varchar(8) NOT NULL CHECK (media_type IN ('IMAGE','VIDEO')),
 image_seconds numeric(3,1) NOT NULL DEFAULT 3 CHECK (image_seconds BETWEEN 1 AND 5),
 once_per_day  boolean NOT NULL DEFAULT false,
 enabled       boolean NOT NULL DEFAULT true,
 updated_by    uuid,
 updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_presentation_screens ENABLE ROW LEVEL SECURITY;
-- Painel: dono/gerente lê a própria configuração. Escrita só pelas RPCs abaixo (sem INSERT/UPDATE/DELETE direto).
DO $policy$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tenant_presentation_screens'
    AND policyname = 'presentation_manager_read') THEN
  CREATE POLICY presentation_manager_read ON public.tenant_presentation_screens FOR SELECT TO authenticated
   USING (public.is_tenant_owner_or_manager(tenant_id));
 END IF;
END $policy$;
REVOKE ALL ON public.tenant_presentation_screens FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tenant_presentation_screens TO authenticated;

-- Nova ferramenta opcional: nenhuma linha criada por padrão. Ausência = desligada.
ALTER TABLE public.tenant_modules DROP CONSTRAINT IF EXISTS tenant_modules_module_key_check;
ALTER TABLE public.tenant_modules ADD CONSTRAINT tenant_modules_module_key_check
 CHECK (module_key IN ('delivery','pickup','addons','kds','dine_in','counter','service_fee',
 'printing','weight','barcode','substitution','variants','reserve_exchange','scheduling',
 'quotes','street_vendor','pos','loyalty','credit_tab','store_presentation'));

-- Owner mantém controle dos outros módulos; gerente só pode alternar este módulo.
CREATE OR REPLACE FUNCTION public.set_tenant_module(
  p_tenant uuid,
  p_key text,
  p_enabled boolean,
  p_config jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_previous_enabled boolean;
  v_previous_config jsonb;
  v_blockers text[];
  v_config jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Faça login para alterar os módulos.';
  END IF;

  SELECT tu.role_id INTO v_role
  FROM public.tenant_users tu
  WHERE tu.tenant_id = p_tenant
    AND tu.user_id = auth.uid()
    AND tu.status = 'ACTIVE';

  IF v_role IS DISTINCT FROM 'OWNER' AND NOT (p_key = 'store_presentation' AND v_role = 'MANAGER') THEN
    RAISE EXCEPTION 'MODULE_OWNER_REQUIRED: Apenas o proprietário pode alterar os módulos.';
  END IF;

  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'MODULE_INVALID: Informe se o módulo deve ficar ativado ou desativado.';
  END IF;

  IF p_key IS NULL OR p_key NOT IN (
    'delivery', 'pickup', 'addons', 'kds', 'dine_in', 'counter', 'service_fee',
    'printing', 'weight', 'barcode', 'substitution', 'variants', 'reserve_exchange',
    'scheduling', 'quotes', 'street_vendor', 'pos', 'loyalty', 'credit_tab', 'store_presentation'
  ) THEN
    RAISE EXCEPTION 'MODULE_INVALID: Módulo inválido.';
  END IF;

  IF p_enabled AND p_key = 'service_fee' AND NOT EXISTS (
    SELECT 1 FROM public.tenant_modules tm
    WHERE tm.tenant_id = p_tenant AND tm.module_key IN ('dine_in', 'counter') AND tm.enabled
  ) THEN
    RAISE EXCEPTION 'MODULE_DEPENDENCY: Taxa de serviço precisa de Mesa ou Balcão.';
  END IF;

  IF p_enabled AND p_key = 'kds' AND NOT EXISTS (
    SELECT 1 FROM public.tenant_modules tm
    WHERE tm.tenant_id = p_tenant AND tm.module_key IN ('pickup', 'counter') AND tm.enabled
  ) THEN
    RAISE EXCEPTION 'MODULE_DEPENDENCY: Chamar no TV precisa de Retirada ou Balcão.';
  END IF;

  IF NOT p_enabled THEN
    v_blockers := public._tenant_module_disable_blockers(p_tenant, p_key);
    IF COALESCE(pg_catalog.cardinality(v_blockers), 0) > 0 THEN
      RAISE EXCEPTION 'MODULE_HAS_OPEN_ITEMS: Feche primeiro: %', pg_catalog.array_to_string(v_blockers, ', ');
    END IF;
  END IF;

  SELECT tm.enabled, tm.config
  INTO v_previous_enabled, v_previous_config
  FROM public.tenant_modules tm
  WHERE tm.tenant_id = p_tenant AND tm.module_key = p_key;

  v_config := CASE
    WHEN p_config IS NULL OR (p_config = '{}'::jsonb AND COALESCE(v_previous_config, '{}'::jsonb) <> '{}'::jsonb)
      THEN COALESCE(v_previous_config, '{}'::jsonb)
    ELSE p_config
  END;

  INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, config, updated_by, updated_at)
  VALUES (p_tenant, p_key, p_enabled, v_config, auth.uid(), pg_catalog.now())
  ON CONFLICT (tenant_id, module_key) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        config = EXCLUDED.config,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at
    WHERE public.tenant_modules.enabled IS DISTINCT FROM EXCLUDED.enabled
       OR public.tenant_modules.config IS DISTINCT FROM EXCLUDED.config;

  IF v_previous_enabled IS DISTINCT FROM p_enabled OR v_previous_config IS DISTINCT FROM v_config THEN
    PERFORM public.log_audit_event(
      'TENANT_MODULE_UPDATED',
      'tenant_modules',
      pg_catalog.format('Módulo %s %s.', p_key, CASE WHEN p_enabled THEN 'ativado' ELSE 'desativado' END),
      p_key,
      pg_catalog.jsonb_build_object('enabled', COALESCE(v_previous_enabled, false), 'config', COALESCE(v_previous_config, '{}'::jsonb))::text,
      pg_catalog.jsonb_build_object('enabled', p_enabled, 'config', v_config)::text,
      p_tenant
    );
  END IF;
END;
$$;


REVOKE ALL ON FUNCTION public.set_tenant_module(uuid,text,boolean,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_module(uuid,text,boolean,jsonb) TO authenticated;

-- Limites (também validados no navegador): imagem até 3 MB; vídeo até 15 MB e 10 s.
CREATE OR REPLACE FUNCTION public.set_presentation_screen(p_tenant_id uuid, p_asset_id uuid, p_image_seconds numeric DEFAULT 3, p_once_per_day boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.marketing_media_assets; v_seconds numeric;
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL OR NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
  RAISE EXCEPTION 'FORBIDDEN: somente dono ou gerente' USING ERRCODE = '42501';
 END IF;
 PERFORM public.assert_tenant_module_enabled(p_tenant_id, 'store_presentation');

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
 v_seconds := round(COALESCE(p_image_seconds, 3), 1);
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

CREATE OR REPLACE FUNCTION public.clear_presentation_screen(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL OR NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
  RAISE EXCEPTION 'FORBIDDEN: só o dono ou gerente da loja altera a tela inicial.' USING ERRCODE = '42501';
 END IF;
 PERFORM public.assert_tenant_module_enabled(p_tenant_id, 'store_presentation');
 DELETE FROM public.tenant_presentation_screens WHERE tenant_id = p_tenant_id;
END $$;

REVOKE ALL ON FUNCTION public.set_presentation_screen(uuid,uuid,numeric,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_presentation_screen(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_presentation_screen(uuid,uuid,numeric,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_presentation_screen(uuid) TO authenticated;

-- get_public_store: mesma resposta de antes + "presentation" (só se ativa e a mídia continua PUBLICADA).
DO $base$ DECLARE d text; BEGIN
 IF to_regprocedure('public._presentation_store_base(text)') IS NULL THEN
  SELECT definition INTO d FROM public._presentation_20261118_restore
    WHERE signature IN ('get_public_store(text)','public.get_public_store(text)');
  IF d IS NULL THEN RAISE EXCEPTION 'PRESENTATION PRE: sem definição da RPC pública'; END IF;
  EXECUTE replace(d, 'public.get_public_store(', 'public._presentation_store_base(');
 END IF;
END $base$;
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
 WHERE s.tenant_id = v_tenant AND s.enabled AND m.media IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.tenant_modules tm
    WHERE tm.tenant_id = v_tenant AND tm.module_key = 'store_presentation' AND tm.enabled);
 RETURN result || jsonb_build_object('presentation', v_presentation);
END $$;
GRANT EXECUTE ON FUNCTION public.get_public_store(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
