-- =============================================================================
-- 20261014001000 — pacote fix R3 (achados dos testes de escrita em staging, 14/10)
--  1. C5: set_driver_link_status re-checa pedido em rota após travar a linha do entregador
--     (corrida SUSPEND × assign_order_to_driver não reverte mais um despacho já confirmado).
--  3. review_driver_application: ação de auditoria DRIVER_APPLICATION_REJECTED (era ..._REJECTD).
--  4. get_my_driver_approval: + chave 'availability' (o entregador não tem SELECT em drivers).
-- Só CREATE OR REPLACE (assinaturas, SECURITY DEFINER, search_path e ACLs preservados).
-- Sem GRANT/REVOKE, sem DDL de tabela. Rollback: reaplicar os blocos B7/B8 da 0700.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.review_driver_application(p_driver_id uuid, p_decision text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_k record; v_d record; v_dec text := upper(btrim(p_decision));
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.'; END IF;
    IF v_dec NOT IN ('APPROVE','REJECT') THEN RAISE EXCEPTION 'Decisão inválida.'; END IF;
    SELECT user_id, tenant_id INTO v_k FROM public.drivers WHERE id = p_driver_id;
    IF NOT FOUND OR NOT public.has_tenant_role(v_uid, v_k.tenant_id, ARRAY['OWNER','MANAGER']) THEN
        RAISE EXCEPTION 'Entregador não encontrado.';
    END IF;
    PERFORM public._lock_user_tenant(v_k.user_id, v_k.tenant_id);           -- lock 2 antes da linha
    SELECT id, user_id, tenant_id, approval_status INTO v_d FROM public.drivers WHERE id = p_driver_id FOR UPDATE;
    IF v_d.approval_status <> 'PENDING' THEN
        RAISE EXCEPTION 'Cadastro não está pendente (estado: %).', v_d.approval_status USING ERRCODE = 'P0417';
    END IF;

    IF v_dec = 'APPROVE' THEN
        UPDATE public.drivers SET approval_status = 'APPROVED', updated_at = now() WHERE id = p_driver_id;
        UPDATE public.tenant_users SET status = 'ACTIVE', updated_at = now()
        WHERE user_id = v_d.user_id AND tenant_id = v_d.tenant_id AND role_id = 'DRIVER';
    ELSE
        UPDATE public.drivers SET approval_status = 'REJECTED', status = 'UNAVAILABLE', updated_at = now() WHERE id = p_driver_id;
        -- Decisão do CEO/GPT 14/10: REJECT também encerra o vínculo de acesso (tela "Cadastro não aprovado").
        UPDATE public.tenant_users SET status = 'INACTIVE', updated_at = now()
        WHERE user_id = v_d.user_id AND tenant_id = v_d.tenant_id AND role_id = 'DRIVER';
    END IF;

    -- 1000: grafia corrigida (antes 'DRIVER_APPLICATION_REJECTD'; linhas históricas não são renomeadas)
    PERFORM public.log_audit_event(CASE v_dec WHEN 'APPROVE' THEN 'DRIVER_APPLICATION_APPROVED' ELSE 'DRIVER_APPLICATION_REJECTED' END, 'drivers',
        'Revisão de cadastro de entregador' || CASE WHEN p_reason IS NOT NULL THEN ': ' || left(p_reason, 200) ELSE '' END,
        p_driver_id::text, 'PENDING', CASE v_dec WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END, v_d.tenant_id);

    RETURN jsonb_build_object('driverId', p_driver_id, 'status', CASE v_dec WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_driver_link_status(p_driver_id uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_k record; v_d record; v_act text := upper(btrim(p_action)); v_new text;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.'; END IF;
    IF v_act NOT IN ('SUSPEND','REACTIVATE','REMOVE') THEN RAISE EXCEPTION 'Ação inválida.'; END IF;
    SELECT user_id, tenant_id INTO v_k FROM public.drivers WHERE id = p_driver_id;
    IF NOT FOUND OR NOT public.has_tenant_role(v_uid, v_k.tenant_id, ARRAY['OWNER','MANAGER']) THEN
        RAISE EXCEPTION 'Entregador não encontrado.';
    END IF;

    PERFORM public._lock_user_tenant(v_k.user_id, v_k.tenant_id);           -- lock 2
    IF EXISTS (SELECT 1 FROM public.orders o                                 -- lock 3
               WHERE o.driver_id = v_k.user_id AND o.tenant_id = v_k.tenant_id
                 AND o.status = 'OUT_FOR_DELIVERY' FOR UPDATE) AND v_act <> 'REACTIVATE' THEN
        RAISE EXCEPTION 'Entregador com pedido em rota. Desatribua ou reporte a falha antes.' USING ERRCODE = 'P0418';
    END IF;
    SELECT id, user_id, tenant_id, approval_status INTO v_d FROM public.drivers WHERE id = p_driver_id FOR UPDATE;  -- lock 4
    -- 1000 (C5): re-checagem DEPOIS do lock da linha do entregador. assign_order_to_driver trava
    -- pedido -> entregador; se ele venceu a corrida, já commitou o pedido em rota e esta leitura
    -- (novo snapshot em READ COMMITTED) o enxerga -> P0418. Se este RPC venceu, o assign espera a
    -- linha do entregador e depois lê approval_status = SUSPENDED -> P0414. Ordem de locks mantida:
    -- pedidos -> entregador nos dois RPCs (nenhuma nova espera por pedido após o lock 4).
    IF v_act <> 'REACTIVATE' AND EXISTS (SELECT 1 FROM public.orders o
               WHERE o.driver_id = v_d.user_id AND o.tenant_id = v_d.tenant_id
                 AND o.status = 'OUT_FOR_DELIVERY') THEN
        RAISE EXCEPTION 'Entregador com pedido em rota. Desatribua ou reporte a falha antes.' USING ERRCODE = 'P0418';
    END IF;

    IF v_act = 'SUSPEND' THEN
        IF v_d.approval_status <> 'APPROVED' THEN RAISE EXCEPTION 'Só vínculo aprovado pode ser suspenso.' USING ERRCODE = 'P0417'; END IF;
        PERFORM public.suspend_driver(p_driver_id);     -- reaproveita (status SUSPENDED + devolve WAITING_FOR_DRIVER)
        UPDATE public.drivers SET approval_status = 'SUSPENDED', updated_at = now() WHERE id = p_driver_id;
        v_new := 'SUSPENDED';
    ELSIF v_act = 'REACTIVATE' THEN
        IF v_d.approval_status <> 'SUSPENDED' THEN RAISE EXCEPTION 'Só vínculo suspenso pode ser reativado.' USING ERRCODE = 'P0417'; END IF;
        UPDATE public.drivers SET approval_status = 'APPROVED', status = 'UNAVAILABLE', updated_at = now() WHERE id = p_driver_id;
        UPDATE public.tenant_users SET status = 'ACTIVE', updated_at = now()
        WHERE user_id = v_d.user_id AND tenant_id = v_d.tenant_id AND role_id = 'DRIVER';
        v_new := 'APPROVED';
    ELSE
        IF v_d.approval_status NOT IN ('APPROVED','SUSPENDED') THEN RAISE EXCEPTION 'Vínculo não pode ser removido neste estado.' USING ERRCODE = 'P0417'; END IF;
        IF v_d.approval_status = 'APPROVED' THEN PERFORM public.suspend_driver(p_driver_id); END IF;
        UPDATE public.drivers SET approval_status = 'REMOVED', status = 'SUSPENDED', updated_at = now() WHERE id = p_driver_id;
        UPDATE public.tenant_users SET status = 'INACTIVE', updated_at = now()
        WHERE user_id = v_d.user_id AND tenant_id = v_d.tenant_id AND role_id = 'DRIVER';
        v_new := 'REMOVED';
    END IF;

    PERFORM public.log_audit_event('DRIVER_LINK_' || v_act, 'drivers',
        'Estado do vínculo do entregador alterado' || CASE WHEN p_reason IS NOT NULL THEN ': ' || left(p_reason, 200) ELSE '' END,
        p_driver_id::text, v_d.approval_status, v_new, v_d.tenant_id);
    RETURN jsonb_build_object('driverId', p_driver_id, 'status', v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_driver_approval(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_s text; v_av text;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501'; END IF;
    IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'Loja obrigatória.'; END IF;
    SELECT d.approval_status, d.status INTO v_s, v_av FROM public.drivers d
    WHERE d.user_id = v_uid AND d.tenant_id = p_tenant_id;
    -- 1000: + availability (status operacional da PRÓPRIA linha); chave aditiva, approval_status inalterado
    RETURN jsonb_build_object('approval_status', COALESCE(v_s, 'NONE'), 'availability', COALESCE(v_av, 'NONE'));
END;
$$;

-- POST (aborta a transação se algo não ficou como esperado)
DO $$
DECLARE d text;
BEGIN
    d := pg_get_functiondef('public.set_driver_link_status(uuid,text,text)'::regprocedure);
    IF position('1000 (C5)' in d) = 0 THEN RAISE EXCEPTION 'POST: re-checagem C5 ausente'; END IF;
    d := pg_get_functiondef('public.review_driver_application(uuid,text,text)'::regprocedure);
    IF position('DRIVER_APPLICATION_REJECTED' in d) = 0 OR position('|| ''D''' in d) > 0 THEN RAISE EXCEPTION 'POST: ação de auditoria'; END IF;
    d := pg_get_functiondef('public.get_my_driver_approval(uuid)'::regprocedure);
    IF position('''availability''' in d) = 0 THEN RAISE EXCEPTION 'POST: availability ausente'; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN ('public.set_driver_link_status(uuid,text,text)'::regprocedure,
               'public.review_driver_application(uuid,text,text)'::regprocedure,'public.get_my_driver_approval(uuid)'::regprocedure)
               AND (NOT p.prosecdef OR has_function_privilege('anon', p.oid, 'EXECUTE')
                    OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))) THEN
        RAISE EXCEPTION 'POST: ACL/SECURITY DEFINER alterados';
    END IF;
END $$;

COMMIT;
