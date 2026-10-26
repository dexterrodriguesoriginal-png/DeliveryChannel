-- Reverts PR B schema/functions; notification and chat data are removed. Handoff data is preserved.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
 PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='pr-b-retention';
 END IF;
END $$;
DROP TRIGGER pr_b_orders_notify ON public.orders;
DROP TRIGGER pr_b_drivers_notify ON public.drivers;
DROP TRIGGER pr_b_messages_notify ON public.order_messages;
ALTER PUBLICATION supabase_realtime DROP TABLE public.owner_notifications, public.order_messages;
DROP TABLE public.order_messages, public.owner_notifications;
DROP FUNCTION public._pr_b_notify(),public.purge_dispatch_data(),public.send_order_message(uuid,text),public.get_dispatch_queue(uuid),public.set_dispatch_mode(uuid,text),public.get_handoff_status(uuid),public.reset_handoff_code(uuid,text);
CREATE OR REPLACE FUNCTION public.get_order_pickup_code(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
    AS $$
DECLARE v RECORD;
BEGIN
    SELECT h.pickup_code, h.pickup_attempts, h.pickup_confirmed_at, h.tenant_id INTO v
    FROM public.order_handoff_codes h WHERE h.order_id = p_order_id;
    IF NOT FOUND OR auth.uid() IS NULL
       OR NOT public.has_tenant_role(auth.uid(), v.tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER','DELIVERY_MANAGER']) THEN
        RETURN NULL;
    END IF;
    RETURN jsonb_build_object('code', v.pickup_code, 'confirmed', v.pickup_confirmed_at IS NOT NULL,
                              'locked', v.pickup_attempts >= 5, 'attempts', v.pickup_attempts);
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_order_pickup_code(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
    AS $$
DECLARE v_tenant uuid;
BEGIN
    SELECT tenant_id INTO v_tenant FROM public.order_handoff_codes WHERE order_id = p_order_id AND pickup_confirmed_at IS NULL FOR UPDATE;
    IF NOT FOUND OR auth.uid() IS NULL
       OR NOT public.has_tenant_role(auth.uid(), v_tenant, ARRAY['OWNER','MANAGER','DELIVERY_MANAGER']) THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.order_handoff_codes SET pickup_code = public._handoff_code(), pickup_attempts = 0 WHERE order_id = p_order_id;
    PERFORM public.log_audit_event('PICKUP_CODE_RESET', 'order_handoff_codes', 'Código de retirada regenerado pela loja',
        p_order_id::text, NULL, NULL, v_tenant);
    RETURN public.get_order_pickup_code(p_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_order_pickup(p_order_id uuid, p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
    AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_order RECORD;
    v_h RECORD;
    v_code text := regexp_replace(COALESCE(p_code, ''), '\D', '', 'g');
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE = '42501'; END IF;
    SELECT id, tenant_id, status, driver_id INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.driver_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END IF;
    IF NOT public._rate_limit_hit('handoff_code', v_uid::text, v_order.tenant_id, 10, 60) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas; aguarde um minuto.';
    END IF;
    IF v_order.status NOT IN ('WAITING_FOR_DRIVER', 'READY') THEN
        RAISE EXCEPTION 'INVALID_STATE: o pedido não está aguardando retirada (status %).', v_order.status;
    END IF;
    SELECT * INTO v_h FROM public.order_handoff_codes WHERE order_id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CODE_NOT_FOUND: pedido sem código de retirada; peça à loja.'; END IF;
    IF v_h.pickup_attempts >= 5 THEN
        RAISE EXCEPTION 'CODE_LOCKED: código bloqueado após 5 tentativas; peça à loja para liberar.';
    END IF;
    IF v_code <> v_h.pickup_code THEN
        UPDATE public.order_handoff_codes SET pickup_attempts = pickup_attempts + 1 WHERE order_id = p_order_id;
        RETURN jsonb_build_object('success', false, 'error', 'CODE_INVALID', 'attemptsLeft', GREATEST(0, 4 - v_h.pickup_attempts));
    END IF;
    UPDATE public.order_handoff_codes SET pickup_confirmed_at = now(), delivery_code = public._handoff_code() WHERE order_id = p_order_id;
    UPDATE public.orders SET status = 'OUT_FOR_DELIVERY', picked_up_at = now(),
           driver_accepted_at = COALESCE(driver_accepted_at, now()), updated_at = now() WHERE id = p_order_id;
    UPDATE public.drivers SET status = 'ON_DELIVERY', updated_at = now() WHERE user_id = v_uid AND tenant_id = v_order.tenant_id AND status <> 'SUSPENDED';
    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (p_order_id, 'OUT_FOR_DELIVERY', 'Retirada confirmada com código', 'Entregador');
    PERFORM public.log_audit_event('ORDER_PICKUP_CONFIRMED', 'orders', 'Retirada confirmada com código', p_order_id::text,
        v_order.status::text, 'OUT_FOR_DELIVERY', v_order.tenant_id);
    RETURN jsonb_build_object('success', true, 'orderStatus', 'OUT_FOR_DELIVERY');
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_order_delivery(p_order_id uuid, p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
    AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_order RECORD;
    v_h RECORD;
    v_left int;
    v_code text := regexp_replace(COALESCE(p_code, ''), '\D', '', 'g');
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE = '42501'; END IF;
    SELECT id, tenant_id, status, driver_id INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.driver_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END IF;
    IF NOT public._rate_limit_hit('handoff_code', v_uid::text, v_order.tenant_id, 10, 60) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas; aguarde um minuto.';
    END IF;
    IF v_order.status <> 'OUT_FOR_DELIVERY' THEN
        RAISE EXCEPTION 'INVALID_STATE: o pedido não está em rota (status %).', v_order.status;
    END IF;
    SELECT * INTO v_h FROM public.order_handoff_codes WHERE order_id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_h.delivery_code IS NULL THEN RAISE EXCEPTION 'CODE_NOT_FOUND: pedido sem código de entrega; fale com a loja.'; END IF;
    IF v_h.delivery_attempts >= 5 THEN
        RAISE EXCEPTION 'CODE_LOCKED: código bloqueado após 5 tentativas; fale com a loja.';
    END IF;
    IF v_code <> v_h.delivery_code THEN
        UPDATE public.order_handoff_codes SET delivery_attempts = delivery_attempts + 1 WHERE order_id = p_order_id;
        RETURN jsonb_build_object('success', false, 'error', 'CODE_INVALID', 'attemptsLeft', GREATEST(0, 4 - v_h.delivery_attempts));
    END IF;
    UPDATE public.order_handoff_codes SET delivery_confirmed_at = now() WHERE order_id = p_order_id;
    UPDATE public.orders SET status = 'DELIVERED', delivered_at = now(), updated_at = now() WHERE id = p_order_id;
    SELECT count(*) INTO v_left FROM public.orders
    WHERE driver_id = v_uid AND tenant_id = v_order.tenant_id AND status IN ('OUT_FOR_DELIVERY', 'WAITING_FOR_DRIVER');
    IF v_left = 0 THEN
        UPDATE public.drivers SET status = 'AVAILABLE', updated_at = now()
        WHERE user_id = v_uid AND tenant_id = v_order.tenant_id AND status = 'ON_DELIVERY';
    END IF;
    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (p_order_id, 'DELIVERED', 'Entrega confirmada com código do cliente', 'Entregador');
    PERFORM public.log_audit_event('ORDER_DELIVERY_CONFIRMED', 'orders', 'Entrega confirmada com código', p_order_id::text,
        'OUT_FOR_DELIVERY', 'DELIVERED', v_order.tenant_id);
    RETURN jsonb_build_object('success', true, 'orderStatus', 'DELIVERED');
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_accept_order(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_order RECORD;
    v_driver RECORD;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE = '42501'; END IF;
    SELECT id, tenant_id, status, driver_id INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.tenant_users tu WHERE tu.tenant_id = v_order.tenant_id
                                AND tu.user_id = v_uid AND tu.role_id = 'DRIVER' AND tu.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END IF;
    IF v_order.status <> 'WAITING_FOR_DRIVER' OR v_order.driver_id IS NOT NULL THEN
        IF v_order.driver_id = v_uid THEN
            RETURN jsonb_build_object('success', true, 'orderId', p_order_id, 'alreadyAccepted', true);
        END IF;
        RAISE EXCEPTION 'ORDER_NOT_AVAILABLE: esta corrida não está mais disponível.';
    END IF;
    SELECT id, status INTO v_driver FROM public.drivers WHERE user_id = v_uid AND tenant_id = v_order.tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DRIVER_NOT_FOUND: cadastro de entregador não encontrado nesta loja.'; END IF;
    IF v_driver.status <> 'AVAILABLE' THEN
        RAISE EXCEPTION 'DRIVER_NOT_AVAILABLE: fique disponível para aceitar corridas (status atual: %).', v_driver.status;
    END IF;
    UPDATE public.orders SET driver_id = v_uid, driver_accepted_at = now(), updated_at = now() WHERE id = p_order_id;
    UPDATE public.drivers SET status = 'ON_DELIVERY', updated_at = now() WHERE id = v_driver.id;
    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (p_order_id, 'DRIVER_ACCEPTED', 'Entregador aceitou a corrida', 'Entregador');
    PERFORM public.log_audit_event('ORDER_DRIVER_ACCEPTED', 'orders', 'Entregador aceitou a corrida',
        p_order_id::text, NULL, v_uid::text, v_order.tenant_id);
    RETURN jsonb_build_object('success', true, 'orderId', p_order_id, 'orderStatus', 'WAITING_FOR_DRIVER');
END;
$$;

CREATE OR REPLACE FUNCTION public.list_available_driver_orders() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', o.id, 'orderNumber', o.order_number, 'tenantId', o.tenant_id, 'storeName', t.name,
        'deliveryAddress', o.delivery_address, 'totalAmount', o.total_amount,
        'paymentMethod', o.payment_method, 'createdAt', o.created_at,
        'driverPayout', COALESCE((to_jsonb(o) ->> 'driver_payout')::numeric, o.delivery_fee)
    ) ORDER BY o.created_at), '[]'::jsonb)
    FROM public.orders o
    JOIN public.tenants t ON t.id = o.tenant_id
    JOIN public.tenant_users tu ON tu.tenant_id = o.tenant_id AND tu.user_id = auth.uid()
         AND tu.role_id = 'DRIVER' AND tu.status = 'ACTIVE'
    WHERE auth.uid() IS NOT NULL AND o.status = 'WAITING_FOR_DRIVER' AND o.driver_id IS NULL
      AND o.fulfillment_type = 'DELIVERY';
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

    -- 1600: entrega marcada pela loja sem código do cliente = override manual com motivo e auditoria.
    IF v_new = 'DELIVERED' AND v_order.fulfillment_type = 'DELIVERY' THEN
        IF v_note IS NULL THEN
            RAISE EXCEPTION 'NOTE_REQUIRED: informe o motivo para concluir a entrega sem o código do cliente.';
        END IF;
        PERFORM public.log_audit_event('DELIVERY_OVERRIDE_NO_CODE', 'orders', 'Entrega concluída pela loja sem código: ' || v_note,
            p_order_id::text, v_order.status::text, 'DELIVERED', v_order.tenant_id);
    END IF;
    -- 2100: retirada com fila de chegada ativa: concluir sem o código do cliente = override com motivo e auditoria.
    IF v_new = 'DELIVERED' AND v_order.fulfillment_type = 'PICKUP'
       AND EXISTS (SELECT 1 FROM public.pickup_arrivals a WHERE a.order_id = p_order_id AND a.handed_over_at IS NULL) THEN
        IF v_note IS NULL THEN
            RAISE EXCEPTION 'PICKUP_CODE_REQUIRED: confirme a retirada com o código do cliente (ou informe o motivo).';
        END IF;
        PERFORM public.log_audit_event('PICKUP_OVERRIDE_NO_CODE', 'orders', 'Retirada concluída sem código: ' || v_note,
            p_order_id::text, v_order.status::text, 'DELIVERED', v_order.tenant_id);
    END IF;
    SELECT COALESCE(NULLIF(u.name, ''), u.email, 'Equipe') INTO v_actor FROM public.users u WHERE u.id = auth.uid();
    v_actor := COALESCE(v_actor, 'Equipe') || ' (' || v_role || ')';

    UPDATE public.orders SET status = v_new, updated_at = now(),
        delivered_at = CASE WHEN v_new = 'DELIVERED' THEN now() ELSE delivered_at END,
        picked_up_at = CASE WHEN v_new = 'OUT_FOR_DELIVERY' THEN COALESCE(picked_up_at, now()) ELSE picked_up_at END
    WHERE id = p_order_id;
    -- 1600: saída marcada pela loja também gera o código de entrega do cliente.
    IF v_new = 'OUT_FOR_DELIVERY' THEN
        UPDATE public.order_handoff_codes SET pickup_confirmed_at = COALESCE(pickup_confirmed_at, now()),
               delivery_code = COALESCE(delivery_code, public._handoff_code()) WHERE order_id = p_order_id;
    END IF;

    IF v_new = 'CANCELLED' THEN
        v_restocked := public._restock_order_items(p_order_id, v_actor);
    END IF;

    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (p_order_id, v_new, COALESCE(v_note, 'Status alterado para ' || v_new), v_actor);

    RETURN jsonb_build_object('order_id', p_order_id, 'previous_status', v_order.status, 'status', v_new,
                              'restocked_products', v_restocked);
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
    IF v_order.status NOT IN ('READY', 'WAITING_FOR_DRIVER') THEN
        RAISE EXCEPTION 'O pedido não está pronto para despacho (Status atual: %).', v_order.status;
    END IF;

    -- 3. Bloquear motorista com FOR UPDATE (Ordem: 2º Motorista)
    SELECT id, full_name, status, tenant_id, approval_status
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
    -- 0700: só vínculo APPROVED recebe atribuição (spec 2.2 / 4.2)
    IF v_driver.approval_status IS DISTINCT FROM 'APPROVED' THEN
        RAISE EXCEPTION 'Entregador não aprovado neste estabelecimento.' USING ERRCODE = 'P0414';
    END IF;

    IF v_driver.status <> 'AVAILABLE' THEN
        RAISE EXCEPTION 'Motorista não está disponível para receber novos pedidos (Status atual: %).', v_driver.status;
    END IF;

    -- 7. Determinar status efetivamente aplicado ao pedido (READY -> OUT_FOR_DELIVERY)
    -- 1500: designar = aceite em nome do entregador; a saída (OUT_FOR_DELIVERY) só ocorre na retirada com código.
    v_target_order_status := 'WAITING_FOR_DRIVER';
    IF v_order.driver_id IS NOT NULL AND v_order.driver_id <> p_driver_user_id THEN
        RAISE EXCEPTION 'DRIVER_ALREADY_ASSIGNED: pedido já está com outro entregador; desatribua antes.';
    END IF;

    -- 8. Atribuir pedido
    UPDATE public.orders
    SET driver_id = p_driver_user_id,
        status = v_target_order_status,
        driver_accepted_at = NOW(),
        updated_at = NOW()
    WHERE id = p_order_id;

    -- 9. Alterar status do motorista para ON_DELIVERY
    UPDATE public.drivers
    SET status = 'ON_DELIVERY',
        updated_at = NOW()
    WHERE id = v_driver.id;

    -- 10. Histórico (sem nome do entregador: o cliente lê esta tabela)
    IF v_order.status = 'READY' THEN
        INSERT INTO public.order_status_history (order_id, status, note, changed_by, created_at)
        VALUES (p_order_id, 'WAITING_FOR_DRIVER', 'Loja chamou o entregador', 'Despacho da Loja', NOW());
    END IF;
    INSERT INTO public.order_status_history (order_id, status, note, changed_by, created_at)
    VALUES (p_order_id, 'DRIVER_ASSIGNED', 'Entregador designado pela loja', 'Despacho da Loja', NOW() + interval '1 millisecond');

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

CREATE OR REPLACE FUNCTION public.get_my_order_delivery_code(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
    AS $$
DECLARE v_code char(4);
BEGIN
    IF auth.uid() IS NULL THEN RETURN NULL; END IF;
    SELECT h.delivery_code INTO v_code
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id AND c.user_id = auth.uid()
    JOIN public.order_handoff_codes h ON h.order_id = o.id
    WHERE o.id = p_order_id AND o.status = 'OUT_FOR_DELIVERY' AND h.delivery_confirmed_at IS NULL;
    IF v_code IS NULL THEN RETURN NULL; END IF;
    RETURN jsonb_build_object('code', v_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.log_audit_event(
    p_action VARCHAR(64),
    p_resource VARCHAR(64),
    p_details TEXT,
    p_resource_id VARCHAR(64) DEFAULT NULL,
    p_previous_value TEXT DEFAULT NULL,
    p_new_value TEXT DEFAULT NULL,
    p_tenant_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_user_role VARCHAR(32) := 'ANONYMOUS';
    v_user_name VARCHAR(255) := 'Sistema';
    v_tenant_id UUID := p_tenant_id;
    v_tenant_name VARCHAR(255) := NULL;
    v_is_ceo BOOLEAN := false;
    v_log_id UUID;
BEGIN
    IF v_user_id IS NOT NULL THEN
        SELECT u.name, tu.role_id, COALESCE(v_tenant_id, tu.tenant_id)
        INTO v_user_name, v_user_role, v_tenant_id
        FROM public.users u
        LEFT JOIN public.tenant_users tu ON tu.user_id = u.id AND tu.status = 'ACTIVE'
        WHERE u.id = v_user_id
        LIMIT 1;

        v_is_ceo := public.is_ceo(v_user_id);
    END IF;

    IF v_tenant_id IS NOT NULL THEN
        SELECT name INTO v_tenant_name FROM public.tenants WHERE id = v_tenant_id;
    END IF;

    INSERT INTO public.audit_logs (
        user_id,
        user_name,
        user_role,
        tenant_id,
        tenant_name,
        action,
        resource,
        resource_id,
        details,
        previous_value,
        new_value,
        is_ceo_support
    ) VALUES (
        COALESCE(v_user_id::text, 'system'),
        COALESCE(v_user_name, 'Sistema'),
        COALESCE(v_user_role, 'SYSTEM'),
        v_tenant_id,
        v_tenant_name,
        p_action,
        p_resource,
        p_resource_id,
        p_details,
        p_previous_value,
        p_new_value,
        v_is_ceo
    ) RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$;
DROP FUNCTION public._pr_b_driver(uuid),public._pr_b_staff(uuid,text[]);
ALTER TABLE public.tenant_settings DROP COLUMN dispatch_mode;
NOTIFY pgrst,'reload schema';
COMMIT;
