#!/bin/sh
# Conexões reais: QR concorrente e desativação da permissão enquanto há aprovação pendente.
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
unset PGPASSWORD PGHOSTADDR PGSERVICE PGSERVICEFILE DATABASE_URL SUPABASE_DB_URL || true
case "${1:-}" in entrega1_4_*_run) DB="$1" ;; *) echo 'Disposable entrega1_4 database required' >&2; exit 2 ;; esac
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
P() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
P <<'SQL' >/dev/null
RESET ROLE; SELECT t.login(NULL);
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token) SELECT ('e1420000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-0000-0000-00000000000a','Concorrência 1.4 '||n,'entrega14-concurrency-'||n FROM generate_series(201,204) n;
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,responsible_user_id) SELECT ('e1430000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-0000-0000-00000000000a','TABLE',('e1420000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'e1310000-0000-0000-0000-000000000001' FROM unnest(ARRAY[201,203]) n;
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at) SELECT ('e1440000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-0000-0000-00000000000a',('e1430000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'e1310000-0000-0000-0000-000000000001','Cliente','entrega14-concurrency-'||n,now() FROM unnest(ARRAY[201,203]) n;
INSERT INTO public.waiter_table_assignments(tenant_id,table_id,waiter_id) VALUES('10000000-0000-0000-0000-00000000000a','e1420000-0000-0000-0000-000000000203','e1310000-0000-0000-0000-000000000002');
SET ROLE authenticated; SELECT t.login('e1310000-0000-0000-0000-000000000001');
SELECT public.customer_move_table('e1440000-0000-0000-0000-000000000201','e1420000-0000-0000-0000-000000000202');
SELECT public.customer_move_table('e1440000-0000-0000-0000-000000000203','e1420000-0000-0000-0000-000000000204');
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.set_waiter_table_move_approval('10000000-0000-0000-0000-00000000000a',true);
SQL
wait_locked() {
 i=0
 while [ "$(P -At -c "SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE a.application_name='$1' AND l.locktype='advisory' AND l.granted)")" != t ]; do
  i=$((i+1)); [ "$i" -lt 100 ] || { echo 'Não observou mutex da conexão A' >&2; return 1; }
 done
}
P <<'SQL' >"$TMP/approve.log" 2>&1 &
SET application_name='entrega14-approve'; SET statement_timeout='10s';
BEGIN;
SELECT public._salon_lock_tenant('10000000-0000-0000-0000-00000000000a');
SELECT pg_sleep(0.5);
SET ROLE authenticated; SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.resolve_table_move_request((SELECT id FROM public.table_move_requests WHERE tab_id='e1430000-0000-0000-0000-000000000201' AND status='PENDING'),true);
COMMIT;
SQL
approve_pid=$!
wait_locked entrega14-approve
P <<'SQL' >"$TMP/enter.log" 2>&1 &
SET statement_timeout='10s'; SET ROLE authenticated; SELECT t.login('e1310000-0000-0000-0000-000000000004');
SELECT public.enter_table('entrega14-concurrency-202','Cliente2','entrega14-enter-202');
SQL
enter_pid=$!
wait "$approve_pid" || { cat "$TMP/approve.log"; exit 1; }
wait "$enter_pid" || { cat "$TMP/enter.log"; exit 1; }
P <<'SQL' >/dev/null
SELECT t.is((SELECT count(*) FROM public.dining_tabs WHERE table_id='e1420000-0000-0000-0000-000000000202' AND status IN('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT')),1::bigint,'1.4.1 corrida autorização/QR mantém uma única conta');
SELECT t.is(public._salon_tab_for_table('e1420000-0000-0000-0000-000000000202'),'e1430000-0000-0000-0000-000000000201'::uuid,'1.4.1 QR concorrente usa a conta autorizada sem perder dívida');
SQL
P <<'SQL' >"$TMP/disable.log" 2>&1 &
SET application_name='entrega14-disable'; SET statement_timeout='10s';
BEGIN;
SELECT public._salon_lock_tenant('10000000-0000-0000-0000-00000000000a');
SELECT pg_sleep(0.5);
SET ROLE authenticated; SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.set_waiter_table_move_approval('10000000-0000-0000-0000-00000000000a',false);
COMMIT;
SQL
disable_pid=$!
wait_locked entrega14-disable
P <<'SQL' >"$TMP/waiter.log" 2>&1 &
SET statement_timeout='10s';
SELECT id AS pending FROM public.table_move_requests WHERE tab_id='e1430000-0000-0000-0000-000000000203' AND status='PENDING' \gset
SET ROLE authenticated; SELECT t.login('e1310000-0000-0000-0000-000000000002');
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'pending'),'FORBIDDEN','1.4.1 corrida dono desativa/garçom autoriza revalida permissão após mutex');
SQL
waiter_pid=$!
wait "$disable_pid" || { cat "$TMP/disable.log"; exit 1; }
wait "$waiter_pid" || { cat "$TMP/waiter.log"; exit 1; }
P <<'SQL' >/dev/null
SELECT t.is((SELECT table_id FROM public.dining_tabs WHERE id='e1430000-0000-0000-0000-000000000203'),'e1420000-0000-0000-0000-000000000203'::uuid,'1.4.1 revogação concorrente impede movimento');
SELECT t.is((SELECT status FROM public.table_move_requests WHERE tab_id='e1430000-0000-0000-0000-000000000203'),'PENDING','1.4.1 revogação concorrente mantém solicitação para dono');
SQL
echo 'PASS: concorrência aprovação/QR e revogação/aprovação do garçom'
