-- ============================================================================
-- PROPOSTA (NÃO É MIGRATION ATIVA) — 20261013000200_purchase_origin_pricing.sql
-- DeliveryChannel — Preço por ORIGEM DA COMPRA no checkout real.
--
-- Pré-requisito: 001–020 + N1 v3 + N2 v3 reconciliada + proposta 20261013000100 (marcador [FULFILLMENT]).
-- Local: supabase/proposals/ (fora de supabase/migrations: não entra em `db push`).
--
-- O QUE FAZ
--  * Os itens do checkout passam a aceitar, por linha, a referência de origem:
--      { "productId", "quantity", "notes", "source": "catalog"|"campaign", "campaignItemId": uuid }
--    Preço/desconto continuam PROIBIDOS no payload (_price_items da N2 recusa com UNEXPECTED_FIELD).
--  * source ausente ou 'catalog' => preço vigente do catálogo (_effective_product_price da N2: promoção própria).
--  * source 'campaign' => RECUSADO com CAMPAIGN_SOURCE_UNAVAILABLE.
--
-- POR QUE 'campaign' É RECUSADO (BLOQUEIO REAL, NÃO INVENTADO)
--  A main lê as ofertas do carrossel de public.promotion_carousels / promotion_carousel_items
--  (src/repositories/promotionRepository.ts). Essas tabelas NÃO existem em 001–020 + N1 + N2:
--  são criadas pela 022 (quarentenada; preço gravado em promotional_price, validade start_date/end_date)
--  ou pela N4 (preço derivado de discount_type/discount_value, validade start_at/end_at). Os dois esquemas
--  são incompatíveis e nenhum está confirmado na produção. Sem a tabela real, o servidor não tem como
--  validar identidade, tenant, validade e preço autorizado da campanha — então recusa, em vez de
--  cobrar silenciosamente o preço de catálogo ou confiar no navegador.
--  Quando o esquema de campanhas estiver definido e aplicado, _origin_normalize_items deve ser substituída
--  por uma versão que valide (tenant_id = loja, carrossel e item ativos, show_in_store, janela de validade,
--  product_id = item, preço > 0 e < preço cheio) e devolva o preço da campanha para a linha.
--  Se a tabela promotion_carousel_items JÁ existir no banco, esta proposta ABORTA (precisa ser refeita
--  sobre o esquema real).
--
-- Aditiva e idempotente: 1 função nova + troca textual (marcada) da chamada em _checkout_core.
-- Nada é apagado; nenhum dado é alterado. Rollback: rollback_20261013000200_purchase_origin_pricing.sql
-- Espelho do front: src/lib/pricing/purchaseOrigin.ts
-- ============================================================================

-- 0. PRECHECK ESTRUTURAL
DO $pre$
DECLARE v_src TEXT;
BEGIN
    IF to_regprocedure('public._price_items(uuid,jsonb,boolean)') IS NULL
       OR to_regprocedure('public._effective_product_price(uuid,uuid,timestamptz)') IS NULL
       OR to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)') IS NULL THEN
        RAISE EXCEPTION 'ORIGIN PRE: objetos da N2 ausentes (_price_items, _effective_product_price, _checkout_core). Abortado.';
    END IF;
    SELECT p.prosrc INTO v_src FROM pg_proc p
    WHERE p.oid = to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)');
    IF position('[FULFILLMENT]' IN v_src) = 0 THEN
        RAISE EXCEPTION 'ORIGIN PRE: proposta 20261013000100 (modalidade/retirada) não aplicada. Abortado.';
    END IF;
    IF position('[ORIGIN]' IN v_src) = 0 AND position('public._price_items(v_tenant.id, p_items, true)' IN v_src) = 0 THEN
        RAISE EXCEPTION 'ORIGIN PRE: _checkout_core não tem a chamada esperada de _price_items. Refazer a proposta sobre o corpo atual. Abortado.';
    END IF;
    IF to_regclass('public.promotion_carousel_items') IS NOT NULL OR to_regclass('public.promotion_carousels') IS NOT NULL THEN
        RAISE EXCEPTION 'ORIGIN PRE: tabelas de carrossel já existem (022 ou N4). Esta proposta deve ser refeita para validar campanhas no esquema real. Abortado.';
    END IF;
END
$pre$;

-- 1. Normaliza/valida a origem de cada item e devolve o payload aceito por _price_items (sem campos de origem).
CREATE OR REPLACE FUNCTION public._origin_normalize_items(p_tenant UUID, p_items JSONB)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_elem JSONB;
    v_out JSONB := '[]'::jsonb;
    v_src TEXT;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RETURN p_items;  -- _price_items devolve o erro padrão (EMPTY_CART)
    END IF;
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        IF jsonb_typeof(v_elem) IS DISTINCT FROM 'object' THEN
            v_out := v_out || jsonb_build_array(v_elem);  -- _price_items recusa (INVALID_ITEM)
            CONTINUE;
        END IF;
        IF v_elem ? 'source' AND jsonb_typeof(v_elem -> 'source') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'INVALID_ITEM_SOURCE: origem do item inválida.';
        END IF;
        v_src := COALESCE(v_elem ->> 'source', 'catalog');
        IF v_src NOT IN ('catalog', 'campaign') THEN
            RAISE EXCEPTION 'INVALID_ITEM_SOURCE: origem "%" inválida. Valores aceitos: catalog, campaign.', v_src;
        END IF;
        IF v_src = 'catalog' AND v_elem ? 'campaignItemId' THEN
            RAISE EXCEPTION 'INVALID_ITEM_SOURCE: campaignItemId só é aceito com source = campaign.';
        END IF;
        IF v_src = 'campaign' THEN
            IF jsonb_typeof(v_elem -> 'campaignItemId') IS DISTINCT FROM 'string'
               OR (v_elem ->> 'campaignItemId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                RAISE EXCEPTION 'CAMPAIGN_ITEM_INVALID: referência da oferta (campaignItemId) ausente ou inválida.';
            END IF;
            -- Sem tabela de campanhas confirmada neste esquema: não há como validar identidade/tenant/validade/preço.
            RAISE EXCEPTION 'CAMPAIGN_SOURCE_UNAVAILABLE: ofertas de campanha ainda não podem ser finalizadas (validação de campanha indisponível no servidor). Adicione o produto pelo catálogo.';
        END IF;
        v_out := v_out || jsonb_build_array(v_elem - 'source' - 'campaignItemId');
    END LOOP;
    RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public._origin_normalize_items(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 2. _checkout_core: passa os itens pela normalização de origem (troca textual marcada, idempotente).
DO $patch$
DECLARE v_def TEXT;
BEGIN
    v_def := pg_get_functiondef(to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)'));
    IF position('[ORIGIN]' IN v_def) > 0 THEN
        RETURN;  -- já aplicada
    END IF;
    v_def := replace(v_def, 'public._price_items(v_tenant.id, p_items, true)',
        'public._price_items(v_tenant.id, public._origin_normalize_items(v_tenant.id, p_items) /*[ORIGIN]*/, true)');
    EXECUTE v_def;
END
$patch$;

-- 3. Pós-verificação
DO $post$
DECLARE v_src TEXT;
BEGIN
    SELECT prosrc INTO v_src FROM pg_proc
    WHERE oid = to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)');
    IF position('[ORIGIN]' IN v_src) = 0 OR position('[FULFILLMENT]' IN v_src) = 0
       OR to_regprocedure('public._origin_normalize_items(uuid,jsonb)') IS NULL THEN
        RAISE EXCEPTION 'ORIGIN POST: verificação falhou.';
    END IF;
END
$post$;
-- Fim da proposta.
