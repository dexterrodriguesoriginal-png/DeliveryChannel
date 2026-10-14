#!/usr/bin/env bash
# Aplica a sequência oficial no projeto Supabase de STAGING (nunca produção).
#   verify  → estado real: projeto vazio (somente leitura)
#   base    → 001–020 (uma transação por migration + registro em supabase_migrations, como o CLI)
#   n1      → N1 (prechecks internos abortam se o estado não for exatamente 001–020)
#   n1v     → N1.V manual (supabase/manual/n1v_validate_constraints.sql), transação única
#   n2n6    → N2, N3, N4, N5, N6 (cada uma com seus prechecks)
#   post    → verificação pós-aplicação (somente leitura)
#   status  → lista versões registradas (somente leitura)
#   all     → verify, base, n1, n1v, n2n6, post
# DRY-RUN por padrão (só mostra o plano). Para executar: --execute + STAGING_CONFIRM=<ref>.
# Uso: scripts/staging/apply_staging.sh <etapa> [--execute]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/lib_guard.sh"
STAGE="${1:-}"; EXEC="${2:-}"
case "$STAGE" in verify|base|n1|n1v|n2n6|post|status|all) ;; *) echo "Uso: $0 verify|base|n1|n1v|n2n6|post|status|all [--execute]" >&2; exit 2;; esac
[ -z "$EXEC" ] || [ "$EXEC" = "--execute" ] || { echo "Argumento desconhecido: $EXEC" >&2; exit 2; }
sg_validate_env
MIG="$ROOT/supabase/migrations"
DRY=1; if [ "$EXEC" = "--execute" ]; then sg_require_confirm; DRY=0; fi
# Senha nunca na linha de comando visível: psql lê da própria URL; não ecoamos a URL.
export PGCONNECT_TIMEOUT=15 PGAPPNAME=deliverychannel-staging
PSQL=(psql "$STAGING_DB_URL" -X -q -v ON_ERROR_STOP=1)
echo "Alvo: projeto STAGING '$STAGING_PROJECT_REF' (modo: $([ $DRY = 1 ] && echo DRY-RUN || echo EXECUTAR))"

run() { # descrição, args psql...
  local d="$1"; shift
  if [ $DRY = 1 ]; then echo "[dry-run] $d"; return 0; fi
  echo ">> $d"; "${PSQL[@]}" "$@"
}
registered() { "${PSQL[@]}" -At -c "SELECT coalesce(string_agg(version, ' ' ORDER BY version),'') FROM supabase_migrations.schema_migrations" 2>/dev/null || true; }
expect_last() { # versão esperada como última registrada (estado real antes de cada etapa)
  [ $DRY = 1 ] && { echo "[dry-run] checar que a última versão registrada é ${1:-<nenhuma>}"; return 0; }
  local last; last="$(registered | awk '{print $NF}')"
  [ "$last" = "$1" ] || { echo "ABORTADO: última versão registrada='${last:-<nenhuma>}', esperado='${1:-<nenhuma>}'." >&2; exit 4; }
}
apply_file() { # arquivo de migration
  local f="$1" b v n; b="$(basename "$f")"; v="${b%%_*}"; n="${b#*_}"; n="${n%.sql}"
  run "migration $b (transação única + registro $v)" -1 -f "$f" \
    -c "INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('$v','$n')"
}
files_between() { local lo="$1" hi="$2" f b v; for f in $(ls "$MIG"/*.sql | sort); do b="$(basename "$f")"; v="${b%%_*}"; [ "$v" \> "$lo" ] && ! [ "$v" \> "$hi" ] && echo "$f"; done; return 0; }

do_verify() { run "verificação de estado real (projeto vazio)" -f "$HERE/sql/verify_empty.sql"; }
do_base() {
  expect_last ""
  run "criar controle supabase_migrations (igual ao CLI) se ausente" -c "CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text)"
  for f in $(files_between 00000000000000 20260929000020); do apply_file "$f"; done
  expect_last 20260929000020
}
do_n1()  { expect_last 20260929000020; apply_file "$(ls "$MIG"/20261006000100_*.sql)"; }
do_n1v() { expect_last 20261006000100; run "N1.V manual (validação de constraints)" -1 -f "$ROOT/supabase/manual/n1v_validate_constraints.sql"; }
do_n2n6() {
  expect_last 20261006000100
  for f in $(files_between 20261006000100 20261006000600); do apply_file "$f"; done
  expect_last 20261006000600
}
do_post() { run "verificação pós-aplicação" -f "$HERE/sql/verify_post.sql"; }

case "$STAGE" in
  verify) do_verify;; base) do_base;; n1) do_n1;; n1v) do_n1v;; n2n6) do_n2n6;; post) do_post;;
  status) [ $DRY = 1 ] && echo "[dry-run] listar versões" || registered;;
  all) do_verify; do_base; do_n1; do_n1v; do_n2n6; do_post;;
esac
echo "Concluído: $STAGE ($([ $DRY = 1 ] && echo 'DRY-RUN — nada foi executado' || echo executado))."
