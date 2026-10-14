#!/usr/bin/env bash
# Seed sintético no STAGING. DRY-RUN por padrão. Uso: scripts/staging/seed_synthetic.sh [--execute]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib_guard.sh"
sg_validate_env
[ "${1:-}" = "--execute" ] || { echo "[dry-run] aplicaria $HERE/sql/seed_synthetic.sql no staging '$STAGING_PROJECT_REF'. Use --execute + STAGING_CONFIRM."; exit 0; }
sg_require_confirm
psql "$STAGING_DB_URL" -X -q -v ON_ERROR_STOP=1 -1 -f "$HERE/sql/seed_synthetic.sql"
