-- Totem do salão: ativação por usuário/senha ou dono/gerente, token de dispositivo,
-- design próprio (temas + cores validadas) e pedido com rate limit.
-- Aditivo. Não altera get_public_store, o cardápio da mesa nem a Tela inicial (colunas preservadas).
BEGIN;

DO $$ BEGIN
  IF to_regclass('public.tenant_settings') IS NULL
     OR to_regprocedure('public._tenant_role_of_caller(uuid)') IS NULL
     OR to_regprocedure('public.get_public_totem_welcome(text)') IS NULL
     OR to_regprocedure('public._totem_welcome_valid(uuid,jsonb)') IS NULL
     OR to_regclass('public.orders') IS NULL
     OR to_regclass('public.products') IS NULL
     OR to_regprocedure('public._sha256_hex(text)') IS NULL
     OR to_regprocedure('public._rate_limit_hit(text,text,uuid,integer,integer)') IS NULL
     OR to_regprocedure('extensions.crypt(text,text)') IS NULL
     OR to_regprocedure('extensions.gen_salt(text,integer)') IS NULL THEN
    RAISE EXCEPTION 'TOTEM_ACCESS_PRECHECK: baseline incompatível (aplique 20261109000200 e pgcrypto/_rate_limit_hit/_sha256_hex) ou extensão ausente.';
  END IF;
  IF to_regclass('public.totem_users') IS NOT NULL THEN
    RAISE EXCEPTION 'TOTEM_ACCESS_PRECHECK: migração já aplicada.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
CREATE TABLE public.totem_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label text NOT NULL,
  username text NOT NULL,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT totem_users_label_len CHECK (char_length(label) BETWEEN 1 AND 40),
  CONSTRAINT totem_users_username_fmt CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$')
);
CREATE UNIQUE INDEX totem_users_tenant_username ON public.totem_users (tenant_id, username);
CREATE INDEX totem_users_tenant ON public.totem_users (tenant_id);

CREATE TABLE public.totem_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  totem_user_id uuid REFERENCES public.totem_users(id) ON DELETE SET NULL,
  activated_by uuid,
  activation_kind text NOT NULL CHECK (activation_kind IN ('TOTEM_USER', 'STAFF')),
  label text NOT NULL,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT totem_devices_label_len CHECK (char_length(label) BETWEEN 1 AND 40),
  CONSTRAINT totem_devices_token_hash_hex CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT totem_devices_kind_user CHECK (
    (activation_kind = 'TOTEM_USER' AND totem_user_id IS NOT NULL)
    OR (activation_kind = 'STAFF' AND activated_by IS NOT NULL)
  )
);
CREATE UNIQUE INDEX totem_devices_token_hash ON public.totem_devices (token_hash);
CREATE UNIQUE INDEX totem_devices_one_active_user ON public.totem_devices (totem_user_id) WHERE revoked_at IS NULL AND totem_user_id IS NOT NULL;
CREATE INDEX totem_devices_tenant ON public.totem_devices (tenant_id, revoked_at);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS totem_device_id uuid REFERENCES public.totem_devices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_totem_device ON public.orders (totem_device_id) WHERE totem_device_id IS NOT NULL;

ALTER TABLE public.totem_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.totem_devices ENABLE ROW LEVEL SECURITY;
-- Sem políticas: acesso só via SECURITY DEFINER (owner das funções). Ninguém lê password_hash/token_hash pelo PostgREST.

REVOKE ALL ON TABLE public.totem_users, public.totem_devices FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.totem_users, public.totem_devices TO service_role;

COMMENT ON TABLE public.totem_users IS 'Usuários do totem (rótulo + username). Senha só em hash bcrypt. Sem acesso admin/financeiro/PII.';
COMMENT ON TABLE public.totem_devices IS 'Dispositivos ativados. O token em claro fica só no aparelho; aqui só o SHA-256.';
COMMENT ON COLUMN public.totem_users.password_hash IS 'bcrypt (extensions.crypt/gen_salt bf). Nunca gravar senha em claro.';
COMMENT ON COLUMN public.totem_devices.token_hash IS 'SHA-256 hex do token do dispositivo. O token em claro não é armazenado.';

-- ---------------------------------------------------------------------------
-- Helpers de senha, token e papel
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._totem_password_hash(p_password text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_password IS NULL OR char_length(p_password) < 8 OR char_length(p_password) > 72 THEN
    RAISE EXCEPTION 'INVALID_TOTEM_PASSWORD: use uma senha de 8 a 72 caracteres.' USING ERRCODE='22023';
  END IF;
  RETURN extensions.crypt(p_password, extensions.gen_salt('bf', 10));
END $$;

CREATE FUNCTION public._totem_password_matches(p_password text, p_hash text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p_hash IS NOT NULL AND p_password IS NOT NULL
     AND extensions.crypt(p_password, p_hash) = p_hash;
$$;

CREATE FUNCTION public._totem_new_token() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RETURN encode(extensions.gen_random_bytes(32), 'hex');
END $$;

CREATE FUNCTION public._totem_token_hash(p_token text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE
    WHEN p_token IS NOT NULL AND p_token ~ '^[0-9a-f]{64}$' THEN public._sha256_hex(p_token)
    ELSE NULL
  END;
$$;

CREATE FUNCTION public._totem_manager(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND COALESCE(public._tenant_role_of_caller(p_tenant), '') IN ('OWNER', 'MANAGER');
$$;

CREATE FUNCTION public._totem_require_manager(p_tenant uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public._totem_manager(p_tenant) THEN
    RAISE EXCEPTION 'FORBIDDEN: somente dono ou gerente gerencia o totem.' USING ERRCODE='42501';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Design do totem (jsonb validado no servidor)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._totem_design_default() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT '{
    "preset":"noturno",
    "bannerRadius":16,
    "colors":{
      "pageBg":"#0B0F14",
      "sidebarBg":"#111827",
      "sidebarCardBg":"#1F2937",
      "sidebarCardText":"#E5E7EB",
      "sidebarCardActiveBg":"#176444",
      "sidebarCardActiveText":"#FFFFFF",
      "productCardBg":"#111827",
      "productCardText":"#F9FAFB",
      "productPrice":"#6EE7B7",
      "addButtonBg":"#176444",
      "addButtonText":"#FFFFFF",
      "orderPanelBg":"#111827",
      "orderPanelText":"#F9FAFB",
      "checkoutButtonBg":"#176444",
      "checkoutButtonText":"#FFFFFF"
    }
  }'::jsonb;
$$;

CREATE FUNCTION public._totem_design_valid(p_cfg jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE
  k text;
  c jsonb;
BEGIN
  IF p_cfg IS NULL OR jsonb_typeof(p_cfg) <> 'object' OR pg_catalog.length(p_cfg::text) > 8000 THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_cfg) AS keys(key)
    WHERE key <> ALL (ARRAY['preset','bannerRadius','colors'])
  ) THEN RETURN false; END IF;
  IF jsonb_typeof(p_cfg->'preset') IS DISTINCT FROM 'string'
     OR char_length(p_cfg->>'preset') NOT BETWEEN 1 AND 32
     OR (p_cfg->>'preset') !~ '^[a-z0-9_-]+$' THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_cfg->'bannerRadius') IS DISTINCT FROM 'number'
     OR (p_cfg->>'bannerRadius') !~ '^[0-9]{1,2}$'
     OR (p_cfg->>'bannerRadius')::int > 48 THEN
    RETURN false;
  END IF;
  c := p_cfg->'colors';
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(c) AS keys(key)
    WHERE key <> ALL (ARRAY[
      'pageBg','sidebarBg','sidebarCardBg','sidebarCardText','sidebarCardActiveBg','sidebarCardActiveText',
      'productCardBg','productCardText','productPrice','addButtonBg','addButtonText',
      'orderPanelBg','orderPanelText','checkoutButtonBg','checkoutButtonText'
    ])
  ) THEN RETURN false; END IF;
  IF (
    SELECT count(*) FROM jsonb_object_keys(c)
  ) <> 15 THEN RETURN false; END IF;
  FOR k IN SELECT jsonb_object_keys(c) LOOP
    IF jsonb_typeof(c->k) IS DISTINCT FROM 'string' OR (c->>k) !~ '^#[0-9A-Fa-f]{6}$' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

ALTER TABLE public.tenant_settings ADD COLUMN totem_design jsonb;
ALTER TABLE public.tenant_settings ADD CONSTRAINT tenant_settings_totem_design_valid
  CHECK (totem_design IS NULL OR public._totem_design_valid(totem_design));
COMMENT ON COLUMN public.tenant_settings.totem_design IS 'Design do totem (preset, raio do banner, cores por elemento). NULL = padrão do tema. Hex validado no servidor.';

CREATE FUNCTION public._totem_design_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.totem_design IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.totem_design IS DISTINCT FROM OLD.totem_design) THEN
    IF NOT public._totem_manager(NEW.tenant_id) THEN
      RAISE EXCEPTION 'FORBIDDEN: somente dono ou gerente altera o design do totem.' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER totem_design_write_guard BEFORE INSERT OR UPDATE ON public.tenant_settings
  FOR EACH ROW EXECUTE FUNCTION public._totem_design_write_guard();

CREATE FUNCTION public.get_totem_design(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public._totem_require_manager(p_tenant);
  RETURN COALESCE((SELECT s.totem_design FROM public.tenant_settings s WHERE s.tenant_id = p_tenant), public._totem_design_default());
END $$;

CREATE FUNCTION public.set_totem_design(p_tenant uuid, p_cfg jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public._totem_require_manager(p_tenant);
  IF NOT public._totem_design_valid(p_cfg) THEN
    RAISE EXCEPTION 'INVALID_TOTEM_DESIGN: confira o tema, o raio e as cores em hexadecimal (#RRGGBB).' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.tenant_settings(tenant_id, totem_design, address, phone_whatsapp)
  VALUES (p_tenant, p_cfg, '', '')
  ON CONFLICT (tenant_id) DO UPDATE SET totem_design = EXCLUDED.totem_design;
  RETURN p_cfg;
END $$;

-- ---------------------------------------------------------------------------
-- Tela pública mínima (nome + logo). Sem cardápio, sem PII.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.get_public_totem_login(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'tenantId', t.id,
    'slug', t.slug,
    'name', COALESCE(th.store_name, t.name, 'Totem'),
    'logoUrl', th.logo_url,
    'accent', COALESCE(th.primary_color, '#176444')
  )
  FROM public.tenants t
  LEFT JOIN public.tenant_themes th ON th.tenant_id = t.id
  WHERE t.slug = lower(pg_catalog.btrim(p_slug)) AND t.status = 'ACTIVE'
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- Admin: usuários e dispositivos
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_create_totem_user(p_tenant uuid, p_label text, p_username text, p_password text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_id uuid;
  v_user text;
  v_label text;
BEGIN
  PERFORM public._totem_require_manager(p_tenant);
  v_label := pg_catalog.btrim(COALESCE(p_label, ''));
  v_user := lower(pg_catalog.btrim(COALESCE(p_username, '')));
  IF v_label = '' OR char_length(v_label) > 40 OR v_label ~ '[<>]' THEN
    RAISE EXCEPTION 'INVALID_TOTEM_USER: informe um rótulo de até 40 caracteres.' USING ERRCODE='22023';
  END IF;
  IF v_user !~ '^[a-z0-9][a-z0-9._-]{2,31}$' THEN
    RAISE EXCEPTION 'INVALID_TOTEM_USER: o usuário deve ter 3 a 32 caracteres (letras, números, . _ -).' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.totem_users(tenant_id, label, username, password_hash, created_by)
  VALUES (p_tenant, v_label, v_user, public._totem_password_hash(p_password), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'label', v_label, 'username', v_user, 'isActive', true);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'TOTEM_USER_EXISTS: já existe um usuário do totem com esse nome nesta loja.' USING ERRCODE='23505';
END $$;

CREATE FUNCTION public.admin_list_totem_users(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public._totem_require_manager(p_tenant);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', u.id,
      'label', u.label,
      'username', u.username,
      'isActive', u.is_active,
      'createdAt', u.created_at,
      'activeDevice', (
        SELECT jsonb_build_object('id', d.id, 'label', d.label, 'lastSeenAt', d.last_seen_at, 'createdAt', d.created_at)
        FROM public.totem_devices d
        WHERE d.totem_user_id = u.id AND d.revoked_at IS NULL
        LIMIT 1
      )
    ) ORDER BY u.created_at)
    FROM public.totem_users u WHERE u.tenant_id = p_tenant
  ), '[]'::jsonb);
END $$;

CREATE FUNCTION public.admin_set_totem_user_password(p_tenant uuid, p_user uuid, p_password text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public._totem_require_manager(p_tenant);
  UPDATE public.totem_users
     SET password_hash = public._totem_password_hash(p_password), updated_at = now()
   WHERE id = p_user AND tenant_id = p_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOTEM_USER_NOT_FOUND: usuário do totem não encontrado.' USING ERRCODE='P0002';
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_user);
END $$;

CREATE FUNCTION public.admin_set_totem_user_active(p_tenant uuid, p_user uuid, p_active boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public._totem_require_manager(p_tenant);
  UPDATE public.totem_users SET is_active = COALESCE(p_active, false), updated_at = now()
   WHERE id = p_user AND tenant_id = p_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOTEM_USER_NOT_FOUND: usuário do totem não encontrado.' USING ERRCODE='P0002';
  END IF;
  IF COALESCE(p_active, false) IS NOT TRUE THEN
    UPDATE public.totem_devices SET revoked_at = now()
     WHERE totem_user_id = p_user AND tenant_id = p_tenant AND revoked_at IS NULL;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_user, 'isActive', COALESCE(p_active, false));
END $$;

CREATE FUNCTION public.admin_list_totem_devices(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public._totem_require_manager(p_tenant);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id,
      'label', d.label,
      'kind', d.activation_kind,
      'userId', d.totem_user_id,
      'userLabel', u.label,
      'username', u.username,
      'createdAt', d.created_at,
      'lastSeenAt', d.last_seen_at,
      'revokedAt', d.revoked_at,
      'active', d.revoked_at IS NULL
    ) ORDER BY d.created_at DESC)
    FROM public.totem_devices d
    LEFT JOIN public.totem_users u ON u.id = d.totem_user_id
    WHERE d.tenant_id = p_tenant
  ), '[]'::jsonb);
END $$;

CREATE FUNCTION public.admin_revoke_totem_device(p_tenant uuid, p_device uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public._totem_require_manager(p_tenant);
  UPDATE public.totem_devices SET revoked_at = now()
   WHERE id = p_device AND tenant_id = p_tenant AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOTEM_DEVICE_NOT_FOUND: dispositivo inexistente ou já desativado.' USING ERRCODE='P0002';
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_device, 'revoked', true);
END $$;

-- ---------------------------------------------------------------------------
-- Ativação no aparelho (emite o token uma vez)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.totem_activate(
  p_slug text,
  p_username text,
  p_password text,
  p_device_label text,
  p_confirm_revoke boolean DEFAULT false,
  p_ip_hash text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_tenant uuid;
  v_user public.totem_users%ROWTYPE;
  v_existing public.totem_devices%ROWTYPE;
  v_label text;
  v_token text;
  v_device uuid;
  v_username text;
BEGIN
  v_label := pg_catalog.btrim(COALESCE(p_device_label, ''));
  IF v_label = '' THEN v_label := 'Totem'; END IF;
  IF char_length(v_label) > 40 OR v_label ~ '[<>]' THEN
    RAISE EXCEPTION 'INVALID_TOTEM_DEVICE: informe um nome de até 40 caracteres.' USING ERRCODE='22023';
  END IF;

  SELECT t.id INTO v_tenant
  FROM public.tenants t
  WHERE t.slug = lower(pg_catalog.btrim(COALESCE(p_slug, ''))) AND t.status = 'ACTIVE';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'TOTEM_STORE_NOT_FOUND: loja não encontrada ou inativa.' USING ERRCODE='P0002';
  END IF;

  v_username := lower(pg_catalog.btrim(COALESCE(p_username, '')));
  IF NOT public._rate_limit_hit('totem_activate_user', public._sha256_hex(v_tenant::text || '|' || v_username), v_tenant, 8, 60)
     OR NOT public._rate_limit_hit('totem_activate_user_slow', public._sha256_hex(v_tenant::text || '|' || v_username), v_tenant, 20, 600)
     OR (COALESCE(p_ip_hash, '') <> '' AND NOT public._rate_limit_hit('totem_activate_ip', public._sha256_hex(p_ip_hash), v_tenant, 10, 60)) THEN
    RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas. Aguarde um minuto e tente de novo.' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_user FROM public.totem_users
   WHERE tenant_id = v_tenant AND username = v_username AND is_active
   LIMIT 1;
  -- Comparação em tempo constante o máximo possível: sempre roda crypt quando há hash.
  IF v_user.id IS NULL OR NOT public._totem_password_matches(p_password, v_user.password_hash) THEN
    RAISE EXCEPTION 'TOTEM_AUTH_FAILED: usuário ou senha inválidos.' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_existing FROM public.totem_devices
   WHERE totem_user_id = v_user.id AND revoked_at IS NULL
   LIMIT 1;
  IF v_existing.id IS NOT NULL AND COALESCE(p_confirm_revoke, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'ACTIVE_DEVICE',
      'message', 'Este usuário já está ativo em outro aparelho. Ativar aqui desativa o anterior.',
      'device', jsonb_build_object('id', v_existing.id, 'label', v_existing.label, 'lastSeenAt', v_existing.last_seen_at)
    );
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.totem_devices SET revoked_at = now() WHERE id = v_existing.id AND revoked_at IS NULL;
  END IF;

  v_token := public._totem_new_token();
  INSERT INTO public.totem_devices(tenant_id, totem_user_id, activation_kind, label, token_hash)
  VALUES (v_tenant, v_user.id, 'TOTEM_USER', v_label, public._totem_token_hash(v_token))
  RETURNING id INTO v_device;

  RETURN jsonb_build_object(
    'ok', true,
    'token', v_token,
    'deviceId', v_device,
    'label', v_label,
    'userLabel', v_user.label,
    'revokedDeviceId', v_existing.id
  );
END $$;

CREATE FUNCTION public.totem_activate_as_staff(p_slug text, p_device_label text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_tenant uuid;
  v_label text;
  v_token text;
  v_device uuid;
BEGIN
  v_label := pg_catalog.btrim(COALESCE(p_device_label, ''));
  IF v_label = '' THEN v_label := 'Totem'; END IF;
  IF char_length(v_label) > 40 OR v_label ~ '[<>]' THEN
    RAISE EXCEPTION 'INVALID_TOTEM_DEVICE: informe um nome de até 40 caracteres.' USING ERRCODE='22023';
  END IF;
  SELECT t.id INTO v_tenant
  FROM public.tenants t
  WHERE t.slug = lower(pg_catalog.btrim(COALESCE(p_slug, ''))) AND t.status = 'ACTIVE';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'TOTEM_STORE_NOT_FOUND: loja não encontrada ou inativa.' USING ERRCODE='P0002';
  END IF;
  PERFORM public._totem_require_manager(v_tenant);
  v_token := public._totem_new_token();
  INSERT INTO public.totem_devices(tenant_id, activated_by, activation_kind, label, token_hash)
  VALUES (v_tenant, auth.uid(), 'STAFF', v_label, public._totem_token_hash(v_token))
  RETURNING id INTO v_device;
  RETURN jsonb_build_object('ok', true, 'token', v_token, 'deviceId', v_device, 'label', v_label, 'kind', 'STAFF');
END $$;

CREATE FUNCTION public._totem_device_ok(p_token text, OUT o_device uuid, OUT o_tenant uuid, OUT o_label text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_hash text;
BEGIN
  v_hash := public._totem_token_hash(p_token);
  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'TOTEM_DEVICE_INVALID: token ausente ou inválido.' USING ERRCODE='42501';
  END IF;
  SELECT d.id, d.tenant_id, d.label INTO o_device, o_tenant, o_label
  FROM public.totem_devices d
  WHERE d.token_hash = v_hash AND d.revoked_at IS NULL;
  IF o_device IS NULL THEN
    RAISE EXCEPTION 'TOTEM_DEVICE_INVALID: totem não ativado ou desativado.' USING ERRCODE='42501';
  END IF;
  UPDATE public.totem_devices SET last_seen_at = now() WHERE id = o_device;
END $$;

CREATE FUNCTION public.totem_current_device(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_device uuid; v_tenant uuid; v_label text;
  v_slug text; v_name text; v_logo text; v_accent text;
BEGIN
  SELECT d.o_device, d.o_tenant, d.o_label INTO v_device, v_tenant, v_label
  FROM public._totem_device_ok(p_token) AS d;
  SELECT t.slug, COALESCE(th.store_name, t.name, 'Totem'), th.logo_url, COALESCE(th.primary_color, '#176444')
    INTO v_slug, v_name, v_logo, v_accent
  FROM public.tenants t
  LEFT JOIN public.tenant_themes th ON th.tenant_id = t.id
  WHERE t.id = v_tenant;
  RETURN jsonb_build_object(
    'ok', true,
    'deviceId', v_device,
    'label', v_label,
    'tenantId', v_tenant,
    'slug', v_slug,
    'name', v_name,
    'logoUrl', v_logo,
    'accent', v_accent,
    'welcome', COALESCE((SELECT s.totem_welcome FROM public.tenant_settings s WHERE s.tenant_id = v_tenant), public._totem_welcome_default()),
    'design', COALESCE((SELECT s.totem_design FROM public.tenant_settings s WHERE s.tenant_id = v_tenant), public._totem_design_default())
  );
END $$;

CREATE FUNCTION public.get_totem_store(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_device uuid; v_tenant uuid; v_label text;
  v_slug text;
  v_store jsonb := '{}'::jsonb;
BEGIN
  SELECT d.o_device, d.o_tenant, d.o_label INTO v_device, v_tenant, v_label
  FROM public._totem_device_ok(p_token) AS d;
  SELECT t.slug INTO v_slug FROM public.tenants t WHERE t.id = v_tenant;
  IF to_regprocedure('public.get_public_store(text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.get_public_store($1)' INTO v_store USING v_slug;
  END IF;
  IF v_store IS NULL OR jsonb_typeof(v_store) <> 'object' THEN
    v_store := '{}'::jsonb;
  END IF;
  RETURN v_store || jsonb_build_object(
    'totemDeviceId', v_device,
    'totemDeviceLabel', v_label,
    'totemWelcome', COALESCE((SELECT s.totem_welcome FROM public.tenant_settings s WHERE s.tenant_id = v_tenant), public._totem_welcome_default()),
    'totemDesign', COALESCE((SELECT s.totem_design FROM public.tenant_settings s WHERE s.tenant_id = v_tenant), public._totem_design_default())
  );
END $$;

-- ---------------------------------------------------------------------------
-- Pedido do totem (preço no servidor, exige token, rate limit por dispositivo)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.create_totem_order(p_token text, p_items jsonb, p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_device uuid; v_tenant uuid; v_label text;
  v_item jsonb;
  v_pid uuid;
  v_qty int;
  v_price numeric(10,2);
  v_name text;
  v_subtotal numeric(10,2) := 0;
  v_order uuid;
  v_existing uuid;
  v_notes text;
BEGIN
  SELECT d.o_device, d.o_tenant, d.o_label INTO v_device, v_tenant, v_label
  FROM public._totem_device_ok(p_token) AS d;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_TOTEM_ORDER: informe a chave de idempotência.' USING ERRCODE='22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' AND column_name='idempotency_key'
  ) THEN
    EXECUTE 'SELECT id FROM public.orders WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1'
      INTO v_existing USING v_tenant, p_idempotency_key;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'orderId', v_existing, 'idempotent', true);
    END IF;
  END IF;

  IF NOT public._rate_limit_hit('totem_order_device', v_device::text, v_tenant, 12, 300) THEN
    RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas de pedido neste totem. Aguarde um pouco.' USING ERRCODE='P0001';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'INVALID_TOTEM_ORDER: envie de 1 a 50 itens.' USING ERRCODE='22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _totem_order_lines (
    product_id uuid,
    product_name text,
    quantity int,
    unit_price numeric(10,2),
    total_price numeric(10,2),
    notes text
  ) ON COMMIT DROP;
  DELETE FROM _totem_order_lines;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'INVALID_TOTEM_ORDER: item inválido.' USING ERRCODE='22023';
    END IF;
    BEGIN
      v_pid := (v_item->>'productId')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'INVALID_TOTEM_ORDER: produto inválido.' USING ERRCODE='22023';
    END;
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty < 1 OR v_qty > 99 THEN
      RAISE EXCEPTION 'INVALID_TOTEM_ORDER: quantidade deve ser entre 1 e 99.' USING ERRCODE='22023';
    END IF;
    v_notes := NULLIF(pg_catalog.btrim(COALESCE(v_item->>'notes', '')), '');
    IF v_notes IS NOT NULL AND char_length(v_notes) > 200 THEN
      RAISE EXCEPTION 'INVALID_TOTEM_ORDER: observação longa demais.' USING ERRCODE='22023';
    END IF;
    SELECT p.name, p.price INTO v_name, v_price
    FROM public.products p
    WHERE p.id = v_pid AND p.tenant_id = v_tenant AND p.is_active
    LIMIT 1;
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'INVALID_TOTEM_ORDER: um dos produtos não está disponível.' USING ERRCODE='22023';
    END IF;
    INSERT INTO _totem_order_lines VALUES (v_pid, v_name, v_qty, v_price, v_price * v_qty, v_notes);
    v_subtotal := v_subtotal + (v_price * v_qty);
  END LOOP;

  -- idempotency_key is immutable after insert (_orders_protect_columns). Set it here, never UPDATE.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' AND column_name='idempotency_key'
  ) THEN
    INSERT INTO public.orders (
      tenant_id, customer_name, customer_phone, delivery_address,
      subtotal, delivery_fee, discount, total_amount,
      payment_method, payment_status, fulfillment_type, status, notes, origin, totem_device_id, idempotency_key
    ) VALUES (
      v_tenant, v_label, '-', 'Totem do salão',
      v_subtotal, 0, 0, v_subtotal,
      'CASH', 'PAYMENT_ON_DELIVERY', 'PICKUP', 'CONFIRMED', 'Pedido do totem do salão', 'direct', v_device, p_idempotency_key
    ) RETURNING id INTO v_order;
  ELSE
    INSERT INTO public.orders (
      tenant_id, customer_name, customer_phone, delivery_address,
      subtotal, delivery_fee, discount, total_amount,
      payment_method, payment_status, fulfillment_type, status, notes, origin, totem_device_id
    ) VALUES (
      v_tenant, v_label, '-', 'Totem do salão',
      v_subtotal, 0, 0, v_subtotal,
      'CASH', 'PAYMENT_ON_DELIVERY', 'PICKUP', 'CONFIRMED', 'Pedido do totem do salão', 'direct', v_device
    ) RETURNING id INTO v_order;
  END IF;

  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, notes)
  SELECT v_order, product_id, product_name, quantity, unit_price, total_price, notes FROM _totem_order_lines;

  IF to_regclass('public.order_status_history') IS NOT NULL THEN
    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (v_order, 'CONFIRMED', 'Pedido criado no totem do salão', 'totem');
  END IF;

  RETURN jsonb_build_object('ok', true, 'orderId', v_order, 'total', v_subtotal, 'idempotent', false);
END $$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public._totem_password_hash(text),
  public._totem_password_matches(text,text),
  public._totem_new_token(),
  public._totem_token_hash(text),
  public._totem_manager(uuid),
  public._totem_require_manager(uuid),
  public._totem_design_default(),
  public._totem_design_valid(jsonb),
  public._totem_design_write_guard(),
  public.get_totem_design(uuid),
  public.set_totem_design(uuid,jsonb),
  public.get_public_totem_login(text),
  public.admin_create_totem_user(uuid,text,text,text),
  public.admin_list_totem_users(uuid),
  public.admin_set_totem_user_password(uuid,uuid,text),
  public.admin_set_totem_user_active(uuid,uuid,boolean),
  public.admin_list_totem_devices(uuid),
  public.admin_revoke_totem_device(uuid,uuid),
  public.totem_activate(text,text,text,text,boolean,text),
  public.totem_activate_as_staff(text,text),
  public._totem_device_ok(text),
  public.totem_current_device(text),
  public.get_totem_store(text),
  public.create_totem_order(text,jsonb,uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public._totem_design_valid(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_totem_design(uuid), public.set_totem_design(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_totem_user(uuid,text,text,text),
  public.admin_list_totem_users(uuid),
  public.admin_set_totem_user_password(uuid,uuid,text),
  public.admin_set_totem_user_active(uuid,uuid,boolean),
  public.admin_list_totem_devices(uuid),
  public.admin_revoke_totem_device(uuid,uuid),
  public.totem_activate_as_staff(text,text)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.get_public_totem_login(text),
  public.totem_activate(text,text,text,text,boolean,text),
  public.totem_current_device(text),
  public.get_totem_store(text),
  public.create_totem_order(text,jsonb,uuid)
TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
