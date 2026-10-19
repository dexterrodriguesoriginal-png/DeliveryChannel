-- Rollback de 20261019002100_pickup_arrival_queue.sql (restaura update_order_status da 1600; remove fila).
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='pickup_arrivals') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.pickup_arrivals; END IF; END $$;
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
DROP TRIGGER IF EXISTS trg_orders_pickup_arrival_ins ON public.orders;
DROP TRIGGER IF EXISTS trg_orders_pickup_arrival_upd ON public.orders;
DROP FUNCTION IF EXISTS public.confirm_handover(uuid, text);
DROP FUNCTION IF EXISTS public.call_pickup(uuid);
DROP FUNCTION IF EXISTS public.get_my_pickup_status(uuid);
DROP FUNCTION IF EXISTS public.customer_check_in(text, uuid);
DROP FUNCTION IF EXISTS public.rotate_store_arrival_qr(uuid);
DROP FUNCTION IF EXISTS public.get_store_arrival_qr(uuid);
DROP FUNCTION IF EXISTS public._arrival_position(uuid);
DROP FUNCTION IF EXISTS public._orders_pickup_arrival_sync();
DROP FUNCTION IF EXISTS public._new_pickup_code(uuid);
DROP FUNCTION IF EXISTS public._arrival_token();
DROP TABLE IF EXISTS public.pickup_arrivals;
DROP TABLE IF EXISTS public.store_arrival_qr;
COMMIT;
