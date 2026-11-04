#!/bin/sh
# PostgreSQL local descartável, incluindo regressões da Entrega 1.3 e reversão exata da 1.4.
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
unset PGPASSWORD PGHOSTADDR PGSERVICE PGSERVICEFILE DATABASE_URL SUPABASE_DB_URL || true
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$HERE/../../.."
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
P -d postgres -c 'SELECT 1' >/dev/null
PREFIX="entrega1_4_$$"; REF="${PREFIX}_ref"; RUN="${PREFIX}_run"; RB="${PREFIX}_rb"
TMP="$(mktemp -d)"
cleanup() {
 for db in "$RUN" "$RB" "$REF"; do dropdb --if-exists "$db" >/dev/null 2>&1 || true; done
 rm -rf "$TMP"
}
trap cleanup EXIT HUP INT TERM
INCLUDE_4600=1 sh supabase/tests/mesas_qr/build_base.sh "$REF" >"$TMP/base.log" 2>&1 || { tail -30 "$TMP/base.log"; exit 1; }
for file in supabase/migrations/20261026004500_*.sql supabase/migrations/20261027004700_*.sql supabase/migrations/20261027004800_*.sql supabase/migrations/20261027004900_*.sql supabase/migrations/20261027005000_*.sql supabase/migrations/20261103000100_*.sql supabase/migrations/20261104000[123]00_entrega1_1.sql; do
 P -d "$REF" -1 -f "$file" >/dev/null
done
P -d "$REF" -f supabase/tests/n1n6/sql/00_framework.sql >/dev/null
sed '2,3d' supabase/tests/n1n6/sql/03_fixtures.sql >"$TMP/fixtures.sql"
P -d "$REF" -f "$TMP/fixtures.sql" >/dev/null
case "${1:-strict}" in
 strict) ;;
 legacy) P -d "$REF" -c 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role' >/dev/null ;;
 *) echo 'Usage: run_regressions.sh [strict|legacy]' >&2; exit 2 ;;
esac
for file in supabase/migrations/20261104000[456]00_entrega1_3_*.sql; do P -d "$REF" -1 -f "$file" >/dev/null; done
# C ainda testa o contrato anterior (mudança imediata): executa antes de aplicar a mudança de contrato.
for file in supabase/tests/entrega1_3/[abc].sql supabase/tests/entrega1_3/review_*.sql; do
 P -d "$REF" -c "SET t.suite='entrega1_3_predecessor'" -f "$file" >"$TMP/suite.log" 2>&1 || { tail -60 "$TMP/suite.log"; exit 1; }
done
sed -n '/^SELECT '\''functions'\''/,/^SQL$/p' supabase/tests/entrega1/run_regressions.sh | sed '$d' >"$TMP/fingerprint.sql"
cat >>"$TMP/fingerprint.sql" <<'SQL'
SELECT 'indexes',md5(string_agg(indexdef,'|' ORDER BY tablename,indexname)) FROM pg_indexes WHERE schemaname='public';
SQL
P -At -d "$REF" -f "$TMP/fingerprint.sql" >"$TMP/before"
createdb -T "$REF" "$RB"
for pass in 1 2; do
 P -d "$RB" -1 -f supabase/migrations/20261104000700_entrega1_4_move_approval.sql >/dev/null
 P -d "$RB" -1 -f supabase/rollback/20261104000700_entrega1_4_move_approval_down.sql >/dev/null
 P -At -d "$RB" -f "$TMP/fingerprint.sql" >"$TMP/after"
 diff -u "$TMP/before" "$TMP/after"
done
echo 'PASS: 007 apply → rollback exato (funções/ACL/RLS/colunas/constraints/triggers/índices), dois ciclos'
createdb -T "$REF" "$RUN"
P -d "$RUN" -1 -f supabase/migrations/20261104000700_entrega1_4_move_approval.sql >/dev/null
for file in "$HERE/table_moves.sql" "$HERE/delivery_codes.sql"; do
 [ -f "$file" ] || continue
 P -d "$RUN" -c "SET t.suite='entrega1_4'" -f "$file" >"$TMP/suite.log" 2>&1 || { tail -80 "$TMP/suite.log"; exit 1; }
done
sh "$HERE/test_move_concurrency.sh" "$RUN"
sh "$HERE/test_move_rollback_guard.sh" "$RUN"
P -At -d "$RUN" -c "SELECT 'FALHOU: '||name||' — '||coalesce(detail,'') FROM t.results WHERE NOT ok ORDER BY id"
P -At -d "$RUN" -c "SELECT suite||': '||count(*) FILTER(WHERE ok)||' passou, '||count(*) FILTER(WHERE NOT ok)||' falhou' FROM t.results GROUP BY suite ORDER BY suite"
[ "$(P -At -d "$RUN" -c 'SELECT count(*) FROM t.results WHERE NOT ok')" = 0 ]
echo 'PASS: entrega1_4 (aprovação de mudança, isolamento, configuração, concorrência e rollback)'
