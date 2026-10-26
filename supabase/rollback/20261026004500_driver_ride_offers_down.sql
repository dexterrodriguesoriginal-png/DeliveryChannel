-- Remove apenas os objetos deste recurso. Pedidos, códigos e histórico são preservados.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='driver-ride-offers-expiry';
 END IF;
END $$;
DROP TRIGGER orders_cancel_driver_offers ON public.orders;
DROP FUNCTION public._orders_cancel_driver_offers();
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
    PERFORM public._assert_online_payment_ready(p_order_id);
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

CREATE OR REPLACE FUNCTION public.driver_accept_order(p_order_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'OWNER_DISPATCH_REQUIRED: aguarde a loja atribuir a corrida.' USING ERRCODE='42501'; END; $$;

CREATE OR REPLACE FUNCTION public.get_dispatch_queue(p_tenant_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public._pr_b_staff(p_tenant_id,ARRAY['OWNER','MANAGER']) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.last_ride NULLS FIRST,q.id),'[]') INTO result FROM (
 SELECT d.id,d.user_id,split_part(d.full_name,' ',1) AS name,
 (SELECT max(coalesce(o.delivered_at,o.driver_accepted_at,o.created_at)) FROM (SELECT * FROM public.orders WHERE NOT awaiting_online_payment) o WHERE o.tenant_id=p_tenant_id AND o.driver_id=d.user_id) AS last_ride
 FROM public.drivers d WHERE d.tenant_id=p_tenant_id AND d.approval_status='APPROVED' AND d.status='AVAILABLE'
 AND EXISTS(SELECT 1 FROM public.tenant_users u WHERE u.tenant_id=p_tenant_id AND u.user_id=d.user_id AND u.role_id='DRIVER' AND u.status='ACTIVE')
 AND NOT EXISTS(SELECT 1 FROM (SELECT * FROM public.orders WHERE NOT awaiting_online_payment) o WHERE o.tenant_id=p_tenant_id AND o.driver_id=d.user_id AND o.status IN ('READY','WAITING_FOR_DRIVER','OUT_FOR_DELIVERY'))
 ) q;
 RETURN jsonb_build_object('mode',(SELECT dispatch_mode FROM public.tenant_settings WHERE tenant_id=p_tenant_id),'drivers',result);
END; $$;
DROP FUNCTION public.offer_order_to_driver(uuid,uuid);
DROP FUNCTION public.driver_respond_offer(uuid,boolean);
DROP FUNCTION public.get_my_driver_offers();
DROP FUNCTION public.cancel_driver_offer(uuid);
DROP FUNCTION public.expire_driver_offers();
DROP FUNCTION public._advance_driver_offer(uuid,text);
DROP FUNCTION public._create_driver_offer(uuid,uuid);
DROP FUNCTION public._driver_offer_queue(uuid,uuid);
DROP FUNCTION public.set_driver_offer_timeout(uuid,integer);
-- Ofertas pendentes são descartadas com a tabela; não atribuir nem alterar pedidos.
DROP TABLE public.order_driver_offers;
ALTER TABLE public.tenant_settings DROP COLUMN driver_offer_timeout_seconds;
NOTIFY pgrst,'reload schema';
COMMIT;
-- resync
