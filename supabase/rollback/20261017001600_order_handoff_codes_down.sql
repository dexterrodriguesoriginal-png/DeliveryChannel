-- Rollback da 20261017001600. ATENÇÃO: descarta os códigos gerados (tabela order_handoff_codes).
BEGIN;
DROP TRIGGER IF EXISTS trg_orders_create_handoff_code ON public.orders;
DROP FUNCTION IF EXISTS public.confirm_order_delivery(uuid, text);
DROP FUNCTION IF EXISTS public.get_my_order_delivery_code(uuid);
DROP FUNCTION IF EXISTS public.confirm_order_pickup(uuid, text);
DROP FUNCTION IF EXISTS public.reset_order_pickup_code(uuid);
DROP FUNCTION IF EXISTS public.get_order_pickup_code(uuid);
DROP FUNCTION IF EXISTS public._orders_create_handoff_code();
DROP TABLE IF EXISTS public.order_handoff_codes;
DROP FUNCTION IF EXISTS public._handoff_code();
CREATE OR REPLACE FUNCTION public.update_driver_order_status(p_order_id uuid, p_status character varying, p_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_driver_user_id UUID := auth.uid();
    v_driver_record RECORD;
    v_order RECORD;
    v_remaining_orders INT;
    v_clean_status VARCHAR(32) := UPPER(TRIM(p_status));
BEGIN
    -- 1. Validar autenticação do motorista
    IF v_driver_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    -- 2. Validar se o status solicitado faz parte dos status operacionais do motorista
    IF v_clean_status NOT IN ('OUT_FOR_DELIVERY', 'DELIVERED') THEN
        RAISE EXCEPTION 'Status "%" não permitido para operação por motorista.', v_clean_status;
    END IF;

    -- 3. Ordem 1: Bloquear e validar o pedido atribuído (1º PEDIDO)
    SELECT id, tenant_id, status, driver_id INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Validar que o pedido está atribuído ao motorista autenticado (auth.uid)
    IF v_order.driver_id IS NULL OR v_order.driver_id <> v_driver_user_id THEN
        RAISE EXCEPTION 'Acesso negado: o pedido não está atribuído ao motorista autenticado.';
    END IF;

    -- Rejeitar expressamente pedido cancelado
    IF v_order.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'Operação negada: pedido cancelado não pode ter seu status alterado pelo motorista.';
    END IF;

    -- 4. Validar vínculo ativo do motorista com o tenant do pedido em tenant_users
    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_users
        WHERE tenant_id = v_order.tenant_id 
          AND user_id = v_driver_user_id 
          AND role_id = 'DRIVER' 
          AND status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'Acesso negado: motorista não possui vínculo ativo com este estabelecimento.';
    END IF;

    -- 5. Ordem 2: Bloquear e validar o motorista (2º MOTORISTA)
    SELECT id, full_name, status INTO v_driver_record
    FROM public.drivers
    WHERE user_id = v_driver_user_id 
      AND tenant_id = v_order.tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cadastro operacional de motorista não encontrado para este estabelecimento.';
    END IF;

    IF v_driver_record.status = 'SUSPENDED' THEN
        RAISE EXCEPTION 'Motorista está suspenso de atividades operacionais.';
    END IF;

    -- 6. Validação estrita das transições válidas de status do pedido:
    -- Somente OUT_FOR_DELIVERY -> DELIVERED é permitida para conclusão da entrega
    IF v_clean_status = 'DELIVERED' THEN
        IF v_order.status <> 'OUT_FOR_DELIVERY' THEN
            RAISE EXCEPTION 'Transição inválida: pedido com status "%" não pode ser finalizado como DELIVERED. É obrigatório estar em "OUT_FOR_DELIVERY".', v_order.status;
        END IF;
    ELSIF v_clean_status = 'OUT_FOR_DELIVERY' THEN
        -- Pode ser chamado para confirmar início de rota apenas se o pedido estiver em READY ou já OUT_FOR_DELIVERY
        IF v_order.status NOT IN ('READY', 'OUT_FOR_DELIVERY') THEN
            RAISE EXCEPTION 'Transição inválida: pedido com status "%" não pode avançar para "OUT_FOR_DELIVERY".', v_order.status;
        END IF;
    END IF;

    -- 7. Atualizar status e updated_at do pedido
    UPDATE public.orders
    SET status = v_clean_status,
        updated_at = NOW()
    WHERE id = p_order_id;

    -- 8. Ajustar status operacional da frota em public.drivers
    IF v_clean_status = 'DELIVERED' THEN
        -- Verificar se ainda restam pedidos em rota para este motorista
        SELECT COUNT(*) INTO v_remaining_orders
        FROM public.orders
        WHERE driver_id = v_driver_user_id 
          AND tenant_id = v_order.tenant_id
          AND status = 'OUT_FOR_DELIVERY';

        -- Se não há mais entregas pendentes, retorna automaticamente para AVAILABLE
        IF v_remaining_orders = 0 THEN
            UPDATE public.drivers
            SET status = 'AVAILABLE',
                updated_at = NOW()
            WHERE id = v_driver_record.id;
        END IF;
    ELSIF v_clean_status = 'OUT_FOR_DELIVERY' THEN
        UPDATE public.drivers
        SET status = 'ON_DELIVERY',
            updated_at = NOW()
        WHERE id = v_driver_record.id;
    END IF;

    -- 9. Inserir histórico de status com identidade garantida do motorista
    INSERT INTO public.order_status_history (
        order_id,
        status,
        note,
        changed_by,
        created_at
    ) VALUES (
        p_order_id,
        v_clean_status,
        COALESCE(p_note, 'Atualização de rota pelo entregador'),
        v_driver_record.full_name,
        NOW()
    );

    -- 10. Gravar log de auditoria forense
    PERFORM public.log_audit_event(
        'ORDER_STATUS_UPDATE_DRIVER',
        'orders',
        'Motorista atualizou status do pedido #' || p_order_id::text || ' de ' || v_order.status || ' para ' || v_clean_status,
        p_order_id::text,
        v_order.status,
        v_clean_status,
        v_order.tenant_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_order_status(p_order_id uuid, p_new_status text, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
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

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261017001600';
NOTIFY pgrst, 'reload schema';
COMMIT;
