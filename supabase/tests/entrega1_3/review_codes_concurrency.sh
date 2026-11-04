#!/bin/sh
# Duas sessões PostgreSQL locais disputam a última tentativa permitida.
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
unset PGPASSWORD PGHOSTADDR PGSERVICE PGSERVICEFILE DATABASE_URL SUPABASE_DB_URL || true
case "${1:-}" in entrega1_3_*_run) DB="$1" ;; *) echo 'Disposable entrega1_3 database required' >&2; exit 2 ;; esac
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT HUP INT TERM
P() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
# A fixture é criada por review_codes.sql; não altera o pedido já bloqueado.
P <<'SQL'
UPDATE public.salon_order_delivery_codes SET attempts=4 WHERE order_id='e13c0000-0000-0000-0000-000000000101';
SQL
cat >"$TMP/wrong.sql" <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.waiter_mark_delivered('e13c0000-0000-0000-0000-000000000101','0000');
\! touch '$TMP/ready'
SELECT pg_sleep(0.6);
COMMIT;
SQL
P -f "$TMP/wrong.sql" >"$TMP/wrong.log" 2>&1 &
WRONG_PID=$!
n=0
while [ ! -f "$TMP/ready" ]; do
 n=$((n+1)); [ "$n" -le 100 ] || { cat "$TMP/wrong.log"; exit 1; }
 sleep 0.03
done
# O código correto concorre enquanto a quinta falha ainda está sem commit.
# Espera pelo lock, lê a tentativa persistida e recusa a sexta tentativa.
if P >"$TMP/correct.log" 2>&1 <<'SQL'
SELECT customer_code AS code FROM public.salon_order_delivery_codes WHERE order_id='e13c0000-0000-0000-0000-000000000101' \gset
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.waiter_mark_delivered('e13c0000-0000-0000-0000-000000000101',:'code');
SQL
then
 echo 'Falha: a sexta tentativa concorrente foi aceita'; exit 1
fi
wait "$WRONG_PID"
grep -q 'DELIVERY_CODE_LOCKED' "$TMP/correct.log" || { cat "$TMP/correct.log"; exit 1; }
P <<'SQL'
SELECT t.ok(EXISTS(SELECT 1 FROM public.salon_order_delivery_codes c JOIN public.orders o ON o.id=c.order_id WHERE c.order_id='e13c0000-0000-0000-0000-000000000101' AND c.attempts=5 AND c.confirmed_at IS NULL AND o.status='OUT_FOR_DELIVERY'),'review-code duas conexões preservam limite de cinco tentativas e impedem entrega');
SQL
echo 'PASS: concorrência da última tentativa do código de entrega'
