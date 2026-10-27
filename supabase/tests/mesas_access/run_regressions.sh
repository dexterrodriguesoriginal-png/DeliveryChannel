#!/bin/sh
# Mesas: modelo de acesso — SQL regression on a DISPOSABLE LOCAL PostgreSQL (never remote, never production).
#  1) base DB = every migration up to and including 20261027004600 (what production runs today) + N1–N6 fixtures
#  2) existing suites 81–84 and mesas_qr, run BEFORE and AFTER 20261027004700 (intended behaviour changes are asserted in the access suite)
#  3) new suite mesas_access.sql
#  4) rollback must restore the exact set of pre-existing functions/triggers, keep tabs/orders/payments/sessions, and re-apply cleanly
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
unset PGPASSWORD DATABASE_URL SUPABASE_DB_URL || true
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE/../../.."
SQLDIR=supabase/tests/n1n6/sql
MIG=supabase/migrations/20261027004700_mesas_access.sql
DOWN=supabase/rollback/20261027004700_mesas_access_down.sql
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
INCLUDE_4600=1 sh supabase/tests/mesas_qr/build_base.sh acc_fx >/dev/null 2>&1
P -d acc_fx -f $SQLDIR/00_framework.sql >/dev/null
sed '2,3d' $SQLDIR/03_fixtures.sql > /tmp/acc_fixtures.sql
P -d acc_fx -f /tmp/acc_fixtures.sql >/dev/null
clone() { dropdb --if-exists "$1" >/dev/null 2>&1; createdb -T acc_fx "$1"; }
suite() { P -d "$1" -c "SET t.suite = '$(basename "$2" .sql)'" -f "$2" > "/tmp/acc_$1_$(basename "$2").log" 2>&1 || { echo "ERRO em $2 ($1)"; tail -8 "/tmp/acc_$1_$(basename "$2").log"; return 1; }; }
report() {
  psql -X -At -d "$1" -c "SELECT suite||': '||name||' — '||COALESCE(detail,'') FROM t.results WHERE NOT ok ORDER BY id" | sed "s/^/  FALHOU [$2] /"
  psql -X -At -d "$1" -c "SELECT '$2: ' || count(*) FILTER (WHERE ok) || ' passou, ' || count(*) FILTER (WHERE NOT ok) || ' falhou' FROM t.results"
  [ "$(psql -X -At -d "$1" -c 'SELECT count(*) FROM t.results WHERE NOT ok')" = 0 ]
}
STATUS=0
OLD="81_product_options 82_dine_in 83_dine_in_payment_choice 84_dine_in_order_table_labels"
clone acc_pre
for f in $OLD; do suite acc_pre $SQLDIR/$f.sql || STATUS=1; done
suite acc_pre supabase/tests/mesas_qr/mesas_qr.sql || STATUS=1
report acc_pre "baseline 81–84 + mesas_qr (antes)" || STATUS=1
clone acc_post
P -d acc_post -1 -f $MIG
for f in $OLD; do suite acc_post $SQLDIR/$f.sql || STATUS=1; done
# Intended behaviour change asserted here (and covered in mesas_access.sql): reopening/restoring a session is not a new join, and a
# second account scanning an occupied table gets TABLE_IN_USE instead of joining. Two rate-limit expectations of the 4600 suite are adapted.
python3 - <<'PY'
s = open('supabase/tests/mesas_qr/mesas_qr.sql').read()
a = "PERFORM t.ok(v_blocked AND n = 16,"
b = "IF SQLERRM LIKE 'RATE_LIMITED%' THEN v_blocked := true; EXIT; END IF;\n      RAISE;\n    END;\n  END LOOP;\n  RESET ROLE;\n  PERFORM t.ok(v_blocked, format('enxurrada"
assert a in s and b in s
s = s.replace(a, "PERFORM t.ok(NOT v_blocked AND n = 20,")
s = s.replace(b, b.replace("IF SQLERRM LIKE 'RATE_LIMITED%' THEN", "IF SQLERRM LIKE 'RATE_LIMITED%' OR SQLERRM LIKE 'TABLE_IN_USE%' THEN"))
# Mesa 03 already has a tab from earlier checks of that suite; the test that follows needs it free
c = "SELECT t.login('e0000000-0000-0000-0000-000000000003');\nSELECT set_config('t.s3'"
assert c in s
s = s.replace(c, "RESET ROLE;\nUPDATE public.dining_tabs SET status = 'CANCELLED', closed_at = now() WHERE table_id = (SELECT id FROM public.dining_tables WHERE qr_token = 'mesas-a3-token-0003') AND status = 'OPEN';\nSET ROLE authenticated;\n" + c)
open('/tmp/mesas_qr_post4700.sql', 'w').write(s)
PY
suite acc_post /tmp/mesas_qr_post4700.sql || STATUS=1
report acc_post "regressão 81–84 + mesas_qr (depois)" || STATUS=1
clone acc_new
P -d acc_new -1 -f $MIG
suite acc_new "$HERE/mesas_access.sql" || STATUS=1
report acc_new "mesas_access" || STATUS=1
clone acc_rb
fnhash() { psql -X -At -d acc_rb -c "SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY oid::regprocedure::text)) FROM pg_proc WHERE pronamespace='public'::regnamespace"; }
trghash() { psql -X -At -d acc_rb -c "SELECT md5(string_agg(tgrelid::regclass||tgname,',' ORDER BY tgrelid::regclass::text,tgname)) FROM pg_trigger WHERE NOT tgisinternal"; }
before_fn=$(fnhash); before_tr=$(trghash)
P -d acc_rb -1 -f $MIG
suite acc_rb "$HERE/mesas_access.sql" || STATUS=1
cnt() { psql -X -At -d acc_rb -c "SELECT (SELECT count(*) FROM public.orders)||'/'||(SELECT count(*) FROM public.dining_tabs)||'/'||(SELECT count(*) FROM public.tab_payments)||'/'||(SELECT count(*) FROM public.tab_sessions)||'/'||(SELECT count(*) FROM public.tab_events)"; }
data_before=$(cnt); ev_before=$(psql -X -At -d acc_rb -c 'SELECT count(*) FROM public.tab_access_events')
P -d acc_rb -1 -f $DOWN
[ "$data_before" = "$(cnt)" ] || { echo 'FALHOU rollback alterou pedidos/comandas/pagamentos/sessões'; STATUS=1; }
[ "$before_fn" = "$(fnhash)" ] || { echo 'FALHOU rollback alterou funções preexistentes'; STATUS=1; }
[ "$before_tr" = "$(trghash)" ] || { echo 'FALHOU rollback deixou gatilhos'; STATUS=1; }
[ "$(psql -X -At -d acc_rb -c "SELECT to_regclass('public.dining_tab_invites') IS NULL AND to_regclass('public.tab_access_events') IS NULL")" = t ] || { echo 'FALHOU rollback deixou tabelas'; STATUS=1; }
[ "$(psql -X -At -d acc_rb -c 'SELECT count(*) FROM public.tab_access_events_archived')" = "$ev_before" ] || { echo 'FALHOU rollback perdeu a trilha de acesso'; STATUS=1; }
P -d acc_rb -1 -f $MIG || { echo 'FALHOU reaplicação'; STATUS=1; }
P -d acc_rb -1 -f $DOWN || { echo 'FALHOU segundo rollback'; STATUS=1; }
for d in acc_pre acc_post acc_new acc_rb; do dropdb --if-exists $d >/dev/null 2>&1; done
[ $STATUS = 0 ] && echo 'PASS: base, regressões 81–84 e mesas_qr, suíte mesas_access, rollback exato e reaplicação' || echo 'FAIL'
exit $STATUS
