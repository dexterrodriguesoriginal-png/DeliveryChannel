#!/usr/bin/env bash
# Autoteste da guarda de quarentena: roda a guarda numa CÓPIA temporária do repositório com
# violações simuladas. Não conecta em banco nem em Supabase.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
pass=0; failn=0
check() { # nome, esperado(0|1), preparo
  local tmp; tmp="$(mktemp -d)"
  mkdir -p "$tmp/scripts/ci" "$tmp/.github/workflows"
  cp -r "$ROOT/supabase" "$tmp/"
  cp "$ROOT/scripts/ci/check_migration_quarantine.sh" "$tmp/scripts/ci/"
  cp "$ROOT"/.github/workflows/*.yml "$tmp/.github/workflows/" 2>/dev/null || true
  ( cd "$tmp" && eval "$3" )
  bash "$tmp/scripts/ci/check_migration_quarantine.sh" >/dev/null 2>&1; local rc=$?
  local got=$([ $rc -eq 0 ] && echo 0 || echo 1)
  if [ "$got" = "$2" ]; then echo "OK|guarda_ci|$1"; pass=$((pass+1)); else echo "FAIL|guarda_ci|$1|exit=$rc"; failn=$((failn+1)); fi
  rm -rf "$tmp"
}
Q=supabase/migrations_quarantine; M=supabase/migrations
check "repositório atual passa" 0 ":"
check "022 devolvida com o mesmo nome falha" 1 "cp $Q/20261002000022_*.sql $M/"
check "023 com outro nome/versão (mesmo sha256) falha" 1 "cp $Q/20261003000023_*.sql $M/20261107000700_nova.sql"
check "024 com espaços alterados (conteúdo equivalente) falha" 1 "sed 's/  */ /g; s/\$/  /' $Q/20261003000024_*.sql > $M/20261107000800_x.sql"
check "versão no intervalo 021–027 com outro nome falha" 1 "echo 'select 1;' > $M/20261003000025_qualquer.sql"
check "nome de migration em quarentena com outra versão falha" 1 "echo 'select 1;' > $M/20261107000900_promotional_cards_own_checkout.sql"
check "apagar arquivo da quarentena falha" 1 "rm $Q/20261002000021_*.sql"
check "README da quarentena ausente falha" 1 "rm $Q/README.md"
check "rollback dentro de supabase/migrations falha" 1 "cp supabase/rollback/n6_rollback.sql $M/20261107001000_n6_rollback.sql"
check "workflow com 'supabase db push' falha" 1 "printf 'on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: supabase db push\n' > .github/workflows/deploy.yml"
check "workflow com 'supabase link' falha" 1 "printf 'on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: supabase link --project-ref abc\n' > .github/workflows/l.yml"
check "20261014000027 devolvida com o mesmo nome falha" 1 "cp $Q/20261014000027_*.sql $M/"
check "20261014000027 com outro nome/versão (mesmo sha256) falha" 1 "cp $Q/20261014000027_*.sql $M/20261107001100_outra.sql"
check "versão 20261014000027 com outro nome falha" 1 "echo 'select 1;' > $M/20261014000027_qualquer.sql"
echo "guarda_ci: passou=$pass falhou=$failn"
[ "$failn" -eq 0 ]
