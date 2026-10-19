-- 20261019002100_pickup_arrival_queue.sql
-- Fila de chegada da retirada (modelo McDonald's): QR de chegada por loja (rotacionável), código curto por pedido de
-- retirada, registro de chegada/chamada/entrega, RPCs do cliente e da equipe, realtime sem PII.
-- 100% ADITIVA: tabelas novas + funções novas; update_order_status ganha só a exigência de código/motivo para concluir
-- retirada que tem registro na fila (override auditado). Nenhum dado existente é alterado ou apagado.
-- Rollback: supabase/rollback/20261019002100_pickup_arrival_queue_down.sql
BEGIN;

-- 1. QR de chegada por loja. Sem grants: só via RPC.
CREATE TABLE IF NOT EXISTS public.store_arrival_qr (
    tenant_id  uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    token      text NOT NULL UNIQUE CHECK (token ~ '^[A-Z2-9]{6}$'),
    rotated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.store_arrival_qr ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_arrival_qr FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._arrival_token() RETURNS text
    LANGUAGE plpgsql VOLATILE SET search_path TO ''
    AS $$
DECLARE a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; b bytea := extensions.gen_random_bytes(6); r text := ''; i int;
BEGIN
    FOR i IN 0..5 LOOP r := r || substr(a, (get_byte(b, i) % length(a)) + 1, 1); END LOOP;
    RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public._arrival_token() FROM PUBLIC, anon, authenticated;

-- 2. Fila: um registro por pedido de retirada. Só ids, código e horários (sem nome/telefone/endereço).
CREATE TABLE IF NOT EXISTS public.pickup_arrivals (
    order_id       uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
    tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    pickup_code    text NOT NULL CHECK (pickup_code ~ '^[0-9]{3,4}$'),
    code_attempts  smallint NOT NULL DEFAULT 0,
    arrived_at     timestamptz,
    called_at      timestamptz,
    handed_over_at timestamptz,
    closed_at      timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pickup_arrivals_open_code ON public.pickup_arrivals (tenant_id, pickup_code) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pickup_arrivals_queue ON public.pickup_arrivals (tenant_id, arrived_at) WHERE closed_at IS NULL;
ALTER TABLE public.pickup_arrivals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pickup_arrivals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pickup_arrivals TO authenticated;

DROP POLICY IF EXISTS pickup_arrivals_staff_select ON public.pickup_arrivals;
CREATE POLICY pickup_arrivals_staff_select ON public.pickup_arrivals FOR SELECT TO authenticated
    USING (public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']));
DROP POLICY IF EXISTS pickup_arrivals_customer_select ON public.pickup_arrivals;
CREATE POLICY pickup_arrivals_customer_select ON public.pickup_arrivals FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.orders o JOIN public.customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
                   WHERE o.id = pickup_arrivals.order_id AND c.user_id = auth.uid()));

-- Código curto único entre os pedidos abertos da loja: 3 dígitos; se não achar, 4.
CREATE OR REPLACE FUNCTION public._new_pickup_code(p_tenant uuid) RETURNS text
    LANGUAGE plpgsql VOLATILE SET search_path TO ''
    AS $$
DECLARE c text; n int := 0;
BEGIN
    LOOP
        n := n + 1;
        IF n <= 40 THEN c := (100 + ((('x' || encode(extensions.gen_random_bytes(2), 'hex'))::bit(16)::int) % 900))::text;
        ELSE c := (1000 + ((('x' || encode(extensions.gen_random_bytes(2), 'hex'))::bit(16)::int) % 9000))::text; END IF;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.pickup_arrivals WHERE tenant_id = p_tenant AND pickup_code = c AND closed_at IS NULL);
        IF n > 200 THEN RAISE EXCEPTION 'PICKUP_CODE_EXHAUSTED'; END IF;
    END LOOP;
    RETURN c;
END;
$$;
REVOKE ALL ON FUNCTION public._new_pickup_code(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._orders_pickup_arrival_sync() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.fulfillment_type = 'PICKUP' AND NEW.status NOT IN ('DELIVERED','CANCELLED') THEN
            INSERT INTO public.pickup_arrivals (order_id, tenant_id, pickup_code)
            VALUES (NEW.id, NEW.tenant_id, public._new_pickup_code(NEW.tenant_id)) ON CONFLICT (order_id) DO NOTHING;
        END IF;
    ELSIF NEW.status IN ('DELIVERED','CANCELLED') AND OLD.status IS DISTINCT FROM NEW.status THEN
        UPDATE public.pickup_arrivals SET closed_at = COALESCE(closed_at, now()) WHERE order_id = NEW.id;
    END IF;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._orders_pickup_arrival_sync() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_orders_pickup_arrival_ins ON public.orders;
CREATE TRIGGER trg_orders_pickup_arrival_ins AFTER INSERT ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public._orders_pickup_arrival_sync();
DROP TRIGGER IF EXISTS trg_orders_pickup_arrival_upd ON public.orders;
CREATE TRIGGER trg_orders_pickup_arrival_upd AFTER UPDATE OF status ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public._orders_pickup_arrival_sync();

-- Retiradas em aberto ganham código (não altera orders).
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT o.id, o.tenant_id FROM public.orders o
             WHERE o.fulfillment_type = 'PICKUP' AND o.status NOT IN ('DELIVERED','CANCELLED')
               AND NOT EXISTS (SELECT 1 FROM public.pickup_arrivals a WHERE a.order_id = o.id) LOOP
        INSERT INTO public.pickup_arrivals (order_id, tenant_id, pickup_code) VALUES (r.id, r.tenant_id, public._new_pickup_code(r.tenant_id));
    END LOOP;
END $$;

-- Posição na fila (1 = próximo): ordem de chegada entre os que chegaram e ainda não retiraram.
CREATE OR REPLACE FUNCTION public._arrival_position(p_order uuid) RETURNS int
    LANGUAGE sql STABLE SET search_path TO ''
    AS $$
    SELECT CASE WHEN a.arrived_at IS NULL OR a.closed_at IS NOT NULL THEN NULL ELSE
        (SELECT count(*)::int FROM public.pickup_arrivals b WHERE b.tenant_id = a.tenant_id AND b.closed_at IS NULL
           AND b.arrived_at IS NOT NULL AND (b.arrived_at, b.order_id) <= (a.arrived_at, a.order_id)) END
    FROM public.pickup_arrivals a WHERE a.order_id = p_order
$$;
REVOKE ALL ON FUNCTION public._arrival_position(uuid) FROM PUBLIC, anon, authenticated;

-- 3. Equipe: QR de chegada da loja (cria se faltar) e troca (dono/gerente).
CREATE OR REPLACE FUNCTION public.get_store_arrival_qr(p_tenant_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
    AS $$
DECLARE v text;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_tenant_role(auth.uid(), p_tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']) THEN
        RAISE EXCEPTION 'FORBIDDEN: sem acesso a esta loja.' USING ERRCODE = '42501';
    END IF;
    SELECT token INTO v FROM public.store_arrival_qr WHERE tenant_id = p_tenant_id;
    IF v IS NULL THEN
        LOOP
            BEGIN
                INSERT INTO public.store_arrival_qr (tenant_id, token) VALUES (p_tenant_id, public._arrival_token())
                ON CONFLICT (tenant_id) DO NOTHING;
                EXIT;
            EXCEPTION WHEN unique_violation THEN NULL;
            END;
        END LOOP;
        SELECT token INTO v FROM public.store_arrival_qr WHERE tenant_id = p_tenant_id;
    END IF;
    RETURN jsonb_build_object('token', v);
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_store_arrival_qr(p_tenant_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
    AS $$
DECLARE v text;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_tenant_role(auth.uid(), p_tenant_id, ARRAY['OWNER','MANAGER']) THEN
        RAISE EXCEPTION 'FORBIDDEN: só dono ou gerente troca o QR.' USING ERRCODE = '42501';
    END IF;
    LOOP
        v := public._arrival_token();
        BEGIN
            INSERT INTO public.store_arrival_qr (tenant_id, token) VALUES (p_tenant_id, v)
            ON CONFLICT (tenant_id) DO UPDATE SET token = EXCLUDED.token, rotated_at = now();
            EXIT;
        EXCEPTION WHEN unique_violation THEN NULL;
        END;
    END LOOP;
    PERFORM public.log_audit_event('ARRIVAL_QR_ROTATED', 'store_arrival_qr', 'QR de chegada trocado', p_tenant_id::text, NULL, NULL, p_tenant_id);
    RETURN jsonb_build_object('token', v);
END;
$$;

-- 4. Cliente: "Cheguei na loja" (QR ou código digitado). Só o próprio pedido de retirada naquela loja, em aberto.
CREATE OR REPLACE FUNCTION public.customer_check_in(p_store_qr_token text, p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
    AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_tok text := upper(regexp_replace(COALESCE(p_store_qr_token, ''), '[^A-Za-z0-9]', '', 'g'));
    v_order RECORD;
    v_tenant uuid;
    v_a RECORD;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: entre na sua conta.' USING ERRCODE = '42501'; END IF;
    IF NOT public._rate_limit_hit('arrival_check_in', v_uid::text, NULL, 10, 60) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas; aguarde um minuto.';
    END IF;
    SELECT o.id, o.tenant_id, o.status, o.fulfillment_type INTO v_order
    FROM public.orders o JOIN public.customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id AND c.user_id = v_uid
    WHERE o.id = p_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501'; END IF;
    IF v_order.fulfillment_type <> 'PICKUP' THEN RAISE EXCEPTION 'NOT_PICKUP: este pedido é de entrega.'; END IF;
    IF v_order.status IN ('DELIVERED','CANCELLED') THEN RAISE EXCEPTION 'ORDER_CLOSED: este pedido já foi encerrado.'; END IF;
    SELECT tenant_id INTO v_tenant FROM public.store_arrival_qr WHERE token = v_tok;
    IF v_tenant IS NULL OR v_tenant <> v_order.tenant_id THEN
        RAISE EXCEPTION 'WRONG_STORE: este QR não é da loja do seu pedido.';
    END IF;
    UPDATE public.pickup_arrivals SET arrived_at = COALESCE(arrived_at, now()) WHERE order_id = p_order_id AND closed_at IS NULL
    RETURNING * INTO v_a;
    IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_CLOSED: este pedido já foi encerrado.'; END IF;
    RETURN jsonb_build_object('code', v_a.pickup_code, 'arrivedAt', v_a.arrived_at, 'calledAt', v_a.called_at,
                              'position', public._arrival_position(p_order_id));
END;
$$;

-- Cliente: situação da retirada (código, posição, chamado).
CREATE OR REPLACE FUNCTION public.get_my_pickup_status(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
    AS $$
DECLARE v RECORD;
BEGIN
    IF auth.uid() IS NULL THEN RETURN NULL; END IF;
    SELECT a.* INTO v FROM public.pickup_arrivals a
    JOIN public.orders o ON o.id = a.order_id
    JOIN public.customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id AND c.user_id = auth.uid()
    WHERE a.order_id = p_order_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN jsonb_build_object('code', v.pickup_code, 'arrivedAt', v.arrived_at, 'calledAt', v.called_at,
        'handedOverAt', v.handed_over_at, 'closed', v.closed_at IS NOT NULL, 'position', public._arrival_position(p_order_id));
END;
$$;

-- 5. Equipe: chamar o cliente (pedido PRONTO).
CREATE OR REPLACE FUNCTION public.call_pickup(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
    AS $$
DECLARE v_order RECORD;
BEGIN
    SELECT id, tenant_id, status, fulfillment_type INTO v_order FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND OR auth.uid() IS NULL
       OR NOT public.has_tenant_role(auth.uid(), v_order.tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']) THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END IF;
    IF v_order.fulfillment_type <> 'PICKUP' THEN RAISE EXCEPTION 'NOT_PICKUP: pedido de entrega.'; END IF;
    IF v_order.status <> 'READY' THEN RAISE EXCEPTION 'INVALID_STATE: marque o pedido como pronto antes de chamar.'; END IF;
    UPDATE public.pickup_arrivals SET called_at = now() WHERE order_id = p_order_id AND closed_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'CODE_NOT_FOUND: pedido sem registro de retirada.'; END IF;
    RETURN jsonb_build_object('success', true, 'calledAt', now());
END;
$$;

-- 6. Equipe: entregar ao cliente conferindo o código (5 tentativas). Conclui READY -> DELIVERED da retirada.
CREATE OR REPLACE FUNCTION public.confirm_handover(p_order_id uuid, p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
    AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_order RECORD;
    v_a RECORD;
    v_role text;
    v_code text := regexp_replace(COALESCE(p_code, ''), '\D', '', 'g');
    v_actor text;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE = '42501'; END IF;
    SELECT id, tenant_id, status, fulfillment_type INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR NOT public.has_tenant_role(v_uid, v_order.tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']) THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE = '42501';
    END IF;
    IF NOT public._rate_limit_hit('pickup_handover', v_uid::text, v_order.tenant_id, 20, 60) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas; aguarde um minuto.';
    END IF;
    IF v_order.fulfillment_type <> 'PICKUP' THEN RAISE EXCEPTION 'NOT_PICKUP: pedido de entrega.'; END IF;
    IF v_order.status <> 'READY' THEN RAISE EXCEPTION 'INVALID_STATE: o pedido não está pronto (status %).', v_order.status; END IF;
    SELECT * INTO v_a FROM public.pickup_arrivals WHERE order_id = p_order_id AND closed_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CODE_NOT_FOUND: pedido sem código de retirada.'; END IF;
    IF v_a.code_attempts >= 5 THEN RAISE EXCEPTION 'CODE_LOCKED: código bloqueado após 5 tentativas; conclua com motivo.'; END IF;
    IF v_code <> v_a.pickup_code THEN
        UPDATE public.pickup_arrivals SET code_attempts = code_attempts + 1 WHERE order_id = p_order_id;
        RETURN jsonb_build_object('success', false, 'error', 'CODE_INVALID', 'attemptsLeft', GREATEST(0, 4 - v_a.code_attempts));
    END IF;
    UPDATE public.pickup_arrivals SET handed_over_at = now(), closed_at = now() WHERE order_id = p_order_id;
    UPDATE public.orders SET status = 'DELIVERED', delivered_at = now(), updated_at = now() WHERE id = p_order_id;
    v_role := public._tenant_role_of_caller(v_order.tenant_id);
    SELECT COALESCE(NULLIF(u.name, ''), u.email, 'Equipe') INTO v_actor FROM public.users u WHERE u.id = v_uid;
    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (p_order_id, 'DELIVERED', 'Retirada confirmada com código do cliente', COALESCE(v_actor, 'Equipe') || ' (' || COALESCE(v_role, '?') || ')');
    PERFORM public.log_audit_event('PICKUP_HANDOVER_CONFIRMED', 'orders', 'Retirada confirmada com código', p_order_id::text,
        'READY', 'DELIVERED', v_order.tenant_id);
    RETURN jsonb_build_object('success', true, 'orderStatus', 'DELIVERED');
END;
$$;

REVOKE ALL ON FUNCTION public.get_store_arrival_qr(uuid), public.rotate_store_arrival_qr(uuid), public.customer_check_in(text, uuid),
    public.get_my_pickup_status(uuid), public.call_pickup(uuid), public.confirm_handover(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_arrival_qr(uuid), public.rotate_store_arrival_qr(uuid), public.customer_check_in(text, uuid),
    public.get_my_pickup_status(uuid), public.call_pickup(uuid), public.confirm_handover(uuid, text) TO authenticated;

-- 7. update_order_status (cópia da 1600 + bloco 2100).
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

-- 8. Realtime: pickup_arrivals (RLS por assinante; sem PII).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RAISE EXCEPTION 'REALTIME_PUBLICATION_MISSING';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pickup_arrivals') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.pickup_arrivals;
    END IF;
END $$;

COMMIT;
