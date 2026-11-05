#!/bin/sh
# Duas conexões reais no PostgreSQL descartável do runner.
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
unset PGPASSWORD PGHOSTADDR PGSERVICE PGSERVICEFILE DATABASE_URL SUPABASE_DB_URL || true
case "${1:-}" in entrega1_3_*_run) DB="$1" ;; *) echo 'Disposable entrega1_3 database required' >&2; exit 2 ;; esac
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
P() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
P <<'SQL' >/dev/null
RESET ROLE;
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token) SELECT ('e1320000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-0000-0000-00000000000a','Concorrência '||n,'review-concurrency-'||n FROM generate_series(61,64) n;
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,responsible_user_id) VALUES('e1330000-0000-0000-0000-000000000061','10000000-0000-0000-0000-00000000000a','TABLE','e1320000-0000-0000-0000-000000000061','e1310000-0000-0000-0000-000000000001');
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at) VALUES('e1340000-0000-0000-0000-000000000061','10000000-0000-0000-0000-00000000000a','e1330000-0000-0000-0000-000000000061','e1310000-0000-0000-0000-000000000001','Cliente','concurrency-61',now());
SQL
# Observa o mutex adquirido por A antes de iniciar B; não depende de um sleep no shell.
wait_locked() {
 i=0
 while [ "$(P -At -c "SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE a.application_name='$1' AND l.locktype='advisory' AND l.granted)")" != t ]; do
  i=$((i+1)); [ "$i" -lt 100 ] || { echo 'Não observou lock da conexão A' >&2; return 1; }
 done
}
P <<'SQL' >"$TMP/move.log" 2>&1 &
SET application_name='review-table-move';
SET statement_timeout='10s';
BEGIN;
SELECT public._salon_lock_tenant('10000000-0000-0000-0000-00000000000a');
SELECT pg_sleep(0.5);
SET ROLE authenticated;
SELECT t.login('e1310000-0000-0000-0000-000000000001');
SELECT public.customer_move_table('e1340000-0000-0000-0000-000000000061','e1320000-0000-0000-0000-000000000062');
COMMIT;
SQL
move_pid=$!
wait_locked review-table-move
P <<'SQL' >"$TMP/enter.log" 2>&1 &
SET statement_timeout='10s';
SET ROLE authenticated;
SELECT t.login('e1310000-0000-0000-0000-000000000004');
SELECT public.enter_table('review-concurrency-62','Cliente2','concurrency-62');
SQL
enter_pid=$!
wait "$move_pid" || { cat "$TMP/move.log"; exit 1; }
wait "$enter_pid" || { cat "$TMP/enter.log"; exit 1; }
P -c "SELECT t.is((SELECT count(*) FROM public.dining_tabs WHERE table_id='e1320000-0000-0000-0000-000000000062' AND status IN('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT')),1::bigint,'revisão corrida mudar/QR não cria conta concorrente nem perde dívida')" >/dev/null
P <<'SQL' >"$TMP/join.log" 2>&1 &
SET application_name='review-table-join';
SET statement_timeout='10s';
BEGIN;
SELECT public._salon_lock_tenant('10000000-0000-0000-0000-00000000000a');
SELECT pg_sleep(0.5);
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.staff_join_tables(ARRAY['e1320000-0000-0000-0000-000000000062'::uuid,'e1320000-0000-0000-0000-000000000063'::uuid],false);
COMMIT;
SQL
join_pid=$!
wait_locked review-table-join
P <<'SQL' >"$TMP/open.log" 2>&1 &
SET statement_timeout='10s';
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.staff_open_tab('e1320000-0000-0000-0000-000000000063');
SQL
open_pid=$!
wait "$join_pid" || { cat "$TMP/join.log"; exit 1; }
wait "$open_pid" || { cat "$TMP/open.log"; exit 1; }
P -c "SELECT t.is(public._salon_tab_for_table('e1320000-0000-0000-0000-000000000063'),'e1330000-0000-0000-0000-000000000061'::uuid,'revisão corrida juntar/abrir usa mesma conta agrupada')" >/dev/null
# A operação inversa esperada usa o mesmo mutex e não espera os locks na ordem oposta.
P <<'SQL' >"$TMP/join-forward.log" 2>&1 &
SET statement_timeout='10s'; SET ROLE authenticated; SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.staff_join_tables(ARRAY['e1320000-0000-0000-0000-000000000062'::uuid,'e1320000-0000-0000-0000-000000000063'::uuid],true);
SQL
forward_pid=$!
P <<'SQL' >"$TMP/join-reverse.log" 2>&1 &
SET statement_timeout='10s'; SET ROLE authenticated; SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.staff_join_tables(ARRAY['e1320000-0000-0000-0000-000000000063'::uuid,'e1320000-0000-0000-0000-000000000062'::uuid],true);
SQL
reverse_pid=$!
wait "$forward_pid" || { cat "$TMP/join-forward.log"; exit 1; }
wait "$reverse_pid" || { cat "$TMP/join-reverse.log"; exit 1; }
echo 'PASS: concorrência mudar/QR, juntar/abrir e junções em ordem inversa'

