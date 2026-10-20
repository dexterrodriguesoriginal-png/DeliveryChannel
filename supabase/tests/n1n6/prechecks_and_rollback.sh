#!/usr/bin/env bash
# Prechecks que ABORTAM (bancos separados) + ensaio de rollback N6→N1 e reaplicação + N1.V manual.
# PostgreSQL LOCAL apenas. Saída: linhas "OK|categoria|nome" ou "FAIL|categoria|nome|detalhe".
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/harness/lib.sh"
set +e
MODE="${1:-strict}"
RB="$REPO_ROOT/supabase/rollback"
MIG="$REPO_ROOT/supabase/migrations"
N() { ls "$MIG"/20261006000${1}00_*.sql; }
ok()   { echo "OK|$1|$2"; }
fail() { echo "FAIL|$1|$2|${3:-}"; }
expect_abort() { # cat, nome, db, arquivo, regex
  local out; out=$(P "$3" -1 -f "$4" 2>&1)
  if [ $? -ne 0 ] && echo "$out" | grep -Eq "$5"; then ok "$1" "$2"; else fail "$1" "$2" "$(echo "$out" | grep -m1 ERROR)"; fi
}
q() { psql -X -At -d "$1" -c "$2"; }
rollback() { # db, N
  printf "BEGIN;\nSET LOCAL n1n6.rollback_confirm='N%s';\nSET LOCAL n1n6.rollback_export_done='yes';\n\\\\i %s/n%s_rollback.sql\nCOMMIT;\n" "$2" "$RB" "$2" \
    | psql -X -q -v ON_ERROR_STOP=1 -d "$1" 2>&1
}
FN_MD5="SELECT string_agg(x, ',' ORDER BY x) FROM (SELECT p.oid::regprocedure::text || '=' || md5(regexp_replace(prosrc, '\s+', '', 'g')) || ':pub=' || has_function_privilege('n1n6_nobody', p.oid, 'EXECUTE') || ':anon=' || has_function_privilege('anon', p.oid, 'EXECUTE') || ':auth=' || has_function_privilege('authenticated', p.oid, 'EXECUTE') || ':' || prosecdef AS x FROM pg_proc p WHERE pronamespace='public'::regnamespace) z"
POL="SELECT string_agg(x, ',' ORDER BY x) FROM (SELECT schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||array_to_string(roles, ';')||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) AS x FROM pg_policies) z"
TBL="SELECT string_agg(x, ',' ORDER BY x) FROM (SELECT table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') AS x FROM information_schema.columns WHERE table_schema IN ('public','storage')) z"
GR="SELECT string_agg(x, ',' ORDER BY x) FROM (SELECT grantee||'.'||table_name||'.'||privilege_type AS x FROM information_schema.role_table_grants WHERE table_schema='public' UNION ALL SELECT grantee||'.'||table_name||'.'||column_name||'.'||privilege_type FROM information_schema.column_privileges WHERE table_schema='public' AND grantee IN ('anon','authenticated')) z"

psql -X -q -d postgres -c "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='n1n6_nobody') THEN CREATE ROLE n1n6_nobody NOLOGIN; END IF; END\$\$" >/dev/null 2>&1
C=prechecks_aborto
DB=n1n6_pre
# P1: migration 021 registrada (estado diferente de 001–020)
mkbase $DB "$MODE" >/dev/null; q $DB "INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261001000021','promotional_cards')" >/dev/null
expect_abort $C "PC1: 021 registrada em schema_migrations aborta a N1" $DB "$(N 1)" "N1 PC1"
[ "$(q $DB "SELECT to_regclass('public.tenant_payment_settings') IS NULL")" = t ] && ok $C "PC1: nada criado após o abort" || fail $C "PC1: nada criado após o abort"
# P2: função substituída editada manualmente
mkbase $DB "$MODE" >/dev/null
q $DB "SELECT 1" >/dev/null
psql -X -q -d $DB -c "$(psql -X -At -d $DB -c "SELECT replace(pg_get_functiondef('public.get_public_store(text)'::regprocedure), 'Montagem do objeto seguro', 'Montagem EDITADA')")" >/dev/null
expect_abort $C "PC2: get_public_store editada fora do repositório aborta a N1" $DB "$(N 1)" "N1 PC2"
# P3: tabela nova já existente (ex.: resto de 021–027)
mkbase $DB "$MODE" >/dev/null; q $DB "CREATE TABLE public.coupons (id int)" >/dev/null
expect_abort $C "PC4: tabela coupons pré-existente aborta a N1" $DB "$(N 1)" "N1 PC4"
mkbase $DB "$MODE" >/dev/null; q $DB "ALTER TABLE public.offers ADD COLUMN media_url text" >/dev/null
expect_abort $C "PC4: coluna offers.media_url (de 021–027) aborta a N1" $DB "$(N 1)" "N1 PC4|N1 PC"
# P4: policy da 001 ausente
mkbase $DB "$MODE" >/dev/null; q $DB "DROP POLICY orders_staff_update ON public.orders" >/dev/null
expect_abort $C "PC3: policy orders_staff_update ausente aborta a N1" $DB "$(N 1)" "N1 PC3"
# P5: ordem — N2 sem N1; N1 reaplicada; N6 sem N5; N6 com get_public_store editada
mkbase $DB "$MODE" >/dev/null
expect_abort $C "N2 sem N1 aborta" $DB "$(N 2)" "N2 PRE|N2"
apply_migration $DB "$(N 1)" >/dev/null
expect_abort $C "N1 reaplicada aborta (PC1: 21 versões)" $DB "$(N 1)" "N1 PC1"
apply_migration $DB "$(N 2)" >/dev/null; apply_migration $DB "$(N 3)" >/dev/null; apply_migration $DB "$(N 4)" >/dev/null
expect_abort $C "N6 sem N5 aborta" $DB "$(N 6)" "N6 PRE"
apply_migration $DB "$(N 5)" >/dev/null
psql -X -q -d $DB -c "$(psql -X -At -d $DB -c "SELECT replace(pg_get_functiondef('public.get_public_store(text)'::regprocedure), 'Montagem do objeto seguro', 'Montagem EDITADA')")" >/dev/null
expect_abort $C "N6 com get_public_store editada aborta" $DB "$(N 6)" "N6 PRE"
dropdb --if-exists $DB

C=rollback_ensaio
DB=n1n6_rb
mkbase $DB "$MODE" >/dev/null
P $DB -f "$HERE/sql/01_legacy_data.sql" >/dev/null
F0=$(q $DB "$FN_MD5"); P0=$(q $DB "$POL"); T0=$(q $DB "$TBL"); G0=$(q $DB "$GR")
D0=$(q $DB "SELECT md5(string_agg(x, ',' ORDER BY x)) FROM (SELECT to_jsonb(o)::text x FROM public.offers o UNION ALL SELECT to_jsonb(r)::text FROM public.orders r UNION ALL SELECT to_jsonb(c)::text FROM public.customers c UNION ALL SELECT to_jsonb(i)::text FROM public.order_items i UNION ALL SELECT to_jsonb(p)::text FROM public.products p UNION ALL SELECT to_jsonb(s)::text FROM public.tenant_settings s) z")
apply_n_series $DB >/dev/null && ok $C "N1–N6 e estoque fase 1 aplicados" || fail $C "N1–N6 e estoque fase 1 aplicados"
out=$(P $DB -1 -f "$RB/n6_rollback.sql" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q "não confirmado" && ok $C "rollback sem confirmação explícita é recusado" || fail $C "rollback sem confirmação explícita é recusado" "$out"
out=$(rollback $DB 1); echo "$out" | grep -q "abortado" && ok $C "rollback N1 fora de ordem (N2–N6 aplicadas) é recusado" || fail $C "rollback N1 fora de ordem é recusado" "$out"
out=$(P $DB -1 -f "$RB/20261020003100_stock_phase1_down.sql" 2>&1)
[ $? -eq 0 ] && ok $C "rollback Estoque Fase 1 executado" || fail $C "rollback Estoque Fase 1 executado" "$(echo "$out" | grep -m1 ERROR)"
for n in 6 5 4 3 2 1; do
  out=$(rollback $DB $n); [ $? -eq 0 ] && ok $C "rollback N$n executado" || fail $C "rollback N$n executado" "$(echo "$out" | grep -m1 ERROR)"
done
[ "$(q $DB "SELECT count(*) FROM supabase_migrations.schema_migrations")" = 20 ] && ok $C "schema_migrations volta a 001–020" || fail $C "schema_migrations volta a 001–020"
[ "$(q $DB "$FN_MD5")" = "$F0" ] && ok $C "todas as funções public idênticas (md5) ao estado 001–020" || fail $C "funções idênticas ao estado 001–020" "$(diff <(echo "$F0" | tr , '\n') <(q $DB "$FN_MD5" | tr , '\n') | head -60)"
[ "$(q $DB "$POL")" = "$P0" ] && ok $C "policies idênticas ao estado 001–020" || fail $C "policies idênticas" "$(diff <(echo "$P0" | tr , '\n') <(q $DB "$POL" | tr , '\n') | head -60)"
[ "$(q $DB "$TBL")" = "$T0" ] && ok $C "colunas/tabelas idênticas ao estado 001–020" || fail $C "colunas idênticas" "$(diff <(echo "$T0" | tr , '\n') <(q $DB "$TBL" | tr , '\n') | head -60)"
[ "$(q $DB "$GR")" = "$G0" ] && ok $C "grants de tabela e de coluna idênticos ao estado 001–020" || fail $C "grants idênticos" "$(diff <(echo "$G0" | tr , '\n') <(q $DB "$GR" | tr , '\n') | head -60)"
D1=$(q $DB "SELECT md5(string_agg(x, ',' ORDER BY x)) FROM (SELECT to_jsonb(o)::text x FROM public.offers o UNION ALL SELECT to_jsonb(r)::text FROM public.orders r UNION ALL SELECT to_jsonb(c)::text FROM public.customers c UNION ALL SELECT to_jsonb(i)::text FROM public.order_items i UNION ALL SELECT to_jsonb(p)::text FROM public.products p UNION ALL SELECT to_jsonb(s)::text FROM public.tenant_settings s) z")
[ "$D1" = "$D0" ] && ok $C "dados legados (ofertas, pedidos, itens, clientes, produtos, settings) intactos após ida e volta" || fail $C "dados legados intactos após ida e volta"
apply_n_series $DB >/dev/null && ok $C "N1–N6 reaplicadas após rollback completo" || fail $C "N1–N6 reaplicadas após rollback completo"
# N5 com campanhas: recusa sem confirmação de export
q $DB "INSERT INTO public.campaigns (tenant_id, name) VALUES ('10000000-0000-0000-0000-00000000000a','c')" >/dev/null
rollback $DB 6 >/dev/null
out=$(printf "BEGIN;\nSET LOCAL n1n6.rollback_confirm='N5';\n\\\\i %s/n5_rollback.sql\nCOMMIT;\n" "$RB" | psql -X -q -v ON_ERROR_STOP=1 -d $DB 2>&1)
echo "$out" | grep -q "Exporte" && ok $C "rollback N5 com campanhas exige confirmação de export" || fail $C "rollback N5 exige export" "$out"

C=n1v_manual
out=$(P $DB -1 -f "$REPO_ROOT/supabase/manual/n1v_validate_constraints.sql" 2>&1); rc=$?
[ $rc -eq 0 ] && ok $C "N1.V roda sem erro com dados legados inconsistentes" || fail $C "N1.V roda sem erro" "$out"
[ "$(q $DB "SELECT count(*) FROM pg_constraint WHERE conname='orders_total_consistency'")" = 0 ] && ok $C "N1.V não cria CHECK de total com pedido legado inconsistente (pulado)" || fail $C "N1.V pula CHECK de total"
[ "$(q $DB "SELECT convalidated FROM pg_constraint WHERE conname='offers_product_same_tenant'")" = f ] && ok $C "N1.V mantém FK de oferta NOT VALID (F1-A: vínculo inválido não corrigido)" || fail $C "N1.V mantém FK NOT VALID"
D2=$(q $DB "SELECT md5(string_agg(to_jsonb(o)::text, ',' ORDER BY id)) FROM public.offers o")
D3=$(q $DB "SELECT md5(string_agg(to_jsonb(o)::text, ',' ORDER BY id)) FROM public.offers o")
[ "$D2" = "$D3" ] && ok $C "N1.V não altera linhas" || fail $C "N1.V não altera linhas"
# Banco consistente: N1.V valida
DB2=n1n6_n1v
mkbase $DB2 "$MODE" >/dev/null; apply_n_series $DB2 >/dev/null
out=$(P $DB2 -1 -f "$REPO_ROOT/supabase/manual/n1v_validate_constraints.sql" 2>&1)
[ "$(q $DB2 "SELECT count(*) FROM pg_constraint WHERE conname='orders_total_consistency' AND convalidated")" = 1 ] && ok $C "N1.V cria e valida CHECK de total quando diagnóstico = 0" || fail $C "N1.V valida CHECK" "$out"
out=$(printf "BEGIN;\nSET LOCAL n1n6.rollback_confirm='N1V';\n\\\\i %s/n1v_rollback.sql\nCOMMIT;\n" "$RB" | psql -X -q -v ON_ERROR_STOP=1 -d $DB2 2>&1)
[ $? -eq 0 ] && ok $C "rollback N1.V executado" || fail $C "rollback N1.V" "$out"
dropdb --if-exists $DB2
dropdb --if-exists $DB
