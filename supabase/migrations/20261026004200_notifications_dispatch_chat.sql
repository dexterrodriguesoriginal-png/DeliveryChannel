-- PR B: notifications, dispatch, reversed pickup and order chat. Stage before production.
BEGIN;
CREATE FUNCTION public._pr_b_staff(p_tenant uuid, p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
 SELECT 1 FROM public.tenant_users u JOIN public.tenants t ON t.id=u.tenant_id
 WHERE u.tenant_id=p_tenant AND u.user_id=auth.uid() AND u.status='ACTIVE'
 AND u.role_id=ANY(p_roles) AND t.status='ACTIVE');
$$;
REVOKE ALL ON FUNCTION public._pr_b_staff(uuid,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._pr_b_staff(uuid,text[]) TO authenticated;
CREATE FUNCTION public._pr_b_driver(p_order uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.orders o JOIN public.drivers d
 ON d.tenant_id=o.tenant_id AND d.user_id=o.driver_id
 WHERE o.id=p_order AND o.driver_id=auth.uid() AND d.approval_status='APPROVED'
 AND d.status<>'SUSPENDED' AND public._pr_b_staff(o.tenant_id,ARRAY['DRIVER']));
$$;
REVOKE ALL ON FUNCTION public._pr_b_driver(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._pr_b_driver(uuid) TO authenticated;
ALTER TABLE public.tenant_settings ADD COLUMN dispatch_mode text NOT NULL DEFAULT 'OWNER_PICKS'
 CHECK(dispatch_mode IN ('AUTO_QUEUE','OWNER_PICKS'));
-- Do not broaden pre-existing table UPDATE grants.
CREATE FUNCTION public.set_dispatch_mode(p_tenant_id uuid,p_mode text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public._pr_b_staff(p_tenant_id,ARRAY['OWNER','MANAGER']) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_mode NOT IN ('AUTO_QUEUE','OWNER_PICKS') OR p_mode IS NULL THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
 UPDATE public.tenant_settings SET dispatch_mode=p_mode WHERE tenant_id=p_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'SETTINGS_NOT_FOUND'; END IF;
END; $$;
CREATE FUNCTION public.get_dispatch_queue(p_tenant_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public._pr_b_staff(p_tenant_id,ARRAY['OWNER','MANAGER']) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.last_ride NULLS FIRST,q.id),'[]') INTO result FROM (
 SELECT d.id,d.user_id,split_part(d.full_name,' ',1) AS name,
 (SELECT max(coalesce(o.delivered_at,o.driver_accepted_at,o.created_at)) FROM public.orders o WHERE o.tenant_id=p_tenant_id AND o.driver_id=d.user_id) AS last_ride
 FROM public.drivers d WHERE d.tenant_id=p_tenant_id AND d.approval_status='APPROVED' AND d.status='AVAILABLE'
 AND EXISTS(SELECT 1 FROM public.tenant_users u WHERE u.tenant_id=p_tenant_id AND u.user_id=d.user_id AND u.role_id='DRIVER' AND u.status='ACTIVE')
 AND NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.tenant_id=p_tenant_id AND o.driver_id=d.user_id AND o.status IN ('READY','WAITING_FOR_DRIVER','OUT_FOR_DELIVERY'))
 ) q;
 RETURN jsonb_build_object('mode',(SELECT dispatch_mode FROM public.tenant_settings WHERE tenant_id=p_tenant_id),'drivers',result);
END; $$;
CREATE TABLE public.owner_notifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('ORDER_NEW','DRIVER_JOIN_REQUEST','ORDER_MESSAGE')),
 ref_id uuid NOT NULL, title text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz);
CREATE INDEX ON public.owner_notifications(tenant_id,created_at DESC);
ALTER TABLE public.owner_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_notifications FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE(read_at) ON public.owner_notifications TO authenticated;
CREATE POLICY owner_notifications_select ON public.owner_notifications FOR SELECT TO authenticated
 USING(public._pr_b_staff(tenant_id,ARRAY['OWNER','MANAGER']));
CREATE POLICY owner_notifications_update ON public.owner_notifications FOR UPDATE TO authenticated
 USING(public._pr_b_staff(tenant_id,ARRAY['OWNER','MANAGER'])) WITH CHECK(public._pr_b_staff(tenant_id,ARRAY['OWNER','MANAGER']));
CREATE TABLE public.order_messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants ON DELETE CASCADE,
 order_id uuid NOT NULL REFERENCES public.orders ON DELETE CASCADE,
 sender_role text NOT NULL CHECK(sender_role IN ('DRIVER','STORE')),sender_user uuid NOT NULL REFERENCES auth.users,
 body text NOT NULL CHECK(char_length(btrim(body)) BETWEEN 1 AND 500),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON public.order_messages(tenant_id,order_id,created_at);
ALTER TABLE public.order_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_messages FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.order_messages TO authenticated;
CREATE POLICY order_messages_select ON public.order_messages FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.orders o WHERE o.id=order_id AND o.tenant_id=order_messages.tenant_id)
 AND (public._pr_b_staff(tenant_id,ARRAY['OWNER','MANAGER','OPERATOR','CASHIER','DELIVERY_MANAGER']) OR public._pr_b_driver(order_id)));
-- Sends are RPC-only: tenant, sender and timestamp cannot be spoofed.
CREATE FUNCTION public.send_order_message(p_order_id uuid,p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o record; v_role text; v_id uuid;
BEGIN
 SELECT id,tenant_id,status INTO o FROM public.orders WHERE id=p_order_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF public._pr_b_staff(o.tenant_id,ARRAY['OWNER','MANAGER','OPERATOR','CASHIER','DELIVERY_MANAGER']) THEN v_role:='STORE';
 ELSIF public._pr_b_driver(p_order_id) THEN v_role:='DRIVER';
 ELSE RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF o.status IN ('DELIVERED','CANCELLED') THEN RAISE EXCEPTION 'ORDER_CLOSED'; END IF;
 IF p_body IS NULL OR char_length(btrim(p_body)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_MESSAGE'; END IF;
 IF NOT public._rate_limit_hit('order_message',auth.uid()::text,o.tenant_id,20,60) THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;
 INSERT INTO public.order_messages(tenant_id,order_id,sender_role,sender_user,body) VALUES(o.tenant_id,p_order_id,v_role,auth.uid(),btrim(p_body)) RETURNING id INTO v_id;
 RETURN v_id;
END; $$;
CREATE FUNCTION public._pr_b_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF TG_TABLE_NAME='orders' THEN
 INSERT INTO public.owner_notifications(tenant_id,kind,ref_id,title) VALUES(NEW.tenant_id,'ORDER_NEW',NEW.id,'Novo pedido');
 ELSIF TG_TABLE_NAME='drivers' THEN
 IF NEW.approval_status='PENDING' AND (TG_OP='INSERT' OR OLD.approval_status IS DISTINCT FROM NEW.approval_status) THEN
 INSERT INTO public.owner_notifications(tenant_id,kind,ref_id,title) VALUES(NEW.tenant_id,'DRIVER_JOIN_REQUEST',NEW.id,'Solicitação de entregador'); END IF;
 ELSIF NEW.sender_role='DRIVER' THEN
 INSERT INTO public.owner_notifications(tenant_id,kind,ref_id,title) VALUES(NEW.tenant_id,'ORDER_MESSAGE',NEW.order_id,'Mensagem do entregador');
 END IF;
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public._pr_b_notify() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER pr_b_orders_notify AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public._pr_b_notify();
CREATE TRIGGER pr_b_drivers_notify AFTER INSERT OR UPDATE OF approval_status ON public.drivers FOR EACH ROW EXECUTE FUNCTION public._pr_b_notify();
CREATE TRIGGER pr_b_messages_notify AFTER INSERT ON public.order_messages FOR EACH ROW EXECUTE FUNCTION public._pr_b_notify();
CREATE FUNCTION public.purge_dispatch_data() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 DELETE FROM public.owner_notifications WHERE created_at < now()-interval '90 days';
 DELETE FROM public.order_messages m USING public.orders o WHERE o.id=m.order_id AND o.tenant_id=m.tenant_id
 AND ((o.delivered_at IS NOT NULL AND o.delivered_at < now()-interval '90 days')
 OR (o.status='CANCELLED' AND o.updated_at < now()-interval '90 days'));
END; $$;
REVOKE ALL ON FUNCTION public.purge_dispatch_data() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_dispatch_data() TO service_role;
-- Supabase pg_cron when enabled; otherwise deploy the documented daily service job.
DO $block$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
 PERFORM cron.schedule('pr-b-retention','20 3 * * *','SELECT public.purge_dispatch_data()');
 END IF;
END $block$;
CREATE OR REPLACE FUNCTION public.driver_accept_order(p_order_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'OWNER_DISPATCH_REQUIRED: aguarde a loja atribuir a corrida.' USING ERRCODE='42501'; END; $$;
CREATE OR REPLACE FUNCTION public.list_available_driver_orders() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT '[]'::jsonb; $$;
CREATE OR REPLACE FUNCTION public.get_order_pickup_code(p_order_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE h record;
BEGIN
 IF NOT public._pr_b_driver(p_order_id) THEN RETURN NULL; END IF;
 SELECT * INTO h FROM public.order_handoff_codes WHERE order_id=p_order_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('code',h.pickup_code,'confirmed',h.pickup_confirmed_at IS NOT NULL,'locked',h.pickup_attempts>=5,'attempts',h.pickup_attempts);
END; $$;
CREATE FUNCTION public.get_handoff_status(p_order_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE h record;
BEGIN
 SELECT * INTO h FROM public.order_handoff_codes WHERE order_id=p_order_id;
 IF NOT FOUND OR NOT public._pr_b_staff(h.tenant_id,ARRAY['OWNER','MANAGER','OPERATOR','CASHIER','DELIVERY_MANAGER']) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('pickupLocked',h.pickup_attempts>=5,'deliveryLocked',h.delivery_attempts>=5,'confirmed',h.pickup_confirmed_at IS NOT NULL);
END; $$;
CREATE FUNCTION public.reset_handoff_code(p_order_id uuid,p_kind text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o record; h record; v_code text;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR NOT public._pr_b_staff(o.tenant_id,ARRAY['OWNER','MANAGER']) THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('pickup','delivery') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;
 IF o.status IN ('DELIVERED','CANCELLED') THEN RAISE EXCEPTION 'ORDER_CLOSED'; END IF;
 SELECT * INTO h FROM public.order_handoff_codes WHERE order_id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CODE_NOT_FOUND'; END IF;
 IF (p_kind='pickup' AND h.pickup_confirmed_at IS NOT NULL) OR (p_kind='delivery' AND (o.status<>'OUT_FOR_DELIVERY' OR h.delivery_confirmed_at IS NOT NULL)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 LOOP
 v_code:=public._handoff_code();
 EXIT WHEN v_code IS DISTINCT FROM CASE WHEN p_kind='pickup' THEN h.pickup_code ELSE h.delivery_code END;
 END LOOP;
 IF p_kind='pickup' THEN UPDATE public.order_handoff_codes SET pickup_code=v_code,pickup_attempts=0 WHERE order_id=p_order_id;
 ELSE UPDATE public.order_handoff_codes SET delivery_code=v_code,delivery_attempts=0 WHERE order_id=p_order_id; END IF;
 PERFORM public.log_audit_event('HANDOFF_CODE_RESET','order_handoff_codes','Novo código de '||p_kind,p_order_id::text,NULL,NULL,o.tenant_id);
 RETURN jsonb_build_object('success',true);
END; $$;
CREATE OR REPLACE FUNCTION public.reset_order_pickup_code(p_order_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT public.reset_handoff_code(p_order_id,'pickup'); $$;

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
    IF NOT FOUND OR NOT public._pr_b_staff(v_order.tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER','DELIVERY_MANAGER']) OR NOT EXISTS(SELECT 1 FROM public.drivers d JOIN public.tenant_users u ON u.tenant_id=d.tenant_id AND u.user_id=d.user_id JOIN public.tenants t ON t.id=d.tenant_id WHERE d.user_id=v_order.driver_id AND d.tenant_id=v_order.tenant_id AND d.approval_status='APPROVED' AND d.status<>'SUSPENDED' AND u.role_id='DRIVER' AND u.status='ACTIVE' AND t.status='ACTIVE') THEN
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
    UPDATE public.drivers SET status = 'ON_DELIVERY', updated_at = now() WHERE user_id = v_order.driver_id AND tenant_id = v_order.tenant_id AND status <> 'SUSPENDED';
    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (p_order_id, 'OUT_FOR_DELIVERY', 'Retirada confirmada com código', 'Equipe');
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
    IF NOT FOUND OR v_order.driver_id IS DISTINCT FROM v_uid OR NOT public._pr_b_driver(p_order_id) THEN
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

    IF NOT FOUND OR NOT public._pr_b_staff(v_order.tenant_id, ARRAY['OWNER','MANAGER','DELIVERY_MANAGER']) THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE='42501';
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
    IF NOT public._pr_b_staff(v_order.tenant_id, ARRAY['OWNER', 'MANAGER', 'DELIVERY_MANAGER']) THEN
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
        'Entregador atribuído pela loja',
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
    JOIN public.customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id AND c.user_id = auth.uid()
    JOIN public.order_handoff_codes h ON h.order_id = o.id AND h.tenant_id = o.tenant_id
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
SET search_path TO ''
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
        CASE WHEN p_action IN ('HANDOFF_CODE_RESET','ORDER_PICKUP_CONFIRMED','ORDER_DELIVERY_CONFIRMED','ORDER_ASSIGNED_DRIVER') THEN split_part(btrim(COALESCE(v_user_name,'Sistema')),' ',1) ELSE COALESCE(v_user_name,'Sistema') END,
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
CREATE OR REPLACE FUNCTION public.update_order_status(p_order_id uuid, p_new_status text, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

    IF v_new='OUT_FOR_DELIVERY' AND v_order.fulfillment_type='DELIVERY' THEN
        RAISE EXCEPTION 'PICKUP_CODE_REQUIRED: peça o código ao entregador e confirme a retirada.';
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
REVOKE ALL ON FUNCTION public.set_dispatch_mode(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_dispatch_mode(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_dispatch_queue(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_dispatch_queue(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.send_order_message(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.send_order_message(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_handoff_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_handoff_status(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.reset_handoff_code(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reset_handoff_code(uuid,text) TO authenticated;
DO $$ BEGIN
 ALTER PUBLICATION supabase_realtime ADD TABLE public.owner_notifications, public.order_messages;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
