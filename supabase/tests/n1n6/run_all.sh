#!/usr/bin/env bash
# Runner único dos testes SQL de N1–N6 em PostgreSQL LOCAL (nunca remoto).
# Uso: supabase/tests/n1n6/run_all.sh [strict|legacy|both]   (padrão: both)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Focused current-schema regression, independent of the historical N1–N6 fixtures.
if [ "${1:-}" = 'online-payment-gate' ]; then
  sh "$HERE/../online_payment_gate/run_regressions.sh" strict || exit $?
  exec sh "$HERE/../online_payment_gate/run_regressions.sh" legacy
fi
source "$HERE/harness/lib.sh"
set +e
MODES="${1:-both}"; [ "$MODES" = both ] && MODES="strict legacy"
SQL="$HERE/sql"
LOG_DIR="${N1N6_LOG_DIR:-/tmp/n1n6_logs}"; mkdir -p "$LOG_DIR"
TOTAL_PASS=0; TOTAL_FAIL=0
declare -A CAT_PASS CAT_FAIL

record() { # categoria, ok(0/1), nome
  local c="$1" ok="$2" n="$3"
  if [ "$ok" = 1 ]; then CAT_PASS[$c]=$(( ${CAT_PASS[$c]:-0} + 1 )); TOTAL_PASS=$((TOTAL_PASS+1));
  else CAT_FAIL[$c]=$(( ${CAT_FAIL[$c]:-0} + 1 )); TOTAL_FAIL=$((TOTAL_FAIL+1)); echo "  FALHOU [$c] $n"; fi
}

category_of() {
  case "$1" in
    10_*) echo "integridade_migracao";; 11_*) echo "pedidos_status_F5_F7";; 12_*) echo "pix_pagamento";;
    13_*) echo "pii_get_customer_order";; 14_*) echo "seed_F3";; 2[0-1]_*) echo "cupons";; 22_*) echo "checkout";;
    23_*) echo "pdv";; 3*) echo "storage_midia";; 4*) echo "carrossel_ofertas";; 5*) echo "campanhas_analytics";;
    6*) echo "vitrine_promocional";; 7*) echo "rls_multitenant";; 80_*) echo "concorrencia_real";;
    85_*) echo "estoque";; *) echo "outros";;
  esac
}

for MODE in $MODES; do
  DB="n1n6_test_$MODE"
  echo "=== MODO $MODE (banco $DB) ==="
  mkbase "$DB" "$MODE" || { record "build_$MODE" 0 "base 001–020"; continue; }
  P "$DB" -f "$SQL/01_legacy_data.sql" >/dev/null && P "$DB" -f "$SQL/02_snapshot.sql" >/dev/null || { record "build_$MODE" 0 "dados legados"; continue; }
  if apply_n_series "$DB" > "$LOG_DIR/apply_$MODE.log" 2>&1; then record "aplicacao_migrations" 1 "N1–N6 ($MODE)"; else record "aplicacao_migrations" 0 "N1–N6 ($MODE)"; cat "$LOG_DIR/apply_$MODE.log"; continue; fi
  P "$DB" -f "$SQL/00_framework.sql" >/dev/null && P "$DB" -f "$SQL/03_fixtures.sql" >/dev/null || { record "build_$MODE" 0 "fixtures"; continue; }
  for f in $(ls "$SQL"/[1-9]*.sql | sort); do
    b="$(basename "$f" .sql)"
    if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -c "SET t.suite = '$b'" -c "\\i $f" > "$LOG_DIR/${MODE}_$b.log" 2>&1; then
      P "$DB" -c "INSERT INTO t.results(suite,name,ok,detail) VALUES ('$b','arquivo abortou por erro inesperado',false,'ver $LOG_DIR/${MODE}_$b.log')" >/dev/null
      echo "  ERRO inesperado em $b ($MODE):"; tail -5 "$LOG_DIR/${MODE}_$b.log"
    fi
  done
  # Concorrência (conexões paralelas reais)
  if [ -x "$HERE/concurrency/run_concurrency.sh" ]; then
    "$HERE/concurrency/run_concurrency.sh" "$DB" > "$LOG_DIR/${MODE}_concurrency.log" 2>&1
  fi
  # Prechecks que abortam + ensaio de rollback N6→N1 + N1.V (bancos separados)
  while IFS='|' read -r st cat name detail; do
    case "$st" in OK) record "$cat" 1 "$MODE/$name";; FAIL) record "$cat" 0 "$MODE/$name — $detail";; esac
  done < <("$HERE/prechecks_and_rollback.sh" "$MODE" 2>"$LOG_DIR/${MODE}_prechecks_rollback.err")
  while IFS='|' read -r suite name ok; do
    [ -z "$suite" ] && continue
    record "$(category_of "$suite")" "$([ "$ok" = t ] && echo 1 || echo 0)" "$MODE/$suite: $name"
  done < <(psql -X -At -d "$DB" -c "SELECT suite, replace(name,'|','/'), ok FROM t.results ORDER BY id")
done

echo
echo "=== RESUMO POR CATEGORIA ==="
for c in $(printf '%s\n' "${!CAT_PASS[@]}" "${!CAT_FAIL[@]}" | sort -u); do
  printf '%-28s passou=%-4s falhou=%s\n' "$c" "${CAT_PASS[$c]:-0}" "${CAT_FAIL[$c]:-0}"
done
echo "TOTAL passou=$TOTAL_PASS falhou=$TOTAL_FAIL"
[ "$TOTAL_FAIL" -eq 0 ]
