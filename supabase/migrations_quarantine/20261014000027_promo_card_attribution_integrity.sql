-- =============================================================================
-- 027 — Integridade da atribuição de vendas a Cards Promocionais
--       (Marketing → Desempenho & Vendas)
-- =============================================================================
-- Depende de 026 (orders.offer_id, order_items.offer_id/discount_amount,
-- offers.promo_times_used e process_promotional_checkout_atomic, que JÁ grava a
-- origem do pedido no servidor, validando offer.tenant_id = loja do pedido).
-- Esta migration NÃO cria tabela nem RPC de checkout e NÃO altera dados existentes
-- (única coluna nova: customers.notes, nula, exigida pela RPC da 026 — ver item 0).
-- Ela só torna a atribuição confiável para fins analíticos:
--   1) offer_id de pedido/itens precisa pertencer à MESMA loja do pedido;
--   2) a origem promocional é imutável após gravada (não pode ser trocada por
--      UPDATE de staff via orders_staff_update/order_items_staff_manage), o que
--      garante que um pedido conte uma única vez e para um único card;
--   3) o registro de resgate (campaign_metadata.redemption_number) é imutável.
-- offer_id → NULL só é aceito quando vem da ação ON DELETE SET NULL do FK da 026.
-- Rollback: supabase/rollbacks/20261014000027_promo_card_attribution_integrity.rollback.sql
-- =============================================================================

-- PRECHECKS: abortam se o estado não for o esperado (026 aplicada, sem dados inconsistentes)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='offer_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='campaign_metadata')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='order_items' AND column_name='offer_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='order_items' AND column_name='discount_amount')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='offers' AND column_name='promo_times_used')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='process_promotional_checkout_atomic')
  THEN
    RAISE EXCEPTION '027 PRECHECK: estrutura da 026 ausente (orders.offer_id/campaign_metadata, order_items.offer_id/discount_amount, offers.promo_times_used ou process_promotional_checkout_atomic). Abortando.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.orders o JOIN public.offers f ON f.id = o.offer_id WHERE f.tenant_id <> o.tenant_id) THEN
    RAISE EXCEPTION '027 PRECHECK: existem pedidos atribuídos a card de outra loja. Abortando sem alterar dados.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_items i JOIN public.orders o ON o.id = i.order_id JOIN public.offers f ON f.id = i.offer_id WHERE f.tenant_id <> o.tenant_id) THEN
    RAISE EXCEPTION '027 PRECHECK: existem itens atribuídos a card de outra loja. Abortando sem alterar dados.';
  END IF;
END $$;

-- 0) Correção necessária para o fluxo de atribuição funcionar:
--    process_promotional_checkout_atomic (026) insere customers.notes ao cadastrar
--    o cliente no primeiro pedido promocional, mas essa coluna não existe em 001–026
--    (falha "column notes of relation customers does not exist" reproduzida em
--    Postgres local). Coluna aditiva e nula; nenhum dado existente é alterado.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS notes TEXT;

-- 0b) Correção necessária no checkout promocional (mesma assinatura e mesmo
--     comportamento da 026; ÚNICA mudança: o evento CHECKOUT_COMPLETED grava
--     card_id = NULL e mantém offer_id). Na 026 a RPC gravava offers.id em
--     campaign_analytics_events.card_id, que tem FK para campaign_cards(id):
--     todo checkout promocional falhava (reproduzido em Postgres local) e
--     nenhum pedido chegava a ser atribuído.
CREATE OR REPLACE FUNCTION public.process_promotional_checkout_atomic(
    p_tenant_slug TEXT,
    p_offer_id UUID,
    p_quantity INT,
    p_customer_name VARCHAR,
    p_customer_phone VARCHAR,
    p_customer_email VARCHAR,
    p_delivery_address TEXT,
    p_address_details JSONB,
    p_payment_method VARCHAR,
    p_fulfillment_type VARCHAR,
    p_notes TEXT DEFAULT NULL,
    p_coupon_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_tenant_status VARCHAR(32);
    v_tenant_name TEXT;
    v_min_order_value NUMERIC(10,2) := 0.00;
    v_delivery_fee NUMERIC(10,2) := 0.00;
    v_free_threshold NUMERIC(10,2);
    v_default_prep INT := 30;
    
    v_offer RECORD;
    v_prod RECORD;
    v_unit_price NUMERIC(10,2);
    v_orig_price NUMERIC(10,2);
    v_subtotal NUMERIC(10,2) := 0.00;
    v_discount NUMERIC(10,2) := 0.00;
    v_coupon_discount NUMERIC(10,2) := 0.00;
    v_total_amount NUMERIC(10,2) := 0.00;
    
    v_customer_id UUID;
    v_order_id UUID;
    v_clean_phone VARCHAR(32);
    v_clean_address TEXT;
    v_new_usage_count INT;
    v_redemption_msg TEXT := NULL;
    v_item_name TEXT;
    v_item_unit VARCHAR(16);
BEGIN
    -- 1. Validar autenticação do cliente: NÃO EXISTE CHECKOUT ANÔNIMO
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Autenticação necessária. É necessário estar conectado para finalizar o pedido promocional.';
    END IF;

    -- 2. Validar dados do cliente
    IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
        RAISE EXCEPTION 'O nome do cliente é obrigatório.';
    END IF;
    IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN
        RAISE EXCEPTION 'O WhatsApp do cliente é obrigatório.';
    END IF;
    v_clean_phone := regexp_replace(p_customer_phone, '[^\d]', '', 'g');
    IF length(v_clean_phone) < 10 THEN
        RAISE EXCEPTION 'Número de WhatsApp inválido.';
    END IF;

    -- 3. Validar tenant
    SELECT t.id, t.status, t.name, s.min_order_value, s.delivery_fee, s.free_delivery_threshold, COALESCE(s.default_prep_time_minutes, 30)
    INTO v_tenant_id, v_tenant_status, v_tenant_name, v_min_order_value, v_delivery_fee, v_free_threshold, v_default_prep
    FROM public.tenants t
    LEFT JOIN public.tenant_settings s ON s.tenant_id = t.id
    WHERE t.slug = p_tenant_slug;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Estabelecimento com slug "%" não encontrado.', p_tenant_slug;
    END IF;
    IF v_tenant_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'O estabelecimento "%" está temporariamente desativado para pedidos.', p_tenant_slug;
    END IF;

    -- 4. Validar quantidade
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'A quantidade deve ser de pelo menos 1 unidade.';
    END IF;

    -- 5. TRAVAR O CARD PROMOCIONAL PARA ATUALIZAÇÃO ATÔMICA (ROW-LEVEL LOCK FOR UPDATE)
    SELECT * INTO v_offer
    FROM public.offers
    WHERE id = p_offer_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Card promocional não encontrado para este estabelecimento.';
    END IF;

    IF NOT v_offer.is_active THEN
        RAISE EXCEPTION 'Esta promoção foi desativada pelo estabelecimento.';
    END IF;

    -- Validar período temporal
    IF v_offer.start_at IS NOT NULL AND v_offer.start_at > NOW() THEN
        RAISE EXCEPTION 'Esta promoção ainda não iniciou.';
    END IF;
    IF v_offer.end_at IS NOT NULL AND v_offer.end_at < NOW() THEN
        RAISE EXCEPTION 'Esta promoção expirou.';
    END IF;

    -- Validar limite atômico de usos
    IF v_offer.promo_usage_limit IS NOT NULL AND v_offer.promo_usage_limit > 0 THEN
        IF v_offer.promo_times_used >= v_offer.promo_usage_limit THEN
            RAISE EXCEPTION 'Esta promoção atingiu o limite máximo de % usos e está esgotada.', v_offer.promo_usage_limit;
        END IF;
    END IF;

    -- Validar quantidade máxima por cliente
    IF v_offer.promo_max_quantity_per_customer IS NOT NULL AND p_quantity > v_offer.promo_max_quantity_per_customer THEN
        RAISE EXCEPTION 'A quantidade máxima permitida por cliente nesta promoção é de % unidades.', v_offer.promo_max_quantity_per_customer;
    END IF;

    -- Determina preço oficial a partir do banco de dados (impossível fraudar no front)
    v_unit_price := COALESCE(v_offer.promo_price, v_offer.promotional_price, v_offer.original_price, 0.00);
    v_orig_price := COALESCE(v_offer.promo_original_price, v_offer.original_price, v_unit_price);
    v_item_name := COALESCE(v_offer.promo_title, v_offer.title);
    v_item_unit := COALESCE(v_offer.promo_unit, 'un');

    IF v_unit_price <= 0 THEN
        RAISE EXCEPTION 'Preço promocional inválido no cadastro da promoção.';
    END IF;

    v_subtotal := v_unit_price * p_quantity;

    -- Se a oferta estiver vinculada a um produto do catálogo físico, valida estoque
    IF v_offer.product_id IS NOT NULL THEN
        SELECT * INTO v_prod FROM public.products
        WHERE id = v_offer.product_id AND tenant_id = v_tenant_id
        FOR UPDATE;

        IF FOUND THEN
            IF v_prod.stock_quantity < p_quantity THEN
                RAISE EXCEPTION 'Estoque insuficiente para o produto da promoção. Disponível: %', v_prod.stock_quantity;
            END IF;
            -- Baixa atômica de estoque
            UPDATE public.products
            SET stock_quantity = stock_quantity - p_quantity,
                updated_at = NOW()
            WHERE id = v_prod.id;
        END IF;
    END IF;

    -- 6. Validar tipo de entrega e taxa
    IF p_fulfillment_type = 'DELIVERY' THEN
        v_clean_address := trim(COALESCE(p_delivery_address, ''));
        IF v_clean_address = '' THEN
            RAISE EXCEPTION 'Endereço de entrega é obrigatório para entrega.';
        END IF;
        IF v_free_threshold IS NOT NULL AND v_subtotal >= v_free_threshold THEN
            v_delivery_fee := 0.00;
        END IF;
    ELSE
        p_fulfillment_type := 'PICKUP';
        v_clean_address := 'Retirada no Balcão';
        v_delivery_fee := 0.00;
    END IF;

    -- 7. Resolver ou criar cliente
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE tenant_id = v_tenant_id AND user_id = v_user_id;

    IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (
            tenant_id, user_id, name, phone, email, notes
        ) VALUES (
            v_tenant_id, v_user_id, p_customer_name, v_clean_phone, p_customer_email, 'Cliente cadastrado via Checkout Promocional'
        ) RETURNING id INTO v_customer_id;
    ELSE
        UPDATE public.customers
        SET name = p_customer_name,
            phone = v_clean_phone,
            email = COALESCE(p_customer_email, email),
            updated_at = NOW()
        WHERE id = v_customer_id;
    END IF;

    v_total_amount := v_subtotal + v_delivery_fee;

    -- 8. Incrementa contador atômico de usos da promoção
    v_new_usage_count := v_offer.promo_times_used + 1;
    UPDATE public.offers
    SET promo_times_used = v_new_usage_count,
        updated_at = NOW()
    WHERE id = v_offer.id;

    IF v_offer.promo_usage_limit IS NOT NULL AND v_offer.promo_usage_limit > 0 THEN
        v_redemption_msg := format('🎉 Parabéns! Você foi o cliente nº %s a aproveitar esta promoção!', v_new_usage_count);
    END IF;

    -- 9. Inserir Pedido Real no Sistema Oficial (public.orders)
    INSERT INTO public.orders (
        tenant_id,
        customer_id,
        customer_name,
        customer_phone,
        customer_email,
        delivery_address,
        address_details,
        subtotal,
        delivery_fee,
        discount,
        total_amount,
        payment_method,
        payment_status,
        fulfillment_type,
        status,
        notes,
        origin,
        prep_time_minutes,
        offer_id,
        campaign_metadata
    ) VALUES (
        v_tenant_id,
        v_customer_id,
        p_customer_name,
        v_clean_phone,
        p_customer_email,
        v_clean_address,
        COALESCE(p_address_details, '{}'::jsonb),
        v_subtotal,
        v_delivery_fee,
        v_discount,
        v_total_amount,
        p_payment_method,
        'PENDING',
        p_fulfillment_type,
        'PENDING',
        COALESCE(p_notes, ''),
        'promotional_checkout',
        v_default_prep,
        v_offer.id,
        jsonb_build_object(
            'offer_id', v_offer.id,
            'offer_title', v_offer.title,
            'redemption_number', v_new_usage_count,
            'is_limited', (v_offer.promo_usage_limit IS NOT NULL AND v_offer.promo_usage_limit > 0)
        )
    ) RETURNING id INTO v_order_id;

    -- 10. Inserir Item Oficial (public.order_items)
    INSERT INTO public.order_items (
        order_id,
        product_id,
        product_name,
        quantity,
        unit_price,
        total_price,
        notes,
        unit,
        offer_id,
        original_price,
        discount_amount,
        discount_percentage
    ) VALUES (
        v_order_id,
        v_offer.product_id,
        v_item_name,
        p_quantity,
        v_unit_price,
        v_subtotal,
        COALESCE(p_notes, 'Oferta Promocional Exclusiva'),
        v_item_unit,
        v_offer.id,
        v_orig_price,
        GREATEST(0, (v_orig_price - v_unit_price) * p_quantity),
        v_offer.promo_discount_percentage
    );

    -- 11. Histórico de status do pedido
    INSERT INTO public.order_status_history (
        order_id, status, note, changed_by
    ) VALUES (
        v_order_id, 'PENDING', 'Pedido confirmado via Checkout Promocional', 'Checkout Promocional'
    );

    -- 12. Registrar evento de Analytics
    INSERT INTO public.campaign_analytics_events (
        tenant_id,
        card_id,
        offer_id,
        product_id,
        customer_id,
        order_id,
        event_type,
        event_value,
        quantity,
        metadata
    ) VALUES (
        v_tenant_id,
        NULL, -- card_id referencia campaign_cards; um card de offers NÃO é campaign_card (026 violava o FK)
        v_offer.id,
        v_offer.product_id,
        v_customer_id,
        v_order_id,
        'CHECKOUT_COMPLETED',
        v_total_amount,
        p_quantity,
        jsonb_build_object(
            'offer_title', v_item_name,
            'redemption_number', v_new_usage_count,
            'unit_price', v_unit_price
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'redemption_number', v_new_usage_count,
        'celebration_message', v_redemption_msg,
        'total_amount', v_total_amount,
        'is_exhausted', (v_offer.promo_usage_limit IS NOT NULL AND v_new_usage_count >= v_offer.promo_usage_limit)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_promotional_checkout_atomic TO authenticated;


-- 1) orders
CREATE OR REPLACE FUNCTION public._orders_promo_attribution_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- offer_id -> NULL só é aceito vindo da ação ON DELETE SET NULL do FK (trigger aninhado)
    IF NEW.offer_id IS DISTINCT FROM OLD.offer_id
       AND (NEW.offer_id IS NOT NULL OR pg_trigger_depth() < 2) THEN
      RAISE EXCEPTION 'A origem promocional (offer_id) do pedido é imutável.' USING ERRCODE = '42501';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id AND NEW.offer_id IS NOT NULL THEN
      RAISE EXCEPTION 'Pedido atribuído a card não pode mudar de loja.' USING ERRCODE = '42501';
    END IF;
    IF (NEW.campaign_metadata -> 'redemption_number') IS DISTINCT FROM (OLD.campaign_metadata -> 'redemption_number') THEN
      RAISE EXCEPTION 'O registro de resgate (redemption_number) do pedido é imutável.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.offer_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.offers f WHERE f.id = NEW.offer_id AND f.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Card promocional não pertence à loja do pedido.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_orders_promo_attribution_guard ON public.orders;
CREATE TRIGGER trg_orders_promo_attribution_guard
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public._orders_promo_attribution_guard();

-- 2) order_items
CREATE OR REPLACE FUNCTION public._order_items_promo_attribution_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- offer_id -> NULL só é aceito vindo da ação ON DELETE SET NULL do FK (trigger aninhado)
    IF NEW.offer_id IS DISTINCT FROM OLD.offer_id
       AND (NEW.offer_id IS NOT NULL OR pg_trigger_depth() < 2) THEN
      RAISE EXCEPTION 'A origem promocional (offer_id) do item é imutável.' USING ERRCODE = '42501';
    END IF;
    IF NEW.offer_id IS NOT NULL AND NEW.discount_amount IS DISTINCT FROM OLD.discount_amount THEN
      RAISE EXCEPTION 'O desconto promocional registrado no item é imutável.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.offer_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.orders o JOIN public.offers f ON f.id = NEW.offer_id AND f.tenant_id = o.tenant_id
       WHERE o.id = NEW.order_id) THEN
    RAISE EXCEPTION 'Card promocional do item não pertence à loja do pedido.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_order_items_promo_attribution_guard ON public.order_items;
CREATE TRIGGER trg_order_items_promo_attribution_guard
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public._order_items_promo_attribution_guard();

REVOKE ALL ON FUNCTION public._orders_promo_attribution_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._order_items_promo_attribution_guard() FROM PUBLIC, anon, authenticated;

-- 3) Índice para o painel (pedidos atribuídos por loja e período)
CREATE INDEX IF NOT EXISTS idx_orders_tenant_offer_created
  ON public.orders (tenant_id, created_at) WHERE offer_id IS NOT NULL;
