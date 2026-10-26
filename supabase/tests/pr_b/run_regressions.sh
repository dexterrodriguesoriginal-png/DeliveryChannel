#!/bin/sh
set -eu
# Local disposable database only. Also runnable inside postgres:17 with repo mounted at /repo.
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
cd "$(dirname "$0")/../../.."
export PGDATABASE="pr_b_regression_$$"
createdb "$PGDATABASE"
trap 'dropdb --if-exists "$PGDATABASE"' EXIT
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
 case "$name" in 20261026004200_*) continue ;; esac
 if [ "$name" = '20261014000800_revoke_excess_table_privileges.sql' ]; then
 psql -X -v ON_ERROR_STOP=1 -c 'GRANT ALL ON public.drivers,public.team_invites,public.tenant_users TO postgres'
 fi
 psql -X -v ON_ERROR_STOP=1 -1 -f "$file"
 version=${name%%_*}
 psql -X -v ON_ERROR_STOP=1 -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('$version')"
done
hash_functions() {
 psql -X -At -c "SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY proname)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('get_order_pickup_code','reset_order_pickup_code','confirm_order_pickup','confirm_order_delivery','driver_accept_order','list_available_driver_orders','update_order_status','assign_order_to_driver','get_my_order_delivery_code','log_audit_event')"
}
before=$(hash_functions)
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261026004200_notifications_dispatch_chat.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/pr_b/security_and_flows.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/rollback/20261026004200_notifications_dispatch_chat_down.sql
[ "$before" = "$(hash_functions)" ] || { echo 'Rollback changed original function definitions or grants' >&2; exit 1; }
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261026004200_notifications_dispatch_chat.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/pr_b/security_and_flows.sql
echo 'PASS: PR B migration, flows, roles, tenant isolation, rollback definitions/grants, reapplication'
