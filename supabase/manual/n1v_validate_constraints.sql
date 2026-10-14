-- ============================================================================
-- N1.V — VALIDAÇÃO MANUAL DE CONSTRAINTS (separada da N1; NÃO é migration)
-- Fica fora de supabase/migrations de propósito: o CLI nunca a aplica.
-- Execução manual, só após N1 aplicada e com decisão do fundador:
--   psql ... -1 -f supabase/manual/n1v_validate_constraints.sql
-- Não altera nenhuma linha. Cada etapa só roda se o diagnóstico der zero;
-- caso contrário emite NOTICE e deixa o objeto como está (NOT VALID / trigger).
-- F1 opção A: as ofertas com produto de outro tenant NÃO são corrigidas; logo a
-- validação de offers_product_same_tenant normalmente será PULADA (esperado).
-- ============================================================================
DO $n1v$
DECLARE
    v BIGINT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006000100') THEN
        RAISE EXCEPTION 'N1.V: N1 (20261006000100) não está aplicada; abortado.';
    END IF;

    -- V1: total dos pedidos (PC5)
    SELECT count(*) INTO v FROM public.orders WHERE total_amount <> subtotal - discount + delivery_fee;
    IF v = 0 THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_total_consistency') THEN
            ALTER TABLE public.orders ADD CONSTRAINT orders_total_consistency
                CHECK (total_amount = subtotal - discount + delivery_fee) NOT VALID;
        END IF;
        ALTER TABLE public.orders VALIDATE CONSTRAINT orders_total_consistency;
        RAISE NOTICE 'N1.V V1: orders_total_consistency criada e validada.';
    ELSE
        RAISE NOTICE 'N1.V V1: % pedidos legados inconsistentes; CHECK não criado (trigger de INSERT continua protegendo pedidos novos).', v;
    END IF;

    -- V2: oferta → produto do mesmo tenant (PC6/D1)
    SELECT count(*) INTO v FROM public.offers o JOIN public.products p ON p.id = o.product_id WHERE p.tenant_id <> o.tenant_id;
    IF v = 0 THEN
        ALTER TABLE public.offers VALIDATE CONSTRAINT offers_product_same_tenant;
        RAISE NOTICE 'N1.V V2: offers_product_same_tenant validada.';
    ELSE
        RAISE NOTICE 'N1.V V2: % ofertas com produto de outro tenant (F1 opção A: sem correção). FK permanece NOT VALID.', v;
    END IF;
END
$n1v$;
