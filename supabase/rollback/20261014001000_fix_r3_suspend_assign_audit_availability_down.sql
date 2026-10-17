-- EFEITOS DESTRUTIVOS: nenhum dado; perde as correções R3 nas 3 RPCs (volta ao comportamento do 0700).
-- Rollback 1000: volta review_driver_application, set_driver_link_status e get_my_driver_approval para as versões do 0700.
-- Sem perda de dados (só funções). Mesmas assinaturas → ACLs preservadas pelo CREATE OR REPLACE.
-- Comportamento revertido: correções R3 (suspensão/atribuição/auditoria/disponibilidade) deixam de valer.
BEGIN;
DO $pre$ BEGIN
  IF to_regprocedure('public.set_my_availability(uuid,text)') IS NOT NULL THEN RAISE EXCEPTION 'PRE: reverter 1100 antes do 1000'; END IF;
END $pre$;
CREATE OR REPLACE FUNCTION public.get_my_driver_approval(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid := auth.uid(); v_s text;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501'; END IF;
    IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'Loja obrigatória.'; END IF;
    SELECT d.approval_status INTO v_s FROM public.drivers d
    WHERE d.user_id = v_uid AND d.tenant_id = p_tenant_id;
    RETURN jsonb_build_object('approval_status', COALESCE(v_s, 'NONE'));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.review_driver_application(p_driver_id uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    PERFORM public.log_audit_event('DRIVER_APPLICATION_' || v_dec || 'D', 'drivers',
        'Revisão de cadastro de entregador' || CASE WHEN p_reason IS NOT NULL THEN ': ' || left(p_reason, 200) ELSE '' END,
        p_driver_id::text, 'PENDING', CASE v_dec WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END, v_d.tenant_id);

    RETURN jsonb_build_object('driverId', p_driver_id, 'status', CASE v_dec WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_driver_link_status(p_driver_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

DO $post$ BEGIN
  IF NOT has_function_privilege('authenticated','public.get_my_driver_approval(uuid)','execute')
     OR has_function_privilege('anon','public.get_my_driver_approval(uuid)','execute') THEN
    RAISE EXCEPTION 'POST: ACL inesperada';
  END IF;
END $post$;
COMMIT;
