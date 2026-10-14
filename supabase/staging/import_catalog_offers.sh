#!/usr/bin/env bash
# F6: importa catálogo/ofertas (CSV exportado pelo fundador) em STAGING. Nunca em produção.
# Uso: STAGING_DB_URL=postgresql://... [STAGING_PROJECT_REF=xxxx] ./import_catalog_offers.sh <dir_csv> --i-confirm-staging
set -euo pipefail
PROD_REF="qjmhlbipmwobnuctzpft"
DIR="${1:-}"; CONFIRM="${2:-}"
[ -n "$DIR" ] && [ -f "$DIR/categories.csv" ] && [ -f "$DIR/products.csv" ] && [ -f "$DIR/offers.csv" ] || { echo "Uso: $0 <dir com categories.csv products.csv offers.csv> --i-confirm-staging" >&2; exit 2; }
[ "$CONFIRM" = "--i-confirm-staging" ] || { echo "Recusado: falta --i-confirm-staging." >&2; exit 2; }
URL="${STAGING_DB_URL:-}"
[ -n "$URL" ] || { echo "Recusado: defina STAGING_DB_URL (banco de STAGING)." >&2; exit 2; }
case "$URL" in *"$PROD_REF"*) echo "RECUSADO: a URL aponta para o projeto de PRODUÇÃO ($PROD_REF)." >&2; exit 3;; esac
if printf '%s' "$URL" | grep -Eq 'supabase\.(co|com)'; then
  [ -n "${STAGING_PROJECT_REF:-}" ] && [ "$STAGING_PROJECT_REF" != "$PROD_REF" ] && printf '%s' "$URL" | grep -q "$STAGING_PROJECT_REF" \
    || { echo "Recusado: URL Supabase sem STAGING_PROJECT_REF correspondente (e diferente de produção)." >&2; exit 3; }
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
ABS="$(cd "$DIR" && pwd)"
cd "$ABS"
psql "$URL" -X -1 -v ON_ERROR_STOP=1 -f "$HERE/import_catalog_offers.sql"
