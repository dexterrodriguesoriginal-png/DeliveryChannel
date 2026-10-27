#!/bin/sh
# Mesas e QR Code — SQL regression on a DISPOSABLE LOCAL PostgreSQL (never remote, never production).
#  1) base DB = every migration before 20261027004600 + N1–N6 fixtures
#  2) existing dine-in suites (82/83/84) must pass BEFORE and AFTER the migration
#  3) new suite (mesas_qr.sql): RLS, token abuse, pause, rate limits, PIX per tab
#  4) rollback must restore the exact set of pre-existing functions, keep tabs/orders/payments, and re-apply cleanly
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
unset PGPASSWORD DATABASE_URL SUPABASE_DB_URL || true
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE/../../.."
SQLDIR=supabase/tests/n1n6/sql
MIG=supabase/migrations/20261027004600_mesas_qr.sql
DOWN=supabase/rollback/20261027004600_mesas_qr_down.sql
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
sh "$HERE/build_base.sh" mesas_fx >/dev/null 2>&1
P -d mesas_fx -f $SQLDIR/00_framework.sql >/dev/null
# the historical fixture inserts a driver without the approval flow added later; drop only that statement
sed '2,3d' $SQLDIR/03_fixtures.sql > /tmp/mesas_fixtures.sql
P -d mesas_fx -f /tmp/mesas_fixtures.sql >/dev/null
clone() { dropdb --if-exists "$1" >/dev/null 2>&1; createdb -T mesas_fx "$1"; }
suite() { # db file
  P -d "$1" -c "SET t.suite = '$(basename "$2" .sql)'" -f "$2" > "/tmp/mesas_$1_$(basename "$2").log" 2>&1 || { echo "ERRO em $2 ($1)"; tail -8 "/tmp/mesas_$1_$(basename "$2").log"; return 1; }
}
report() { # db label
  psql -X -At -d "$1" -c "SELECT suite||': '||name||' — '||COALESCE(detail,'') FROM t.results WHERE NOT ok ORDER BY id" | sed "s/^/  FALHOU [$2] /"
  psql -X -At -d "$1" -c "SELECT '$2: ' || count(*) FILTER (WHERE ok) || ' passou, ' || count(*) FILTER (WHERE NOT ok) || ' falhou' FROM t.results"
  [ "$(psql -X -At -d "$1" -c 'SELECT count(*) FROM t.results WHERE NOT ok')" = 0 ]
}
STATUS=0
clone mesas_pre
for f in 81_product_options 82_dine_in 83_dine_in_payment_choice 84_dine_in_order_table_labels; do suite mesas_pre $SQLDIR/$f.sql || STATUS=1; done
report mesas_pre "baseline 82–84 (antes da migration)" || STATUS=1
clone mesas_post
P -d mesas_post -1 -f $MIG
for f in 81_product_options 82_dine_in 83_dine_in_payment_choice 84_dine_in_order_table_labels; do suite mesas_post $SQLDIR/$f.sql || STATUS=1; done
report mesas_post "regressão 82–84 (depois da migration)" || STATUS=1
clone mesas_new
P -d mesas_new -1 -f $MIG
suite mesas_new "$HERE/mesas_qr.sql" || STATUS=1
report mesas_new "mesas_qr" || STATUS=1
# --- rollback exactness
clone mesas_rb
fnhash() { psql -X -At -d mesas_rb -c "SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY oid::regprocedure::text)) FROM pg_proc WHERE pronamespace='public'::regnamespace"; }
trghash() { psql -X -At -d mesas_rb -c "SELECT md5(string_agg(tgrelid::regclass||tgname,',' ORDER BY tgrelid::regclass::text,tgname)) FROM pg_trigger WHERE NOT tgisinternal"; }
before_fn=$(fnhash); before_tr=$(trghash)
P -d mesas_rb -1 -f $MIG
suite mesas_rb "$HERE/mesas_qr.sql" || STATUS=1
cnt() { psql -X -At -d mesas_rb -c "SELECT (SELECT count(*) FROM public.orders)||'/'||(SELECT count(*) FROM public.dining_tabs)||'/'||(SELECT count(*) FROM public.tab_payments)||'/'||(SELECT count(*) FROM public.tab_sessions)||'/'||(SELECT count(*) FROM public.tab_events)"; }
data_before=$(cnt)
P -d mesas_rb -1 -f $DOWN
[ "$data_before" = "$(cnt)" ] || { echo 'FALHOU rollback alterou pedidos/comandas/pagamentos'; STATUS=1; }
[ "$before_fn" = "$(fnhash)" ] || { echo 'FALHOU rollback alterou funções preexistentes'; STATUS=1; }
[ "$before_tr" = "$(trghash)" ] || { echo 'FALHOU rollback deixou gatilhos'; STATUS=1; }
[ "$(psql -X -At -d mesas_rb -c "SELECT to_regclass('public.tab_pix_charges') IS NULL AND to_regclass('public.dining_qr_pauses') IS NULL")" = t ] || { echo 'FALHOU rollback deixou tabelas'; STATUS=1; }
P -d mesas_rb -1 -f $MIG || { echo 'FALHOU reaplicação'; STATUS=1; }
P -d mesas_rb -1 -f $DOWN || { echo 'FALHOU segundo rollback'; STATUS=1; }
[ $STATUS = 0 ] && echo 'PASS: base, regressão 82–84, suíte mesas_qr, rollback exato e reaplicação' || echo 'FAIL'
exit $STATUS
