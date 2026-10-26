#!/usr/bin/env bash
# Ciclo em staging separado, já atualizado até 4400. Nunca usa stubs locais.
set -euo pipefail
cd "$(dirname "$0")/../../.."
source scripts/staging/lib_guard.sh
sg_validate_env
if [[ "${1:-}" != '--execute' ]]; then
  echo 'Plano: aplicar 4500 → testar em transação/ROLLBACK → reverter → comparar funções/permissões → reaplicar → testar.'
  exit 0
fi
sg_require_confirm
export PGCONNECT_TIMEOUT=15 PGAPPNAME=deliverychannel-driver-offers-staging
PSQL=(psql "$STAGING_DB_URL" -X -q -v ON_ERROR_STOP=1)
[[ "$("${PSQL[@]}" -At -c "SELECT to_regclass('public.order_driver_offers') IS NULL")" == t ]] || sg_die '4500 já existe; este ensaio exige staging na base 4400.'
hash_functions() {
 "${PSQL[@]}" -At -c "SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY oid::regprocedure::text)) FROM pg_proc WHERE pronamespace='public'::regnamespace"
}
before=$(hash_functions)
"${PSQL[@]}" -f supabase/migrations/20261026004500_driver_ride_offers.sql
"${PSQL[@]}" -f supabase/tests/driver_ride_offers/security_and_flows.sql
"${PSQL[@]}" -f supabase/rollback/20261026004500_driver_ride_offers_down.sql
[[ "$before" == "$(hash_functions)" ]] || sg_die 'Rollback divergiu das funções ou permissões originais.'
"${PSQL[@]}" -f supabase/migrations/20261026004500_driver_ride_offers.sql
"${PSQL[@]}" -f supabase/tests/driver_ride_offers/security_and_flows.sql
"${PSQL[@]}" -c "INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261026004500','driver_ride_offers')"
echo 'PASS: staging apply → down → apply e testes com ROLLBACK.'
