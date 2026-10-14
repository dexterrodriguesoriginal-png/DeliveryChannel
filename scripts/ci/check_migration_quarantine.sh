#!/usr/bin/env bash
# Guarda de CI: impede que as migrations legadas 021–027 (não aplicadas em produção), incluindo
# 20261014000027_promo_card_attribution_integrity (substituída pelo N5), voltem para supabase/migrations.
# NÃO conecta em banco nem em Supabase. Só inspeciona arquivos do repositório.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$ROOT/supabase/migrations"
QUA="$ROOT/supabase/migrations_quarantine"
fail=0
err() { echo "ERRO: $*" >&2; fail=1; }

# Nomes (sufixo após a versão) das migrations em quarentena
NAMES="tenant_default_prep_time promotional_carousels_and_coupons promotional_cards_media_and_atomic_coupons promotional_cards_scheduling_datetime campaigns_cards_analytics_attribution promotional_cards_own_checkout fix_promotional_cards_public_store promo_card_attribution_integrity"
# sha256 exatos dos arquivos 021–027
HASHES="faf24437324bc05fb978d1a963620c7793781c2547bcafe109397570e44daf84 d5ceca5fbbbefa09bb71f8eb5a2ec0723d0a8caadd3cd5a8f9ba7f9f1ec16f68 addf08014729e3cb59f3ae415cc663da91faa77041385c75794152fa4de396c1 d1e93b3c41f6cf2b3fbc7483c4049fa5b3cfccd7d9f4f0af76c8bed7bb4ab495 e356bf28b30650c4baf3ec92252b202b9ef3f3caa5f0e7b5a1b239bc6d171496 5d7390ba128605bad7ff03524625909c12ef110251447e2d36f991acf03318ed 4d562297897018ed6290883ae6e4b0f9c09f1fb08c674461579e5e2611a39666 475c464b4efef85e5a8bba290b663713c09da862949fb3f33fd76da4f9c9dc90"

norm_hash() { tr -d ' \t\r\n' < "$1" | sha256sum | cut -d' ' -f1; }

# hashes normalizados (sem espaços) dos arquivos em quarentena presentes
QNORM=""
for q in "$QUA"/*.sql; do [ -f "$q" ] && QNORM="$QNORM $(norm_hash "$q")"; done

shopt -s nullglob
for f in "$MIG"/*.sql; do
  b="$(basename "$f")"; v="${b%%_*}"; name="${b#*_}"; name="${name%.sql}"
  if [[ "$v" =~ ^[0-9]{14}$ ]] && [ "$v" \> "20261002000020" ] && [ "$v" \< "20261003000028" ]; then
    err "$b: versão $v pertence ao intervalo em quarentena (20261002000021–20261003000027)"
  fi
  [ "$v" = "20261014000027" ] && err "$b: versão 20261014000027 está em quarentena (substituída pelo N5)"
  for n in $NAMES; do [ "$name" = "$n" ] && err "$b: nome igual a migration em quarentena ($n)"; done
  h="$(sha256sum "$f" | cut -d' ' -f1)"
  for x in $HASHES; do [ "$h" = "$x" ] && err "$b: conteúdo idêntico (sha256) a migration em quarentena"; done
  nh="$(norm_hash "$f")"
  for x in $QNORM; do [ "$nh" = "$x" ] && err "$b: conteúdo equivalente (sem espaços) a migration em quarentena"; done
done

# A quarentena não pode ser apagada
cnt=$(ls "$QUA"/*.sql 2>/dev/null | wc -l)
[ "$cnt" -ge 7 ] || err "supabase/migrations_quarantine deve manter os 7 arquivos 021–026 + 20261014000027 (encontrados: $cnt)"
[ -f "$QUA/README.md" ] || err "supabase/migrations_quarantine/README.md ausente"

# Rollbacks e passos manuais nunca podem estar em supabase/migrations
for f in "$MIG"/*rollback* "$MIG"/*n1v*; do err "$(basename "$f"): rollback/passo manual dentro de supabase/migrations"; done

# Nenhum workflow pode aplicar migrations ou vincular projeto Supabase
for w in "$ROOT"/.github/workflows/*.yml "$ROOT"/.github/workflows/*.yaml; do
  [ "$(basename "$w")" = "migration-quarantine-guard.yml" ] && continue
  if grep -Eiq 'supabase[[:space:]]+(db[[:space:]]+push|link|migration[[:space:]]+up|db[[:space:]]+reset)' "$w"; then
    err "$(basename "$w"): workflow aplica migrations ou vincula projeto Supabase"
  fi
done

if [ "$fail" -ne 0 ]; then echo "Guarda de quarentena: FALHOU" >&2; exit 1; fi
echo "Guarda de quarentena: OK ($(ls "$MIG"/*.sql | wc -l) migrations ativas, $cnt em quarentena)"
