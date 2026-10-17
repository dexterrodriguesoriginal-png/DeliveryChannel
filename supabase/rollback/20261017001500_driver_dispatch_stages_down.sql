-- Rollback da 20261017001500 (restaura as definições anteriores; colunas novas removidas).
BEGIN;
DROP FUNCTION IF EXISTS public.driver_accept_order(uuid);
DROP FUNCTION IF EXISTS public.list_available_driver_orders();
CREATE OR REPLACE FUNCTION public._orders_protect_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
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

CREATE OR REPLACE FUNCTION public.assign_order_to_driver(p_order_id uuid, p_driver_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_operator_id UUID := auth.uid();
    v_order RECORD;
    v_driver RECORD;
    v_target_order_status VARCHAR(32);
BEGIN
    -- 1. Validar autenticação
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    -- 2. Bloquear pedido com FOR UPDATE (Ordem: 1º Pedido)
    SELECT id, tenant_id, status, driver_id, total_amount
    INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Validar se o status do pedido permite despacho operacional
    IF v_order.status NOT IN ('READY', 'WAITING_FOR_DRIVER', 'OUT_FOR_DELIVERY') THEN
        RAISE EXCEPTION 'O pedido não está pronto para despacho (Status atual: %).', v_order.status;
    END IF;

    -- 3. Bloquear motorista com FOR UPDATE (Ordem: 2º Motorista)
    SELECT id, full_name, status, tenant_id
    INTO v_driver
    FROM public.drivers
    WHERE user_id = p_driver_user_id 
      AND tenant_id = v_order.tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cadastro operacional de motorista não encontrado para este estabelecimento.';
    END IF;

    -- 4. Validar tenant: operador deve ser administrador do tenant do pedido
    IF NOT public.has_tenant_role(v_operator_id, v_order.tenant_id, ARRAY['OWNER', 'MANAGER', 'DELIVERY_MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada: somente administradores do estabelecimento podem despachar pedidos.';
    END IF;

    -- 5. Validar vínculo em tenant_users com papel DRIVER e status ACTIVE
    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_users
        WHERE tenant_id = v_order.tenant_id 
          AND user_id = p_driver_user_id 
          AND role_id = 'DRIVER' 
          AND status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'O usuário informado não é um motorista ativo deste estabelecimento.';
    END IF;

    -- 6. Validação estrita de disponibilidade: EXIGE STATUS AVAILABLE
    IF v_driver.status <> 'AVAILABLE' THEN
        RAISE EXCEPTION 'Motorista não está disponível para receber novos pedidos (Status atual: %).', v_driver.status;
    END IF;

    -- 7. Determinar status efetivamente aplicado ao pedido (READY -> OUT_FOR_DELIVERY)
    v_target_order_status := 'OUT_FOR_DELIVERY';

    -- 8. Atribuir pedido
    UPDATE public.orders
    SET driver_id = p_driver_user_id,
        status = v_target_order_status,
        updated_at = NOW()
    WHERE id = p_order_id;

    -- 9. Alterar status do motorista para ON_DELIVERY
    UPDATE public.drivers
    SET status = 'ON_DELIVERY',
        updated_at = NOW()
    WHERE id = v_driver.id;

    -- 10. Inserir histórico de status com o status EFETIVAMENTE APLICADO
    INSERT INTO public.order_status_history (
        order_id,
        status,
        note,
        changed_by,
        created_at
    ) VALUES (
        p_order_id,
        v_target_order_status,
        'Pedido atribuído ao entregador ' || v_driver.full_name,
        'Despacho da Loja',
        NOW()
    );

    -- 11. Auditoria forense
    PERFORM public.log_audit_event(
        'ORDER_ASSIGNED_DRIVER',
        'orders',
        'Pedido atribuído ao entregador ' || v_driver.full_name || ' (' || p_driver_user_id::text || ')',
        p_order_id::text,
        v_order.driver_id::text,
        p_driver_user_id::text,
        v_order.tenant_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'orderId', p_order_id,
        'driverUserId', p_driver_user_id,
        'driverName', v_driver.full_name,
        'orderStatus', v_target_order_status
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.unassign_order_driver(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_operator_id UUID := auth.uid();
    v_order RECORD;
    v_driver RECORD;
    v_prev_driver_id UUID;
    v_new_order_status VARCHAR(32);
    v_remaining_orders_count INT;
BEGIN
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    -- Ordem 1: Bloquear Pedido com FOR UPDATE
    SELECT id, tenant_id, status, driver_id
    INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF NOT public.has_tenant_role(v_operator_id, v_order.tenant_id, ARRAY['OWNER', 'MANAGER', 'DELIVERY_MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada: somente administradores podem alterar a atribuição de pedidos.';
    END IF;

    v_prev_driver_id := v_order.driver_id;

    IF v_prev_driver_id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'orderId', p_order_id, 'message', 'Pedido já não possuía motorista.');
    END IF;

    -- Ordem 2: Bloquear Motorista com FOR UPDATE
    SELECT id, status INTO v_driver
    FROM public.drivers
    WHERE user_id = v_prev_driver_id 
      AND tenant_id = v_order.tenant_id
    FOR UPDATE;

    -- Se OUT_FOR_DELIVERY ou WAITING_FOR_DRIVER, retorna para READY. Não altera outros status automaticamente.
    v_new_order_status := CASE 
        WHEN v_order.status IN ('OUT_FOR_DELIVERY', 'WAITING_FOR_DRIVER') THEN 'READY' 
        ELSE v_order.status 
    END;

    -- Desatribuir do pedido
    UPDATE public.orders
    SET driver_id = NULL,
        status = v_new_order_status,
        updated_at = NOW()
    WHERE id = p_order_id;

    -- Verificar se o motorista ainda possui outros pedidos em rota
    SELECT COUNT(*) INTO v_remaining_orders_count
    FROM public.orders
    WHERE driver_id = v_prev_driver_id
      AND tenant_id = v_order.tenant_id
      AND status = 'OUT_FOR_DELIVERY';

    -- Se não houver outros pedidos em rota, retornar para AVAILABLE (preserva SUSPENDED)
    IF v_remaining_orders_count = 0 AND FOUND THEN
        UPDATE public.drivers
        SET status = 'AVAILABLE',
            updated_at = NOW()
        WHERE id = v_driver.id
          AND status <> 'SUSPENDED';
    END IF;

    -- Histórico com status efetivo
    INSERT INTO public.order_status_history (
        order_id,
        status,
        note,
        changed_by,
        created_at
    ) VALUES (
        p_order_id,
        v_new_order_status,
        'Motorista desatribuído pela gerência da loja',
        'Despacho da Loja',
        NOW()
    );

    PERFORM public.log_audit_event(
        'ORDER_UNASSIGNED_DRIVER',
        'orders',
        'Desatribuição de motorista para o pedido #' || p_order_id::text,
        p_order_id::text,
        v_prev_driver_id::text,
        NULL,
        v_order.tenant_id
    );

    RETURN jsonb_build_object('success', true, 'orderId', p_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.suspend_driver(p_driver_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_operator_id UUID := auth.uid();
    v_driver RECORD;
BEGIN
    -- 1. Validar autenticação
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    -- 2. Identificar motorista e tenant
    SELECT id, tenant_id, user_id, full_name, status
    INTO v_driver
    FROM public.drivers
    WHERE id = p_driver_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Motorista não encontrado.';
    END IF;

    -- 3. Validar administrador
    IF NOT public.has_tenant_role(v_operator_id, v_driver.tenant_id, ARRAY['OWNER', 'MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada: somente proprietários e gerentes podem suspender motoristas.';
    END IF;

    -- 4. Ordem 1: Bloquear os pedidos pendentes em rota atribuídos ao motorista (1º PEDIDOS)
    PERFORM 1
    FROM public.orders
    WHERE driver_id = v_driver.user_id 
      AND tenant_id = v_driver.tenant_id 
      AND status IN ('OUT_FOR_DELIVERY', 'WAITING_FOR_DRIVER')
    FOR UPDATE;

    -- 5. Ordem 2: Bloquear o motorista (2º MOTORISTA)
    SELECT id, tenant_id, user_id, full_name, status
    INTO v_driver
    FROM public.drivers
    WHERE id = p_driver_id
    FOR UPDATE;

    -- 6. Alterar motorista para SUSPENDED
    UPDATE public.drivers
    SET status = 'SUSPENDED',
        updated_at = NOW()
    WHERE id = p_driver_id;

    -- 7. Registrar histórico para os pedidos que serão desatribuídos
    INSERT INTO public.order_status_history (
        order_id,
        status,
        note,
        changed_by,
        created_at
    )
    SELECT 
        id,
        'READY',
        'Motorista foi suspenso; pedido retornado para despacho (READY)',
        'Administração da Loja',
        NOW()
    FROM public.orders
    WHERE driver_id = v_driver.user_id 
      AND tenant_id = v_driver.tenant_id 
      AND status IN ('OUT_FOR_DELIVERY', 'WAITING_FOR_DRIVER');

    -- 8. Desatribuir pedidos pendentes que ainda não foram entregues voltando para READY
    UPDATE public.orders
    SET driver_id = NULL,
        status = 'READY',
        updated_at = NOW()
    WHERE driver_id = v_driver.user_id 
      AND tenant_id = v_driver.tenant_id 
      AND status IN ('OUT_FOR_DELIVERY', 'WAITING_FOR_DRIVER');

    -- 9. Trilha de auditoria
    PERFORM public.log_audit_event(
        'DRIVER_SUSPENDED',
        'drivers',
        'Motorista ' || v_driver.full_name || ' foi suspenso pelo administrador ' || v_operator_id::text,
        p_driver_id::text,
        v_driver.status,
        'SUSPENDED',
        v_driver.tenant_id
    );

    RETURN jsonb_build_object('success', true, 'driverId', p_driver_id);
END;
$$;

ALTER TABLE public.orders DROP COLUMN IF EXISTS driver_accepted_at, DROP COLUMN IF EXISTS picked_up_at, DROP COLUMN IF EXISTS delivered_at;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261017001500';
COMMIT;
