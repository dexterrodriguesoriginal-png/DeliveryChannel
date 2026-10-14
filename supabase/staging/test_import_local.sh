#!/usr/bin/env bash
# Teste LOCAL do procedimento F6 (origem sintética "produção" local -> CSV -> staging local 001–020 -> N1–N6).
# Nunca conecta em host remoto. Saída: OK|f6_staging|... / FAIL|f6_staging|...
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../tests/n1n6/harness/lib.sh"
set +e
C=f6_staging; T="$(mktemp -d)"
ok() { echo "OK|$C|$1"; }; fail() { echo "FAIL|$C|$1|${2:-}"; }
mkbase f6src strict >/dev/null; P f6src -f "$HERE/../tests/n1n6/sql/01_legacy_data.sql" >/dev/null
( cd "$T" && sed "s/'SLUG-1','SLUG-2'/'adega-a','adega-b'/g" "$HERE/export_catalog_offers.sql" > exp.sql && psql -X -q -d f6src -f exp.sql ) \
  && ok "export somente leitura gera 3 CSVs" || fail "export"
grep -qiE 'cost_price|pix|email|customer' "$T"/*.csv && fail "CSV sem PII/cost_price/pix" || ok "CSVs sem PII, cost_price ou pix_key"
mkbase f6dst strict >/dev/null
P f6dst -c "INSERT INTO public.tenants (slug, name, document, phone, email) VALUES ('adega-a','Adega A staging','00000000000191','11000000000','staging-a@test.local'),('adega-b','Adega B staging','00000000000272','11000000001','staging-b@test.local')" >/dev/null
L="postgresql:///f6dst?host=/var/run/postgresql"
STAGING_DB_URL="postgresql://postgres@db.qjmhlbipmwobnuctzpft.supabase.co:5432/postgres" "$HERE/import_catalog_offers.sh" "$T" --i-confirm-staging >/dev/null 2>&1; [ $? -eq 3 ] && ok "recusa URL de produção" || fail "recusa URL de produção"
STAGING_DB_URL="postgresql://u@aws-0-sa-east-1.pooler.supabase.com:6543/postgres" "$HERE/import_catalog_offers.sh" "$T" --i-confirm-staging >/dev/null 2>&1; [ $? -eq 3 ] && ok "recusa Supabase sem STAGING_PROJECT_REF" || fail "recusa Supabase sem ref"
STAGING_DB_URL="$L" "$HERE/import_catalog_offers.sh" "$T" >/dev/null 2>&1; [ $? -eq 2 ] && ok "recusa sem --i-confirm-staging" || fail "recusa sem confirmação"
STAGING_DB_URL="$L" "$HERE/import_catalog_offers.sh" "$T" --i-confirm-staging >/dev/null 2>&1 && ok "import em staging local 001–020" || fail "import"
[ "$(psql -X -At -d f6dst -c "SELECT count(*) FROM public.offers o JOIN public.products p ON p.id=o.product_id WHERE p.tenant_id<>o.tenant_id")" = 1 ] && ok "vínculo inválido entre tenants reproduzido (F1)" || fail "vínculo F1 reproduzido"
[ "$(psql -X -At -d f6dst -c "SELECT count(*) FROM public.products WHERE cost_price IS NOT NULL AND id::text LIKE 'd0000000%'")" = 0 ] && ok "cost_price não copiado" || fail "cost_price"
N0=$(psql -X -At -d f6dst -c "SELECT count(*) FROM public.offers")
STAGING_DB_URL="$L" "$HERE/import_catalog_offers.sh" "$T" --i-confirm-staging >/dev/null 2>&1
[ "$(psql -X -At -d f6dst -c "SELECT count(*) FROM public.offers")" = "$N0" ] && ok "reimport idempotente (sem duplicar)" || fail "reimport idempotente"
apply_n_series f6dst >/dev/null 2>&1 && ok "N1–N6 aplicam sobre o catálogo importado" || fail "N1–N6 sobre importado"
STAGING_DB_URL="$L" "$HERE/import_catalog_offers.sh" "$T" --i-confirm-staging >/dev/null 2>&1; [ $? -ne 0 ] && ok "import recusado depois da N1" || fail "recusa após N1"
dropdb f6src; dropdb f6dst; rm -rf "$T"
