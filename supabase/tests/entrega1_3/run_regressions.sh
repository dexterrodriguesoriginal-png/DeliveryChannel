#!/bin/sh
# PostgreSQL local descartável; nenhuma conexão a Supabase remoto.
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
unset PGPASSWORD PGHOSTADDR PGSERVICE PGSERVICEFILE DATABASE_URL SUPABASE_DB_URL || true
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$HERE/../../.."
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
P -d postgres -c 'SELECT 1' >/dev/null
PREFIX="entrega1_3_$$"
REF="${PREFIX}_ref"; RUN="${PREFIX}_run"; RB="${PREFIX}_rb"; PART="${PREFIX}_part"
TMP="$(mktemp -d)"
cleanup() {
 for db in "$PART" "$RUN" "$RB" "$REF"; do dropdb --if-exists "$db" >/dev/null 2>&1 || true; done
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
 *) echo 'Usage: run_regressions.sh [strict|legacy] [A|B|C|all]' >&2; exit 2 ;;
esac
case "${2:-all}" in A) MAX=4 ;; B) MAX=5 ;; C|all) MAX=9 ;; *) exit 2 ;; esac
sed -n '/^SELECT '\''functions'\''/,/^SQL$/p' supabase/tests/entrega1/run_regressions.sh | sed '$d' >"$TMP/fingerprint.sql"
cat >>"$TMP/fingerprint.sql" <<'SQL'
SELECT 'indexes',md5(string_agg(indexdef,'|' ORDER BY tablename,indexname)) FROM pg_indexes WHERE schemaname='public';
SQL
P -At -d "$REF" -f "$TMP/fingerprint.sql" >"$TMP/before"
apply_parts() {
 for file in supabase/migrations/20261104000[4-9]00_entrega1_3_*.sql; do
  [ -f "$file" ] || continue
  part=$(basename "$file" | cut -c12)
  [ "$part" -le "$MAX" ] || continue
  P -d "$1" -1 -f "$file" >/dev/null
 done
}
createdb -T "$REF" "$RB"
for pass in 1 2; do
 apply_parts "$RB"
 for file in $(ls supabase/rollback/20261104000[4-9]00_entrega1_3_*_down.sql | sort -r); do
  part=$(basename "$file" | cut -c12)
  [ "$part" -le "$MAX" ] || continue
  P -d "$RB" -1 -f "$file" >/dev/null
 done
 P -At -d "$RB" -f "$TMP/fingerprint.sql" >"$TMP/after"
 diff -u "$TMP/before" "$TMP/after"
done
echo 'PASS: Entrega 1.3 apply → rollback exato → apply → rollback exato'
# Cada down deve restaurar seu predecessor imediato, não apenas o estado final
# depois de reverter A+B+C: uma reversão posterior não pode mascarar outra.
for migration in supabase/migrations/20261104000[4-9]00_entrega1_3_*.sql; do
 [ -f "$migration" ] || continue
 part=$(basename "$migration" | cut -c12)
 [ "$part" -le "$MAX" ] || continue
 createdb -T "$REF" "$PART"
 for predecessor in supabase/migrations/20261104000[4-9]00_entrega1_3_*.sql; do
  [ -f "$predecessor" ] || continue
  previous=$(basename "$predecessor" | cut -c12)
  [ "$previous" -lt "$part" ] || continue
  P -d "$PART" -1 -f "$predecessor" >/dev/null
 done
 P -At -d "$PART" -f "$TMP/fingerprint.sql" >"$TMP/part-before"
 down="supabase/rollback/$(basename "$migration" .sql)_down.sql"
 for pass in 1 2; do
  P -d "$PART" -1 -f "$migration" >/dev/null
  P -d "$PART" -1 -f "$down" >/dev/null
  P -At -d "$PART" -f "$TMP/fingerprint.sql" >"$TMP/part-after"
  diff -u "$TMP/part-before" "$TMP/part-after"
 done
 echo "PASS: $(basename "$migration") rollback exato isolado em dois ciclos"
 if [ "$part" -eq 6 ]; then sh "$HERE/test_config_rollback_guard.sh" "$PART"; fi
 dropdb "$PART"
done
createdb -T "$REF" "$RUN"
apply_parts "$RUN"
for file in "$HERE"/[abc].sql "$HERE"/review_*.sql; do
 [ -f "$file" ] || continue
 case "$(basename "$file")" in a.sql) part=4 ;; b.sql) part=5 ;; c.sql|review_*.sql) part=6 ;; esac
 [ "$part" -le "$MAX" ] || continue
 P -d "$RUN" -c "SET t.suite='entrega1_3'" -f "$file" >"$TMP/suite.log" 2>&1 || { tail -60 "$TMP/suite.log"; exit 1; }
done
if [ "$MAX" -ge 6 ]; then
 for check in test_table_concurrency.sh review_codes_concurrency.sh; do
  [ -f "$HERE/$check" ] || continue
  sh "$HERE/$check" "$RUN"
 done
fi
if [ "$MAX" -ge 6 ] && [ -f "$HERE/test_tables_codes_rollback_guard.sh" ]; then
 sh "$HERE/test_tables_codes_rollback_guard.sh" "$RUN"
fi
if [ "$MAX" -ge 5 ] && [ -f "$HERE/test_receipt_rollback_guard.sh" ]; then
 sh "$HERE/test_receipt_rollback_guard.sh" "$RUN"
fi
P -At -d "$RUN" -c "SELECT 'FALHOU: '||name||' — '||coalesce(detail,'') FROM t.results WHERE NOT ok ORDER BY id"
P -At -d "$RUN" -c "SELECT 'entrega1_3: '||count(*) FILTER(WHERE ok)||' passou, '||count(*) FILTER(WHERE NOT ok)||' falhou' FROM t.results"
[ "$(P -At -d "$RUN" -c 'SELECT count(*) FROM t.results WHERE NOT ok')" = 0 ]
echo 'PASS: entrega1_3 (rodadas, liberação do balcão, segurança e isolamento)'
