-- Rollback de 20261015001300: restaura list_tenant_driver_locations da 20261015001200.
BEGIN;
DROP FUNCTION IF EXISTS public.list_tenant_driver_locations(uuid);
CREATE FUNCTION public.list_tenant_driver_locations(p_tenant_id uuid)
RETURNS TABLE (driver_id uuid, full_name varchar, status varchar, lat double precision,
               lng double precision, accuracy_m real, heading real, speed real,
               recorded_at timestamptz, is_stale boolean, low_accuracy boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501'; END IF;
    IF p_tenant_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.tenant_users tu
        WHERE tu.user_id = auth.uid() AND tu.tenant_id = p_tenant_id
          AND tu.role_id IN ('OWNER', 'MANAGER') AND tu.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'Sem permissão para este estabelecimento.' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT d.id, d.full_name, d.status, l.lat, l.lng, l.accuracy_m, l.heading, l.speed,
           l.recorded_at, l.recorded_at < now() - interval '2 minutes', coalesce(l.accuracy_m > 200, false)
    FROM public.driver_locations l
    JOIN public.drivers d ON d.id = l.driver_id AND d.tenant_id = l.tenant_id
    WHERE l.tenant_id = p_tenant_id
    ORDER BY l.recorded_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_tenant_driver_locations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenant_driver_locations(uuid) TO authenticated;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261015001300';
COMMIT;
