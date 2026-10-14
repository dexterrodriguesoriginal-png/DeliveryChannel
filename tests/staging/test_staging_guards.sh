#!/usr/bin/env bash
# Testes das guardas anti-produção e dos bloqueios de estado de scripts/staging/*. PostgreSQL LOCAL apenas.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
A="$ROOT/scripts/staging/apply_staging.sh"; S="$ROOT/scripts/staging/seed_synthetic.sh"
STUBS="$ROOT/supabase/tests/n1n6/harness/00_supabase_stubs.sql"
export PGHOST=/var/run/postgresql
PASS=0; FAIL=0
t() { local name="$1" want="$2"; shift 2; local out rc; out=$(env -i PATH="$PATH" PGHOST="$PGHOST" "$@" 2>&1); rc=$?
  if [ "$want" = ok ] && [ $rc -eq 0 ]; then PASS=$((PASS+1)); elif [ "$want" != ok ] && [ $rc -ne 0 ] && echo "$out" | grep -Eq "$want"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); echo "FALHOU: $name (rc=$rc) :: $(echo "$out" | tail -2)"; fi; }
PROD=qjmhlbipmwobnuctzpft; STG=abcdefghijklmnopqrst
SURL="postgresql://postgres.$STG:x@aws-0-exemplo.pooler.supabase.com:5432/postgres"
L="postgresql:///stg_guard_t?host=/var/run/postgresql"
LOC=(STAGING_ALLOW_LOCAL_REHEARSAL=1 STAGING_PROJECT_REF=local-rehearsal STAGING_DB_URL=$L)
CSV=$(mktemp -d); touch $CSV/categories.csv $CSV/products.csv $CSV/offers.csv; trap "rm -rf $CSV" EXIT
# --- guardas de ambiente (nenhuma conexão) ---
t "sem ref" "STAGING_PROJECT_REF" STAGING_DB_URL=$SURL bash $A all
t "sem url" "STAGING_DB_URL" STAGING_PROJECT_REF=$STG bash $A all
t "ref de produção" "PRODUÇÃO" STAGING_PROJECT_REF=$PROD STAGING_DB_URL=$SURL bash $A all
t "url de produção" "PRODUÇÃO" STAGING_PROJECT_REF=$STG STAGING_DB_URL="postgresql://postgres.$PROD:x@h.pooler.supabase.com:5432/postgres" bash $A all
t "url prod maiúscula" "PRODUÇÃO" STAGING_PROJECT_REF=$STG STAGING_DB_URL="postgresql://postgres:x@db.QJMHLBIPMWOBNUCTZPFT.supabase.co:5432/postgres" bash $A all
t "api url de produção" "PRODUÇÃO" STAGING_PROJECT_REF=$STG STAGING_DB_URL=$SURL STAGING_SUPABASE_URL=https://$PROD.supabase.co bash $A all
t "confirm = prod" "PRODUÇÃO" STAGING_PROJECT_REF=$STG STAGING_DB_URL=$SURL STAGING_CONFIRM=$PROD bash $A all --execute
t "url sem o ref" "não contém" STAGING_PROJECT_REF=$STG STAGING_DB_URL="postgresql://postgres.zzzzzzzzzzzzzzzzzzzz:x@h.pooler.supabase.com:5432/postgres" bash $A all
t "host não supabase" "não é um host Supabase" STAGING_PROJECT_REF=$STG STAGING_DB_URL="postgresql://u:x@db.$STG.example.org/postgres" bash $A all
t "ref inválido" "inválido" STAGING_PROJECT_REF=abc STAGING_DB_URL="$SURL abc" bash $A all
t "marcador de senha" "marcador" STAGING_PROJECT_REF=$STG STAGING_DB_URL="postgresql://postgres.$STG:[YOUR-PASSWORD]@h.pooler.supabase.com:5432/postgres" bash $A all
t "api url errada" "https://$STG" STAGING_PROJECT_REF=$STG STAGING_DB_URL=$SURL STAGING_SUPABASE_URL=https://outro.supabase.co bash $A all
t "local sem flag" "local sem" STAGING_PROJECT_REF=$STG STAGING_DB_URL=$L bash $A all
t "flag local + host remoto" "só aceita PostgreSQL local" STAGING_ALLOW_LOCAL_REHEARSAL=1 STAGING_PROJECT_REF=local-rehearsal STAGING_DB_URL=$SURL bash $A all
t "execute sem confirm" "STAGING_CONFIRM" STAGING_PROJECT_REF=$STG STAGING_DB_URL=$SURL bash $A all --execute
t "execute confirm errado" "STAGING_CONFIRM" STAGING_PROJECT_REF=$STG STAGING_DB_URL=$SURL STAGING_CONFIRM=zzzz bash $A all --execute
t "dry-run válido não conecta" ok STAGING_PROJECT_REF=$STG STAGING_DB_URL=$SURL bash $A all
t "etapa inválida" "Uso" STAGING_PROJECT_REF=$STG STAGING_DB_URL=$SURL bash $A tudo
t "seed sem confirm" "STAGING_CONFIRM" STAGING_PROJECT_REF=$STG STAGING_DB_URL=$SURL bash $S --execute
t "seed url prod" "PRODUÇÃO" STAGING_PROJECT_REF=$STG STAGING_DB_URL="postgresql://postgres.$PROD:x@h.pooler.supabase.com/postgres" bash $S --execute
t "import F6 url prod" "PRODUÇÃO" STAGING_DB_URL="postgresql://postgres.$PROD:x@h.pooler.supabase.com/postgres" bash $ROOT/supabase/staging/import_catalog_offers.sh $CSV --i-confirm-staging
# --- bloqueios de estado real (banco local descartável) ---
fresh() { dropdb --if-exists stg_guard_t >/dev/null 2>&1; createdb stg_guard_t; psql -X -q -d stg_guard_t -f "$STUBS" >/dev/null; }
X=(env "${LOC[@]}" STAGING_CONFIRM=local-rehearsal)
fresh
t "N1 em projeto vazio aborta" "esperado='20260929000020'" "${X[@]}" bash $A n1 --execute
t "N1.V antes da N1 aborta" "esperado='20261006000100'" "${X[@]}" bash $A n1v --execute
t "N2–N6 antes da N1 aborta" "esperado='20261006000100'" "${X[@]}" bash $A n2n6 --execute
t "post em projeto vazio aborta" "POST" "${X[@]}" bash $A post --execute
psql -X -q -d stg_guard_t -c "CREATE TABLE public.lixo(id int)" >/dev/null
t "verify recusa public com tabela" "não está vazio" "${X[@]}" bash $A verify --execute
t "all para no verify (nada aplicado)" "não está vazio" "${X[@]}" bash $A all --execute
[ "$(psql -X -At -d stg_guard_t -c "select count(*) from supabase_migrations.schema_migrations")" = 0 ] && PASS=$((PASS+1)) || { FAIL=$((FAIL+1)); echo "FALHOU: all abortado não deveria registrar nada"; }
fresh; psql -X -q -d stg_guard_t -c "INSERT INTO auth.users(id,email) VALUES (gen_random_uuid(),'x@example.com')" >/dev/null
t "verify recusa auth.users com usuários" "auth.users tem" "${X[@]}" bash $A verify --execute
fresh
t "base executa" ok "${X[@]}" bash $A base --execute
t "base reaplicada aborta" "esperado='<nenhuma>'" "${X[@]}" bash $A base --execute
t "verify após base aborta" "não está vazio" "${X[@]}" bash $A verify --execute
psql -X -q -d stg_guard_t -c "INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261002000021','quarentena')" >/dev/null
t "N1 com 021 (quarentena) registrada aborta" "ABORTADO|N1 PC1" "${X[@]}" bash $A n1 --execute
psql -X -q -d stg_guard_t -c "DELETE FROM supabase_migrations.schema_migrations WHERE version='20261002000021'" >/dev/null
t "N1 executa" ok "${X[@]}" bash $A n1 --execute
t "N1 reaplicada aborta" "ABORTADO" "${X[@]}" bash $A n1 --execute
t "N1.V executa" ok "${X[@]}" bash $A n1v --execute
t "N2–N6 executa" ok "${X[@]}" bash $A n2n6 --execute
t "post OK" "ok" "${X[@]}" bash $A post --execute
t "seed sem usuários aborta" "usuários de teste ausentes" "${X[@]}" bash $S --execute
dropdb --if-exists stg_guard_t >/dev/null 2>&1
echo "staging guards: passou=$PASS falhou=$FAIL"; [ $FAIL -eq 0 ]
