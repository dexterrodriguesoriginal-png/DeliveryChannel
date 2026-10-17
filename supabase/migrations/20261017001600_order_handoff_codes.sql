-- 20261017001600_order_handoff_codes.sql
-- Códigos antifraude: retirada (só loja vê; entregador digita) e entrega (só cliente vê; entregador digita).
-- Tabela sem policies/grants; acesso só por RPC. 5 tentativas por código + rate limit 10/min.
-- update_driver_order_status deixa de aceitar OUT_FOR_DELIVERY/DELIVERED sem código; loja marca DELIVERED só com motivo (auditado).
-- Rollback: supabase/rollback/20261017001600_order_handoff_codes_down.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.order_handoff_codes (
    order_id              uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
    tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    pickup_code           char(4) NOT NULL,
    pickup_attempts       smallint NOT NULL DEFAULT 0,
    pickup_confirmed_at   timestamptz,
    delivery_code         char(4),
    delivery_attempts     smallint NOT NULL DEFAULT 0,
    delivery_confirmed_at timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.order_handoff_codes IS 'Códigos de retirada (só loja) e entrega (só cliente). Sem policies/grants: acesso só por RPC SECURITY DEFINER.';
ALTER TABLE public.order_handoff_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_handoff_codes FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._handoff_code() RETURNS char(4)
    LANGUAGE sql VOLATILE SET search_path TO ''
    AS $$ SELECT lpad(((('x' || encode(extensions.gen_random_bytes(2), 'hex'))::bit(16)::int) % 10000)::text, 4, '0')::char(4) $$;
REVOKE ALL ON FUNCTION public._handoff_code() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._orders_create_handoff_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
    AS $$
BEGIN
    IF NEW.fulfillment_type = 'DELIVERY' THEN
        INSERT INTO public.order_handoff_codes (order_id, tenant_id, pickup_code)
        VALUES (NEW.id, NEW.tenant_id, public._handoff_code()) ON CONFLICT (order_id) DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._orders_create_handoff_code() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_orders_create_handoff_code ON public.orders;
CREATE TRIGGER trg_orders_create_handoff_code AFTER INSERT ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public._orders_create_handoff_code();

-- Pedidos de entrega em andamento recebem código de retirada (não altera orders).
INSERT INTO public.order_handoff_codes (order_id, tenant_id, pickup_code)
SELECT o.id, o.tenant_id, public._handoff_code() FROM public.orders o
WHERE o.fulfillment_type = 'DELIVERY' AND o.status NOT IN ('DELIVERED','CANCELLED')
ON CONFLICT (order_id) DO NOTHING;

-- Loja: código de retirada (staff do tenant). Demais: não encontrado.
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

-- Loja desbloqueia após 5 erros (gera novo código de retirada).
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

-- Entregador designado confirma a retirada com o código da loja (5 tentativas).
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

-- Cliente dono do pedido: código de entrega (só com o pedido em rota).
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

-- Entregador designado confirma a entrega com o código do cliente (5 tentativas).
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

REVOKE ALL ON FUNCTION public.get_order_pickup_code(uuid), public.reset_order_pickup_code(uuid),
    public.confirm_order_pickup(uuid, text), public.get_my_order_delivery_code(uuid),
    public.confirm_order_delivery(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_pickup_code(uuid), public.reset_order_pickup_code(uuid),
    public.confirm_order_pickup(uuid, text), public.get_my_order_delivery_code(uuid),
    public.confirm_order_delivery(uuid, text) TO authenticated;

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
    IF v_clean_status = 'DELIVERED' THEN
        RAISE EXCEPTION 'DELIVERY_CODE_REQUIRED: confirme a entrega com o código informado pelo cliente.';
    END IF;
    IF v_clean_status = 'OUT_FOR_DELIVERY' THEN
        RAISE EXCEPTION 'PICKUP_CODE_REQUIRED: confirme a retirada com o código fornecido pela loja.';
    END IF;
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

    -- 1600: entrega marcada pela loja sem código do cliente = override manual com motivo e auditoria.
    IF v_new = 'DELIVERED' AND v_order.fulfillment_type = 'DELIVERY' THEN
        IF v_note IS NULL THEN
            RAISE EXCEPTION 'NOTE_REQUIRED: informe o motivo para concluir a entrega sem o código do cliente.';
        END IF;
        PERFORM public.log_audit_event('DELIVERY_OVERRIDE_NO_CODE', 'orders', 'Entrega concluída pela loja sem código: ' || v_note,
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

NOTIFY pgrst, 'reload schema';
COMMIT;
