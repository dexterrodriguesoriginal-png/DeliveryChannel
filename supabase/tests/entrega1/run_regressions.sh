#!/bin/sh
# Entrega 1: only disposable LOCAL PostgreSQL; never connects to Supabase.
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
unset PGPASSWORD PGHOSTADDR PGSERVICE PGSERVICEFILE DATABASE_URL SUPABASE_DB_URL || true
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$HERE/../../.."
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
P -d postgres -c 'SELECT 1' >/dev/null
PREFIX="entrega1_$$"
REF="${PREFIX}_ref"; RUN="${PREFIX}_run"; RB="${PREFIX}_rb"; DRIFT="${PREFIX}_drift"
TMP="$(mktemp -d)"
cleanup() {
  for db in "$RUN" "$RB" "$DRIFT" "$REF"; do dropdb --if-exists "$db" >/dev/null 2>&1 || true; done
  rm -rf "$TMP"
}
trap cleanup EXIT HUP INT TERM
MIG=supabase/migrations/20261103000100_entrega1.sql
DOWN=supabase/rollback/20261103000100_entrega1_down.sql
INCLUDE_4600=1 sh supabase/tests/mesas_qr/build_base.sh "$REF" >"$TMP/base.log" 2>&1 || { tail -30 "$TMP/base.log"; exit 1; }
for file in supabase/migrations/20261026004500_*.sql supabase/migrations/20261027004700_*.sql supabase/migrations/20261027004800_*.sql supabase/migrations/20261027004900_*.sql supabase/migrations/20261027005000_*.sql; do
  P -d "$REF" -1 -f "$file" >/dev/null
done
P -d "$REF" -f supabase/tests/n1n6/sql/00_framework.sql >/dev/null
sed '2,3d' supabase/tests/n1n6/sql/03_fixtures.sql >"$TMP/fixtures.sql"
P -d "$REF" -f "$TMP/fixtures.sql" >/dev/null
case "${1:-strict}" in
  strict) ;;
  legacy)
    P -d "$REF" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role" >/dev/null
    ;;
  *) echo 'Usage: run_regressions.sh [strict|legacy]' >&2; exit 2 ;;
esac

# Fingerprints include complete definitions, grants, RLS, checks and triggers.
cat >"$TMP/fingerprint.sql" <<'SQL'
SELECT 'functions', md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'|' ORDER BY p.oid::regprocedure::text))
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f';
SELECT 'policies', md5(string_agg(row(tablename,policyname,permissive,roles,cmd,qual,with_check)::text,'|' ORDER BY tablename,policyname))
FROM pg_policies WHERE schemaname IN ('public','storage');
SELECT 'columns', md5(string_agg(row(table_name,column_name,data_type,is_nullable,column_default)::text,'|' ORDER BY table_name,ordinal_position))
FROM information_schema.columns WHERE table_schema='public';
SELECT 'constraints', md5(string_agg(c.conrelid::regclass::text||c.conname||pg_get_constraintdef(c.oid),'|' ORDER BY c.conrelid::regclass::text,c.conname))
FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public';
SELECT 'relations', md5(string_agg(row(c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl)::text,'|' ORDER BY c.relname))
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','v','S');
SELECT 'triggers', md5(string_agg(pg_get_triggerdef(t.oid),'|' ORDER BY t.tgrelid::regclass::text,t.tgname))
FROM pg_trigger t WHERE NOT t.tgisinternal;
SELECT 'roles', md5(string_agg(to_jsonb(r)::text,'|' ORDER BY r.id)) FROM public.roles r;
SQL
P -At -d "$REF" -f "$TMP/fingerprint.sql" >"$TMP/before"
for patch_case in literal regexp path path_extra roles; do
  createdb -T "$REF" "$DRIFT"
  if P -d "$DRIFT" -v "patch_case=$patch_case" -f "$HERE/security_patch_guards.sql" >"$TMP/drift.log" 2>&1; then
    echo "FALHOU: patch $patch_case não recusou baseline divergente" >&2
    exit 1
  fi
  case "$(cat "$TMP/drift.log")" in
    *ENTREGA1_PATCH_MISMATCH:*) ;;
    *) tail -20 "$TMP/drift.log"; exit 1 ;;
  esac
  P -At -d "$DRIFT" -f "$TMP/fingerprint.sql" >"$TMP/after-drift"
  diff -u "$TMP/before" "$TMP/after-drift"
  dropdb "$DRIFT"
done
echo 'PASS: cinco baselines divergentes recusados sem alteração de schema'
createdb -T "$REF" "$RB"
P -d "$RB" -1 -f "$MIG" >/dev/null
P -d "$RB" -1 -f "$DOWN" >/dev/null
P -At -d "$RB" -f "$TMP/fingerprint.sql" >"$TMP/after"
diff -u "$TMP/before" "$TMP/after"
P -d "$RB" -1 -f "$MIG" >/dev/null
P -d "$RB" -1 -f "$DOWN" >/dev/null
P -At -d "$RB" -f "$TMP/fingerprint.sql" >"$TMP/after"
diff -u "$TMP/before" "$TMP/after"
echo 'PASS: apply → rollback exato → apply → rollback exato'

createdb -T "$REF" "$RUN"
P -d "$RUN" -1 -f "$MIG" >/dev/null
P -d "$RUN" -c "SET t.suite='entrega1'" -f "$HERE/entrega1.sql" >"$TMP/suite.log" 2>&1 || { tail -40 "$TMP/suite.log"; exit 1; }
P -At -d "$RUN" -c "SELECT 'FALHOU: '||name||' — '||coalesce(detail,'') FROM t.results WHERE NOT ok ORDER BY id"
P -At -d "$RUN" -c "SELECT 'entrega1: '||count(*) FILTER(WHERE ok)||' passou, '||count(*) FILTER(WHERE NOT ok)||' falhou' FROM t.results"
[ "$(P -At -d "$RUN" -c 'SELECT count(*) FROM t.results WHERE NOT ok')" = 0 ]
echo 'PASS: entrega1 (segurança, fluxos e isolamento)'

