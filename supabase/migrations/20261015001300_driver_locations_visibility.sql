-- =============================================================================
-- 20261015001300 — driver_locations: visibilidade restrita a entrega ativa da loja.
-- Decisão CEO: a posição do entregador só é exposta a OWNER/MANAGER/DELIVERY_MANAGER (vínculo
-- ACTIVE) da loja enquanto ele tiver pedido OUT_FOR_DELIVERY atribuído (orders.driver_id) NESSA
-- loja. Fora disso o entregador aparece na lista da frota SEM posição (lat/lng NULL).
-- Posições de entregadores apenas AVAILABLE nunca são expostas a nenhuma loja.
-- Escrita (upsert_my_location) inalterada: só vínculo APPROVED AVAILABLE/ON_DELIVERY.
-- Troca a assinatura de list_tenant_driver_locations (DROP + CREATE).
-- Rollback: supabase/rollback/20261015001300_driver_locations_visibility_down.sql
-- =============================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.list_tenant_driver_locations(uuid);

CREATE FUNCTION public.list_tenant_driver_locations(p_tenant_id uuid)
RETURNS TABLE (driver_id uuid, full_name varchar, status varchar, active_order_id uuid,
               lat double precision, lng double precision, accuracy_m real, heading real, speed real,
               recorded_at timestamptz, is_stale boolean, low_accuracy boolean, location_visible boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501'; END IF;
    IF p_tenant_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.tenant_users tu
        WHERE tu.user_id = auth.uid() AND tu.tenant_id = p_tenant_id
          AND tu.role_id IN ('OWNER', 'MANAGER', 'DELIVERY_MANAGER') AND tu.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'Sem permissão para este estabelecimento.' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    WITH act AS (
        SELECT DISTINCT ON (o.driver_id) o.driver_id AS user_id, o.id AS order_id
        FROM public.orders o
        WHERE o.tenant_id = p_tenant_id AND o.status = 'OUT_FOR_DELIVERY' AND o.driver_id IS NOT NULL
        ORDER BY o.driver_id, o.updated_at DESC NULLS LAST
    )
    SELECT d.id, d.full_name, d.status, a.order_id,
           CASE WHEN v.ok THEN l.lat END, CASE WHEN v.ok THEN l.lng END,
           CASE WHEN v.ok THEN l.accuracy_m END, CASE WHEN v.ok THEN l.heading END,
           CASE WHEN v.ok THEN l.speed END, CASE WHEN v.ok THEN l.recorded_at END,
           CASE WHEN v.ok THEN l.recorded_at < now() - interval '2 minutes' END,
           CASE WHEN v.ok THEN coalesce(l.accuracy_m > 200, false) END,
           coalesce(v.ok, false)
    FROM public.drivers d
    LEFT JOIN act a ON a.user_id = d.user_id
    LEFT JOIN public.driver_locations l ON l.driver_id = d.id AND l.tenant_id = d.tenant_id
    CROSS JOIN LATERAL (SELECT (a.order_id IS NOT NULL AND l.driver_id IS NOT NULL
                                AND d.approval_status = 'APPROVED'
                                AND d.status IN ('AVAILABLE', 'ON_DELIVERY')) AS ok) v
    WHERE d.tenant_id = p_tenant_id
    ORDER BY (a.order_id IS NOT NULL) DESC, d.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.list_tenant_driver_locations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenant_driver_locations(uuid) TO authenticated;

DO $$
DECLARE p oid := 'public.list_tenant_driver_locations(uuid)'::regprocedure;
BEGIN
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = p) THEN RAISE EXCEPTION 'POST: secdef'; END IF;
    IF (SELECT proconfig FROM pg_proc WHERE oid = p) IS DISTINCT FROM ARRAY['search_path=""'] THEN RAISE EXCEPTION 'POST: search_path'; END IF;
    IF has_function_privilege('anon', p, 'EXECUTE') OR NOT has_function_privilege('authenticated', p, 'EXECUTE') THEN RAISE EXCEPTION 'POST: ACL'; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc pp, aclexplode(pp.proacl) a WHERE pp.oid = p AND a.grantee = 0) THEN RAISE EXCEPTION 'POST: PUBLIC'; END IF;
END $$;

COMMIT;
