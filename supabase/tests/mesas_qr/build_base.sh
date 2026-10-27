#!/bin/sh
# Builds a disposable LOCAL database with every migration that exists BEFORE 20261027004600 (staging-like).
# Usage: build_base.sh <dbname>   (local socket only; refuses remote PGHOST)
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
unset PGPASSWORD DATABASE_URL SUPABASE_DB_URL || true
cd "$(dirname "$0")/../../.."
export PGDATABASE="$1"
dropdb --if-exists "$PGDATABASE"; createdb "$PGDATABASE"
psql -X -q -v ON_ERROR_STOP=1 -f supabase/tests/n1n6/harness/00_supabase_stubs.sql >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -c "INSERT INTO vault.secrets_stub(name,decrypted_secret) VALUES ('n1n6_ip_hash_salt','local-regression-fixture-salt-0123456789abcdef'); CREATE PUBLICATION supabase_realtime"
apply() { psql -X -q -v ON_ERROR_STOP=1 -1 -f "$1" >/dev/null && psql -X -q -v ON_ERROR_STOP=1 -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('${2%%_*}')" >/dev/null; }
for file in supabase/migrations/202609*.sql; do apply "$file" "${file##*/}"; done
psql -X -q -v ON_ERROR_STOP=1 -f supabase/tests/n1n6/sql/01_legacy_data.sql >/dev/null
for file in supabase/migrations/202610*.sql; do
  name=${file##*/}
  case "$name" in 20261026004500_*|20261027004600_*) continue ;; esac   # driver_ride_offers is unrelated and has its own suite
  [ "$name" = '20261014000800_revoke_excess_table_privileges.sql' ] && psql -X -q -v ON_ERROR_STOP=1 -c 'GRANT ALL ON public.drivers,public.team_invites,public.tenant_users TO postgres'
  apply "$file" "$name"
done
echo "base ready: $PGDATABASE"
