-- 20261019002300_kitchen_screen.sql
-- Tela da Cozinha (opcional, desligada por padrão): pareamento de aparelho por QR (login anônimo do Supabase +
-- kitchen_devices), código de 8 caracteres com hash, uso único, 10 min; PIN opcional (bcrypt); revogação imediata;
-- cozinha só faz CONFIRMED->PREPARING e PREPARING->READY; sem preços/PII (só primeiro nome em RETIRADA).
-- Endurecimento anônimo: handle_new_auth_user ignora usuário sem e-mail/anônimo; anônimo não cria customers/orders.
-- 100% ADITIVA (tabelas/funções/triggers novos + handle_new_auth_user com 1 bloco a mais). Nenhum dado alterado.
-- Rollback: supabase/rollback/20261019002300_kitchen_screen_down.sql
BEGIN;

DO $$ BEGIN
    IF to_regprocedure('public._sha256_hex(text)') IS NULL OR to_regprocedure('public._tenant_role_of_caller(uuid)') IS NULL
       OR to_regprocedure('public._rate_limit_hit(text,text,uuid,integer,integer)') IS NULL
       OR to_regprocedure('extensions.crypt(text,text)') IS NULL THEN
        RAISE EXCEPTION 'PRECHECK 2300: dependência ausente (N1 / pgcrypto).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RAISE EXCEPTION 'PRECHECK 2300: publicação supabase_realtime ausente.';
    END IF;
END $$;

-- 1. Provisionamento: usuário anônimo (ou sem e-mail) não vira public.users e não falha.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name pg_catalog.varchar(255);
BEGIN
    -- 2300: login anônimo (aparelho da cozinha) ou conta sem e-mail: sem perfil em public.users.
    IF COALESCE((pg_catalog.to_jsonb(NEW) ->> 'is_anonymous')::boolean, false) OR NEW.email IS NULL THEN
        RETURN NEW;
    END IF;

    -- Obtém o nome real a partir de raw_user_meta_data quando disponível
    v_name := COALESCE(
        NEW.raw_user_meta_data->>'name',
        NEW.raw_user_meta_data->>'full_name',
        pg_catalog.split_part(NEW.email, '@', 1)
    );

    INSERT INTO public.users (id, name, email, phone, avatar_url, created_at, updated_at)
    VALUES (NEW.id, v_name, NEW.email, NEW.raw_user_meta_data->>'phone', NEW.raw_user_meta_data->>'avatar_url', pg_catalog.now(), pg_catalog.now())
    ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name, email = EXCLUDED.email,
        phone = COALESCE(EXCLUDED.phone, public.users.phone),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
        updated_at = pg_catalog.now();
    RETURN NEW;
END;
$$;

-- 2. Anônimo nunca cria dados de cliente.
CREATE OR REPLACE FUNCTION public._block_anonymous_writes() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO ''
    AS $$
BEGIN
    IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
        RAISE EXCEPTION 'ANONYMOUS_FORBIDDEN: entre com sua conta para continuar.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._block_anonymous_writes() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_customers_block_anonymous ON public.customers;
CREATE TRIGGER trg_customers_block_anonymous BEFORE INSERT OR UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public._block_anonymous_writes();
DROP TRIGGER IF EXISTS trg_orders_block_anonymous ON public.orders;
CREATE TRIGGER trg_orders_block_anonymous BEFORE INSERT ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public._block_anonymous_writes();

-- 3. Tabelas (RLS ligado; escrita só por RPC).
CREATE TABLE IF NOT EXISTS public.kitchen_settings (
    tenant_id  uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    enabled    boolean NOT NULL DEFAULT false,
    pin_hash   text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid
);
CREATE TABLE IF NOT EXISTS public.kitchen_pairing_codes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    code_hash   text NOT NULL UNIQUE,
    device_name text,
    created_by  uuid NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    used_by_device uuid
);
CREATE TABLE IF NOT EXISTS public.kitchen_devices (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id        uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
    user_agent     text CHECK (user_agent IS NULL OR length(user_agent) <= 200),
    created_by     uuid,
    created_at     timestamptz NOT NULL DEFAULT now(),
    last_seen_at   timestamptz,
    unlocked_until timestamptz,
    revoked_at     timestamptz,
    revoked_by     uuid
);
CREATE INDEX IF NOT EXISTS ix_kitchen_devices_tenant ON public.kitchen_devices (tenant_id);
CREATE TABLE IF NOT EXISTS public.kitchen_order_signals (
    order_id   uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
    tenant_id  uuid NOT NULL,
    status     varchar(32) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_kitchen_signals_tenant ON public.kitchen_order_signals (tenant_id);
ALTER TABLE public.kitchen_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_order_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitchen_settings, public.kitchen_pairing_codes, public.kitchen_devices, public.kitchen_order_signals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.kitchen_order_signals TO authenticated;

-- 4. Helpers.
CREATE OR REPLACE FUNCTION public._kitchen_device_of_caller() RETURNS public.kitchen_devices
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
    SELECT d.* FROM public.kitchen_devices d
    JOIN public.tenants t ON t.id = d.tenant_id AND t.status = 'ACTIVE'
    JOIN public.kitchen_settings s ON s.tenant_id = d.tenant_id AND s.enabled
    WHERE d.user_id = auth.uid() AND d.revoked_at IS NULL
    LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public._kitchen_can_read_tenant(p_tenant_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
    SELECT auth.uid() IS NOT NULL AND (
        EXISTS (SELECT 1 FROM public.kitchen_devices d
                JOIN public.tenants t ON t.id = d.tenant_id AND t.status = 'ACTIVE'
                JOIN public.kitchen_settings s ON s.tenant_id = d.tenant_id AND s.enabled
                WHERE d.user_id = auth.uid() AND d.revoked_at IS NULL AND d.tenant_id = p_tenant_id
                  AND (s.pin_hash IS NULL OR d.unlocked_until > now()))
        OR (COALESCE(public._tenant_role_of_caller(p_tenant_id), '') IN ('OWNER','MANAGER','OPERATOR','CASHIER')
            AND EXISTS (SELECT 1 FROM public.kitchen_settings s WHERE s.tenant_id = p_tenant_id AND s.enabled)))
$$;

CREATE OR REPLACE FUNCTION public._kitchen_assert_manager(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
BEGIN
    IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(p_tenant_id), '') NOT IN ('OWNER','MANAGER') THEN
        RAISE EXCEPTION 'FORBIDDEN: só dono ou gerente.' USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._kitchen_new_code() RETURNS text
    LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp
    AS $$
DECLARE a text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; b bytea := extensions.gen_random_bytes(8); r text := ''; i int;
BEGIN
    FOR i IN 0..7 LOOP r := r || substr(a, (get_byte(b, i) % length(a)) + 1, 1); END LOOP;
    RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public._kitchen_device_of_caller(), public._kitchen_assert_manager(uuid), public._kitchen_new_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._kitchen_can_read_tenant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._kitchen_can_read_tenant(uuid) TO authenticated;

DROP POLICY IF EXISTS kitchen_signals_select ON public.kitchen_order_signals;
CREATE POLICY kitchen_signals_select ON public.kitchen_order_signals FOR SELECT TO authenticated
    USING (public._kitchen_can_read_tenant(tenant_id));

-- 5. Sinal sem PII para o realtime da cozinha.
CREATE OR REPLACE FUNCTION public._orders_kitchen_signal() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
BEGIN
    INSERT INTO public.kitchen_order_signals (order_id, tenant_id, status, updated_at)
    VALUES (NEW.id, NEW.tenant_id, NEW.status, now())
    ON CONFLICT (order_id) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._orders_kitchen_signal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_orders_kitchen_signal ON public.orders;
CREATE TRIGGER trg_orders_kitchen_signal AFTER INSERT OR UPDATE OF status ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public._orders_kitchen_signal();
INSERT INTO public.kitchen_order_signals (order_id, tenant_id, status, updated_at)
SELECT id, tenant_id, status, now() FROM public.orders WHERE status NOT IN ('DELIVERED','CANCELLED')
ON CONFLICT (order_id) DO NOTHING;

-- 6. RPCs do dono/gerente.
CREATE OR REPLACE FUNCTION public.get_kitchen_settings(p_tenant_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
DECLARE v RECORD;
BEGIN
    IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(p_tenant_id), '') NOT IN ('OWNER','MANAGER','OPERATOR','CASHIER') THEN
        RAISE EXCEPTION 'FORBIDDEN: sem acesso a esta loja.' USING ERRCODE = '42501';
    END IF;
    SELECT enabled, pin_hash IS NOT NULL AS has_pin INTO v FROM public.kitchen_settings WHERE tenant_id = p_tenant_id;
    RETURN jsonb_build_object('enabled', COALESCE(v.enabled, false), 'has_pin', COALESCE(v.has_pin, false),
        'active_devices', (SELECT count(*) FROM public.kitchen_devices WHERE tenant_id = p_tenant_id AND revoked_at IS NULL));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_kitchen_settings(p_tenant_id uuid, p_enabled boolean, p_pin text DEFAULT NULL, p_clear_pin boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
BEGIN
    PERFORM public._kitchen_assert_manager(p_tenant_id);
    IF p_pin IS NOT NULL AND p_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'PIN_FORMAT: o PIN deve ter 4 números.'; END IF;
    INSERT INTO public.kitchen_settings (tenant_id, enabled, pin_hash, updated_at, updated_by)
    VALUES (p_tenant_id, COALESCE(p_enabled, false),
            CASE WHEN p_pin IS NOT NULL THEN extensions.crypt(p_pin, extensions.gen_salt('bf')) END, now(), auth.uid())
    ON CONFLICT (tenant_id) DO UPDATE SET
        enabled = COALESCE(p_enabled, public.kitchen_settings.enabled),
        pin_hash = CASE WHEN p_clear_pin THEN NULL WHEN p_pin IS NOT NULL THEN extensions.crypt(p_pin, extensions.gen_salt('bf')) ELSE public.kitchen_settings.pin_hash END,
        updated_at = now(), updated_by = auth.uid();
    IF p_pin IS NOT NULL OR p_clear_pin THEN
        UPDATE public.kitchen_devices SET unlocked_until = NULL WHERE tenant_id = p_tenant_id;
    END IF;
    PERFORM public.log_audit_event('KITCHEN_SETTINGS_CHANGED', 'kitchen_settings',
        'Tela da Cozinha: ' || CASE WHEN COALESCE(p_enabled, false) THEN 'ligada' ELSE 'desligada' END
        || CASE WHEN p_clear_pin THEN ', PIN removido' WHEN p_pin IS NOT NULL THEN ', PIN definido' ELSE '' END,
        p_tenant_id::text, NULL, NULL, p_tenant_id);
    RETURN public.get_kitchen_settings(p_tenant_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_kitchen_pairing_code(p_tenant_id uuid, p_device_name text DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
DECLARE v_code text; v_exp timestamptz := now() + interval '10 minutes';
BEGIN
    PERFORM public._kitchen_assert_manager(p_tenant_id);
    IF NOT EXISTS (SELECT 1 FROM public.kitchen_settings WHERE tenant_id = p_tenant_id AND enabled) THEN
        RAISE EXCEPTION 'KITCHEN_DISABLED: ligue a Tela da Cozinha primeiro.';
    END IF;
    IF NOT public._rate_limit_hit('kitchen_code', auth.uid()::text, p_tenant_id, 20, 600) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas; aguarde alguns minutos.';
    END IF;
    IF (SELECT count(*) FROM public.kitchen_pairing_codes WHERE tenant_id = p_tenant_id AND used_at IS NULL AND expires_at > now()) >= 5 THEN
        RAISE EXCEPTION 'TOO_MANY_CODES: já existem 5 códigos válidos; aguarde expirarem.';
    END IF;
    LOOP
        v_code := public._kitchen_new_code();
        BEGIN
            INSERT INTO public.kitchen_pairing_codes (tenant_id, code_hash, device_name, created_by, expires_at)
            VALUES (p_tenant_id, public._sha256_hex(v_code), NULLIF(btrim(COALESCE(p_device_name, '')), ''), auth.uid(), v_exp);
            EXIT;
        EXCEPTION WHEN unique_violation THEN NULL;
        END;
    END LOOP;
    RETURN jsonb_build_object('code', v_code, 'expires_at', v_exp);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_kitchen_devices(p_tenant_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
BEGIN
    PERFORM public._kitchen_assert_manager(p_tenant_id);
    RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'created_at', created_at,
        'last_seen_at', last_seen_at, 'revoked_at', revoked_at) ORDER BY created_at DESC)
        FROM public.kitchen_devices WHERE tenant_id = p_tenant_id), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_kitchen_device(p_device_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
DECLARE v_t uuid;
BEGIN
    SELECT tenant_id INTO v_t FROM public.kitchen_devices WHERE id = p_device_id;
    IF v_t IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: aparelho não encontrado.' USING ERRCODE = '42501'; END IF;
    PERFORM public._kitchen_assert_manager(v_t);
    UPDATE public.kitchen_devices SET revoked_at = COALESCE(revoked_at, now()), revoked_by = COALESCE(revoked_by, auth.uid()) WHERE id = p_device_id;
    PERFORM public.log_audit_event('KITCHEN_DEVICE_REVOKED', 'kitchen_devices', 'Aparelho da cozinha desconectado', p_device_id::text, NULL, NULL, v_t);
    RETURN jsonb_build_object('revoked', true);
END;
$$;

-- 7. Aparelho (usuário anônimo): parear, contexto, PIN.
CREATE OR REPLACE FUNCTION public.redeem_kitchen_pairing_code(p_code text, p_device_name text, p_user_agent text DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
DECLARE
    v_code text := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
    v_c RECORD; v_dev uuid; v_t RECORD; v_pin boolean;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE = '42501'; END IF;
    IF NOT COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
        RAISE EXCEPTION 'USE_STAFF_LOGIN: você já está logado com uma conta; abra a Tela da Cozinha pelo painel.';
    END IF;
    IF NOT public._rate_limit_hit('kitchen_redeem', auth.uid()::text, NULL, 10, 600) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas; aguarde alguns minutos.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.kitchen_devices WHERE user_id = auth.uid() AND revoked_at IS NULL) THEN
        RAISE EXCEPTION 'ALREADY_PAIRED: este aparelho já está conectado a uma loja.';
    END IF;
    SELECT * INTO v_c FROM public.kitchen_pairing_codes WHERE code_hash = public._sha256_hex(v_code) FOR UPDATE;
    IF NOT FOUND OR v_c.used_at IS NOT NULL OR v_c.expires_at <= now()
       OR NOT EXISTS (SELECT 1 FROM public.kitchen_settings s JOIN public.tenants t ON t.id = s.tenant_id
                      WHERE s.tenant_id = v_c.tenant_id AND s.enabled AND t.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'PAIRING_CODE_INVALID: código inválido ou expirado. Peça um novo ao dono.';
    END IF;
    -- aparelho revogado com o mesmo login anônimo: o app sai e entra com um login anônimo novo (nada é apagado)
    IF EXISTS (SELECT 1 FROM public.kitchen_devices WHERE user_id = auth.uid()) THEN
        RAISE EXCEPTION 'KITCHEN_DEVICE_REVOKED: este aparelho foi desconectado pela loja.';
    END IF;
    INSERT INTO public.kitchen_devices (tenant_id, user_id, name, user_agent, created_by, last_seen_at)
    VALUES (v_c.tenant_id, auth.uid(), left(COALESCE(NULLIF(btrim(p_device_name), ''), v_c.device_name, 'Cozinha'), 40),
            left(p_user_agent, 200), v_c.created_by, now())
    RETURNING id INTO v_dev;
    UPDATE public.kitchen_pairing_codes SET used_at = now(), used_by_device = v_dev WHERE id = v_c.id;
    SELECT id, name, slug INTO v_t FROM public.tenants WHERE id = v_c.tenant_id;
    SELECT pin_hash IS NOT NULL INTO v_pin FROM public.kitchen_settings WHERE tenant_id = v_c.tenant_id;
    PERFORM public.log_audit_event('KITCHEN_DEVICE_PAIRED', 'kitchen_devices', 'Aparelho da cozinha conectado', v_dev::text, NULL, NULL, v_c.tenant_id);
    RETURN jsonb_build_object('device_id', v_dev, 'tenant_id', v_t.id, 'store_name', v_t.name, 'slug', v_t.slug, 'pin_required', v_pin);
END;
$$;

CREATE OR REPLACE FUNCTION public.kitchen_get_context(p_tenant_id uuid DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
DECLARE d public.kitchen_devices; v_pin boolean; v_name text; v_any RECORD;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE = '42501'; END IF;
    IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
        d := public._kitchen_device_of_caller();
        IF d.id IS NULL THEN
            SELECT k.revoked_at, s.enabled INTO v_any FROM public.kitchen_devices k
            LEFT JOIN public.kitchen_settings s ON s.tenant_id = k.tenant_id WHERE k.user_id = auth.uid();
            IF NOT FOUND THEN RAISE EXCEPTION 'NOT_PAIRED: aparelho não conectado.'; END IF;
            IF v_any.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'KITCHEN_DEVICE_REVOKED: este aparelho foi desconectado pela loja.'; END IF;
            RAISE EXCEPTION 'KITCHEN_DISABLED: a Tela da Cozinha está desligada nesta loja.';
        END IF;
        UPDATE public.kitchen_devices SET last_seen_at = now() WHERE id = d.id AND (last_seen_at IS NULL OR last_seen_at < now() - interval '60 seconds');
        SELECT pin_hash IS NOT NULL INTO v_pin FROM public.kitchen_settings WHERE tenant_id = d.tenant_id;
        SELECT name INTO v_name FROM public.tenants WHERE id = d.tenant_id;
        RETURN jsonb_build_object('mode', 'device', 'tenant_id', d.tenant_id, 'store_name', v_name, 'device_name', d.name,
            'pin_required', v_pin, 'locked', v_pin AND NOT COALESCE(d.unlocked_until > now(), false));
    END IF;
    IF p_tenant_id IS NULL OR COALESCE(public._tenant_role_of_caller(p_tenant_id), '') NOT IN ('OWNER','MANAGER','OPERATOR','CASHIER') THEN
        RAISE EXCEPTION 'FORBIDDEN: seu perfil não abre a Tela da Cozinha.' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.kitchen_settings WHERE tenant_id = p_tenant_id AND enabled) THEN
        RAISE EXCEPTION 'KITCHEN_DISABLED: a Tela da Cozinha está desligada nesta loja.';
    END IF;
    SELECT name INTO v_name FROM public.tenants WHERE id = p_tenant_id;
    RETURN jsonb_build_object('mode', 'staff', 'tenant_id', p_tenant_id, 'store_name', v_name, 'pin_required', false, 'locked', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.kitchen_unlock(p_pin text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
DECLARE d public.kitchen_devices; v_hash text; v_until timestamptz := now() + interval '12 hours';
BEGIN
    d := public._kitchen_device_of_caller();
    IF d.id IS NULL THEN RAISE EXCEPTION 'KITCHEN_DEVICE_REVOKED: este aparelho foi desconectado pela loja.' USING ERRCODE = '42501'; END IF;
    IF NOT public._rate_limit_hit('kitchen_pin', d.id::text, d.tenant_id, 5, 300) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas; aguarde 5 minutos.';
    END IF;
    SELECT pin_hash INTO v_hash FROM public.kitchen_settings WHERE tenant_id = d.tenant_id;
    IF v_hash IS NOT NULL AND extensions.crypt(COALESCE(p_pin, ''), v_hash) <> v_hash THEN
        RAISE EXCEPTION 'PIN_INVALID: PIN incorreto.';
    END IF;
    UPDATE public.kitchen_devices SET unlocked_until = v_until WHERE id = d.id;
    RETURN jsonb_build_object('unlocked_until', v_until);
END;
$$;

CREATE OR REPLACE FUNCTION public.kitchen_lock() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
BEGIN
    UPDATE public.kitchen_devices SET unlocked_until = now() WHERE user_id = auth.uid() AND revoked_at IS NULL;
END;
$$;

-- 8. Cozinha: lista (sem preço/PII; primeiro nome só em RETIRADA) e transições permitidas.
CREATE OR REPLACE FUNCTION public._kitchen_resolve_tenant(p_tenant_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
DECLARE d public.kitchen_devices; v_any RECORD; v_hash text;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE = '42501'; END IF;
    IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
        d := public._kitchen_device_of_caller();
        IF d.id IS NULL THEN
            SELECT k.revoked_at INTO v_any FROM public.kitchen_devices k WHERE k.user_id = auth.uid();
            IF FOUND AND v_any.revoked_at IS NULL THEN RAISE EXCEPTION 'KITCHEN_DISABLED: a Tela da Cozinha está desligada nesta loja.'; END IF;
            RAISE EXCEPTION 'KITCHEN_DEVICE_REVOKED: este aparelho foi desconectado pela loja.' USING ERRCODE = '42501';
        END IF;
        SELECT pin_hash INTO v_hash FROM public.kitchen_settings WHERE tenant_id = d.tenant_id;
        IF v_hash IS NOT NULL AND NOT COALESCE(d.unlocked_until > now(), false) THEN
            RAISE EXCEPTION 'KITCHEN_LOCKED: digite o PIN para destravar.';
        END IF;
        UPDATE public.kitchen_devices SET last_seen_at = now() WHERE id = d.id AND (last_seen_at IS NULL OR last_seen_at < now() - interval '60 seconds');
        RETURN d.tenant_id;
    END IF;
    IF p_tenant_id IS NULL OR NOT COALESCE(public._kitchen_can_read_tenant(p_tenant_id), false) THEN
        IF p_tenant_id IS NOT NULL AND COALESCE(public._tenant_role_of_caller(p_tenant_id), '') IN ('OWNER','MANAGER','OPERATOR','CASHIER') THEN
            RAISE EXCEPTION 'KITCHEN_DISABLED: a Tela da Cozinha está desligada nesta loja.';
        END IF;
        RAISE EXCEPTION 'FORBIDDEN: seu perfil não abre a Tela da Cozinha.' USING ERRCODE = '42501';
    END IF;
    RETURN p_tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION public._kitchen_resolve_tenant(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.kitchen_list_orders(p_tenant_id uuid DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
DECLARE v_t uuid := public._kitchen_resolve_tenant(p_tenant_id);
BEGIN
    RETURN COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'created_at')) FROM (
            SELECT jsonb_build_object(
                'order_id', o.id, 'order_number', o.order_number, 'status', o.status, 'fulfillment_type', o.fulfillment_type,
                'created_at', o.created_at, 'notes', o.notes,
                'customer_first_name', CASE WHEN o.fulfillment_type = 'PICKUP'
                    THEN NULLIF(split_part(btrim(COALESCE(o.customer_name, '')), ' ', 1), '') END,
                'pickup_code', CASE WHEN o.fulfillment_type = 'PICKUP' AND to_regclass('public.pickup_arrivals') IS NOT NULL
                    THEN (SELECT a.pickup_code FROM public.pickup_arrivals a WHERE a.order_id = o.id) END,
                'confirmed_at', (SELECT max(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'CONFIRMED'),
                'preparing_at', (SELECT max(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'PREPARING'),
                'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('order_item_id', i.id, 'product_name', i.product_name,
                        'quantity', i.quantity, 'unit', i.unit, 'notes', i.notes) ORDER BY i.product_name)
                    FROM public.order_items i WHERE i.order_id = o.id), '[]'::jsonb)) AS x
            FROM public.orders o
            WHERE o.tenant_id = v_t AND o.status IN ('CONFIRMED','PREPARING')
            ORDER BY o.created_at LIMIT 100) q), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.kitchen_set_order_status(p_order_id uuid, p_to text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
DECLARE
    v_o RECORD; v_t uuid; v_to text := upper(btrim(COALESCE(p_to, ''))); v_actor text; d public.kitchen_devices;
BEGIN
    SELECT id, tenant_id, status INTO v_o FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501'; END IF;
    BEGIN
        v_t := public._kitchen_resolve_tenant(v_o.tenant_id);
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE 'KITCHEN_%' THEN RAISE; END IF;
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END;
    IF v_t <> v_o.tenant_id THEN RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501'; END IF;
    IF v_o.status = v_to THEN
        RETURN jsonb_build_object('order_id', p_order_id, 'previous_status', v_o.status, 'status', v_o.status, 'unchanged', true);
    END IF;
    IF NOT ((v_o.status, v_to) IN (('CONFIRMED','PREPARING'), ('PREPARING','READY'))) THEN
        RAISE EXCEPTION 'TRANSITION_FORBIDDEN: a cozinha não pode mudar o pedido de % para %.', v_o.status, v_to USING ERRCODE = '42501';
    END IF;
    IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
        d := public._kitchen_device_of_caller(); v_actor := 'Cozinha — ' || d.name;
    ELSE
        SELECT COALESCE(NULLIF(u.name, ''), u.email, 'Equipe') || ' (' || public._tenant_role_of_caller(v_t) || ') · Cozinha' INTO v_actor
        FROM public.users u WHERE u.id = auth.uid();
    END IF;
    UPDATE public.orders SET status = v_to, updated_at = now() WHERE id = p_order_id;
    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (p_order_id, v_to, CASE WHEN v_to = 'READY' THEN 'Pronto (Tela da Cozinha)' ELSE 'Em preparo (Tela da Cozinha)' END, COALESCE(v_actor, 'Cozinha'));
    RETURN jsonb_build_object('order_id', p_order_id, 'previous_status', v_o.status, 'status', v_to, 'unchanged', false);
END;
$$;
-- Reservado (não implementado): kitchen_record_item_weight(p_order_item_id uuid, p_weight_grams int) — política dos 20 g.

REVOKE ALL ON FUNCTION public.get_kitchen_settings(uuid), public.set_kitchen_settings(uuid, boolean, text, boolean),
    public.create_kitchen_pairing_code(uuid, text), public.list_kitchen_devices(uuid), public.revoke_kitchen_device(uuid),
    public.redeem_kitchen_pairing_code(text, text, text), public.kitchen_get_context(uuid), public.kitchen_unlock(text),
    public.kitchen_lock(), public.kitchen_list_orders(uuid), public.kitchen_set_order_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_kitchen_settings(uuid), public.set_kitchen_settings(uuid, boolean, text, boolean),
    public.create_kitchen_pairing_code(uuid, text), public.list_kitchen_devices(uuid), public.revoke_kitchen_device(uuid),
    public.redeem_kitchen_pairing_code(text, text, text), public.kitchen_get_context(uuid), public.kitchen_unlock(text),
    public.kitchen_lock(), public.kitchen_list_orders(uuid), public.kitchen_set_order_status(uuid, text) TO authenticated;

-- 9. Realtime do sinal (RLS por assinante).
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'kitchen_order_signals') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.kitchen_order_signals;
    END IF;
END $$;

COMMIT;
