-- =============================================================================
-- 20261014001100 — set_my_availability: o PRÓPRIO entregador alterna AVAILABLE/UNAVAILABLE.
-- Identifica o entregador só por auth.uid() (nunca recebe user_id/driver_id).
-- Exige vínculo tenant_users DRIVER ACTIVE e drivers.approval_status = 'APPROVED'.
-- Com entrega em andamento (ON_DELIVERY ou pedido OUT_FOR_DELIVERY) recusa com P0418;
-- SUSPENDED/não aprovado/sem vínculo → P0414; valor inválido → P0417.
-- Locks: só a linha do entregador (FOR UPDATE). assign_order_to_driver trava pedido → entregador;
-- esta função não trava pedidos, então não há ciclo. Quem chega depois lê o estado já commitado.
-- SECURITY DEFINER, search_path '', EXECUTE só para authenticated. Sem GRANT em tabelas.
-- Rollback: DROP FUNCTION public.set_my_availability(uuid, text);
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.set_my_availability(p_tenant_id uuid, p_availability text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_new text := upper(btrim(coalesce(p_availability, '')));
    v_d record;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501'; END IF;
    IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'Loja obrigatória.'; END IF;
    IF v_new NOT IN ('AVAILABLE', 'UNAVAILABLE') THEN
        RAISE EXCEPTION 'Disponibilidade inválida.' USING ERRCODE = 'P0417';
    END IF;

    SELECT id, status, approval_status INTO v_d
    FROM public.drivers
    WHERE user_id = v_uid AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_d.approval_status IS DISTINCT FROM 'APPROVED'
       OR v_d.status = 'SUSPENDED'
       OR NOT EXISTS (SELECT 1 FROM public.tenant_users tu
                      WHERE tu.user_id = v_uid AND tu.tenant_id = p_tenant_id
                        AND tu.role_id = 'DRIVER' AND tu.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'Entregador não aprovado neste estabelecimento.' USING ERRCODE = 'P0414';
    END IF;

    IF v_d.status = 'ON_DELIVERY' OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.driver_id = v_uid AND o.tenant_id = p_tenant_id AND o.status = 'OUT_FOR_DELIVERY') THEN
        RAISE EXCEPTION 'Entregador com pedido em rota. Conclua a entrega antes.' USING ERRCODE = 'P0418';
    END IF;

    IF v_d.status IS DISTINCT FROM v_new THEN
        UPDATE public.drivers SET status = v_new, updated_at = now() WHERE id = v_d.id;
        PERFORM public.log_audit_event('DRIVER_AVAILABILITY_CHANGED', 'drivers',
            'Entregador alterou a própria disponibilidade', v_d.id::text, v_d.status, v_new, p_tenant_id);
    END IF;

    RETURN jsonb_build_object('availability', v_new, 'changed', v_d.status IS DISTINCT FROM v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_availability(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_availability(uuid, text) TO authenticated;

DO $$
DECLARE p oid := 'public.set_my_availability(uuid,text)'::regprocedure;
BEGIN
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = p) THEN RAISE EXCEPTION 'POST: não é SECURITY DEFINER'; END IF;
    IF (SELECT proconfig FROM pg_proc WHERE oid = p) IS DISTINCT FROM ARRAY['search_path=""'] THEN RAISE EXCEPTION 'POST: search_path'; END IF;
    IF has_function_privilege('anon', p, 'EXECUTE') OR NOT has_function_privilege('authenticated', p, 'EXECUTE') THEN
        RAISE EXCEPTION 'POST: ACL';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc pp, aclexplode(pp.proacl) a WHERE pp.oid = p AND a.grantee = 0) THEN
        RAISE EXCEPTION 'POST: PUBLIC com EXECUTE';
    END IF;
END $$;

COMMIT;
