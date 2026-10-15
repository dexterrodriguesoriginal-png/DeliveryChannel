-- Rollback de 20261015001200_driver_locations (não fica em migrations/).
BEGIN;
DROP TRIGGER IF EXISTS trg_driver_locations_clear ON public.drivers;
DROP TRIGGER IF EXISTS trg_driver_locations_clear_link ON public.tenant_users;
DROP FUNCTION IF EXISTS public.trg_driver_locations_clear_on_driver();
DROP FUNCTION IF EXISTS public.trg_driver_locations_clear_on_link();
DROP FUNCTION IF EXISTS public.upsert_my_location(double precision, double precision, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.get_my_location();
DROP FUNCTION IF EXISTS public.list_tenant_driver_locations(uuid);
DROP TABLE IF EXISTS public.driver_locations;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261015001200';
COMMIT;
