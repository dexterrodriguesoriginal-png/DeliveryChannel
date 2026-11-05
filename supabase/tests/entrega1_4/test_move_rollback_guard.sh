#!/bin/sh
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
unset PGPASSWORD PGHOSTADDR PGSERVICE PGSERVICEFILE DATABASE_URL SUPABASE_DB_URL || true
case "${1:-}" in entrega1_4_*_run) CHECK="${1}_guard" ;; *) exit 2 ;; esac
TMP=$(mktemp -d)
trap 'dropdb --if-exists "$CHECK" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT HUP INT TERM
createdb -T "$1" "$CHECK"
P() { psql -X -q -v ON_ERROR_STOP=1 -d "$CHECK" "$@"; }
snapshot() { P -At -c "SELECT md5(COALESCE(string_agg(to_jsonb(r)::text,'|' ORDER BY id),'')) FROM public.table_move_requests r; SELECT md5(COALESCE(string_agg(to_jsonb(s)::text,'|' ORDER BY tenant_id),'')) FROM public.waiter_service_settings s"; }
snapshot >"$TMP/before"
if P -1 -f supabase/rollback/20261104000700_entrega1_4_move_approval_down.sql >"$TMP/down.log" 2>&1; then echo 'FAIL: histórico foi descartado'; exit 1; fi
grep 'ROLLBACK_BLOCKED' "$TMP/down.log" >/dev/null
snapshot >"$TMP/after"
diff -u "$TMP/before" "$TMP/after"
# Apenas configuração também precisa impedir perda silenciosa da autorização.
P -c "TRUNCATE public.table_move_requests; UPDATE public.waiter_service_settings SET allow_waiter_table_move_approval=true WHERE tenant_id='10000000-0000-0000-0000-00000000000a'" >/dev/null
snapshot >"$TMP/before"
if P -1 -f supabase/rollback/20261104000700_entrega1_4_move_approval_down.sql >"$TMP/down.log" 2>&1; then echo 'FAIL: permissão configurada foi descartada'; exit 1; fi
grep 'ROLLBACK_BLOCKED' "$TMP/down.log" >/dev/null
snapshot >"$TMP/after"
diff -u "$TMP/before" "$TMP/after"
echo 'PASS: rollback007 preserva histórico e reconhece configuração em uso'

