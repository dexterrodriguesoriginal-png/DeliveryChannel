#!/bin/sh
# PostgreSQL LOCAL descartável: E1 sobre o schema C: ranking, isolamento e reversão exata.
# E1_ONLY=1 aplica o schema anterior, mas executa somente os testes novos de E1.
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
unset PGPASSWORD PGHOSTADDR PGSERVICE PGSERVICEFILE DATABASE_URL SUPABASE_DB_URL || true
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$HERE/../../.."
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
PREFIX="entrega2_e1_$$"; REF="${PREFIX}_ref"; RUN="${PREFIX}_run"; RB="${PREFIX}_rb"; GUARD="${PREFIX}_guard"
TMP="$(mktemp -d)"
cleanup() { for db in "$GUARD" "$RUN" "$RB" "$REF"; do dropdb --if-exists "$db" >/dev/null 2>&1 || true; done; rm -rf "$TMP"; }
trap cleanup EXIT HUP INT TERM
INCLUDE_4600=1 sh supabase/tests/mesas_qr/build_base.sh "$REF" >"$TMP/base.log" 2>&1 || { tail -40 "$TMP/base.log"; exit 1; }
for file in supabase/migrations/20261026004500_*.sql supabase/migrations/20261027004700_*.sql supabase/migrations/20261027004800_*.sql supabase/migrations/20261027004900_*.sql supabase/migrations/20261027005000_*.sql supabase/migrations/20261103000100_*.sql supabase/migrations/20261104000[123]00_entrega1_1.sql; do P -d "$REF" -1 -f "$file" >/dev/null; done
P -d "$REF" -f supabase/tests/n1n6/sql/00_framework.sql >/dev/null
sed '2,3d' supabase/tests/n1n6/sql/03_fixtures.sql >"$TMP/fixtures.sql"
P -d "$REF" -f "$TMP/fixtures.sql" >/dev/null
case "${1:-strict}" in
 strict) ;;
 legacy) P -d "$REF" -c 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role' >/dev/null ;;
 *) echo 'Usage: run_e1_regressions.sh [strict|legacy]' >&2; exit 2 ;;
esac
for file in supabase/migrations/20261104000[456]00_entrega1_3_*.sql; do P -d "$REF" -1 -f "$file" >/dev/null; done
if [ "${E1_ONLY:-0}" != 1 ]; then
for file in supabase/tests/entrega1_3/[abc].sql supabase/tests/entrega1_3/review_*.sql; do P -d "$REF" -c "SET t.suite='entrega1_3_predecessor'" -f "$file" >"$TMP/suite.log" 2>&1 || { tail -80 "$TMP/suite.log"; exit 1; }; done
fi
P -d "$REF" -1 -f supabase/migrations/20261104000700_entrega1_4_move_approval.sql >/dev/null
if [ "${E1_ONLY:-0}" != 1 ]; then
for file in supabase/tests/entrega1_4/table_moves.sql supabase/tests/entrega1_4/delivery_codes.sql; do P -d "$REF" -c "SET t.suite='entrega1_4_predecessor'" -f "$file" >"$TMP/suite.log" 2>&1 || { tail -80 "$TMP/suite.log"; exit 1; }; done
fi
P -d "$REF" -1 -f supabase/migrations/20261104000800_entrega2_menu_outdoor.sql >/dev/null
if [ "${E1_ONLY:-0}" != 1 ]; then
P -d "$REF" -c "SET t.suite='entrega2_b_predecessor'" -f "$HERE/b.sql" >"$TMP/suite.log" 2>&1 || { tail -80 "$TMP/suite.log"; exit 1; }
fi
# Congela os retornos públicos imediatamente anteriores a 009 para provar adição exata.
P -d "$REF" -c "CREATE TABLE t.c_public_before AS SELECT slug,public.get_public_store(slug) payload FROM public.tenants WHERE status='ACTIVE'; GRANT SELECT ON t.c_public_before TO PUBLIC" >/dev/null
P -d "$REF" -c "CREATE TABLE t.c_outdoor_before AS SELECT slug,public.list_public_menu_outdoor(slug) payload FROM public.tenants WHERE status='ACTIVE'; GRANT SELECT ON t.c_outdoor_before TO PUBLIC" >/dev/null
P -d "$REF" -1 -f supabase/migrations/20261104000900_entrega2_menu_theme.sql >/dev/null
if [ "${E1_ONLY:-0}" != 1 ]; then
P -d "$REF" -c "SET t.suite='entrega2_c_predecessor'" -f "$HERE/c.sql" >"$TMP/suite.log" 2>&1 || { tail -100 "$TMP/suite.log"; exit 1; }
fi
sed -n '/^SELECT '\''functions'\''/,/^SQL$/p' supabase/tests/entrega1/run_regressions.sh | sed '$d' >"$TMP/fingerprint.sql"
cat >>"$TMP/fingerprint.sql" <<'SQL'
SELECT 'indexes',md5(string_agg(indexdef,'|' ORDER BY tablename,indexname)) FROM pg_indexes WHERE schemaname='public';
SELECT 'comments',md5(string_agg(row(c.relname,a.attname,col_description(c.oid,a.attnum))::text,'|' ORDER BY c.relname,a.attname)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname='public';
SQL
P -At -d "$REF" -f "$TMP/fingerprint.sql" >"$TMP/before"
createdb -T "$REF" "$RB"
for pass in 1 2; do
 P -d "$RB" -1 -f supabase/migrations/20261104001000_entrega2_upsell.sql >/dev/null
 P -d "$RB" -1 -f supabase/rollback/20261104001000_entrega2_upsell_down.sql >/dev/null
 P -At -d "$RB" -f "$TMP/fingerprint.sql" >"$TMP/after"
 diff -u "$TMP/before" "$TMP/after"
done
echo 'PASS: 010 apply → rollback exato (schema, comentários e ACL), dois ciclos'
createdb -T "$REF" "$RUN"
P -d "$RUN" -1 -f supabase/migrations/20261104001000_entrega2_upsell.sql >/dev/null
P -d "$RUN" -c "SET t.suite='entrega2_e1'" -f "$HERE/e1.sql" >"$TMP/suite.log" 2>&1 || { tail -120 "$TMP/suite.log"; exit 1; }
createdb -T "$RUN" "$GUARD"
P -At -d "$GUARD" -f "$TMP/fingerprint.sql" >"$TMP/guard-before"
P -At -d "$GUARD" -c "SELECT md5(string_agg(row(tablename,rowsecurity)::text,'|' ORDER BY tablename)) FROM pg_tables WHERE schemaname='public'" >>"$TMP/guard-before"
if P -d "$GUARD" -1 -f supabase/rollback/20261104001000_entrega2_upsell_down.sql >"$TMP/guard.log" 2>&1; then echo 'FAIL: rollback descartou dados de upsell em uso'; exit 1; fi
grep -E 'ROLLBACK_BLOCKED|ROLLBACK_HAS_DATA|UPSELL_ROLLBACK' "$TMP/guard.log" >/dev/null
P -At -d "$GUARD" -f "$TMP/fingerprint.sql" >"$TMP/guard-after"
P -At -d "$GUARD" -c "SELECT md5(string_agg(row(tablename,rowsecurity)::text,'|' ORDER BY tablename)) FROM pg_tables WHERE schemaname='public'" >>"$TMP/guard-after"
diff -u "$TMP/guard-before" "$TMP/guard-after"
echo 'PASS: rollback 010 em uso recusado e schema preservado'
P -At -d "$RUN" -c "SELECT 'FALHOU: '||name||' — '||coalesce(detail,'') FROM t.results WHERE NOT ok ORDER BY id"
P -At -d "$RUN" -c "SELECT suite||': '||count(*) FILTER(WHERE ok)||' passou, '||count(*) FILTER(WHERE NOT ok)||' falhou' FROM t.results GROUP BY suite ORDER BY suite"
[ "$(P -At -d "$RUN" -c 'SELECT count(*) FROM t.results WHERE NOT ok')" = 0 ]
echo 'PASS: entrega2 E1 (ranking, autorização, LGPD, eventos e reversão)'
