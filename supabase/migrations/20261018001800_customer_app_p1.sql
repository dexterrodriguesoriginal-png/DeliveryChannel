-- 20261018001800_customer_app_p1.sql
-- App do cliente (P1): CPF no cadastro, cupons visíveis ao cliente e pedido de exclusão de conta (LGPD).
-- 100% ADITIVA e idempotente: nenhuma coluna/tabela existente é alterada ou removida; nenhum dado é reescrito.
--   1. customers.cpf (nullable, só 11 dígitos) + _is_valid_cpf(text)
--   2. RPC update_my_customer_profile(p_tenant_id, p_name, p_phone, p_cpf) — só o PRÓPRIO cadastro (auth.uid())
--   3. RPC list_store_coupons_for_customer(p_tenant_slug) — só cupons já divulgados em cards publicados
--      (mesma regra do get_public_store: show_coupon_code + card visível + cupom ACTIVE na janela, não esgotado)
--   4. Tabela customer_account_deletion_requests (RLS: o cliente só vê as próprias linhas; escrita só via RPC)
--      + RPC request_my_account_deletion(p_reason) — APENAS registra o pedido. Nada é apagado/anonimizado aqui;
--      o histórico de pedidos é preservado (obrigação fiscal) e o processamento é feito pela plataforma.
-- O frontend detecta a ausência destas RPCs (PGRST202) e cai no comportamento anterior, então o deploy do app
-- pode vir antes ou depois desta migration.
-- Rollback: supabase/rollback/20261018001800_customer_app_p1_down.sql
BEGIN;

-- 1. CPF -------------------------------------------------------------------------------------------------
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS cpf varchar(11);
DO $c$ BEGIN
    ALTER TABLE public.customers ADD CONSTRAINT customers_cpf_digits CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $c$;
COMMENT ON COLUMN public.customers.cpf IS '1800: CPF opcional do cliente (nota fiscal), só dígitos. Gravado via update_my_customer_profile.';

CREATE OR REPLACE FUNCTION public._is_valid_cpf(p text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE SET search_path TO ''
    AS $$
DECLARE d text := regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g'); s int; r int; i int;
BEGIN
    IF length(d) <> 11 OR d ~ '^(\d)\1{10}$' THEN RETURN false; END IF;
    s := 0; FOR i IN 1..9 LOOP s := s + substr(d, i, 1)::int * (11 - i); END LOOP;
    r := (s * 10) % 11; IF r = 10 THEN r := 0; END IF;
    IF r <> substr(d, 10, 1)::int THEN RETURN false; END IF;
    s := 0; FOR i IN 1..10 LOOP s := s + substr(d, i, 1)::int * (12 - i); END LOOP;
    r := (s * 10) % 11; IF r = 10 THEN r := 0; END IF;
    RETURN r = substr(d, 11, 1)::int;
END;
$$;

-- 2. Perfil do próprio cliente ----------------------------------------------------------------------------
-- Não toca updated_at/métricas (o trigger check_customer_self_update continua valendo).
CREATE OR REPLACE FUNCTION public.update_my_customer_profile(p_tenant_id uuid, p_name text, p_phone text, p_cpf text DEFAULT NULL)
    RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_name text := btrim(COALESCE(p_name, ''));
    v_phone text := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
    v_cpf text := NULLIF(regexp_replace(COALESCE(p_cpf, ''), '[^0-9]', '', 'g'), '');
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Faça login para alterar seus dados.' USING ERRCODE = '42501'; END IF;
    IF length(v_name) < 2 OR length(v_name) > 255 THEN RAISE EXCEPTION 'Informe seu nome completo.' USING ERRCODE = '22023'; END IF;
    IF length(v_phone) < 10 OR length(v_phone) > 13 THEN RAISE EXCEPTION 'Telefone inválido.' USING ERRCODE = '22023'; END IF;
    IF v_cpf IS NOT NULL AND NOT public._is_valid_cpf(v_cpf) THEN RAISE EXCEPTION 'CPF inválido.' USING ERRCODE = '22023'; END IF;

    UPDATE public.customers
       SET name = v_name, phone = v_phone, cpf = v_cpf
     WHERE tenant_id = p_tenant_id AND user_id = v_uid;
    RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.update_my_customer_profile(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_customer_profile(uuid, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public._is_valid_cpf(text) FROM PUBLIC, anon, authenticated;

-- 3. Cupons visíveis --------------------------------------------------------------------------------------
-- Só o que a vitrine pública já mostra (cupom exibido num card visível). Nunca: cupons internos, contadores
-- por cliente, quem usou.
CREATE OR REPLACE FUNCTION public.list_store_coupons_for_customer(p_tenant_slug text)
    RETURNS TABLE (code text, description text, discount_type text, discount_value numeric, min_order_value numeric,
                   max_discount_amount numeric, first_order_only boolean, end_date timestamptz, remaining_uses integer, source text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
    SELECT DISTINCT ON (cp.id)
           cp.code::text,
           COALESCE(cp.description, cd.title)::text,
           cp.discount_type::text,
           cp.discount_value,
           cp.min_order_value,
           cp.max_discount_amount,
           cp.first_order_only,
           NULLIF(LEAST(COALESCE(cp.end_at, 'infinity'), COALESCE(cd.end_at, 'infinity'), COALESCE(k.end_at, 'infinity')), 'infinity'::timestamptz),
           CASE WHEN cp.usage_limit IS NULL THEN NULL ELSE GREATEST(0, cp.usage_limit - cp.times_used) END,
           'campaign'::text
      FROM public.tenants t
      JOIN public.campaign_cards cd ON cd.tenant_id = t.id
      JOIN public.campaigns k ON k.id = cd.campaign_id AND k.tenant_id = t.id
      JOIN public.coupons cp ON cp.id = cd.coupon_id AND cp.tenant_id = t.id
     WHERE t.slug = p_tenant_slug AND t.status = 'ACTIVE'
       AND k.status = 'ACTIVE'
       AND cd.show_coupon_code
       AND public._campaign_card_visible_at(cd.id, now())
       AND cp.status = 'ACTIVE'
       AND (cp.start_at IS NULL OR cp.start_at <= now())
       AND (cp.end_at IS NULL OR cp.end_at > now())
       AND (cp.usage_limit IS NULL OR cp.times_used < cp.usage_limit)
     ORDER BY cp.id, cd.display_order;
$$;
REVOKE ALL ON FUNCTION public.list_store_coupons_for_customer(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_store_coupons_for_customer(text) TO anon, authenticated;

-- 4. Pedido de exclusão de conta (LGPD) -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_account_deletion_requests (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    reason        text CHECK (reason IS NULL OR length(reason) <= 1000),
    status        varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSED','CANCELLED')),
    requested_at  timestamptz NOT NULL DEFAULT now(),
    processed_at  timestamptz
);
COMMENT ON TABLE public.customer_account_deletion_requests IS
    '1800: pedidos de exclusão/anonimização (LGPD). Só registro; o processamento anonimiza dados pessoais e PRESERVA o histórico de pedidos.';
CREATE UNIQUE INDEX IF NOT EXISTS uq_deletion_requests_pending
    ON public.customer_account_deletion_requests (user_id) WHERE status = 'PENDING';
ALTER TABLE public.customer_account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_account_deletion_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.customer_account_deletion_requests TO authenticated;
DROP POLICY IF EXISTS deletion_requests_self_select ON public.customer_account_deletion_requests;
CREATE POLICY deletion_requests_self_select ON public.customer_account_deletion_requests
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.request_my_account_deletion(p_reason text DEFAULT NULL)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Faça login para solicitar a exclusão.' USING ERRCODE = '42501'; END IF;
    SELECT id INTO v_id FROM public.customer_account_deletion_requests WHERE user_id = v_uid AND status = 'PENDING';
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    INSERT INTO public.customer_account_deletion_requests (user_id, reason)
    VALUES (v_uid, NULLIF(left(btrim(COALESCE(p_reason, '')), 1000), ''))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_my_account_deletion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_my_account_deletion(text) TO authenticated;

COMMIT;
