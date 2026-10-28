#!/bin/sh
# Garçom v2 — SQL regression on a DISPOSABLE LOCAL PostgreSQL (nunca aplica em banco real).
#  1) base = migrations até 20261027004600 + 4700 + 4800 + fixtures N1–N6
#  2) aplica 20261027004900 e roda garcom_v2.sql
#  3) rollback exato (md5 de funções/gatilhos/policies/colunas pré-existentes e contagem de dados) + reaplicação limpa
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
unset PGPASSWORD DATABASE_URL SUPABASE_DB_URL || true

if ! psql -X -q -c "SELECT 1" postgres >/dev/null 2>&1; then
  PG_BIN="/usr/lib/postgresql/17/bin"
  export PGHOST="/tmp/pg_gv2_sock"
  export PGUSER="postgres"
  mkdir -p "$PGHOST"
  if [ ! -f "/tmp/pg_gv2_data/PG_VERSION" ]; then
    "$PG_BIN/initdb" -D /tmp/pg_gv2_data -U postgres --auth=trust >/dev/null
  fi
  rm -f /tmp/pg_gv2_data/postmaster.pid "$PGHOST"/.s.PGSQL.*
  "$PG_BIN/pg_ctl" -D /tmp/pg_gv2_data -l /tmp/pg_gv2.log -o "-k $PGHOST -h ''" start >/dev/null
  trap '"$PG_BIN/pg_ctl" -D /tmp/pg_gv2_data stop >/dev/null 2>&1 || true' EXIT
fi

HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE/../../.."
SQLDIR=supabase/tests/n1n6/sql
MIG=supabase/migrations/20261027004900_garcom_v2_login_modes_tracking.sql
DOWN=supabase/rollback/20261027004900_garcom_v2_login_modes_tracking_down.sql
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
STATUS=0

INCLUDE_4600=1 sh supabase/tests/mesas_qr/build_base.sh gv2_fx >/dev/null 2>&1
P -d gv2_fx -1 -f supabase/migrations/20261027004700_mesas_access.sql >/dev/null
P -d gv2_fx -1 -f supabase/migrations/20261027004800_mesas_holder_lock_empty_cancel_waiter_rls.sql >/dev/null
P -d gv2_fx -f $SQLDIR/00_framework.sql >/dev/null
sed '2,3d' $SQLDIR/03_fixtures.sql > /tmp/gv2_fixtures.sql
P -d gv2_fx -f /tmp/gv2_fixtures.sql >/dev/null
# Stub do Storage do Supabase: bloqueia DELETE direto como storage.protect_delete() faz em produção.
P -d gv2_fx >/dev/null <<'SQL'
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text);
CREATE OR REPLACE FUNCTION storage.protect_delete() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'; END $f$;
DROP TRIGGER IF EXISTS protect_buckets_delete ON storage.buckets;
CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
DROP TRIGGER IF EXISTS protect_objects_delete ON storage.objects;
CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
SQL

dropdb --if-exists gv2_run >/dev/null 2>&1; createdb -T gv2_fx gv2_run
P -d gv2_run -1 -f $MIG
P -d gv2_run -c "SET t.suite = 'garcom_v2'" -f "$HERE/garcom_v2.sql" > /tmp/gv2_suite.log 2>&1 || { echo 'ERRO na suíte garcom_v2'; tail -12 /tmp/gv2_suite.log; STATUS=1; }
psql -X -At -d gv2_run -c "SELECT 'FALHOU: '||name||' — '||COALESCE(detail,'') FROM t.results WHERE NOT ok ORDER BY id"
psql -X -At -d gv2_run -c "SELECT 'garcom_v2: ' || count(*) FILTER (WHERE ok) || ' passou, ' || count(*) FILTER (WHERE NOT ok) || ' falhou' FROM t.results"
[ "$(psql -X -At -d gv2_run -c 'SELECT count(*) FROM t.results WHERE NOT ok')" = 0 ] || STATUS=1

# Rollback exato (sem os dados criados pela suíte: usa um clone limpo com a migration aplicada)
dropdb --if-exists gv2_rb >/dev/null 2>&1; createdb -T gv2_fx gv2_rb
P -d gv2_rb -1 -f $MIG
P -d gv2_rb -1 -f $DOWN
chk() { [ "$1" = "$2" ] || { echo "FALHOU rollback: $3"; STATUS=1; }; }
fh() { psql -X -At -d gv2_rb -c "SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY oid::regprocedure::text)) FROM pg_proc WHERE pronamespace='public'::regnamespace"; }
dropdb --if-exists gv2_ref >/dev/null 2>&1; createdb -T gv2_fx gv2_ref
fhr() { psql -X -At -d gv2_ref -c "SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY oid::regprocedure::text)) FROM pg_proc WHERE pronamespace='public'::regnamespace"; }
chk "$(fhr)" "$(fh)" 'funções diferem do estado anterior (md5 pg_get_functiondef+proacl, inclui handle_waiter_call original)'
tr_() { psql -X -At -d "$1" -c "SELECT md5(string_agg(tgrelid::regclass||tgname,',' ORDER BY tgrelid::regclass::text,tgname)) FROM pg_trigger WHERE NOT tgisinternal"; }
po_() { psql -X -At -d "$1" -c "SELECT md5(string_agg(tablename||':'||policyname||':'||coalesce(qual,''),'|' ORDER BY tablename,policyname)) FROM pg_policies WHERE schemaname='public'"; }
co_() { psql -X -At -d "$1" -c "SELECT md5(string_agg(table_name||'.'||column_name||':'||data_type,',' ORDER BY table_name,column_name)) FROM information_schema.columns WHERE table_schema='public'"; }
chk "$(tr_ gv2_ref)" "$(tr_ gv2_rb)" 'gatilhos diferem'
chk "$(po_ gv2_ref)" "$(po_ gv2_rb)" 'policies diferem'
chk "$(co_ gv2_ref)" "$(co_ gv2_rb)" 'colunas/tabelas diferem'
P -d gv2_rb -1 -f $MIG || { echo 'FALHOU reaplicação'; STATUS=1; }
P -d gv2_rb -1 -f $DOWN || { echo 'FALHOU segundo rollback'; STATUS=1; }
chk "$(fhr)" "$(fh)" 'segundo rollback alterou funções'
chk "$(psql -X -At -d gv2_rb -c "SELECT count(*) FROM storage.buckets WHERE id='waiter-photos'")" 1 'rollback deveria manter o bucket waiter-photos (Storage API)'
grep -Eiq 'DELETE[[:space:]]+FROM[[:space:]]+storage\.' $DOWN && { echo 'FALHOU: rollback contém DELETE direto em storage.*'; STATUS=1; }

for d in gv2_fx gv2_run gv2_rb gv2_ref; do dropdb --if-exists $d >/dev/null 2>&1; done
[ $STATUS = 0 ] && echo 'PASS: garcom_v2 (suíte, rollback exato, reaplicação)' || echo 'FAIL'
exit $STATUS
