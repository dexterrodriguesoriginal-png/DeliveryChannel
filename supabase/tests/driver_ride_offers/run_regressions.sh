#!/bin/sh
set -eu
# Local disposable database only. Also runnable inside postgres:17 with repo mounted at /repo.
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
cd "$(dirname "$0")/../../.."
export PGDATABASE="driver_ride_offers_$$"
createdb "$PGDATABASE"
# Banco sintético preservado para inspeção até o descarte do contêiner local.
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/n1n6/harness/00_supabase_stubs.sql
psql -X -v ON_ERROR_STOP=1 -c "INSERT INTO vault.secrets_stub(name,decrypted_secret) VALUES ('n1n6_ip_hash_salt','local-regression-fixture-salt-0123456789abcdef'); CREATE PUBLICATION supabase_realtime"
for file in supabase/migrations/202609*.sql; do
 psql -X -v ON_ERROR_STOP=1 -1 -f "$file"
 name=${file##*/}; version=${name%%_*}
 psql -X -v ON_ERROR_STOP=1 -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('$version')"
done
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/n1n6/sql/01_legacy_data.sql
for file in supabase/migrations/202610*.sql; do
 name=${file##*/}
 case "$name" in 20261026004500_*) continue ;; esac
 if [ "$name" = '20261014000800_revoke_excess_table_privileges.sql' ]; then
 psql -X -v ON_ERROR_STOP=1 -c 'GRANT ALL ON public.drivers,public.team_invites,public.tenant_users TO postgres'
 fi
 psql -X -v ON_ERROR_STOP=1 -1 -f "$file"
 version=${name%%_*}
 psql -X -v ON_ERROR_STOP=1 -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('$version')"
done
hash_functions() {
 psql -X -At -c "SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY oid::regprocedure::text)) FROM pg_proc WHERE pronamespace='public'::regnamespace"
}
if [ "${1:-strict}" = legacy ]; then
 psql -X -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role"
fi
before=$(hash_functions)
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/driver_ride_offers/legacy_inflight.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261026004500_driver_ride_offers.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/driver_ride_offers/legacy_flow.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/driver_ride_offers/security_and_flows.sql
sh supabase/tests/driver_ride_offers/concurrency.sh
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/driver_ride_offers/pending_before_down.sql
hash_order_data() {
 psql -X -At -c "SELECT md5(coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY id)::text FROM public.orders o),'')) || md5(coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY order_id)::text FROM public.order_handoff_codes h),'')) || md5(coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY id)::text FROM public.order_status_history h),''))"
}
order_data=$(hash_order_data)
psql -X -v ON_ERROR_STOP=1 -f supabase/rollback/20261026004500_driver_ride_offers_down.sql
[ "$order_data" = "$(hash_order_data)" ] || { echo 'Rollback alterou pedidos, códigos ou histórico' >&2; exit 1; }
[ "$before" = "$(hash_functions)" ] || { echo 'Rollback alterou definições ou permissões originais' >&2; exit 1; }
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261026004500_driver_ride_offers.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/driver_ride_offers/legacy_flow.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/driver_ride_offers/security_and_flows.sql
echo 'PASS: oferta, aceite, recusa, expiração, isolamento, retirada, liberação, compatibilidade, rollback exato e reaplicação'
