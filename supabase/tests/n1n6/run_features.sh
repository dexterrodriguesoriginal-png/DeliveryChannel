#!/usr/bin/env bash
# Appended suites 80–84 run at their own historical migration window.
# The N1–N6 rollback rehearsal intentionally excludes these later migrations.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/harness/lib.sh"
MODE="${1:-strict}"
case "$MODE" in strict|legacy) ;; *) exit 2 ;; esac
DB="n1n6_features_${MODE}_$$"
LOG_DIR="${N1N6_LOG_DIR:-/tmp/n1n6_logs}"
mkdir -p "$LOG_DIR"
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
build() {
  # Old prechecks 0700/0800 require strict predecessor ACLs. Apply legacy defaults
  # only when reaching the later feature under test, as focused suites do.
  mkbase "$DB" strict
  P "$DB" -f "$HERE/sql/01_legacy_data.sql" >/dev/null
  for f in "$MIG_DIR"/*.sql; do
    b="${f##*/}"; v="${b%%_*}"
    [ "$v" \> '20260929000020' ] || continue
    [ "$v" \< '20261019002400' ] || continue
    apply_migration "$DB" "$f"
  done
  P "$DB" -f "$HERE/sql/00_framework.sql" >/dev/null
  # This fixture predates approval_status; its synthetic available driver is approved.
  P "$DB" -c "ALTER TABLE public.drivers ALTER COLUMN approval_status SET DEFAULT 'APPROVED'" >/dev/null
  P "$DB" -f "$HERE/sql/03_fixtures.sql" >/dev/null
  P "$DB" -c "ALTER TABLE public.drivers ALTER COLUMN approval_status SET DEFAULT 'PENDING'" >/dev/null
  if [ "$MODE" = legacy ]; then
    P "$DB" -c 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role' >/dev/null
  fi
}
if ! build >"$LOG_DIR/${MODE}_features_build.log" 2>&1; then
  echo "FAIL|feature_build|$MODE/fixtures de operação|ver ${MODE}_features_build.log"
  exit 1
fi
for pair in 80:20261019002400 81:20261019002500 82:20261019002600 83:20261019002700 84:20261020002800; do
  test_prefix="${pair%%:*}"; migration_prefix="${pair#*:}"
  migration=("$MIG_DIR/${migration_prefix}_"*.sql)
  test_file=("$HERE/sql/${test_prefix}_"*.sql)
  suite="$(basename "${test_file[0]}" .sql)"
  if ! apply_migration "$DB" "${migration[0]}" >"$LOG_DIR/${MODE}_${suite}_apply.log" 2>&1; then
    echo "FAIL|feature_build|$MODE/$suite migration|ver ${MODE}_${suite}_apply.log"
    exit 1
  fi
  if ! P "$DB" -c "SET t.suite='$suite'" -f "${test_file[0]}" >"$LOG_DIR/${MODE}_${suite}.log" 2>&1; then
    P "$DB" -c "INSERT INTO t.results(suite,name,ok,detail) VALUES('$suite','arquivo abortou por erro inesperado',false,'ver ${MODE}_${suite}.log')" >/dev/null
  fi
done
# Later expectations formerly mixed into N1 files remain verified after 3500/4300.
for f in "$MIG_DIR"/*.sql; do
  b="${f##*/}"; v="${b%%_*}"
  [ "$v" \> '20261020002800' ] || continue
  [ "$v" \> '20261026004300' ] && continue
  if ! apply_migration "$DB" "$f" >>"$LOG_DIR/${MODE}_later_guards_apply.log" 2>&1; then
    echo "FAIL|feature_build|$MODE/later guards migration|ver ${MODE}_later_guards_apply.log"
    exit 1
  fi
done
if ! P "$DB" -c "SET t.suite='87_later_guards'" -f "$HERE/sql/87_later_guards.sql" >"$LOG_DIR/${MODE}_87_later_guards.log" 2>&1; then
  P "$DB" -c "INSERT INTO t.results(suite,name,ok,detail) VALUES('87_later_guards','arquivo abortou por erro inesperado',false,'ver ${MODE}_87_later_guards.log')" >/dev/null
fi
psql -X -At -d "$DB" -c "SELECT CASE WHEN ok THEN 'OK' ELSE 'FAIL' END||'|operacao_modulos|'||replace(name,'|','/')||'|$MODE/'||suite||' '||coalesce(replace(detail,'|','/'),'') FROM t.results ORDER BY id"
[ "$(psql -X -At -d "$DB" -c 'SELECT count(*) FROM t.results WHERE NOT ok')" = 0 ]

