#!/bin/sh
set -eu
# Local disposable database only. Also runnable inside postgres:17 with repo mounted at /repo.
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
cd "$(dirname "$0")/../../.."
export PGDATABASE="online_payment_gate_$$"
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
 case "$name" in 20261026004301_*|20261026004500_*) continue ;; esac
 if [ "$name" = '20261014000800_revoke_excess_table_privileges.sql' ]; then
 psql -X -v ON_ERROR_STOP=1 -c 'GRANT ALL ON public.drivers,public.team_invites,public.tenant_users TO postgres'
 fi
 psql -X -v ON_ERROR_STOP=1 -1 -f "$file"
 version=${name%%_*}
 psql -X -v ON_ERROR_STOP=1 -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('$version')"
done
# Hash ALL original public functions and ACLs, plus policies (not just an allow-list).
hash_originals() {
 psql -X -At -c "SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY oid::regprocedure::text)) FROM pg_proc WHERE pronamespace='public'::regnamespace"
 psql -X -At -c "SELECT md5(string_agg(row(p.tablename,p.policyname,p.qual,p.with_check,p.roles,p.cmd,p.permissive)::text,'' ORDER BY p.tablename,p.policyname)) FROM pg_policies p WHERE schemaname='public'"
}
if [ "${1:-strict}" = 'legacy' ]; then
 psql -X -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role"
fi
before=$(hash_originals)
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/online_payment_gate/backfill.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261026004301_online_payment_gate.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/online_payment_gate/assert_backfill.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/online_payment_gate/security_and_flows.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/rollback/20261026004301_online_payment_gate_down.sql
[ "$before" = "$(hash_originals)" ] || { echo 'Rollback changed function definitions, grants or policies' >&2; exit 1; }
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261026004301_online_payment_gate.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/online_payment_gate/assert_backfill.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/online_payment_gate/security_and_flows.sql
echo 'PASS: online gate, backfill, tenant isolation, stock, rollback definitions/ACLs/policies, reapplication'
