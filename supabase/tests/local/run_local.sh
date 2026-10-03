#!/usr/bin/env bash
# Executa a suíte SQL dos cards promocionais em um PostgreSQL LOCAL (nunca em produção).
#
# Uso:
#   supabase/tests/local/run_local.sh fresh    # banco novo: stubs + 001..027 + testes
#   supabase/tests/local/run_local.sh upgrade  # banco com 001..026 + dados legados, aplica 027 por cima + testes
#
# Variáveis: PGHOST/PGPORT/PGUSER (padrão do psql), DB (padrão dc_cards_<modo>).
# Modo "strict": sem privilégios padrão extras. Defina LEGACY_DEFAULT_PRIVS=1 para simular os
# privilégios padrão de um projeto Supabase (GRANT ALL em tabelas/funções novas para anon/authenticated).
set -euo pipefail
MODE="${1:-fresh}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIG="$ROOT/supabase/migrations"
DB="${DB:-dc_cards_${MODE}}"
FIX_MIG="20261003000027"

psql_db() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb "$DB"
psql_db -f "$HERE/supabase_stubs.sql" >/dev/null
if [ "${LEGACY_DEFAULT_PRIVS:-0}" = "1" ]; then
  psql_db -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;"
fi

apply_range() { # $1 = "lt" (antes da 027) ou "all"
  for f in $(ls "$MIG"/*.sql | sort); do
    b="$(basename "$f")"; p="${b%%_*}"
    if [ "$1" = "lt" ] && [ ! "$p" \< "$FIX_MIG" ]; then continue; fi
    psql_db -f "$f" >/dev/null 2>"$DB.$b.err" || { echo "FALHOU: $b"; cat "$DB.$b.err"; exit 1; }
    rm -f "$DB.$b.err"
    echo "aplicada: $b"
  done
}

if [ "$MODE" = "fresh" ]; then
  apply_range all
elif [ "$MODE" = "upgrade" ]; then
  apply_range lt
  echo "== estado legado (001..026) + dados pré-existentes"
  psql_db -f "$HERE/legacy_state_before_027.sql"
  echo "== aplicando $FIX_MIG por cima de 001..026"
  psql_db -f "$MIG/${FIX_MIG}_fix_promotional_cards_public_store.sql"
  psql_db -f "$HERE/legacy_state_after_027.sql"
else
  echo "modo inválido: $MODE"; exit 2
fi

echo "== suíte de testes"
psql -X -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/tests/promotional_cards_public_store.test.sql"
