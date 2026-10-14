#!/usr/bin/env bash
# Funções comuns do harness LOCAL. Conecta SOMENTE no PostgreSQL local (socket /var/run/postgresql).
# Recusa qualquer PGHOST remoto.
set -euo pipefail
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Recusado: PGHOST=$PGHOST não é local. Este harness só roda em PostgreSQL local." >&2; exit 2;;
esac
unset PGPASSWORD DATABASE_URL SUPABASE_DB_URL || true
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
N1N6_DIR="$(cd "$HARNESS_DIR/.." && pwd)"
REPO_ROOT="$(cd "$N1N6_DIR/../../.." && pwd)"
MIG_DIR="$REPO_ROOT/supabase/migrations"
P() { psql -X -q -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }

# Cria banco no estado 001–020 (como produção), registrando versões como o Supabase CLI.
# $1 = db, $2 = strict|legacy
mkbase() {
  local db="$1" mode="$2"
  dropdb --if-exists "$db" >/dev/null 2>&1 || true
  createdb "$db"
  P "$db" -f "$HARNESS_DIR/00_supabase_stubs.sql" >/dev/null
  if [ "$mode" = "legacy" ]; then
    P "$db" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;" >/dev/null
  fi
  local f b v
  for f in $(ls "$MIG_DIR"/*.sql | sort); do
    b="$(basename "$f")"; v="${b%%_*}"
    [ "$v" \> "20260929000020" ] && continue
    apply_migration "$db" "$f"
  done
}

# Aplica um arquivo de migration em transação única e registra a versão (como o CLI).
apply_migration() {
  local db="$1" f="$2" b v n
  b="$(basename "$f")"; v="${b%%_*}"; n="${b#*_}"; n="${n%.sql}"
  P "$db" -1 -f "$f" >/dev/null 2>"/tmp/n1n6_apply_$$.err" || { echo "FALHOU ao aplicar $b:"; cat "/tmp/n1n6_apply_$$.err"; return 1; }
  P "$db" -c "INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('$v','$n')" >/dev/null
}

# Aplica as migrations N1–N6 (versões > 020)
apply_n_series() {
  local db="$1" upto="${2:-99999999999999}" f b v
  for f in $(ls "$MIG_DIR"/*.sql | sort); do
    b="$(basename "$f")"; v="${b%%_*}"
    [ "$v" \> "20260929000020" ] || continue
    [ "$v" \> "$upto" ] && continue
    apply_migration "$db" "$f"
  done
}
