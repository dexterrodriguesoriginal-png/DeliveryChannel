#!/usr/bin/env bash
# Integração REAL do frontend com PostgreSQL LOCAL + PostgREST LOCAL (nunca remoto; sem supabase link).
# Cria dois bancos sintéticos:
#   fe_legacy : migrations 001–020 (estado atual de produção) + dados sintéticos
#   fe_n1n6   : 001–020 + N1–N6 + fixtures de teste
# e sobe um PostgREST para cada um (portas 54321 e 54322), com JWT HS256 de teste.
# Conexão: usuário local do Postgres de teste; o PostgREST troca para anon/authenticated (SET ROLE) por requisição.
# Uso: tests/integration/setup_local_backend.sh [/caminho/postgrest]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
N1N6="$ROOT/supabase/tests/n1n6"
source "$N1N6/harness/lib.sh"
PGRST="${1:-${POSTGREST_BIN:-postgrest}}"
SECRET="${FE_IT_JWT_SECRET:-local-integration-secret-only-for-tests-0123456789}"

# Supabase concede privilégios padrão a anon/authenticated (modo "legacy" do harness = igual à produção).
mkbase fe_legacy legacy
P fe_legacy -f "$N1N6/sql/01_legacy_data.sql" >/dev/null

mkbase fe_n1n6 legacy
P fe_n1n6 -f "$N1N6/sql/01_legacy_data.sql" >/dev/null
apply_n_series fe_n1n6 >/dev/null
P fe_n1n6 -f "$N1N6/sql/00_framework.sql" >/dev/null 2>&1
P fe_n1n6 -f "$N1N6/sql/03_fixtures.sql" >/dev/null

for db in fe_legacy fe_n1n6; do
  P "$db" -c "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOINHERIT LOGIN; END IF; END\$\$;" \
          -c "GRANT anon, authenticated TO authenticator;" >/dev/null
done

start() { # db porta
  cat > "/tmp/pgrst_$1.conf" <<CONF
db-uri = "postgres://${PGUSER:-$(whoami)}@/$1?host=/var/run/postgresql"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = $2
CONF
  pkill -f "pgrst_$1.conf" 2>/dev/null || true
  nohup "$PGRST" "/tmp/pgrst_$1.conf" > "/tmp/pgrst_$1.log" 2>&1 &
}
start fe_legacy 54321
start fe_n1n6 54322
for p in 54321 54322; do
  for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$p/" >/dev/null && break; sleep 0.2; done
  curl -sf "http://127.0.0.1:$p/" >/dev/null || { echo "PostgREST na porta $p não subiu" >&2; exit 1; }
done
echo "OK: fe_legacy=http://127.0.0.1:54321 fe_n1n6=http://127.0.0.1:54322"
