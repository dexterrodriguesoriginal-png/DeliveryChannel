#!/bin/sh
# Garçom v3 — SQL regression on a DISPOSABLE LOCAL PostgreSQL.
#  1) base = migrations até 20261027004900 + fixtures
#  2) aplica 20261027005000 e roda garcom_v3.sql
#  3) rollback exato + reaplicação limpa
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
unset PGPASSWORD DATABASE_URL SUPABASE_DB_URL || true

if ! psql -X -q -c "SELECT 1" postgres >/dev/null 2>&1; then
  PG_BIN="/usr/lib/postgresql/17/bin"
  export PGHOST="/tmp/pg_gv3_sock"
  export PGUSER="postgres"
  mkdir -p "$PGHOST"
  if [ ! -f "/tmp/pg_gv3_data/PG_VERSION" ]; then
    "$PG_BIN/initdb" -D /tmp/pg_gv3_data -U postgres --auth=trust >/dev/null
  fi
  rm -f /tmp/pg_gv3_data/postmaster.pid "$PGHOST"/.s.PGSQL.*
  "$PG_BIN/pg_ctl" -D /tmp/pg_gv3_data -l /tmp/pg_gv3.log -o "-k $PGHOST -h ''" start >/dev/null
  trap '"$PG_BIN/pg_ctl" -D /tmp/pg_gv3_data stop >/dev/null 2>&1 || true' EXIT
fi

HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE/../../.."
SQLDIR=supabase/tests/n1n6/sql
MIG=supabase/migrations/20261027005000_garcom_v3_bill_flow_and_kds_tracking.sql
DOWN=supabase/rollback/20261027005000_garcom_v3_bill_flow_and_kds_tracking_down.sql
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
STATUS=0

INCLUDE_4600=1 sh supabase/tests/mesas_qr/build_base.sh gv3_fx >/dev/null 2>&1
P -d gv3_fx -1 -f supabase/migrations/20261027004700_mesas_access.sql >/dev/null
P -d gv3_fx -1 -f supabase/migrations/20261027004800_mesas_holder_lock_empty_cancel_waiter_rls.sql >/dev/null
P -d gv3_fx -1 -f supabase/migrations/20261027004900_garcom_v2_login_modes_tracking.sql >/dev/null
P -d gv3_fx -f $SQLDIR/00_framework.sql >/dev/null
sed '2,3d' $SQLDIR/03_fixtures.sql > /tmp/gv3_fixtures.sql
P -d gv3_fx -f /tmp/gv3_fixtures.sql >/dev/null

dropdb --if-exists gv3_run >/dev/null 2>&1; createdb -T gv3_fx gv3_run
P -d gv3_run -1 -f $MIG
P -d gv3_run -c "SET t.suite = 'garcom_v3'" -f "$HERE/garcom_v3.sql" > /tmp/gv3_suite.log 2>&1 || { echo 'ERRO na suíte garcom_v3'; tail -12 /tmp/gv3_suite.log; STATUS=1; }
psql -X -At -d gv3_run -c "SELECT 'FALHOU: '||name||' — '||COALESCE(detail,'') FROM t.results WHERE NOT ok ORDER BY id"
psql -X -At -d gv3_run -c "SELECT 'garcom_v3: ' || count(*) FILTER (WHERE ok) || ' passou, ' || count(*) FILTER (WHERE NOT ok) || ' falhou' FROM t.results"
[ "$(psql -X -At -d gv3_run -c 'SELECT count(*) FROM t.results WHERE NOT ok')" = 0 ] || STATUS=1

# Rollback exato
dropdb --if-exists gv3_rb >/dev/null 2>&1; createdb -T gv3_fx gv3_rb
P -d gv3_rb -1 -f $MIG
P -d gv3_rb -1 -f $DOWN
chk() { [ "$1" = "$2" ] || { echo "FALHOU rollback: $3"; diff -u /tmp/gv3_fhr.txt /tmp/gv3_fh.txt 2>/dev/null || true; STATUS=1; }; }
fh() { psql -X -At -d gv3_rb -c "SELECT proname || ' ' || prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY proname" > /tmp/gv3_fh.txt; psql -X -At -d gv3_rb -c "SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY oid::regprocedure::text)) FROM pg_proc WHERE pronamespace='public'::regnamespace"; }
dropdb --if-exists gv3_ref >/dev/null 2>&1; createdb -T gv3_fx gv3_ref
fhr() { psql -X -At -d gv3_ref -c "SELECT proname || ' ' || prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY proname" > /tmp/gv3_fhr.txt; psql -X -At -d gv3_ref -c "SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY oid::regprocedure::text)) FROM pg_proc WHERE pronamespace='public'::regnamespace"; }
chk "$(fhr)" "$(fh)" 'funções diferem do estado anterior'
tr_() { psql -X -At -d "$1" -c "SELECT md5(string_agg(tgrelid::regclass||tgname,',' ORDER BY tgrelid::regclass::text,tgname)) FROM pg_trigger WHERE NOT tgisinternal"; }
po_() { psql -X -At -d "$1" -c "SELECT md5(string_agg(tablename||':'||policyname||':'||coalesce(qual,''),'|' ORDER BY tablename,policyname)) FROM pg_policies WHERE schemaname='public'"; }
co_() { psql -X -At -d "$1" -c "SELECT md5(string_agg(table_name||'.'||column_name||':'||data_type,',' ORDER BY table_name,column_name)) FROM information_schema.columns WHERE table_schema='public'"; }
chk "$(tr_ gv3_ref)" "$(tr_ gv3_rb)" 'gatilhos diferem'
chk "$(po_ gv3_ref)" "$(po_ gv3_rb)" 'policies diferem'
chk "$(co_ gv3_ref)" "$(co_ gv3_rb)" 'colunas/tabelas diferem'
P -d gv3_rb -1 -f $MIG || { echo 'FALHOU reaplicação'; STATUS=1; }
P -d gv3_rb -1 -f $DOWN || { echo 'FALHOU segundo rollback'; STATUS=1; }
chk "$(fhr)" "$(fh)" 'segundo rollback alterou funções'

for d in gv3_fx gv3_run gv3_rb gv3_ref; do dropdb --if-exists $d >/dev/null 2>&1; done
[ $STATUS = 0 ] && echo 'PASS: garcom_v3 (suíte, rollback exato, reaplicação)' || echo 'FAIL'
exit $STATUS
