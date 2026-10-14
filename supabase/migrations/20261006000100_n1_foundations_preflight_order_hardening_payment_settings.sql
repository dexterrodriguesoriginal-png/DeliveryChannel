-- ============================================================================
-- N1 — FUNDAÇÕES, PRÉ-CHECAGENS, HARDENING DE PEDIDOS/SEED, PAGAMENTO (PIX)
-- DESIGN_N1_N6_ARQUITETURA_v3 aprovado pelo fundador (decisões 1–19 + F1–F7).
--
-- Base: estado REAL de produção 001–020. Não depende de 021–027 (quarentena).
-- Esta migration NÃO altera nenhuma linha existente de offers, orders,
-- order_items, customers ou products. Só cria objetos, troca policies,
-- privilégios e funções, e copia (INSERT) a chave PIX para a tabela nova.
--
-- Cria:      security_rate_limits, tenant_payment_settings; helpers; RPCs de
--            status/pagamento de pedido; PIX por pedido; triggers de proteção
--            e auditoria de pedidos; colunas prep_time/idempotency_key;
--            índices UNIQUE (tenant_id,id); CHECK e FK compostas NOT VALID.
-- Substitui: seed_tenant_demo_catalog (014), trg_seed_tenant_demo_catalog (012),
--            get_customer_order_by_id (020).
-- Remove:    policies orders_staff_update e order_items_staff_manage (001).
-- Intocado:  get_public_store, process_checkout_atomic, demais RPCs 001–020.
-- Rollback:  supabase/rollback/n1_rollback.sql (manual, nunca automático).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. PRÉ-CHECAGENS (abortam a migration inteira se o estado não for o esperado)
-- ----------------------------------------------------------------------------
DO $pre$
DECLARE
    v_expected TEXT[] := ARRAY[
        '20260922000001','20260922000002','20260923000003','20260923000004','20260923000005',
        '20260923000006','20260924000007','20260924000008','20260925000009','20260926000010',
        '20260926000011','20260926000012','20260927000013','20260928000014','20260928000015',
        '20260928000016','20260928000017','20260928000018','20260928000019','20260929000020'];
    v_found TEXT[];
    v_extra TEXT[];
    v_missing TEXT[];
    v_md5 TEXT;
    r RECORD;
BEGIN
    -- PC1: registro de migrations do Supabase CLI = exatamente 001–020
    IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
        RAISE EXCEPTION 'N1 PC1: supabase_migrations.schema_migrations ausente. Estado da base não verificável; abortado.';
    END IF;
    SELECT array_agg(version ORDER BY version) INTO v_found FROM supabase_migrations.schema_migrations;
    SELECT array_agg(x) INTO v_extra FROM unnest(COALESCE(v_found, '{}')) x WHERE x <> ALL (v_expected);
    SELECT array_agg(x) INTO v_missing FROM unnest(v_expected) x WHERE x <> ALL (COALESCE(v_found, '{}'));
    IF v_extra IS NOT NULL OR v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'N1 PC1: migrations registradas divergem de 001–020. Extras: %, ausentes: %', v_extra, v_missing;
    END IF;

    -- PC2: funções que N1–N6 substituem precisam estar idênticas às do repositório (sem edição manual)
    FOR r IN SELECT * FROM (VALUES
        ('public.get_public_store(text)', 'cb6e53c11a484d484c31bf071f3a8f73'),
        ('public.process_checkout_atomic(text,character varying,character varying,character varying,text,jsonb,character varying,character varying,text,character varying,jsonb)', 'dbf628fdc378c41ab3c21d737c90ff9b'),
        ('public.seed_tenant_demo_catalog(uuid)', 'e606d5b4ab04343b838538ab3537b16c'),
        ('public.trg_seed_tenant_demo_catalog()', '1559e1d116859566242d4d08a9d532ce'),
        ('public.get_customer_order_by_id(uuid)', '793236fcec3261e9e6b144e74d9a26d6'),
        ('public.has_tenant_role(uuid,uuid,text[])', 'c3f4a6cbfe80e93b64924d4919fdeda1'),
        ('public.log_audit_event(character varying,character varying,text,character varying,text,text,uuid)', '3240a8133b3cae9202fc6eb2a6e6d0ca')
    ) AS t(sig, md5) LOOP
        IF to_regprocedure(r.sig) IS NULL THEN
            RAISE EXCEPTION 'N1 PC2: função % ausente.', r.sig;
        END IF;
        SELECT md5(regexp_replace(prosrc, '\s+', '', 'g')) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure(r.sig);
        IF v_md5 <> r.md5 THEN
            RAISE EXCEPTION 'N1 PC2: função % difere da versão do repositório (md5 % <> %). Edição manual detectada; abortado.', r.sig, v_md5, r.md5;
        END IF;
    END LOOP;

    -- PC3: policies que serão substituídas existem com a definição da 001
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='orders' AND policyname='orders_staff_update' AND cmd='UPDATE') THEN
        RAISE EXCEPTION 'N1 PC3: policy orders_staff_update (001) ausente ou alterada.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_items' AND policyname='order_items_staff_manage' AND cmd='ALL') THEN
        RAISE EXCEPTION 'N1 PC3: policy order_items_staff_manage (001) ausente ou alterada.';
    END IF;

    -- PC4: nenhum objeto que N1–N6 cria (ou que 021–027 criariam) pode existir
    FOR r IN SELECT unnest(ARRAY['security_rate_limits','tenant_payment_settings','coupons','coupon_redemptions',
        'marketing_media_assets','marketing_media_publication_log','promotion_carousels','promotion_carousel_items',
        'campaigns','campaign_cards','campaign_analytics_events','n1n6_privileges_backup']) AS t LOOP
        IF to_regclass('public.' || r.t) IS NOT NULL THEN
            RAISE EXCEPTION 'N1 PC4: tabela public.% já existe (resto de 021–027 ou objeto manual); abortado.', r.t;
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND (
        (table_name='offers' AND column_name IN ('display_mode','media_url','media_type','auto_overlay','has_promo_checkout','media_asset_id','start_at','end_at'))
        OR (table_name='orders' AND column_name IN ('prep_time_minutes','idempotency_key','coupon_id','coupon_code','coupon_discount','campaign_id','card_id','offer_id'))
        OR (table_name='tenant_settings' AND column_name = 'default_prep_time_minutes'))) THEN
        RAISE EXCEPTION 'N1 PC4: colunas de 021–027/N1–N6 já existem em offers/orders/tenant_settings; abortado.';
    END IF;
    IF EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('marketing','marketing-public')) THEN
        RAISE EXCEPTION 'N1 PC4: bucket marketing/marketing-public já existe; abortado.';
    END IF;

    -- PC-EXT: pgcrypto disponível no schema extensions (padrão Supabase)
    IF to_regprocedure('extensions.digest(text,text)') IS NULL OR to_regprocedure('extensions.hmac(text,text,text)') IS NULL THEN
        RAISE EXCEPTION 'N1: extensions.digest/hmac (pgcrypto no schema extensions) indisponível; abortado.';
    END IF;
END
$pre$;

-- PC5 / PC6 / PC7: diagnósticos (não abortam N1; bloqueiam apenas o passo manual N1.V)
DO $diag$
DECLARE v BIGINT;
BEGIN
    SELECT count(*) INTO v FROM public.orders WHERE total_amount <> subtotal - discount + delivery_fee;
    RAISE NOTICE 'N1 PC5: pedidos com total inconsistente = % (CHECK criado NOT VALID)', v;
    SELECT count(*) INTO v FROM public.offers o JOIN public.products p ON p.id = o.product_id WHERE p.tenant_id <> o.tenant_id;
    RAISE NOTICE 'N1 PC6/D1: ofertas com produto de outro tenant = % (F1 opção A: nenhuma correção; FK fica NOT VALID)', v;
    SELECT count(*) INTO v FROM public.products p JOIN public.categories c ON c.id = p.category_id WHERE c.tenant_id <> p.tenant_id;
    RAISE NOTICE 'N1 PC6/D2: produtos com categoria de outro tenant = %', v;
    SELECT count(*) INTO v FROM public.orders o JOIN public.customers c ON c.id = o.customer_id WHERE c.tenant_id <> o.tenant_id;
    RAISE NOTICE 'N1 PC6/D3: pedidos com cliente de outro tenant = %', v;
    SELECT count(*) INTO v FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id JOIN public.products p ON p.id = oi.product_id WHERE p.tenant_id <> o.tenant_id;
    RAISE NOTICE 'N1 PC6/D4: itens com produto de tenant diferente do pedido = %', v;
    SELECT count(*) INTO v FROM public.inventory_movements m JOIN public.products p ON p.id = m.product_id WHERE p.tenant_id <> m.tenant_id;
    RAISE NOTICE 'N1 PC6/D5: movimentos de estoque com produto de outro tenant = %', v;
    SELECT count(*) INTO v FROM public.tenant_settings WHERE pix_key IS NOT NULL AND btrim(pix_key) <> '';
    RAISE NOTICE 'N1 PC7: chaves PIX existentes a copiar = %', v;
END
$diag$;

-- ----------------------------------------------------------------------------
-- 0. BACKUP DE PRIVILÉGIOS (somente metadados de ACL; nenhum dado de negócio)
--    Fotografa as ACLs de TODAS as tabelas/colunas/funções do schema public existentes antes
--    da N1, para que o rollback manual restaure exatamente os GRANTs de 001–020 (o estado real
--    de grants da produção é desconhecido — R-2). Sem acesso pela API (RLS sem policy, sem GRANT).
-- ----------------------------------------------------------------------------
CREATE TABLE public.n1n6_privileges_backup (
    object_type  TEXT NOT NULL CHECK (object_type IN ('table','column','function')),
    object_name  TEXT NOT NULL,
    column_name  TEXT NOT NULL DEFAULT '',
    acl          aclitem[],
    captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (object_type, object_name, column_name)
);
ALTER TABLE public.n1n6_privileges_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.n1n6_privileges_backup FROM PUBLIC, anon, authenticated;
INSERT INTO public.n1n6_privileges_backup (object_type, object_name, acl)
SELECT 'table', c.oid::regclass::text, c.relacl FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v','m','p');
INSERT INTO public.n1n6_privileges_backup (object_type, object_name, column_name, acl)
SELECT 'column', c.oid::regclass::text, a.attname, a.attacl FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v','m','p') AND a.attnum > 0 AND NOT a.attisdropped
  AND a.attacl IS NOT NULL;
INSERT INTO public.n1n6_privileges_backup (object_type, object_name, acl)
SELECT 'function', p.oid::regprocedure::text, p.proacl FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace;

-- ----------------------------------------------------------------------------
-- 1. HELPERS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Papel do usuário autenticado NO tenant (sem a cláusula global CEO/SUPER_ADMIN de has_tenant_role).
CREATE OR REPLACE FUNCTION public.has_tenant_scoped_role(p_tenant_id UUID, p_roles TEXT[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.tenant_users tu
        JOIN public.tenants t ON t.id = tu.tenant_id
        WHERE tu.user_id = auth.uid()
          AND tu.tenant_id = p_tenant_id
          AND tu.role_id = ANY (p_roles)
          AND tu.status = 'ACTIVE'
          AND t.status = 'ACTIVE'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_owner_or_manager(p_tenant_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT public.has_tenant_scoped_role(p_tenant_id, ARRAY['OWNER','MANAGER']);
$$;

-- Papel único do usuário no tenant (UNIQUE(user_id, tenant_id) em tenant_users), escopado.
CREATE OR REPLACE FUNCTION public._tenant_role_of_caller(p_tenant_id UUID)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT tu.role_id
    FROM public.tenant_users tu
    JOIN public.tenants t ON t.id = tu.tenant_id
    WHERE tu.user_id = auth.uid() AND tu.tenant_id = p_tenant_id
      AND tu.status = 'ACTIVE' AND t.status = 'ACTIVE'
    LIMIT 1;
$$;

CREATE TABLE public.security_rate_limits (
    scope        TEXT        NOT NULL,
    subject_key  TEXT        NOT NULL,
    tenant_id    UUID        REFERENCES public.tenants(id) ON DELETE CASCADE,
    window_start TIMESTAMPTZ NOT NULL,
    hits         INTEGER     NOT NULL DEFAULT 0 CHECK (hits >= 0),
    PRIMARY KEY (scope, subject_key, window_start)
);
CREATE INDEX idx_rate_limits_window ON public.security_rate_limits (window_start);
ALTER TABLE public.security_rate_limits ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente por funções SECURITY DEFINER.

CREATE OR REPLACE FUNCTION public._rate_limit_hit(p_scope TEXT, p_subject TEXT, p_tenant UUID, p_limit INT, p_window_s INT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_window TIMESTAMPTZ;
    v_hits INT;
BEGIN
    IF p_subject IS NULL OR p_subject = '' THEN
        RETURN true;
    END IF;
    v_window := to_timestamp(floor(extract(epoch FROM now()) / GREATEST(p_window_s, 1)) * GREATEST(p_window_s, 1));
    INSERT INTO public.security_rate_limits (scope, subject_key, tenant_id, window_start, hits)
    VALUES (p_scope, p_subject, p_tenant, v_window, 1)
    ON CONFLICT (scope, subject_key, window_start) DO UPDATE SET hits = public.security_rate_limits.hits + 1
    RETURNING hits INTO v_hits;
    -- limpeza oportunista (retenção de 24 h)
    IF random() < 0.01 THEN
        DELETE FROM public.security_rate_limits WHERE window_start < now() - interval '24 hours';
    END IF;
    RETURN v_hits <= p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public._sha256_hex(p_value TEXT)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE WHEN p_value IS NULL THEN NULL ELSE encode(extensions.digest(p_value, 'sha256'), 'hex') END;
$$;

-- HMAC do IP do cliente (cabeçalho x-forwarded-for do PostgREST) com salt diário do Vault.
-- Nunca retorna nem grava o IP puro. Sem salt configurado => NULL (camada de IP desligada).
CREATE OR REPLACE FUNCTION public._request_ip_hash()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_headers JSONB;
    v_ip TEXT;
    v_salt TEXT;
BEGIN
    BEGIN
        v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
    EXCEPTION WHEN others THEN
        RETURN NULL;
    END;
    v_ip := btrim(split_part(COALESCE(v_headers ->> 'x-forwarded-for', ''), ',', 1));
    IF v_ip = '' THEN
        RETURN NULL;
    END IF;
    BEGIN
        EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
            INTO v_salt USING 'n1n6_ip_hash_salt';
    EXCEPTION WHEN others THEN
        RETURN NULL;
    END;
    IF v_salt IS NULL OR v_salt = '' THEN
        RETURN NULL;
    END IF;
    RETURN encode(extensions.hmac(v_ip, v_salt || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 'sha256'), 'hex');
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. HARDENING DE PEDIDOS (decisão 11, F5, F7)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "orders_staff_update" ON public.orders;
DROP POLICY IF EXISTS "order_items_staff_manage" ON public.order_items;

REVOKE INSERT, UPDATE ON public.orders FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.order_status_history FROM anon, authenticated;
REVOKE DELETE ON public.orders FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_movements FROM anon, authenticated;

-- 2.1 Colunas imutáveis após o INSERT: tudo exceto status, payment_status, driver_id, notes, updated_at.
--     Comparação genérica via jsonb: qualquer coluna futura fica protegida automaticamente.
CREATE OR REPLACE FUNCTION public._orders_protect_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_mutable TEXT[] := ARRAY['status','payment_status','driver_id','notes','updated_at'];
    -- Referências que FKs com ON DELETE SET NULL podem anular (ex.: exclusão de cliente, campanha).
    -- Só a transição para NULL é aceita; trocar por outro valor continua proibido.
    v_nullable_refs TEXT[] := ARRAY['customer_id','coupon_id','campaign_id','card_id','offer_id'];
    v_old JSONB := to_jsonb(OLD) - v_mutable;
    v_new JSONB := to_jsonb(NEW) - v_mutable;
    v_key TEXT;
BEGIN
    FOREACH v_key IN ARRAY v_nullable_refs LOOP
        IF v_new ? v_key AND (v_new -> v_key) = 'null'::jsonb THEN
            v_old := v_old - v_key;
            v_new := v_new - v_key;
        END IF;
    END LOOP;
    v_key := NULL;
    IF v_old IS DISTINCT FROM v_new THEN
        SELECT k INTO v_key FROM jsonb_object_keys(v_old || v_new) k
        WHERE (v_old -> k) IS DISTINCT FROM (v_new -> k) LIMIT 1;
        RAISE EXCEPTION 'ORDER_FIELD_IMMUTABLE: o campo "%" do pedido é protegido e não pode ser alterado após a criação.', v_key
            USING ERRCODE = '42501';
    END IF;
    -- F5: pedido cancelado é terminal
    IF OLD.status = 'CANCELLED' AND NEW.status IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION 'ORDER_CANCELLED_IS_FINAL: pedido cancelado não pode ser reaberto.' USING ERRCODE = '42501';
    END IF;
    -- REFUNDED é terminal
    IF OLD.payment_status = 'REFUNDED' AND NEW.payment_status IS DISTINCT FROM 'REFUNDED' THEN
        RAISE EXCEPTION 'ORDER_REFUND_IS_FINAL: pagamento estornado não pode voltar a outro status.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_protect_columns
    BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public._orders_protect_columns();

CREATE OR REPLACE FUNCTION public._order_items_protect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old JSONB := to_jsonb(OLD);
    v_new JSONB := to_jsonb(NEW);
    v_key TEXT;
BEGIN
    -- offer_id/card_id (N5) podem ser anulados por ON DELETE SET NULL; nada mais muda.
    FOREACH v_key IN ARRAY ARRAY['offer_id','card_id'] LOOP
        IF v_new ? v_key AND (v_new -> v_key) = 'null'::jsonb THEN
            v_old := v_old - v_key;
            v_new := v_new - v_key;
        END IF;
    END LOOP;
    IF v_old IS DISTINCT FROM v_new THEN
        RAISE EXCEPTION 'ORDER_ITEM_IMMUTABLE: itens de pedido não podem ser alterados após a criação.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_items_protect
    BEFORE UPDATE ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION public._order_items_protect();

-- 2.2 DELETE de pedido (F7): somente OWNER do tenant, somente pedido CANCELLED, auditoria obrigatória.
--     Operações de sistema (sem auth.uid() e fora dos papéis da API, ex.: exclusão do tenant em cascata)
--     são permitidas, mas também auditadas.
CREATE OR REPLACE FUNCTION public._orders_before_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_api_call BOOLEAN := auth.uid() IS NOT NULL OR current_setting('role', true) IN ('anon','authenticated')
                          OR session_user IN ('anon','authenticated','authenticator');
    v_items INT;
BEGIN
    IF v_api_call THEN
        IF NOT public.has_tenant_scoped_role(OLD.tenant_id, ARRAY['OWNER']) THEN
            RAISE EXCEPTION 'ORDER_DELETE_FORBIDDEN: somente o OWNER da loja pode excluir pedidos.' USING ERRCODE = '42501';
        END IF;
        IF OLD.status <> 'CANCELLED' THEN
            RAISE EXCEPTION 'ORDER_DELETE_NOT_CANCELLED: somente pedidos CANCELLED podem ser excluídos (cancele antes).' USING ERRCODE = '42501';
        END IF;
    END IF;
    SELECT count(*) INTO v_items FROM public.order_items WHERE order_id = OLD.id;
    PERFORM public.log_audit_event(
        'ORDER_DELETED', 'orders',
        'Exclusão de pedido #' || OLD.order_number || CASE WHEN v_api_call THEN ' pelo OWNER' ELSE ' por operação de sistema' END,
        OLD.id::text,
        jsonb_build_object('order_number', OLD.order_number, 'status', OLD.status, 'payment_status', OLD.payment_status,
                           'subtotal', OLD.subtotal, 'discount', OLD.discount, 'delivery_fee', OLD.delivery_fee,
                           'total_amount', OLD.total_amount, 'payment_method', OLD.payment_method,
                           'items', v_items, 'created_at', OLD.created_at)::text,
        NULL,
        OLD.tenant_id);
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_orders_before_delete_guard
    BEFORE DELETE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public._orders_before_delete_guard();

-- 2.3 Auditoria de status / pagamento / motorista
CREATE OR REPLACE FUNCTION public._orders_audit_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM public.log_audit_event('ORDER_STATUS_CHANGED', 'orders',
            'Pedido #' || NEW.order_number || ': status ' || OLD.status || ' -> ' || NEW.status,
            NEW.id::text, OLD.status, NEW.status, NEW.tenant_id);
    END IF;
    IF OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
        PERFORM public.log_audit_event('ORDER_PAYMENT_STATUS_CHANGED', 'orders',
            'Pedido #' || NEW.order_number || ': pagamento ' || OLD.payment_status || ' -> ' || NEW.payment_status,
            NEW.id::text, OLD.payment_status, NEW.payment_status, NEW.tenant_id);
    END IF;
    IF OLD.driver_id IS DISTINCT FROM NEW.driver_id THEN
        PERFORM public.log_audit_event('ORDER_DRIVER_CHANGED', 'orders',
            'Pedido #' || NEW.order_number || ': entregador alterado',
            NEW.id::text, OLD.driver_id::text, NEW.driver_id::text, NEW.tenant_id);
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_orders_audit_changes
    AFTER UPDATE OF status, payment_status, driver_id ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public._orders_audit_changes();

-- 2.4 Devolução de estoque idempotente (usada no cancelamento)
CREATE OR REPLACE FUNCTION public._restock_order_items(p_order_id UUID, p_actor TEXT)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant UUID;
    v_item RECORD;
    v_prev INT;
    v_count INT := 0;
BEGIN
    SELECT tenant_id INTO v_tenant FROM public.orders WHERE id = p_order_id;
    IF EXISTS (SELECT 1 FROM public.inventory_movements
               WHERE reference_id = p_order_id::text AND type = 'ESTORNO' AND tenant_id = v_tenant) THEN
        RETURN 0; -- já devolvido
    END IF;
    FOR v_item IN
        SELECT oi.product_id, oi.product_name, sum(oi.quantity)::int AS qty
        FROM public.order_items oi
        WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL
        GROUP BY oi.product_id, oi.product_name
        ORDER BY oi.product_id
    LOOP
        SELECT stock_quantity INTO v_prev FROM public.products
        WHERE id = v_item.product_id AND tenant_id = v_tenant FOR UPDATE;
        IF NOT FOUND THEN
            CONTINUE; -- produto removido ou de outro tenant: nada a devolver
        END IF;
        UPDATE public.products SET stock_quantity = v_prev + v_item.qty, updated_at = now()
        WHERE id = v_item.product_id AND tenant_id = v_tenant;
        INSERT INTO public.inventory_movements (tenant_id, product_id, product_name, quantity, type, reference_id,
                                                reason, previous_stock, new_stock, created_by_name)
        VALUES (v_tenant, v_item.product_id, v_item.product_name, v_item.qty, 'ESTORNO', p_order_id::text,
                'Devolução de estoque por cancelamento do pedido', v_prev, v_prev + v_item.qty, COALESCE(p_actor, 'Sistema'));
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public._status_rank(p_status TEXT)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_status
        WHEN 'PENDING' THEN 1 WHEN 'CONFIRMED' THEN 2 WHEN 'PREPARING' THEN 3 WHEN 'READY' THEN 4
        WHEN 'WAITING_FOR_DRIVER' THEN 5 WHEN 'OUT_FOR_DELIVERY' THEN 6 WHEN 'DELIVERED' THEN 7
        ELSE NULL END;
$$;

-- 2.5 RPC de transição de status (substitui o UPDATE direto do front)
CREATE OR REPLACE FUNCTION public.update_order_status(p_order_id UUID, p_new_status TEXT, p_note TEXT DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_role TEXT;
    v_new TEXT := upper(btrim(COALESCE(p_new_status, '')));
    v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
    v_actor TEXT;
    v_ok BOOLEAN := false;
    v_restocked INT := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE = '42501';
    END IF;
    IF v_new NOT IN ('PENDING','CONFIRMED','PREPARING','READY','WAITING_FOR_DRIVER','OUT_FOR_DELIVERY','DELIVERED','CANCELLED') THEN
        RAISE EXCEPTION 'INVALID_STATUS: status "%" inválido.', p_new_status;
    END IF;
    IF v_note IS NOT NULL AND length(v_note) > 500 THEN
        RAISE EXCEPTION 'INVALID_NOTE: nota com mais de 500 caracteres.';
    END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END IF;

    v_role := public._tenant_role_of_caller(v_order.tenant_id);
    IF v_role IS NULL OR v_role NOT IN ('OWNER','MANAGER','OPERATOR','CASHIER','DELIVERY_MANAGER') THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END IF;

    IF v_order.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'ORDER_CANCELLED_IS_FINAL: pedido cancelado não pode ser reaberto.' USING ERRCODE = '42501';
    END IF;
    IF v_order.status = v_new THEN
        RAISE EXCEPTION 'STATUS_UNCHANGED: o pedido já está em %.', v_new;
    END IF;

    IF v_new = 'CANCELLED' THEN
        IF v_note IS NULL THEN
            RAISE EXCEPTION 'NOTE_REQUIRED: informe o motivo do cancelamento.';
        END IF;
        IF v_role IN ('OWNER','MANAGER') THEN
            v_ok := true;
        ELSIF v_role IN ('OPERATOR','CASHIER') AND v_order.status IN ('PENDING','CONFIRMED') THEN
            v_ok := true;
        END IF;
    ELSIF public._status_rank(v_new) > public._status_rank(v_order.status) THEN
        IF v_role IN ('OWNER','MANAGER') THEN
            v_ok := true;
        ELSIF v_role IN ('OPERATOR','CASHIER') THEN
            v_ok := (v_order.status, v_new) IN (('PENDING','CONFIRMED'), ('CONFIRMED','PREPARING'), ('PREPARING','READY'))
                 OR (v_order.status = 'READY' AND v_new = 'WAITING_FOR_DRIVER' AND v_order.fulfillment_type = 'DELIVERY')
                 OR (v_order.status = 'READY' AND v_new = 'DELIVERED' AND v_order.fulfillment_type = 'PICKUP');
        ELSIF v_role = 'DELIVERY_MANAGER' THEN
            v_ok := (v_order.status, v_new) IN (('WAITING_FOR_DRIVER','OUT_FOR_DELIVERY'), ('OUT_FOR_DELIVERY','DELIVERED'));
        END IF;
    END IF;
    -- retrocesso de status nunca é permitido

    IF NOT v_ok THEN
        RAISE EXCEPTION 'TRANSITION_FORBIDDEN: papel % não pode mudar o pedido de % para %.', v_role, v_order.status, v_new
            USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(NULLIF(u.name, ''), u.email, 'Equipe') INTO v_actor FROM public.users u WHERE u.id = auth.uid();
    v_actor := COALESCE(v_actor, 'Equipe') || ' (' || v_role || ')';

    UPDATE public.orders SET status = v_new, updated_at = now() WHERE id = p_order_id;

    IF v_new = 'CANCELLED' THEN
        v_restocked := public._restock_order_items(p_order_id, v_actor);
    END IF;

    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (p_order_id, v_new, COALESCE(v_note, 'Status alterado para ' || v_new), v_actor);

    RETURN jsonb_build_object('order_id', p_order_id, 'previous_status', v_order.status, 'status', v_new,
                              'restocked_products', v_restocked);
END;
$$;

-- 2.6 RPC de status de pagamento
CREATE OR REPLACE FUNCTION public.update_order_payment_status(p_order_id UUID, p_new_payment_status TEXT, p_note TEXT DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_role TEXT;
    v_new TEXT := upper(btrim(COALESCE(p_new_payment_status, '')));
    v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE = '42501';
    END IF;
    IF v_new NOT IN ('PAID','REFUNDED') THEN
        RAISE EXCEPTION 'INVALID_PAYMENT_STATUS: só é possível marcar PAID ou REFUNDED.';
    END IF;
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END IF;
    v_role := public._tenant_role_of_caller(v_order.tenant_id);
    IF v_role IS NULL OR v_role NOT IN ('OWNER','MANAGER','CASHIER') THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END IF;
    IF v_new = 'PAID' THEN
        IF v_order.payment_status NOT IN ('PENDING','PAYMENT_ON_DELIVERY') THEN
            RAISE EXCEPTION 'PAYMENT_TRANSITION_FORBIDDEN: pagamento em % não pode ir para PAID.', v_order.payment_status;
        END IF;
        IF v_order.status = 'CANCELLED' THEN
            RAISE EXCEPTION 'PAYMENT_TRANSITION_FORBIDDEN: pedido cancelado não pode ser marcado como pago.';
        END IF;
    ELSE -- REFUNDED
        IF v_role NOT IN ('OWNER','MANAGER') THEN
            RAISE EXCEPTION 'PAYMENT_TRANSITION_FORBIDDEN: somente OWNER/MANAGER registram estorno.' USING ERRCODE = '42501';
        END IF;
        IF v_order.payment_status <> 'PAID' THEN
            RAISE EXCEPTION 'PAYMENT_TRANSITION_FORBIDDEN: só pagamento PAID pode ser estornado.';
        END IF;
        IF v_note IS NULL THEN
            RAISE EXCEPTION 'NOTE_REQUIRED: informe o motivo do estorno.';
        END IF;
    END IF;
    UPDATE public.orders SET payment_status = v_new, updated_at = now() WHERE id = p_order_id;
    IF v_note IS NOT NULL THEN
        PERFORM public.log_audit_event('ORDER_PAYMENT_NOTE', 'orders', left(v_note, 500), p_order_id::text,
                                       v_order.payment_status, v_new, v_order.tenant_id);
    END IF;
    RETURN jsonb_build_object('order_id', p_order_id, 'previous_payment_status', v_order.payment_status,
                              'payment_status', v_new);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. HARDENING DO SEED DEMO (decisão 12, F3)
--    O corpo abaixo é cópia literal da versão 014 (mesmos dados demo, sempre o
--    mesmo p_tenant_id em categorias, produtos e ofertas). Só muda o nome: vira
--    função INTERNA, sem GRANT. O auto-seed de lojas novas continua (F3).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._seed_tenant_demo_catalog_internal(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_slug TEXT;

    -- Categorias (5 categorias)
    v_cat_cervejas UUID := gen_random_uuid();
    v_cat_vinhos UUID := gen_random_uuid();
    v_cat_destilados UUID := gen_random_uuid();
    v_cat_petiscos UUID := gen_random_uuid();
    v_cat_nao_alcoolicos UUID := gen_random_uuid();

    -- Produtos (12 produtos)
    v_prod_heineken UUID := gen_random_uuid();
    v_prod_corona UUID := gen_random_uuid();
    v_prod_ipa UUID := gen_random_uuid();
    v_prod_vinho_tinto UUID := gen_random_uuid();
    v_prod_vinho_branco UUID := gen_random_uuid();
    v_prod_whisky UUID := gen_random_uuid();
    v_prod_gin UUID := gen_random_uuid();
    v_prod_vodka UUID := gen_random_uuid();
    v_prod_batata UUID := gen_random_uuid();
    v_prod_calabresa UUID := gen_random_uuid();
    v_prod_refrigerante UUID := gen_random_uuid();
    v_prod_agua UUID := gen_random_uuid();
BEGIN
    -- Evita duplicidade se já houver conteúdo demo no tenant
    IF EXISTS (SELECT 1 FROM public.categories WHERE tenant_id = p_tenant_id AND is_demo = true) THEN
        RETURN;
    END IF;

    -- Obtém o slug do tenant para geração correta dos links internos
    SELECT slug INTO v_tenant_slug FROM public.tenants WHERE id = p_tenant_id;

    -- ==========================================================================
    -- 1. Inserir Categorias Demo (5 categorias com imagens, ordem e descrição)
    -- ==========================================================================
    INSERT INTO public.categories (id, tenant_id, name, description, image_url, display_order, is_active, is_demo)
    VALUES
        (v_cat_cervejas, p_tenant_id, 'Cervejas & Chopp', 'Cervejas artesanais, pilsen, IPAs e importadas estupidamente geladas.', 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=600&auto=format&fit=crop&q=80', 1, true, true),
        (v_cat_vinhos, p_tenant_id, 'Vinhos & Espumantes', 'Rótulos nacionais e importados selecionados para todas as ocasiões.', 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&auto=format&fit=crop&q=80', 2, true, true),
        (v_cat_destilados, p_tenant_id, 'Destilados & Whiskies', 'Whiskies clássicos, gins artesanais, vodkas e cachaças nobres.', 'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=600&auto=format&fit=crop&q=80', 3, true, true),
        (v_cat_petiscos, p_tenant_id, 'Petiscos & Aperitivos', 'Acompanhamentos ideais, queijos, castanhas e porções preparadas na hora.', 'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?w=600&auto=format&fit=crop&q=80', 4, true, true),
        (v_cat_nao_alcoolicos, p_tenant_id, 'Bebidas Sem Álcool', 'Refrigerantes, energéticos, sucos integrais e águas minerais.', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format&fit=crop&q=80', 5, true, true);

    -- ==========================================================================
    -- 2. Inserir Produtos Demo (12 produtos com URLs testadas e válidas HTTP 200)
    -- ==========================================================================
    INSERT INTO public.products (
        id, tenant_id, category_id, name, description, image_url, price, promotional_price, 
        cost_price, sku, unit, stock_quantity, min_stock_alert, is_active, is_featured, is_demo
    ) VALUES
        -- Cervejas (unidade garrafa, preços com e sem promo, custo cadastrado)
        (v_prod_heineken, p_tenant_id, v_cat_cervejas, 'Cerveja Heineken Long Neck 330ml', 'Cerveja puro malte refrescante com sabor característico e lúpulo de qualidade.', 'https://images.unsplash.com/photo-1583258292688-d0213dc5a3a8?w=600&auto=format&fit=crop&q=80', 12.00, NULL, 6.80, 'DEMO-HEIN-330', 'garrafa', 120, 15, true, true, true),
        (v_prod_corona, p_tenant_id, v_cat_cervejas, 'Cerveja Corona Extra 330ml', 'Cerveja mexicana leve e refrescante, ideal para saborear com uma fatia de limão.', 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=600&auto=format&fit=crop&q=80', 13.50, NULL, 7.50, 'DEMO-CORONA-330', 'garrafa', 95, 12, true, false, true),
        (v_prod_ipa, p_tenant_id, v_cat_cervejas, 'Cerveja Artesanal IPA Premium 500ml', 'India Pale Ale com aroma cítrico intenso, notas florais e amargor equilibrado.', 'https://images.unsplash.com/photo-1567696911980-2eed69a46042?w=600&auto=format&fit=crop&q=80', 24.90, 19.90, 12.90, 'DEMO-IPA-500', 'garrafa', 60, 8, true, true, true),
        
        -- Vinhos (promoção, custo, destaque)
        (v_prod_vinho_tinto, p_tenant_id, v_cat_vinhos, 'Vinho Tinto Cabernet Sauvignon 750ml', 'Vinho tinto fino seco com taninos maduros, notas de frutas vermelhas e carvalho.', 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=600&auto=format&fit=crop&q=80', 59.90, 49.90, 31.00, 'DEMO-CABERNET-750', 'garrafa', 40, 6, true, true, true),
        (v_prod_vinho_branco, p_tenant_id, v_cat_vinhos, 'Vinho Branco Sauvignon Blanc 750ml', 'Aromas frescos de frutas tropicais e acidez vibrante. Perfeito bem gelado.', 'https://images.unsplash.com/photo-1584916201218-f4242ceb4809?w=600&auto=format&fit=crop&q=80', 54.00, NULL, 28.50, 'DEMO-SAUVIGNON-750', 'garrafa', 35, 5, true, false, true),

        -- Destilados (alto valor, custo, alerta de estoque baixo)
        (v_prod_whisky, p_tenant_id, v_cat_destilados, 'Whisky Escocês 12 Anos 1L', 'Blended Scotch Whisky maturado por 12 anos em barris de carvalho nobre.', 'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=600&auto=format&fit=crop&q=80', 149.90, 129.90, 89.00, 'DEMO-WHISKY-12A', 'garrafa', 25, 4, true, true, true),
        (v_prod_gin, p_tenant_id, v_cat_destilados, 'Gin London Dry Artesanal 750ml', 'Destilado com zimbro selvagem, sementes de coentro e toques cítricos de limão siciliano.', 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=600&auto=format&fit=crop&q=80', 98.00, NULL, 54.00, 'DEMO-GIN-750', 'garrafa', 30, 5, true, false, true),
        (v_prod_vodka, p_tenant_id, v_cat_destilados, 'Vodka Premium Importada 750ml', 'Tridestilada e filtrada em carvão ativado para máxima pureza e suavidade.', 'https://images.unsplash.com/photo-1569529465841-dfecdab7503b?w=600&auto=format&fit=crop&q=80', 85.00, NULL, NULL, 'DEMO-VODKA-750', 'garrafa', 45, 5, true, false, true),

        -- Petiscos (unidade 'porcao', gastronomia, margem de custo)
        (v_prod_batata, p_tenant_id, v_cat_petiscos, 'Porção de Batata Frita Rústica Especial', 'Batatas cortadas artesanalmente com casca, alecrim fresco e sal marinho.', 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&auto=format&fit=crop&q=80', 32.00, NULL, 9.50, 'DEMO-BATATA-RUST', 'porcao', 50, 10, true, false, true),
        (v_prod_calabresa, p_tenant_id, v_cat_petiscos, 'Porção de Calabresa Acebolada Flambada', 'Fatias de calabresa defumada douradas com cebola roxa e fatias de pão francês.', 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80', 38.00, NULL, 12.00, 'DEMO-CALABRESA', 'porcao', 50, 10, true, false, true),

        -- Não Alcoólicos (unidade 'lata' e 'garrafa', alto giro)
        (v_prod_refrigerante, p_tenant_id, v_cat_nao_alcoolicos, 'Refrigerante Coca-Cola Original Lata 350ml', 'Refrigerante de cola geladíssimo pronto para o consumo.', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format&fit=crop&q=80', 6.00, NULL, 3.10, 'DEMO-COCA-350', 'lata', 150, 24, true, false, true),
        (v_prod_agua, p_tenant_id, v_cat_nao_alcoolicos, 'Água Mineral com Gás 500ml', 'Água mineral natural gaseificada na fonte, leve e refrescante.', 'https://images.unsplash.com/photo-1560023907-5f339617ea30?w=600&auto=format&fit=crop&q=80', 4.50, NULL, 1.40, 'DEMO-AGUA-GAS', 'garrafa', 200, 30, true, false, true);

    -- ==========================================================================
    -- 3. Inserir Ofertas Demo (3 ofertas completas com cores, vigência e links)
    -- ==========================================================================
    INSERT INTO public.offers (
        id, tenant_id, product_id, title, subtitle, description, badge, 
        discount_percentage, original_price, promotional_price, image_url,
        internal_link, display_order, start_date, end_date, background_color, 
        accent_color, is_active, is_demo
    ) VALUES
        -- Oferta 1: Desconto, preço De/Por, Badge, Vinculada ao produto IPA, Verde Esmeralda
        (
            gen_random_uuid(), p_tenant_id, v_prod_ipa,
            'Festival de Cervejas Artesanais',
            'IPA Premium com 20% de Desconto Especial',
            'Aproveite a seleção especial da semana para degustar os melhores lúpulos artesanais com desconto exclusivo.',
            'OFERTA DA SEMANA', 20, 24.90, 19.90,
            'https://images.unsplash.com/photo-1567696911980-2eed69a46042?w=1200&h=500&auto=format&fit=crop&q=80',
            CASE WHEN v_tenant_slug IS NOT NULL THEN '/app/' || v_tenant_slug || '?product=' || v_prod_ipa::text ELSE NULL END,
            1, CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE + INTERVAL '28 days',
            '#15803d', '#4ade80', true, true
        ),
        -- Oferta 2: Vigência estendida, Bordô/Dourado nobre, Vinho Cabernet
        (
            gen_random_uuid(), p_tenant_id, v_prod_vinho_tinto,
            'Adega Reserva Seleção',
            'Vinho Cabernet Sauvignon por apenas R$ 49,90',
            'Rótulo premiado perfeito para acompanhar carnes nobres e jantares memoráveis. Edição limitada da safra selecionada.',
            'DESTAQUE', 17, 59.90, 49.90,
            'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1200&h=500&auto=format&fit=crop&q=80',
            CASE WHEN v_tenant_slug IS NOT NULL THEN '/app/' || v_tenant_slug || '?product=' || v_prod_vinho_tinto::text ELSE NULL END,
            2, CURRENT_DATE, CURRENT_DATE + INTERVAL '45 days',
            '#4a0404', '#fbbf24', true, true
        ),
        -- Oferta 3: Visual Dark Premium, Azul Petróleo/Ciano, Whisky 12 Anos
        (
            gen_random_uuid(), p_tenant_id, v_prod_whisky,
            'Combo Destilados Premium',
            'Whisky 12 Anos com Preço Especial de Boas-Vindas',
            'Garanta sua garrafa de 1 litro com condição imperdível por tempo limitado para abastecer seu bar particular.',
            'IMPERDÍVEL', 13, 149.90, 129.90,
            'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=1200&h=500&auto=format&fit=crop&q=80',
            CASE WHEN v_tenant_slug IS NOT NULL THEN '/app/' || v_tenant_slug || '?product=' || v_prod_whisky::text ELSE NULL END,
            3, CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '60 days',
            '#0f172a', '#38bdf8', true, true
        );
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_tenant_demo_catalog(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Autorização: somente OWNER/MANAGER ATIVO do próprio tenant (antes: qualquer autenticado).
    IF auth.uid() IS NULL OR NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
        RAISE EXCEPTION 'DEMO_SEED_FORBIDDEN: somente OWNER/MANAGER da loja pode gerar o catálogo demo.' USING ERRCODE = '42501';
    END IF;
    PERFORM public._seed_tenant_demo_catalog_internal(p_tenant_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_seed_tenant_demo_catalog()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Onboarding de loja nova: o papel OWNER ainda não existe neste momento; usa a função interna.
    PERFORM public._seed_tenant_demo_catalog_internal(NEW.id);
    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. CONFIGURAÇÃO FINANCEIRA SEGURA POR TENANT + PIX POR PEDIDO (decisão 13)
-- ----------------------------------------------------------------------------
CREATE TABLE public.tenant_payment_settings (
    tenant_id          UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    pix_enabled        BOOLEAN NOT NULL DEFAULT false,
    pix_key_type       VARCHAR(8) CHECK (pix_key_type IN ('CPF','CNPJ','EMAIL','PHONE','EVP')),
    pix_key            VARCHAR(128),
    pix_merchant_name  VARCHAR(25),
    pix_merchant_city  VARCHAR(15),
    updated_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tenant_payment_settings_enabled_complete CHECK (
        NOT pix_enabled OR (pix_key IS NOT NULL AND pix_key_type IS NOT NULL
                            AND pix_merchant_name IS NOT NULL AND pix_merchant_city IS NOT NULL))
);
ALTER TABLE public.tenant_payment_settings ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_tenant_payment_settings_updated_at
    BEFORE UPDATE ON public.tenant_payment_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Leitura: somente OWNER/MANAGER do próprio tenant (sem CEO/SUPER_ADMIN — F2). Escrita só via RPC.
CREATE POLICY tenant_payment_settings_owner_manager_select ON public.tenant_payment_settings
    FOR SELECT TO authenticated
    USING (public.is_tenant_owner_or_manager(tenant_id));

CREATE OR REPLACE FUNCTION public._pix_ascii(p_text TEXT, p_max INT)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT left(btrim(regexp_replace(
        translate(COALESCE(p_text, ''),
            'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
            'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'),
        '[^A-Za-z0-9 .-]', '', 'g')), p_max);
$$;

CREATE OR REPLACE FUNCTION public._validate_pix_key(p_type TEXT, p_key TEXT)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    d INT[];
    s INT;
    i INT;
    r INT;
    w INT[];
BEGIN
    IF p_key IS NULL OR p_type IS NULL THEN
        RETURN false;
    END IF;
    IF p_type = 'EMAIL' THEN
        RETURN length(p_key) <= 77 AND p_key ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
    ELSIF p_type = 'PHONE' THEN
        RETURN p_key ~ '^\+55[1-9][0-9]{9,10}$';
    ELSIF p_type = 'EVP' THEN
        RETURN p_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    ELSIF p_type = 'CPF' THEN
        IF p_key !~ '^[0-9]{11}$' OR p_key ~ '^(.)\1{10}$' THEN RETURN false; END IF;
        SELECT array_agg(substr(p_key, g, 1)::int ORDER BY g) INTO d FROM generate_series(1, 11) g;
        s := 0; FOR i IN 1..9 LOOP s := s + d[i] * (11 - i); END LOOP;
        r := (s * 10) % 11; IF r = 10 THEN r := 0; END IF;
        IF r <> d[10] THEN RETURN false; END IF;
        s := 0; FOR i IN 1..10 LOOP s := s + d[i] * (12 - i); END LOOP;
        r := (s * 10) % 11; IF r = 10 THEN r := 0; END IF;
        RETURN r = d[11];
    ELSIF p_type = 'CNPJ' THEN
        IF p_key !~ '^[0-9]{14}$' OR p_key ~ '^(.)\1{13}$' THEN RETURN false; END IF;
        SELECT array_agg(substr(p_key, g, 1)::int ORDER BY g) INTO d FROM generate_series(1, 14) g;
        w := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
        s := 0; FOR i IN 1..12 LOOP s := s + d[i] * w[i]; END LOOP;
        r := s % 11; r := CASE WHEN r < 2 THEN 0 ELSE 11 - r END;
        IF r <> d[13] THEN RETURN false; END IF;
        w := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
        s := 0; FOR i IN 1..13 LOOP s := s + d[i] * w[i]; END LOOP;
        r := s % 11; r := CASE WHEN r < 2 THEN 0 ELSE 11 - r END;
        RETURN r = d[14];
    END IF;
    RETURN false;
END;
$$;

-- CRC16-CCITT-FALSE (polinômio 0x1021, valor inicial 0xFFFF), exigido pelo BR Code (campo 63).
CREATE OR REPLACE FUNCTION public._crc16_ccitt(p_payload TEXT)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bytes BYTEA := convert_to(p_payload, 'UTF8');
    v_crc INT := 65535;
    i INT;
    j INT;
BEGIN
    FOR i IN 0 .. length(v_bytes) - 1 LOOP
        v_crc := v_crc # (get_byte(v_bytes, i) << 8);
        FOR j IN 1 .. 8 LOOP
            IF (v_crc & 32768) <> 0 THEN
                v_crc := ((v_crc << 1) # 4129) & 65535;
            ELSE
                v_crc := (v_crc << 1) & 65535;
            END IF;
        END LOOP;
    END LOOP;
    RETURN upper(lpad(to_hex(v_crc), 4, '0'));
END;
$$;

CREATE OR REPLACE FUNCTION public._emv(p_id TEXT, p_value TEXT)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT p_id || lpad(length(p_value)::text, 2, '0') || p_value;
$$;

-- BR Code (PIX "copia e cola") estático com valor e identificador do pedido.
CREATE OR REPLACE FUNCTION public._pix_brcode(p_key TEXT, p_name TEXT, p_city TEXT, p_amount NUMERIC, p_txid TEXT)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payload TEXT;
    v_txid TEXT := left(regexp_replace(COALESCE(p_txid, ''), '[^A-Za-z0-9]', '', 'g'), 25);
BEGIN
    IF p_key IS NULL OR p_key = '' THEN
        RAISE EXCEPTION 'PIX_KEY_MISSING';
    END IF;
    IF v_txid = '' THEN v_txid := '***'; END IF;
    v_payload := public._emv('00', '01')
        || public._emv('26', public._emv('00', 'br.gov.bcb.pix') || public._emv('01', p_key))
        || public._emv('52', '0000')
        || public._emv('53', '986')
        || CASE WHEN p_amount IS NOT NULL AND p_amount > 0 THEN public._emv('54', to_char(p_amount, 'FM9999999990.00')) ELSE '' END
        || public._emv('58', 'BR')
        || public._emv('59', public._pix_ascii(p_name, 25))
        || public._emv('60', public._pix_ascii(p_city, 15))
        || public._emv('62', public._emv('05', v_txid))
        || '6304';
    RETURN v_payload || public._crc16_ccitt(v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION public._mask_pix_key(p_key TEXT)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE WHEN p_key IS NULL THEN NULL
                WHEN length(p_key) <= 4 THEN '****'
                ELSE repeat('*', length(p_key) - 4) || right(p_key, 4) END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_tenant_payment_settings(
    p_tenant_id UUID,
    p_pix_enabled BOOLEAN,
    p_pix_key_type TEXT,
    p_pix_key TEXT,
    p_merchant_name TEXT,
    p_merchant_city TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_type TEXT := upper(btrim(COALESCE(p_pix_key_type, '')));
    v_key TEXT := btrim(COALESCE(p_pix_key, ''));
    v_name TEXT := public._pix_ascii(p_merchant_name, 25);
    v_city TEXT := public._pix_ascii(p_merchant_city, 15);
    v_prev RECORD;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
        RAISE EXCEPTION 'PAYMENT_SETTINGS_FORBIDDEN: somente OWNER/MANAGER da loja.' USING ERRCODE = '42501';
    END IF;
    IF v_type = '' AND v_key = '' THEN
        v_type := NULL; v_key := NULL;
    ELSE
        IF v_type NOT IN ('CPF','CNPJ','EMAIL','PHONE','EVP') THEN
            RAISE EXCEPTION 'PIX_KEY_TYPE_INVALID: tipo de chave inválido.';
        END IF;
        IF v_type IN ('CPF','CNPJ') THEN v_key := regexp_replace(v_key, '[^0-9]', '', 'g'); END IF;
        IF v_type = 'PHONE' THEN
            v_key := regexp_replace(v_key, '[^0-9+]', '', 'g');
            IF v_key !~ '^\+' THEN v_key := '+55' || regexp_replace(v_key, '^55', ''); END IF;
        END IF;
        IF v_type IN ('EMAIL','EVP') THEN v_key := lower(v_key); END IF;
        IF NOT public._validate_pix_key(v_type, v_key) THEN
            RAISE EXCEPTION 'PIX_KEY_INVALID: chave PIX inválida para o tipo %.', v_type;
        END IF;
    END IF;
    IF COALESCE(p_pix_enabled, false) AND (v_key IS NULL OR v_name = '' OR v_city = '') THEN
        RAISE EXCEPTION 'PIX_SETTINGS_INCOMPLETE: para ativar o PIX informe chave, nome e cidade do recebedor.';
    END IF;

    SELECT * INTO v_prev FROM public.tenant_payment_settings WHERE tenant_id = p_tenant_id;

    INSERT INTO public.tenant_payment_settings (tenant_id, pix_enabled, pix_key_type, pix_key, pix_merchant_name, pix_merchant_city, updated_by)
    VALUES (p_tenant_id, COALESCE(p_pix_enabled, false), v_type, v_key, NULLIF(v_name, ''), NULLIF(v_city, ''), auth.uid())
    ON CONFLICT (tenant_id) DO UPDATE SET
        pix_enabled = EXCLUDED.pix_enabled, pix_key_type = EXCLUDED.pix_key_type, pix_key = EXCLUDED.pix_key,
        pix_merchant_name = EXCLUDED.pix_merchant_name, pix_merchant_city = EXCLUDED.pix_merchant_city,
        updated_by = EXCLUDED.updated_by;

    PERFORM public.log_audit_event('PAYMENT_SETTINGS_UPDATED', 'tenant_payment_settings',
        'Configuração de PIX atualizada', p_tenant_id::text,
        CASE WHEN v_prev.tenant_id IS NULL THEN NULL ELSE
            jsonb_build_object('pix_enabled', v_prev.pix_enabled, 'pix_key_type', v_prev.pix_key_type,
                               'pix_key', public._mask_pix_key(v_prev.pix_key))::text END,
        jsonb_build_object('pix_enabled', COALESCE(p_pix_enabled, false), 'pix_key_type', v_type,
                           'pix_key', public._mask_pix_key(v_key))::text,
        p_tenant_id);

    RETURN jsonb_build_object('tenant_id', p_tenant_id, 'pix_enabled', COALESCE(p_pix_enabled, false),
                              'pix_key_type', v_type, 'pix_key_masked', public._mask_pix_key(v_key),
                              'pix_merchant_name', NULLIF(v_name, ''), 'pix_merchant_city', NULLIF(v_city, ''));
END;
$$;

-- Payload PIX somente para o pedido do próprio cliente (ou staff OWNER/MANAGER/CASHIER da loja, para o PDV).
CREATE OR REPLACE FUNCTION public.get_order_pix_payload(p_order_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_pay RECORD;
    v_allowed BOOLEAN := false;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE = '42501';
    END IF;
    IF NOT public._rate_limit_hit('pix_payload', public._sha256_hex(auth.uid()::text), NULL, 30, 60) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas solicitações; tente novamente em instantes.';
    END IF;
    SELECT o.* INTO v_order FROM public.orders o WHERE o.id = p_order_id;
    IF FOUND THEN
        v_allowed := EXISTS (SELECT 1 FROM public.customers c
                             WHERE c.id = v_order.customer_id AND c.tenant_id = v_order.tenant_id AND c.user_id = auth.uid())
                  OR public.has_tenant_scoped_role(v_order.tenant_id, ARRAY['OWNER','MANAGER','CASHIER']);
    END IF;
    IF NOT v_allowed THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END IF;
    IF v_order.payment_method <> 'PIX' THEN
        RAISE EXCEPTION 'PIX_NOT_APPLICABLE: o pedido não é pago via PIX.';
    END IF;
    IF v_order.status = 'CANCELLED' OR v_order.payment_status <> 'PENDING' THEN
        RAISE EXCEPTION 'PIX_NOT_APPLICABLE: o pedido não está aguardando pagamento.';
    END IF;
    SELECT * INTO v_pay FROM public.tenant_payment_settings WHERE tenant_id = v_order.tenant_id;
    IF NOT FOUND OR NOT v_pay.pix_enabled THEN
        RAISE EXCEPTION 'PIX_UNAVAILABLE: a loja não configurou o recebimento via PIX.';
    END IF;
    RETURN jsonb_build_object(
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'amount', v_order.total_amount,
        'merchant_name', v_pay.pix_merchant_name,
        'brcode', public._pix_brcode(v_pay.pix_key, v_pay.pix_merchant_name, v_pay.pix_merchant_city,
                                     v_order.total_amount, 'PED' || v_order.order_number::text));
END;
$$;

-- Cópia (INSERT) das chaves PIX existentes. tenant_settings.pix_key NÃO é alterada nem apagada.
INSERT INTO public.tenant_payment_settings (tenant_id, pix_enabled, pix_key_type, pix_key, pix_merchant_name, pix_merchant_city)
SELECT s.tenant_id,
       (k.ktype IS NOT NULL
        AND public._pix_ascii(COALESCE(th.store_name, t.name), 25) <> ''
        AND public._pix_ascii(s.city, 15) <> ''),
       k.ktype,
       CASE WHEN k.ktype IS NULL THEN left(btrim(s.pix_key), 128) ELSE k.kval END,
       NULLIF(public._pix_ascii(COALESCE(th.store_name, t.name), 25), ''),
       NULLIF(public._pix_ascii(s.city, 15), '')
FROM public.tenant_settings s
JOIN public.tenants t ON t.id = s.tenant_id
LEFT JOIN public.tenant_themes th ON th.tenant_id = s.tenant_id
CROSS JOIN LATERAL (
    SELECT CASE
        WHEN public._validate_pix_key('EVP', lower(btrim(s.pix_key))) THEN 'EVP'
        WHEN public._validate_pix_key('EMAIL', lower(btrim(s.pix_key))) THEN 'EMAIL'
        WHEN public._validate_pix_key('CPF', regexp_replace(s.pix_key, '[^0-9]', '', 'g')) AND s.pix_key !~ '^\s*\+' THEN 'CPF'
        WHEN public._validate_pix_key('CNPJ', regexp_replace(s.pix_key, '[^0-9]', '', 'g')) THEN 'CNPJ'
        WHEN public._validate_pix_key('PHONE', regexp_replace(s.pix_key, '[^0-9+]', '', 'g')) THEN 'PHONE'
        ELSE NULL END AS ktype,
      CASE
        WHEN public._validate_pix_key('EVP', lower(btrim(s.pix_key))) THEN lower(btrim(s.pix_key))
        WHEN public._validate_pix_key('EMAIL', lower(btrim(s.pix_key))) THEN lower(btrim(s.pix_key))
        WHEN public._validate_pix_key('CPF', regexp_replace(s.pix_key, '[^0-9]', '', 'g')) AND s.pix_key !~ '^\s*\+' THEN regexp_replace(s.pix_key, '[^0-9]', '', 'g')
        WHEN public._validate_pix_key('CNPJ', regexp_replace(s.pix_key, '[^0-9]', '', 'g')) THEN regexp_replace(s.pix_key, '[^0-9]', '', 'g')
        WHEN public._validate_pix_key('PHONE', regexp_replace(s.pix_key, '[^0-9+]', '', 'g')) THEN regexp_replace(s.pix_key, '[^0-9+]', '', 'g')
        ELSE NULL END AS kval
) k
WHERE s.pix_key IS NOT NULL AND btrim(s.pix_key) <> '';

-- tenant_settings: a chave PIX deixa de ser legível/gravável pela API (privilégio por coluna).
-- A coluna é mantida intacta (sem UPDATE/DELETE de dados) para rollback; a fonte oficial passa a ser
-- tenant_payment_settings. As policies existentes de tenant_settings não mudam.
ALTER TABLE public.tenant_settings
    ADD COLUMN default_prep_time_minutes INTEGER
    CHECK (default_prep_time_minutes IS NULL OR default_prep_time_minutes BETWEEN 1 AND 240);
COMMENT ON COLUMN public.tenant_settings.default_prep_time_minutes IS
    'Tempo de preparo padrão (min). NULL = não configurado. Sem default (decisão 34).';
COMMENT ON COLUMN public.tenant_settings.pix_key IS
    'LEGADO (até 020). Copiada para tenant_payment_settings na N1; sem privilégio de API. Não usar.';

REVOKE ALL ON public.tenant_settings FROM anon, authenticated;
GRANT SELECT (id, tenant_id, is_open, min_order_value, delivery_fee, free_delivery_threshold,
              estimated_delivery_time, address, city, phone_whatsapp, default_prep_time_minutes,
              created_at, updated_at)
    ON public.tenant_settings TO authenticated;
GRANT UPDATE (is_open, min_order_value, delivery_fee, free_delivery_threshold, estimated_delivery_time,
              address, city, phone_whatsapp, default_prep_time_minutes, updated_at)
    ON public.tenant_settings TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. COLUNAS NOVAS EM ORDERS (aditivas, NULL; nenhuma linha existente é alterada)
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders
    ADD COLUMN prep_time_minutes INTEGER CHECK (prep_time_minutes IS NULL OR prep_time_minutes BETWEEN 1 AND 240),
    ADD COLUMN idempotency_key UUID;
COMMENT ON COLUMN public.orders.prep_time_minutes IS
    'Tempo de preparo informado no momento do pedido. Histórico = NULL (decisão 34); sem default 30.';
CREATE UNIQUE INDEX uq_orders_tenant_idempotency ON public.orders (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. INTEGRIDADE MULTI-TENANT (base para FKs compostas de N2–N5)
--    Índices normais (não CONCURRENTLY): o CLI aplica cada migration em transação,
--    onde CONCURRENTLY é proibido; as tabelas são pequenas (desvio documentado do design v3).
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders    ADD CONSTRAINT orders_tenant_id_id_key    UNIQUE (tenant_id, id);
ALTER TABLE public.offers    ADD CONSTRAINT offers_tenant_id_id_key    UNIQUE (tenant_id, id);
ALTER TABLE public.products  ADD CONSTRAINT products_tenant_id_id_key  UNIQUE (tenant_id, id);
ALTER TABLE public.customers ADD CONSTRAINT customers_tenant_id_id_key UNIQUE (tenant_id, id);
CREATE INDEX idx_offers_tenant_product ON public.offers (tenant_id, product_id);

-- F1 opção A: vínculo oferta→produto do mesmo tenant. NOT VALID: as ~34 ofertas existentes
-- NÃO são verificadas nem corrigidas; só INSERTs novos e UPDATEs que mudem product_id/tenant_id.
-- NO ACTION (não SET NULL): a FK simples offers_product_id_fkey (SET NULL) continua tratando a exclusão
-- do produto; ao fim do comando a linha tem product_id NULL e a FK composta (MATCH SIMPLE) é satisfeita.
ALTER TABLE public.offers
    ADD CONSTRAINT offers_product_same_tenant FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.products (tenant_id, id) NOT VALID;

-- Consistência de total: aplicada a pedidos NOVOS por trigger de INSERT.
-- Motivo do desvio (CHECK NOT VALID do design): no PostgreSQL um CHECK, mesmo NOT VALID, é
-- reavaliado em QUALQUER UPDATE da linha; um pedido legado inconsistente ficaria impedido de
-- mudar de status. O CHECK validado só é criado no passo manual N1.V, se PC5 = 0.
CREATE OR REPLACE FUNCTION public._orders_total_consistency_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.total_amount <> NEW.subtotal - NEW.discount + NEW.delivery_fee
       OR NEW.total_amount < 0 OR NEW.discount < 0 OR NEW.subtotal < 0 OR NEW.delivery_fee < 0 THEN
        RAISE EXCEPTION 'ORDER_TOTAL_INCONSISTENT: total % <> subtotal % - desconto % + entrega %',
            NEW.total_amount, NEW.subtotal, NEW.discount, NEW.delivery_fee;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_orders_total_consistency
    BEFORE INSERT ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public._orders_total_consistency_check();

-- ----------------------------------------------------------------------------
-- 7. HARDENING DE get_customer_order_by_id (020) — entregável G
--    Antes (020): devolvia customerId e, no histórico, o nome do funcionário (changedBy)
--    e a nota interna (note, ex.: motivo de cancelamento digitado pela equipe).
--    Agora: só o cliente dono; sem customerId/tenantId; histórico só com status e horário;
--    erro uniforme (não revela existência); rate limit; inclui prepTimeMinutes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_order_by_id(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_order RECORD;
    v_items JSONB;
    v_history JSONB;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.' USING ERRCODE = '42501';
    END IF;
    IF NOT public._rate_limit_hit('customer_order_read', public._sha256_hex(v_user_id::text), NULL, 120, 60) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas consultas; tente novamente em instantes.';
    END IF;

    SELECT o.id, o.order_number, o.customer_name, o.customer_phone, o.customer_email, o.delivery_address,
           o.address_details, o.subtotal, o.delivery_fee, o.discount, o.total_amount, o.payment_method,
           o.payment_status, o.fulfillment_type, o.status, o.notes, o.prep_time_minutes, o.created_at, o.updated_at
    INTO v_order
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
    WHERE o.id = p_order_id
      AND c.user_id = v_user_id;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado ou acesso não autorizado.' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'productId', oi.product_id, 'productName', oi.product_name, 'quantity', oi.quantity,
               'unitPrice', oi.unit_price, 'totalPrice', oi.total_price, 'notes', oi.notes, 'unit', oi.unit)
               ORDER BY oi.id ASC), '[]'::jsonb)
    INTO v_items
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id;

    -- Histórico público: apenas status e horário (sem nome de funcionário nem nota interna).
    SELECT COALESCE(jsonb_agg(jsonb_build_object('status', osh.status, 'timestamp', osh.created_at)
               ORDER BY osh.created_at ASC), '[]'::jsonb)
    INTO v_history
    FROM public.order_status_history osh
    WHERE osh.order_id = v_order.id;

    RETURN jsonb_build_object(
        'id', v_order.id,
        'orderNumber', v_order.order_number,
        'customerName', v_order.customer_name,
        'customerPhone', v_order.customer_phone,
        'customerEmail', v_order.customer_email,
        'deliveryAddress', v_order.delivery_address,
        'addressDetails', v_order.address_details,
        'subtotal', v_order.subtotal,
        'deliveryFee', v_order.delivery_fee,
        'discount', v_order.discount,
        'totalAmount', v_order.total_amount,
        'paymentMethod', v_order.payment_method,
        'paymentStatus', v_order.payment_status,
        'fulfillmentType', v_order.fulfillment_type,
        'status', v_order.status,
        'notes', v_order.notes,
        'prepTimeMinutes', v_order.prep_time_minutes,
        'items', v_items,
        'statusHistory', v_history,
        'createdAt', v_order.created_at,
        'updatedAt', v_order.updated_at);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. PRIVILÉGIOS (explícitos; corretos tanto em modo de grants estrito quanto legado)
-- ----------------------------------------------------------------------------
GRANT SELECT ON public.orders, public.order_items, public.order_status_history, public.customers TO authenticated;
GRANT DELETE ON public.orders TO authenticated; -- RLS orders_admin_delete + trigger F7 (OWNER + CANCELLED)

REVOKE ALL ON public.security_rate_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.tenant_payment_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tenant_payment_settings TO authenticated;

DO $grants$
DECLARE
    f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.set_updated_at()',
        'public.has_tenant_scoped_role(uuid,text[])',
        'public.is_tenant_owner_or_manager(uuid)',
        'public._tenant_role_of_caller(uuid)',
        'public._rate_limit_hit(text,text,uuid,integer,integer)',
        'public._sha256_hex(text)',
        'public._request_ip_hash()',
        'public._orders_protect_columns()',
        'public._order_items_protect()',
        'public._orders_before_delete_guard()',
        'public._orders_audit_changes()',
        'public._restock_order_items(uuid,text)',
        'public._status_rank(text)',
        'public.update_order_status(uuid,text,text)',
        'public.update_order_payment_status(uuid,text,text)',
        'public._seed_tenant_demo_catalog_internal(uuid)',
        'public.seed_tenant_demo_catalog(uuid)',
        'public.trg_seed_tenant_demo_catalog()',
        'public._pix_ascii(text,integer)',
        'public._validate_pix_key(text,text)',
        'public._crc16_ccitt(text)',
        'public._emv(text,text)',
        'public._pix_brcode(text,text,text,numeric,text)',
        'public._mask_pix_key(text)',
        'public.upsert_tenant_payment_settings(uuid,boolean,text,text,text,text)',
        'public.get_order_pix_payload(uuid)',
        'public._orders_total_consistency_check()',
        'public.get_customer_order_by_id(uuid)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    END LOOP;
END
$grants$;

GRANT EXECUTE ON FUNCTION public.has_tenant_scoped_role(uuid,text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_owner_or_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_status(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_payment_status(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_tenant_demo_catalog(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_tenant_payment_settings(uuid,boolean,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_pix_payload(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_order_by_id(uuid) TO authenticated;
-- Fim da N1.
