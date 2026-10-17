-- n5_delta_manual.sql — DELTA N5 MANUAL (fora de supabase/migrations). NÃO executar sem autorização do CEO.
-- Cria SOMENTE: idx_orders_tenant_offer_created + public.get_promo_offer_performance (texto idêntico a
-- supabase/migrations/20261006000500_n5_... linhas 858–927 do main 68c6db4) + seus grants (linhas 945/951/957).
-- CREATE INDEX não-concorrente: orders tem ~15 linhas (reltuples=15 em 17/10); lock curto; permite rodar tudo
-- numa única transação (CONCURRENTLY não roda dentro de transação).
-- Uso: psql -X -v ON_ERROR_STOP=1 -f n5_delta_manual.sql   (contém BEGIN/COMMIT próprios)
-- Rollback: n5_delta_manual_rollback.sql
\set ON_ERROR_STOP on
SET lock_timeout = '5s';
SET statement_timeout = '60s';
BEGIN;
DO $pre$
DECLARE v TEXT;
BEGIN
    IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'PRE: banco inesperado %', current_database(); END IF;
    IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 20
       OR (SELECT max(version) FROM supabase_migrations.schema_migrations) <> '20260929000020' THEN
        RAISE EXCEPTION 'PRE: histórico diferente de 001–020 (20 versões, máx 20260929000020); abortado.';
    END IF;
    IF to_regclass('public.idx_orders_tenant_offer_created') IS NOT NULL THEN
        RAISE EXCEPTION 'PRE: idx_orders_tenant_offer_created já existe; abortado.'; END IF;
    IF to_regprocedure('public.get_promo_offer_performance(uuid,timestamp with time zone,timestamp with time zone)') IS NOT NULL THEN
        RAISE EXCEPTION 'PRE: get_promo_offer_performance já existe; abortado.'; END IF;
    SELECT md5(regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'), '\s+', '', 'g')) INTO v FROM pg_proc
     WHERE oid = to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)');
    IF v IS DISTINCT FROM 'a5510964e2fa86031d54fed0605c491e' THEN
        RAISE EXCEPTION 'PRE: _checkout_core não é a versão N5 (md5 normalizado %); abortado.', v; END IF;
    IF to_regprocedure('public.is_tenant_owner_or_manager(uuid)') IS NULL
       OR to_regclass('public.campaign_cards') IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='offer_id')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='order_items' AND column_name='offer_id') THEN
        RAISE EXCEPTION 'PRE: dependências N1–N5 ausentes; abortado.'; END IF;
    RAISE NOTICE 'PRE OK';
END $pre$;

CREATE INDEX idx_orders_tenant_offer_created ON public.orders (tenant_id, created_at) WHERE offer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_promo_offer_performance(p_tenant_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_rows JSONB;
BEGIN
    IF auth.uid() IS NULL OR p_tenant_id IS NULL OR NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
        RAISE EXCEPTION 'FORBIDDEN: sem permissão para o desempenho desta loja.' USING ERRCODE = '42501';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '400 days' THEN
        RAISE EXCEPTION 'INVALID_PERIOD: período inválido (máximo 400 dias).';
    END IF;

    WITH o AS (
        SELECT od.id, od.offer_id, od.created_at,
               (od.status <> 'CANCELLED' AND od.payment_status <> 'REFUNDED') AS valid,
               GREATEST(od.total_amount - od.delivery_fee, 0) AS revenue
        FROM public.orders od
        JOIN public.offers f ON f.id = od.offer_id AND f.tenant_id = od.tenant_id
        WHERE od.tenant_id = p_tenant_id AND od.offer_id IS NOT NULL
          AND od.created_at >= p_from AND od.created_at < p_to
    ), it AS (
        SELECT o.id AS order_id,
               COALESCE(sum(oi.quantity) FILTER (WHERE oi.item_kind = 'OFFER'), 0) AS units,
               COALESCE(sum(GREATEST(COALESCE(oi.original_unit_price, oi.unit_price) - oi.unit_price, 0) * oi.quantity
                            + oi.discount_amount), 0) AS discount
        FROM o JOIN public.order_items oi ON oi.order_id = o.id AND oi.offer_id = o.offer_id
        WHERE o.valid
        GROUP BY o.id
    ), agg AS (
        SELECT o.offer_id,
               count(*) FILTER (WHERE o.valid) AS valid_orders,
               count(*) FILTER (WHERE NOT o.valid) AS invalidated_orders,
               COALESCE(sum(o.revenue) FILTER (WHERE o.valid), 0) AS revenue,
               COALESCE(sum(it.units), 0) AS redeemed_units,
               COALESCE(sum(it.discount), 0) AS discount
        FROM o LEFT JOIN it ON it.order_id = o.id
        GROUP BY o.offer_id
    ), last_sale AS (
        SELECT od.offer_id, max(od.created_at) AS last_valid_order_at
        FROM public.orders od
        WHERE od.tenant_id = p_tenant_id AND od.offer_id IS NOT NULL
          AND od.status <> 'CANCELLED' AND od.payment_status <> 'REFUNDED'
        GROUP BY od.offer_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'offer_id', f.id,
               'valid_orders', COALESCE(a.valid_orders, 0),
               'invalidated_orders', COALESCE(a.invalidated_orders, 0),
               'revenue', round(COALESCE(a.revenue, 0), 2),
               'redeemed_units', COALESCE(a.redeemed_units, 0),
               'discount', round(COALESCE(a.discount, 0), 2),
               'last_valid_order_at', l.last_valid_order_at) ORDER BY f.id), '[]'::jsonb)
    INTO v_rows
    FROM public.offers f
    LEFT JOIN agg a ON a.offer_id = f.id
    LEFT JOIN last_sale l ON l.offer_id = f.id
    WHERE f.tenant_id = p_tenant_id AND (a.offer_id IS NOT NULL OR l.offer_id IS NOT NULL);

    RETURN jsonb_build_object('tenant_id', p_tenant_id, 'from', p_from, 'to', p_to,
                              'attribution', 'orders.offer_id (servidor)', 'revenue_rule', 'total_amount - delivery_fee',
                              'rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.get_promo_offer_performance(uuid,timestamp with time zone,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_promo_offer_performance(uuid,timestamp with time zone,timestamp with time zone) TO authenticated;

DO $post$
DECLARE r RECORD;
BEGIN
    SELECT p.prosecdef, p.provolatile, p.proacl::text AS acl,
           md5(regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'), '\s+', '', 'g')) AS h
      INTO r FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_promo_offer_performance(uuid,timestamp with time zone,timestamp with time zone)');
    IF r.h IS DISTINCT FROM '62c79e394f1d1e008ceb88abb81b5027' OR NOT r.prosecdef OR r.provolatile <> 's' THEN
        RAISE EXCEPTION 'POST: função diverge do N5 (md5 %)', r.h; END IF;
    IF has_function_privilege('anon', 'public.get_promo_offer_performance(uuid,timestamp with time zone,timestamp with time zone)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.get_promo_offer_performance(uuid,timestamp with time zone,timestamp with time zone)', 'EXECUTE') THEN
        RAISE EXCEPTION 'POST: grants incorretos (acl %)', r.acl; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_orders_tenant_offer_created'
                   AND indexdef LIKE '%(tenant_id, created_at) WHERE (offer_id IS NOT NULL)%') THEN
        RAISE EXCEPTION 'POST: índice ausente ou diferente'; END IF;
    IF (SELECT md5(regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'), '\s+', '', 'g')) FROM pg_proc
         WHERE oid = to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)'))
       <> 'a5510964e2fa86031d54fed0605c491e' THEN RAISE EXCEPTION 'POST: _checkout_core alterado'; END IF;
    IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 20 THEN RAISE EXCEPTION 'POST: histórico alterado'; END IF;
    RAISE NOTICE 'POST OK acl=%', r.acl;
END $post$;
COMMIT;
