-- ==============================================================================
-- ADEGAFOOD — MIGRATION 009: CLIENT AUTH, CUSTOMERS RELATIONSHIP & ATOMIC CHECKOUT
-- ==============================================================================
-- 1. Vincula public.customers com auth.users de forma multi-tenant segura
-- 2. Adequação da unicidade: remoção de UNIQUE(tenant_id, phone), adoção de UNIQUE(tenant_id, user_id)
-- 3. Políticas de RLS para clientes autenticados consultarem seus próprios dados e pedidos
-- 4. Trigger de proteção em public.customers (separa atualização de perfil direto vs checkout interno)
-- 5. Procedure atômica public.process_checkout_atomic() atualizada e blindada:
--    - Obrigatoriedade estrita de autenticação via auth.uid() (sem spoofing via parâmetro)
--    - Normalização real do telefone (v_clean_phone persistido e consultado de forma canônica)
--    - BLINDAGEM TOTAL ANTI-TAKEOVER: nunca vincula customer órfão por simples telefone
--    - Preservação integral do histórico legado (customers órfãos e seus pedidos continuam intocados)
--    - Redução de risco de deadlock com ordem determinística de locks (ORDER BY product_id ASC)
--    - Consolidação automática de itens duplicados por productId
--    - Garantia atômica anti-overselling (FOR UPDATE com bloqueio de concorrência)
--    - Validação de fulfillment_type ('DELIVERY', 'PICKUP')
--    - Validação de payment_method ('PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH')
--    - Validação de dados do cliente (nome, WhatsApp, e-mail de auth.users)
--    - Validação estrita de endereço de entrega para DELIVERY
--    - Isolamento multi-tenant pelo slug do tenant
--    - Ativação de contexto transacional local ('app.internal_customer_update') para checkout recorrente
--    - Execução restrita a usuários autenticados (REVOKE anon e public)
-- ==============================================================================

-- 1. Adicionar user_id à tabela public.customers
ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Adequação da unicidade de clientes:
-- A unicidade principal de identidade passa a ser por conta autenticada (tenant_id, user_id).
-- O telefone é dado de contato e comunicação, e NÃO prova suficiente de identidade.
-- Remove a constraint antiga UNIQUE (tenant_id, phone) para permitir que novos clientes autenticados
-- possam comprar mesmo se houver registro legado/órfão com o mesmo telefone, sem risco de takeover.
ALTER TABLE public.customers
DROP CONSTRAINT IF EXISTS customers_tenant_id_phone_key;

-- Substitui por índice não-único para buscas rápidas de contato pelo staff do estabelecimento
CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone ON public.customers(tenant_id, phone);

-- Índices de performance e unicidade estrita por tenant e usuário autenticado
CREATE INDEX IF NOT EXISTS idx_customers_tenant_user ON public.customers(tenant_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_user ON public.customers(tenant_id, user_id) WHERE user_id IS NOT NULL;

-- 3. Políticas RLS na tabela public.customers para clientes autenticados
DROP POLICY IF EXISTS "customers_self_select" ON public.customers;
CREATE POLICY "customers_self_select" ON public.customers
    FOR SELECT USING (
        user_id = auth.uid()
    );

DROP POLICY IF EXISTS "customers_self_update" ON public.customers;
CREATE POLICY "customers_self_update" ON public.customers
    FOR UPDATE USING (
        user_id = auth.uid()
    )
    WITH CHECK (
        user_id = auth.uid()
    );

-- 4. Trigger para proteção de dados sensíveis, métricas calculadas e metadados em public.customers
-- Diferencia alteração direta de perfil pelo cliente vs atualização interna legítima pelo checkout atômico
CREATE OR REPLACE FUNCTION public.check_customer_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_internal_checkout BOOLEAN;
BEGIN
    -- Verifica se a atualização foi disparada pelo contexto interno autorizado do process_checkout_atomic
    v_is_internal_checkout := (current_setting('app.internal_customer_update', true) = 'true');

    -- Contexto A: Atualização interna do checkout
    IF v_is_internal_checkout THEN
        -- No checkout interno, id, tenant_id e user_id ainda devem permanecer estritamente consistentes
        IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id THEN
            RAISE EXCEPTION 'Operação interna inválida: id e tenant_id do cliente não podem ser alterados.';
        END IF;
        -- Se o customer já tinha user_id vinculado, não pode ser reassociado a outro user_id
        IF OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
            RAISE EXCEPTION 'Operação interna inválida: cliente já vinculado a outro usuário.';
        END IF;
        -- Não permite alterar origin no checkout para clientes já existentes
        IF NEW.origin IS DISTINCT FROM OLD.origin THEN
            RAISE EXCEPTION 'Operação interna inválida: origin do cliente não pode ser alterado após criação.';
        END IF;
        RETURN NEW;
    END IF;

    -- Contexto B: Alteração direta de perfil pelo próprio cliente via API (auth.uid() = OLD.user_id)
    -- Garante que o cliente NÃO consiga alterar: id, tenant_id, user_id, total_orders, ltv_amount, datas, origin e updated_at
    IF auth.uid() IS NOT NULL AND OLD.user_id = auth.uid() AND NOT public.has_tenant_role(auth.uid(), OLD.tenant_id, ARRAY['OWNER', 'MANAGER']) THEN
        IF NEW.id <> OLD.id OR 
           NEW.tenant_id <> OLD.tenant_id OR 
           NEW.user_id IS DISTINCT FROM OLD.user_id OR 
           NEW.total_orders <> OLD.total_orders OR 
           NEW.ltv_amount <> OLD.ltv_amount OR 
           NEW.first_order_date IS DISTINCT FROM OLD.first_order_date OR 
           NEW.last_order_date IS DISTINCT FROM OLD.last_order_date OR 
           NEW.created_at <> OLD.created_at OR
           NEW.updated_at IS DISTINCT FROM OLD.updated_at OR
           NEW.origin IS DISTINCT FROM OLD.origin THEN
            RAISE EXCEPTION 'Apenas informações pessoais permitidas (nome, telefone e e-mail) podem ser atualizadas pelo cliente.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_customer_self_update ON public.customers;
CREATE TRIGGER trg_check_customer_self_update
BEFORE UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.check_customer_self_update();

-- 5. Políticas RLS para clientes autenticados consultarem seus próprios pedidos
DROP POLICY IF EXISTS "orders_customer_select" ON public.orders;
CREATE POLICY "orders_customer_select" ON public.orders
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.customers c
            WHERE c.id = public.orders.customer_id
              AND c.user_id = auth.uid()
              AND c.tenant_id = public.orders.tenant_id
        )
    );

DROP POLICY IF EXISTS "order_items_customer_select" ON public.order_items;
CREATE POLICY "order_items_customer_select" ON public.order_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.orders o
            JOIN public.customers c ON c.id = o.customer_id
            WHERE o.id = public.order_items.order_id 
              AND c.user_id = auth.uid()
              AND c.tenant_id = o.tenant_id
        )
    );

DROP POLICY IF EXISTS "order_status_history_customer_select" ON public.order_status_history;
CREATE POLICY "order_status_history_customer_select" ON public.order_status_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.orders o
            JOIN public.customers c ON c.id = o.customer_id
            WHERE o.id = public.order_status_history.order_id 
              AND c.user_id = auth.uid()
              AND c.tenant_id = o.tenant_id
        )
    );

-- 6. Atualização da Procedure Atômica public.process_checkout_atomic()
-- Remove qualquer sobrecarga anterior para evitar ambiguidades
DROP FUNCTION IF EXISTS public.process_checkout_atomic(TEXT, VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB, VARCHAR, VARCHAR, TEXT, VARCHAR, JSONB, UUID);
DROP FUNCTION IF EXISTS public.process_checkout_atomic(TEXT, VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB, VARCHAR, VARCHAR, TEXT, VARCHAR, JSONB);

CREATE OR REPLACE FUNCTION public.process_checkout_atomic(
    p_tenant_slug TEXT,
    p_customer_name VARCHAR,
    p_customer_phone VARCHAR,
    p_customer_email VARCHAR,
    p_delivery_address TEXT,
    p_address_details JSONB,
    p_payment_method VARCHAR,
    p_fulfillment_type VARCHAR,
    p_notes TEXT,
    p_origin VARCHAR,
    p_items JSONB -- Array de [{ "productId": UUID, "quantity": INT, "notes": TEXT }]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_auth_email VARCHAR(255);
    v_customer_email VARCHAR(255);
    v_tenant_id UUID;
    v_tenant_status VARCHAR(32);
    v_min_order_value NUMERIC(10,2) := 0.00;
    v_delivery_fee NUMERIC(10,2) := 0.00;
    v_free_threshold NUMERIC(10,2);
    v_order_id UUID;
    v_raw_item RECORD;
    v_item RECORD;
    v_prod RECORD;
    v_unit_price NUMERIC(10,2);
    v_subtotal NUMERIC(10,2) := 0.00;
    v_total_amount NUMERIC(10,2) := 0.00;
    v_customer_id UUID;
    v_prev_stock INT;
    v_new_stock INT;
    v_clean_phone VARCHAR(32);
    v_clean_address TEXT;
BEGIN
    -- 1. Validar autenticação do cliente: NÃO EXISTE CHECKOUT ANÔNIMO. Identidade vem EXCLUSIVAMENTE de auth.uid()
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Autenticação necessária. É necessário estar conectado com uma conta de cliente para finalizar o pedido.';
    END IF;

    -- 2. Validar e normalizar dados cadastrais do cliente
    IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
        RAISE EXCEPTION 'O nome do cliente é obrigatório.';
    END IF;

    IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN
        RAISE EXCEPTION 'O WhatsApp do cliente é obrigatório.';
    END IF;

    -- Normalização real do telefone: somente dígitos (mínimo de 10 dígitos com DDD)
    v_clean_phone := regexp_replace(p_customer_phone, '[^\d]', '', 'g');
    IF length(v_clean_phone) < 10 THEN
        RAISE EXCEPTION 'Número de WhatsApp inválido. Informe um número com DDD válido.';
    END IF;

    -- Obter e-mail primário oficial a partir da sessão auth.users
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_user_id;
    v_customer_email := COALESCE(NULLIF(trim(v_auth_email), ''), NULLIF(trim(p_customer_email), ''));

    -- 3. Validar tipo de fulfillment (DELIVERY ou PICKUP)
    IF p_fulfillment_type NOT IN ('DELIVERY', 'PICKUP') THEN
        RAISE EXCEPTION 'Tipo de entrega "%" inválido. Valores aceitos: DELIVERY, PICKUP.', p_fulfillment_type;
    END IF;

    -- 4. Validar forma de pagamento
    IF p_payment_method NOT IN ('PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH') THEN
        RAISE EXCEPTION 'Forma de pagamento "%" inválida. Valores aceitos: PIX, CREDIT_CARD, DEBIT_CARD, CASH.', p_payment_method;
    END IF;

    -- 5. Validar endereço de entrega de acordo com a modalidade
    v_clean_address := trim(COALESCE(p_delivery_address, ''));
    IF p_fulfillment_type = 'DELIVERY' THEN
        IF v_clean_address = '' THEN
            RAISE EXCEPTION 'Endereço de entrega é obrigatório para a modalidade DELIVERY.';
        END IF;
    ELSE
        -- Retirada no balcão (PICKUP)
        IF v_clean_address = '' THEN
            v_clean_address := 'Retirada no Balcão';
        END IF;
    END IF;

    -- 6. Resolver e validar o tenant pelo slug (apenas ACTIVE pode vender)
    SELECT t.id, t.status, s.min_order_value, s.delivery_fee, s.free_delivery_threshold
    INTO v_tenant_id, v_tenant_status, v_min_order_value, v_delivery_fee, v_free_threshold
    FROM public.tenants t
    LEFT JOIN public.tenant_settings s ON s.tenant_id = t.id
    WHERE t.slug = p_tenant_slug;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Estabelecimento com slug "%" não encontrado.', p_tenant_slug;
    END IF;

    IF v_tenant_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'O estabelecimento "%" está temporariamente desativado ou suspenso para pedidos.', p_tenant_slug;
    END IF;

    -- 7. Validar itens enviados
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'A sacola de compras não pode estar vazia.';
    END IF;

    -- Validação preliminar de integridade de cada elemento individual
    FOR v_raw_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        "productId" UUID,
        "quantity" INT,
        "notes" TEXT
    ) LOOP
        IF v_raw_item."productId" IS NULL THEN
            RAISE EXCEPTION 'ID do produto inválido no pedido.';
        END IF;

        IF v_raw_item."quantity" IS NULL OR v_raw_item."quantity" <= 0 THEN
            RAISE EXCEPTION 'A quantidade do item deve ser um número inteiro maior que zero.';
        END IF;
    END LOOP;

    -- 8. Validar cada item com LOCK FOR UPDATE determinístico (ordenado por productId ASC para reduzir risco de deadlocks)
    FOR v_item IN (
        SELECT 
            (elem->>'productId')::UUID AS product_id,
            SUM((elem->>'quantity')::INT)::INT AS total_quantity,
            string_agg(NULLIF(trim(elem->>'notes'), ''), ' | ') AS notes
        FROM jsonb_array_elements(p_items) AS elem
        GROUP BY (elem->>'productId')::UUID
        ORDER BY (elem->>'productId')::UUID ASC
    ) LOOP
        -- Bloqueia a linha do produto no banco até o término desta transação
        SELECT * INTO v_prod FROM public.products
        WHERE id = v_item.product_id AND tenant_id = v_tenant_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Produto % não encontrado no catálogo deste estabelecimento.', v_item.product_id;
        END IF;

        IF NOT v_prod.is_active THEN
            RAISE EXCEPTION 'O produto "%" está temporariamente indisponível no cardápio.', v_prod.name;
        END IF;

        IF v_prod.stock_quantity < v_item.total_quantity THEN
            RAISE EXCEPTION 'Estoque insuficiente para o produto "%". Disponível: %, Solicitado: %', 
                v_prod.name, v_prod.stock_quantity, v_item.total_quantity;
        END IF;

        -- Preço OFICIAL recalculado no banco de dados com validação promocional estrita
        IF v_prod.promotional_price IS NOT NULL AND v_prod.promotional_price > 0 AND v_prod.promotional_price <= v_prod.price THEN
            v_unit_price := v_prod.promotional_price;
        ELSE
            v_unit_price := v_prod.price;
        END IF;

        v_subtotal := v_subtotal + (v_unit_price * v_item.total_quantity);
    END LOOP;

    -- 9. Validar Pedido Mínimo obrigatório
    IF v_min_order_value > 0 AND v_subtotal < v_min_order_value THEN
        RAISE EXCEPTION 'Valor mínimo do pedido não atingido. O valor mínimo é de R$ % e o subtotal atual é R$ %.',
            v_min_order_value, v_subtotal;
    END IF;

    -- 10. Calcular taxa de entrega oficial a partir das configurações do tenant no banco
    IF p_fulfillment_type = 'DELIVERY' THEN
        IF v_free_threshold IS NOT NULL AND v_subtotal >= v_free_threshold THEN
            v_delivery_fee := 0.00;
        END IF;
    ELSE
        v_delivery_fee := 0.00;
    END IF;

    v_total_amount := v_subtotal + v_delivery_fee;

    -- 11. Resolução do Cliente baseada EXCLUSIVAMENTE em auth.uid() e tenant_id (BLINDAGEM TOTAL ANTI-TAKEOVER)
    -- Localiza o cliente vinculado ao usuário autenticado neste tenant
    SELECT id INTO v_customer_id 
    FROM public.customers 
    WHERE tenant_id = v_tenant_id AND user_id = v_user_id
    LIMIT 1;

    -- Ativa sinalização de transação local para autorizar a atualização interna das métricas pelo checkout
    PERFORM set_config('app.internal_customer_update', 'true', true);

    IF v_customer_id IS NULL THEN
        -- Cria um novo registro de customer exclusivamente para este auth.uid() neste tenant.
        -- O histórico de qualquer customer legado/órfão com o mesmo telefone permanece 100% intocado.
        INSERT INTO public.customers (
            tenant_id, 
            user_id,
            name, 
            phone, 
            email, 
            origin, 
            total_orders, 
            ltv_amount, 
            first_order_date, 
            last_order_date
        ) VALUES (
            v_tenant_id, 
            v_user_id,
            trim(p_customer_name), 
            v_clean_phone, 
            v_customer_email, 
            COALESCE(p_origin, 'direct'), 
            1, 
            v_total_amount, 
            CURRENT_DATE, 
            CURRENT_DATE
        ) RETURNING id INTO v_customer_id;
    ELSE
        -- Atualiza o registro existente do próprio usuário autenticado
        UPDATE public.customers
        SET total_orders = total_orders + 1,
            ltv_amount = ltv_amount + v_total_amount,
            last_order_date = CURRENT_DATE,
            name = COALESCE(NULLIF(trim(p_customer_name), ''), name),
            phone = v_clean_phone,
            email = COALESCE(v_customer_email, email),
            updated_at = NOW()
        WHERE id = v_customer_id
          AND user_id = v_user_id;
    END IF;

    -- Desativa imediatamente a sinalização de transação local
    PERFORM set_config('app.internal_customer_update', 'false', true);

    -- 12. Criar o Pedido Oficial na tabela public.orders com telefone normalizado (v_clean_phone)
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
        origin
    ) VALUES (
        v_tenant_id,
        v_customer_id,
        trim(p_customer_name),
        v_clean_phone,
        v_customer_email,
        v_clean_address,
        p_address_details,
        v_subtotal,
        v_delivery_fee,
        0.00,
        v_total_amount,
        p_payment_method,
        CASE WHEN p_payment_method = 'PIX' THEN 'PENDING' ELSE 'PAYMENT_ON_DELIVERY' END,
        p_fulfillment_type,
        'PENDING',
        p_notes,
        COALESCE(p_origin, 'direct')
    ) RETURNING id INTO v_order_id;

    -- 13. Gravar Itens Consolidados e Decrementar Estoque de Forma Atômica no Kardex (Ordem Determinística ASC)
    FOR v_item IN (
        SELECT 
            (elem->>'productId')::UUID AS product_id,
            SUM((elem->>'quantity')::INT)::INT AS total_quantity,
            string_agg(NULLIF(trim(elem->>'notes'), ''), ' | ') AS notes
        FROM jsonb_array_elements(p_items) AS elem
        GROUP BY (elem->>'productId')::UUID
        ORDER BY (elem->>'productId')::UUID ASC
    ) LOOP
        SELECT * INTO v_prod FROM public.products WHERE id = v_item.product_id;

        IF v_prod.promotional_price IS NOT NULL AND v_prod.promotional_price > 0 AND v_prod.promotional_price <= v_prod.price THEN
            v_unit_price := v_prod.promotional_price;
        ELSE
            v_unit_price := v_prod.price;
        END IF;

        v_prev_stock := v_prod.stock_quantity;
        v_new_stock := v_prev_stock - v_item.total_quantity;

        IF v_new_stock < 0 THEN
            RAISE EXCEPTION 'Estoque insuficiente para o produto "%". Operação abortada.', v_prod.name;
        END IF;

        -- Gravar item oficial consolidado do pedido
        INSERT INTO public.order_items (
            order_id,
            product_id,
            product_name,
            quantity,
            unit_price,
            total_price,
            notes,
            unit
        ) VALUES (
            v_order_id,
            v_prod.id,
            v_prod.name,
            v_item.total_quantity,
            v_unit_price,
            (v_unit_price * v_item.total_quantity),
            v_item.notes,
            v_prod.unit
        );

        -- Decrementa estoque garantindo não-negatividade
        UPDATE public.products
        SET stock_quantity = v_new_stock,
            updated_at = NOW()
        WHERE id = v_prod.id;

        -- Registra Kardex oficial
        INSERT INTO public.inventory_movements (
            tenant_id,
            product_id,
            product_name,
            quantity,
            type,
            reference_id,
            reason,
            previous_stock,
            new_stock,
            created_by_name
        ) VALUES (
            v_tenant_id,
            v_prod.id,
            v_prod.name,
            -v_item.total_quantity,
            'VENDA',
            v_order_id::text,
            'Baixa atômica por venda - Pedido #' || v_order_id::text,
            v_prev_stock,
            v_new_stock,
            'Sistema (process_checkout_atomic)'
        );
    END LOOP;

    -- 14. Histórico inicial de status com identidade consistente
    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (v_order_id, 'PENDING', 'Pedido confirmado com sucesso pelo checkout online', 'Checkout Público');

    RETURN v_order_id;
END;
$$;

-- Permissões de execução: Estritamente para authenticated (bloqueado para anon e public)
REVOKE EXECUTE ON FUNCTION public.process_checkout_atomic(TEXT, VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB, VARCHAR, VARCHAR, TEXT, VARCHAR, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.process_checkout_atomic(TEXT, VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB, VARCHAR, VARCHAR, TEXT, VARCHAR, JSONB) TO authenticated;
