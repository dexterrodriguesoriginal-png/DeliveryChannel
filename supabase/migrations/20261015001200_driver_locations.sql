-- =============================================================================
-- 20261015001200 — driver_locations: última posição do entregador (1 linha por drivers.id).
-- Base compartilhada dos dois mapas (motoboy = navegação; proprietário = monitoramento).
-- * Sem acesso direto à tabela: RLS ligado, sem policies, REVOKE ALL de PUBLIC/anon/authenticated.
-- * Escrita só via upsert_my_location (auth.uid(); tenant derivado no servidor; só linhas
--   drivers APPROVED + status AVAILABLE/ON_DELIVERY + tenant_users DRIVER ACTIVE).
--   Rate limit: 10 s por linha (retorna throttled). accuracy > 500 m é recusada (P0421);
--   > 200 m é gravada e sinalizada como low_accuracy na leitura.
-- * Leitura do proprietário: list_tenant_driver_locations(tenant) só para OWNER/MANAGER ACTIVE
--   do tenant; is_stale = recorded_at < now() - 2 min.
-- * Limpeza automática: drivers UNAVAILABLE/SUSPENDED/não aprovado, vínculo tenant_users DRIVER
--   deixando de ser ACTIVE ou removido; DELETE de drivers → ON DELETE CASCADE.
-- * Realtime: tabela NÃO adicionada à publicação (sem SELECT grants) → UI faz polling via RPC.
-- Rollback: supabase/rollback/20261015001200_driver_locations_down.sql
-- =============================================================================
BEGIN;

CREATE TABLE public.driver_locations (
    driver_id   uuid PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
    tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    lat         double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng         double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
    accuracy_m  real CHECK (accuracy_m IS NULL OR (accuracy_m >= 0 AND accuracy_m <= 500)),
    heading     real CHECK (heading IS NULL OR (heading >= 0 AND heading < 360)),
    speed       real CHECK (speed IS NULL OR (speed >= 0 AND speed <= 100)),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_driver_locations_not_null_island CHECK (NOT (lat = 0 AND lng = 0))
);
CREATE INDEX idx_driver_locations_tenant ON public.driver_locations(tenant_id);
ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;   -- sem policies: só via RPC
REVOKE ALL ON public.driver_locations FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.driver_locations IS 'Última posição autorizada do entregador por vínculo drivers. Acesso só via RPC.';

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_my_location(
    p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL,
    p_heading double precision DEFAULT NULL, p_speed double precision DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_d record;
    v_updated int := 0;
    v_throttled int := 0;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501'; END IF;
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180
       OR (p_lat = 0 AND p_lng = 0) OR p_lat = 'NaN' OR p_lng = 'NaN' THEN
        RAISE EXCEPTION 'Coordenadas inválidas.' USING ERRCODE = 'P0420';
    END IF;
    IF p_accuracy IS NOT NULL AND (p_accuracy < 0 OR p_accuracy > 500 OR p_accuracy = 'NaN') THEN
        RAISE EXCEPTION 'Precisão insuficiente.' USING ERRCODE = 'P0421';
    END IF;
    IF p_heading IS NOT NULL AND (p_heading < 0 OR p_heading >= 360 OR p_heading = 'NaN') THEN p_heading := NULL; END IF;
    IF p_speed IS NOT NULL AND (p_speed < 0 OR p_speed > 100 OR p_speed = 'NaN') THEN p_speed := NULL; END IF;

    FOR v_d IN
        SELECT d.id, d.tenant_id FROM public.drivers d
        WHERE d.user_id = v_uid AND d.approval_status = 'APPROVED'
          AND d.status IN ('AVAILABLE', 'ON_DELIVERY')
          AND EXISTS (SELECT 1 FROM public.tenant_users tu
                      WHERE tu.user_id = v_uid AND tu.tenant_id = d.tenant_id
                        AND tu.role_id = 'DRIVER' AND tu.status = 'ACTIVE')
        FOR UPDATE OF d
    LOOP
        INSERT INTO public.driver_locations AS l
            (driver_id, tenant_id, lat, lng, accuracy_m, heading, speed, recorded_at, updated_at)
        VALUES (v_d.id, v_d.tenant_id, p_lat, p_lng, p_accuracy, p_heading, p_speed, now(), now())
        ON CONFLICT (driver_id) DO UPDATE
            SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, accuracy_m = EXCLUDED.accuracy_m,
                heading = EXCLUDED.heading, speed = EXCLUDED.speed,
                recorded_at = EXCLUDED.recorded_at, updated_at = EXCLUDED.updated_at
            WHERE l.recorded_at <= now() - interval '10 seconds';
        IF FOUND THEN v_updated := v_updated + 1; ELSE v_throttled := v_throttled + 1; END IF;
    END LOOP;

    IF v_updated = 0 AND v_throttled = 0 THEN
        RAISE EXCEPTION 'Entregador não aprovado ou indisponível.' USING ERRCODE = 'P0414';
    END IF;
    RETURN jsonb_build_object('updated', v_updated, 'throttled', v_throttled > 0 AND v_updated = 0,
                              'low_accuracy', coalesce(p_accuracy > 200, false));
END;
$$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_location()
RETURNS TABLE (driver_id uuid, tenant_id uuid, lat double precision, lng double precision,
               accuracy_m real, recorded_at timestamptz, is_stale boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT l.driver_id, l.tenant_id, l.lat, l.lng, l.accuracy_m, l.recorded_at,
           l.recorded_at < now() - interval '2 minutes'
    FROM public.driver_locations l
    JOIN public.drivers d ON d.id = l.driver_id
    WHERE auth.uid() IS NOT NULL AND d.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_tenant_driver_locations(p_tenant_id uuid)
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

-- ---------------------------------------------------------------------------
-- Limpeza automática (triggers; funções sem EXECUTE para clientes)
CREATE OR REPLACE FUNCTION public.trg_driver_locations_clear_on_driver()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.status NOT IN ('AVAILABLE', 'ON_DELIVERY') OR NEW.approval_status IS DISTINCT FROM 'APPROVED'
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        DELETE FROM public.driver_locations WHERE driver_id = NEW.id;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER trg_driver_locations_clear
AFTER UPDATE OF status, approval_status, tenant_id, user_id ON public.drivers
FOR EACH ROW EXECUTE FUNCTION public.trg_driver_locations_clear_on_driver();

CREATE OR REPLACE FUNCTION public.trg_driver_locations_clear_on_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'DELETE' OR NEW.status IS DISTINCT FROM 'ACTIVE' OR NEW.role_id IS DISTINCT FROM 'DRIVER'
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        DELETE FROM public.driver_locations l USING public.drivers d
        WHERE l.driver_id = d.id AND d.user_id = OLD.user_id AND d.tenant_id = OLD.tenant_id;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER trg_driver_locations_clear_link
AFTER UPDATE OF status, role_id, tenant_id, user_id OR DELETE ON public.tenant_users
FOR EACH ROW EXECUTE FUNCTION public.trg_driver_locations_clear_on_link();

-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.upsert_my_location(double precision, double precision, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_location() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_tenant_driver_locations(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_driver_locations_clear_on_driver() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_driver_locations_clear_on_link() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_my_location(double precision, double precision, double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_location() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenant_driver_locations(uuid) TO authenticated;

DO $$
DECLARE p oid;
BEGIN
    FOREACH p IN ARRAY ARRAY[
        'public.upsert_my_location(double precision,double precision,double precision,double precision,double precision)'::regprocedure::oid,
        'public.get_my_location()'::regprocedure::oid,
        'public.list_tenant_driver_locations(uuid)'::regprocedure::oid] LOOP
        IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = p) THEN RAISE EXCEPTION 'POST: não é SECURITY DEFINER %', p; END IF;
        IF (SELECT proconfig FROM pg_proc WHERE oid = p) IS DISTINCT FROM ARRAY['search_path=""'] THEN RAISE EXCEPTION 'POST: search_path %', p; END IF;
        IF has_function_privilege('anon', p, 'EXECUTE') OR NOT has_function_privilege('authenticated', p, 'EXECUTE') THEN RAISE EXCEPTION 'POST: ACL %', p; END IF;
        IF EXISTS (SELECT 1 FROM pg_proc pp, aclexplode(pp.proacl) a WHERE pp.oid = p AND a.grantee = 0) THEN RAISE EXCEPTION 'POST: PUBLIC %', p; END IF;
    END LOOP;
    IF has_table_privilege('anon', 'public.driver_locations', 'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('authenticated', 'public.driver_locations', 'SELECT,INSERT,UPDATE,DELETE') THEN
        RAISE EXCEPTION 'POST: grants diretos na tabela';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.driver_locations'::regclass) THEN RAISE EXCEPTION 'POST: RLS'; END IF;
    IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'driver_locations') THEN
        RAISE EXCEPTION 'POST: tabela em publicação realtime';
    END IF;
END $$;

COMMIT;
