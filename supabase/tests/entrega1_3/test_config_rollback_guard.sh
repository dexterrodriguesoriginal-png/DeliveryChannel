#!/bin/sh
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
case "${1:-}" in entrega1_3_*_part) CFG="${1}_cfg" ;; *) exit 2 ;; esac
unset PGPASSWORD PGHOSTADDR PGSERVICE PGSERVICEFILE DATABASE_URL SUPABASE_DB_URL || true
TMP=$(mktemp -d)
trap 'dropdb --if-exists "$CFG" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT HUP INT TERM
createdb -T "$1" "$CFG"
P() { psql -X -q -v ON_ERROR_STOP=1 -d "$CFG" "$@"; }
P -c "INSERT INTO public.tenant_modules(tenant_id,module_key,enabled,config) VALUES('10000000-0000-0000-0000-00000000000a','dine_in',true,'{\"mode\":\"TABLE\",\"salon_open\":true}') ON CONFLICT(tenant_id,module_key) DO UPDATE SET enabled=true,config=EXCLUDED.config" >/dev/null
P -1 -f supabase/migrations/20261104000600_entrega1_3_c.sql >/dev/null
P -c "SET ROLE authenticated; SELECT t.login('a0000000-0000-0000-0000-000000000001'); SELECT public.set_salon_delivery_code_required('10000000-0000-0000-0000-00000000000a',true)" >/dev/null
snapshot() { P -At -c "SELECT md5(string_agg(config::text,'|' ORDER BY tenant_id)) FROM public.tenant_modules WHERE module_key='dine_in'"; }
snapshot >"$TMP/before"
if P -1 -f supabase/rollback/20261104000600_entrega1_3_c_down.sql >"$TMP/down.log" 2>&1; then echo 'FAIL: config-only usage was discarded'; exit 1; fi
grep 'ROLLBACK_BLOCKED' "$TMP/down.log" >/dev/null
snapshot >"$TMP/after"
diff -u "$TMP/before" "$TMP/after"
echo 'PASS: rollback006 reconhece uso apenas de configuração e preserva o valor'

