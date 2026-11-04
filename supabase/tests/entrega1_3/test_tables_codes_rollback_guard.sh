#!/bin/sh
# Apenas banco sintético do runner local; não imprime conteúdo de clientes/códigos.
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
case "${1:-}" in entrega1_3_*_run) DB="$1" ;; *) echo 'Disposable entrega1_3 database required' >&2; exit 2 ;; esac
unset PGPASSWORD PGHOSTADDR PGSERVICE PGSERVICEFILE DATABASE_URL SUPABASE_DB_URL || true
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$HERE/../../.."
P() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
[ "$(P -At -c "SELECT to_regclass('public.tab_table_moves') IS NOT NULL")" = t ] || exit 0
[ "$(P -At -c 'SELECT (SELECT count(*) FROM public.tab_table_moves)+(SELECT count(*) FROM public.salon_order_delivery_codes)')" -gt 0 ] || exit 0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
snapshot() {
 for relation in tab_table_moves dining_tab_tables salon_order_delivery_codes dining_tabs tab_sessions orders waiter_calls tab_receipt_sends tab_payments tab_access_events; do
  P -At -c "SELECT '$relation',md5(COALESCE(string_agg(rowdata,'|' ORDER BY rowdata),'')) FROM (SELECT to_jsonb(r)::text AS rowdata FROM public.$relation r) snapshot_rows"
 done
 P -At -c "SELECT md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'|' ORDER BY p.oid::regprocedure::text)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'"
}
snapshot >"$TMP/before"
if P -1 -f supabase/rollback/20261104000600_entrega1_3_c_down.sql >"$TMP/down.log" 2>&1; then
 echo 'FAIL: used006 rollback must refuse history/debt loss' >&2
 exit 1
fi
grep 'ROLLBACK_BLOCKED' "$TMP/down.log" >/dev/null
snapshot >"$TMP/after"
diff -u "$TMP/before" "$TMP/after"
echo 'PASS: rollback006 usado recusado; sessões, dívidas, códigos, tentativas e auditoria preservados'
