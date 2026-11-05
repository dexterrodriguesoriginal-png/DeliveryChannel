#!/bin/sh
# Run after b.sql against its disposable LOCAL database. Never deletes receipt history.
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
case "${1:-}" in entrega1_3_*_run) DB="$1" ;; *) echo 'Disposable entrega1_3 database required' >&2; exit 2 ;; esac
unset PGPASSWORD PGHOSTADDR PGSERVICE PGSERVICEFILE DATABASE_URL SUPABASE_DB_URL || true
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$HERE/../../.."
P() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
[ "$(P -At -c "SELECT count(*) FROM public.tab_receipt_sends WHERE charge_id IS NULL")" -gt 0 ] || exit 0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
snapshot() {
 P -At -c "SELECT md5(string_agg(to_jsonb(s)::text,'|' ORDER BY id)) FROM public.tab_receipt_sends s"
 P -At -c "SELECT md5(string_agg(to_jsonb(p)::text,'|' ORDER BY id)) FROM public.tab_payments p"
 P -At -c "SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'|' ORDER BY oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('reserve_tab_receipt','authorize_tab_receipt','finish_tab_receipt','tab_receipt_target')"
 P -At -c "SELECT attnotnull FROM pg_attribute WHERE attrelid='public.tab_receipt_sends'::regclass AND attname='charge_id'"
}
snapshot >"$TMP/before"
if P -1 -f supabase/rollback/20261104000500_entrega1_3_b_down.sql >"$TMP/rollback.log" 2>&1; then
 echo 'FAIL: used receipt rollback must preserve manual receipt history' >&2
 exit 1
fi
grep 'ROLLBACK_BLOCKED' "$TMP/rollback.log" >/dev/null
snapshot >"$TMP/after"
diff -u "$TMP/before" "$TMP/after"
echo 'PASS: rollback005 usado recusado; auditoria de recibos, pagamentos e RPCs preservados'

