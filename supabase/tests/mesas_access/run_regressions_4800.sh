#!/bin/sh
# Mesas: trava do responsável (código HOLDER de uso único / 5 min), liberação de mesa R$ 0,00,
# pré-visualização pública de convite e RLS do papel WAITER — SQL regression on a DISPOSABLE LOCAL PostgreSQL.
#  1) base DB = every migration up to and including 20261027004600 + 20261027004700 + N1–N6 fixtures
#  2) existing suites 81–84, mesas_qr and mesas_access run BEFORE and AFTER 20261027004800
#     (with explicit adaptation of intentional behaviour changes: occupied table without holder stays IN_USE,
#      claiming holder requires staff_create_holder_code, and capabilities version = 3)
#  3) new suite mesas_holder_lock_and_empty_cancel.sql (20 assertions)
#  4) exact rollback (md5 of pg_get_functiondef+proacl, triggers, policies, columns, and row counts) + clean re-apply
set -eu
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Local PostgreSQL only' >&2; exit 2 ;; esac
unset PGPASSWORD DATABASE_URL SUPABASE_DB_URL || true

if ! psql -X -q -c "SELECT 1" postgres >/dev/null 2>&1; then
  PG_BIN="/usr/lib/postgresql/17/bin"
  export PGHOST="/tmp/pg_4800_sock"
  export PGUSER="postgres"
  mkdir -p "$PGHOST"
  if [ ! -f "/tmp/pg_4800_data/PG_VERSION" ]; then
    "$PG_BIN/initdb" -D /tmp/pg_4800_data -U postgres --auth=trust >/dev/null
  fi
  rm -f /tmp/pg_4800_data/postmaster.pid "$PGHOST"/.s.PGSQL.*
  "$PG_BIN/pg_ctl" -D /tmp/pg_4800_data -l /tmp/pg_4800.log -o "-k $PGHOST -h ''" start >/dev/null
  trap '"$PG_BIN/pg_ctl" -D /tmp/pg_4800_data stop >/dev/null 2>&1 || true' EXIT
fi

HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE/../../.."
SQLDIR=supabase/tests/n1n6/sql
MIG4700=supabase/migrations/20261027004700_mesas_access.sql
MIG=supabase/migrations/20261027004800_mesas_holder_lock_empty_cancel_waiter_rls.sql
DOWN=supabase/rollback/20261027004800_mesas_holder_lock_empty_cancel_waiter_rls_down.sql
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

INCLUDE_4600=1 sh supabase/tests/mesas_qr/build_base.sh acc48_fx >/dev/null 2>&1
P -d acc48_fx -1 -f $MIG4700 >/dev/null
P -d acc48_fx -f $SQLDIR/00_framework.sql >/dev/null
sed '2,3d' $SQLDIR/03_fixtures.sql > /tmp/acc48_fixtures.sql
P -d acc48_fx -f /tmp/acc48_fixtures.sql >/dev/null

clone() { dropdb --if-exists "$1" >/dev/null 2>&1; createdb -T acc48_fx "$1"; }
suite() { P -d "$1" -c "SET t.suite = '$(basename "$2" .sql)'" -f "$2" > "/tmp/acc48_$1_$(basename "$2").log" 2>&1 || { echo "ERRO em $2 ($1)"; tail -8 "/tmp/acc48_$1_$(basename "$2").log"; return 1; }; }
report() {
  psql -X -At -d "$1" -c "SELECT suite||': '||name||' — '||COALESCE(detail,'') FROM t.results WHERE NOT ok ORDER BY id" | sed "s/^/  FALHOU [$2] /"
  psql -X -At -d "$1" -c "SELECT '$2: ' || count(*) FILTER (WHERE ok) || ' passou, ' || count(*) FILTER (WHERE NOT ok) || ' falhou' FROM t.results"
  [ "$(psql -X -At -d "$1" -c 'SELECT count(*) FROM t.results WHERE NOT ok')" = 0 ]
}

# Prepare adapted mesas_qr for 4700+ (same adaptation as run_regressions.sh)
python3 - <<'PY'
s = open('supabase/tests/mesas_qr/mesas_qr.sql').read()
a = "PERFORM t.ok(v_blocked AND n = 16,"
b = "IF SQLERRM LIKE 'RATE_LIMITED%' THEN v_blocked := true; EXIT; END IF;\n      RAISE;\n    END;\n  END LOOP;\n  RESET ROLE;\n  PERFORM t.ok(v_blocked, format('enxurrada"
assert a in s and b in s
s = s.replace(a, "PERFORM t.ok(NOT v_blocked AND n = 20,")
s = s.replace(b, b.replace("IF SQLERRM LIKE 'RATE_LIMITED%' THEN", "IF SQLERRM LIKE 'RATE_LIMITED%' OR SQLERRM LIKE 'TABLE_IN_USE%' THEN"))
c = "SELECT t.login('e0000000-0000-0000-0000-000000000003');\nSELECT set_config('t.s3'"
assert c in s
s = s.replace(c, "RESET ROLE;\nUPDATE public.dining_tabs SET status = 'CANCELLED', closed_at = now() WHERE table_id = (SELECT id FROM public.dining_tables WHERE qr_token = 'mesas-a3-token-0003') AND status = 'OPEN';\nSET ROLE authenticated;\n" + c)
g = "AND NOT has_function_privilege('anon', 'public.mesas_qr_capabilities()', 'EXECUTE'), 'capabilities: só autenticado');"
assert g in s
s = s.replace(g, "AND has_function_privilege('anon', 'public.mesas_qr_capabilities()', 'EXECUTE'), 'capabilities: legíveis antes do login (v2+)');")
open('/tmp/mesas_qr_post4700.sql', 'w').write(s)
PY

# Prepare adapted mesas_access for 4800:
# 1) capabilities version is now 3
# 2) an occupied table without holder stays locked (holder_claimable = false, enter_table returns IN_USE);
#    claiming responsibility uses the single-use 5-min HOLDER code from staff_create_holder_code.
python3 - <<'PY'
s = open('supabase/tests/mesas_access/mesas_access.sql').read()
old_cap = "SELECT t.is((public.mesas_qr_capabilities() ->> 'version')::int, 2, 'capacidades: versão 2');"
new_cap = "SELECT t.is((public.mesas_qr_capabilities() ->> 'version')::int, 3, 'capacidades: versão 3');"
assert old_cap in s
s = s.replace(old_cap, new_cap, 1)

old_sec8 = """SELECT t.ok((SELECT responsible_user_id IS NULL AND holder_claimable FROM public.dining_tabs WHERE id = t.tabof('acc-a1-token-000001')), 'mesa fica sem titular, liberada para ser assumida');
SELECT t.ok((SELECT ended_reason = 'STAFF_RESET' FROM public.tab_sessions WHERE id = t.sess(13, 'acc-a1-token-000001')), 'sessão do titular antigo foi encerrada');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.dining_tab_invites WHERE tab_id = t.tabof('acc-a1-token-000001') AND revoked_at IS NULL), 'reinício revoga códigos');
SET ROLE authenticated;
SELECT t.as_user(13);
SELECT t.is(public.get_my_tab(t.sess(13, 'acc-a1-token-000001')) ->> 'endedReason', 'STAFF_RESET', 'antigo titular é avisado');
SELECT t.is((t.enter(14, 'acc-a1-token-000001')) ->> 'state', 'RESPONSIBLE', 'quem ler o QR depois assume como Responsável');
SELECT t.is((SELECT (public.get_my_tab(t.sess(14, 'acc-a1-token-000001')) -> 'me' ->> 'approved')::boolean), false, 'novo titular aguarda a equipe aprovar');
SELECT t.login('a0000000-0000-0000-0000-000000000009');
SELECT t.lives($$SELECT public.approve_session(t.sess(14, 'acc-a1-token-000001'))$$, 'equipe libera o novo titular');"""

new_sec8 = """SELECT t.ok((SELECT responsible_user_id IS NULL AND NOT holder_claimable FROM public.dining_tabs WHERE id = t.tabof('acc-a1-token-000001')), 'mesa fica sem titular e travada (holder_claimable = false)');
SELECT t.ok((SELECT ended_reason = 'STAFF_RESET' FROM public.tab_sessions WHERE id = t.sess(13, 'acc-a1-token-000001')), 'sessão do titular antigo foi encerrada');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.dining_tab_invites WHERE tab_id = t.tabof('acc-a1-token-000001') AND revoked_at IS NULL), 'reinício revoga códigos');
SET ROLE authenticated;
SELECT t.as_user(13);
SELECT t.is(public.get_my_tab(t.sess(13, 'acc-a1-token-000001')) ->> 'endedReason', 'STAFF_RESET', 'antigo titular é avisado');
SELECT t.is((t.enter(14, 'acc-a1-token-000001')) ->> 'state', 'IN_USE', 'mesa sem titular continua IN_USE no QR comum (nunca auto-reivindicável)');
SELECT t.login('a0000000-0000-0000-0000-000000000009');
SELECT set_config('t.hcode14', public.staff_create_holder_code(t.tabof('acc-a1-token-000001')) ->> 'code', false);
SELECT t.as_user(14);
SELECT t.is(public.join_with_code('acc-a1-token-000001', current_setting('t.hcode14'), 'Pessoa 14', 'dev-14') ->> 'state', 'RESPONSIBLE', 'quem usa o código HOLDER de staff_create_holder_code assume como Responsável');
SELECT t.is((SELECT (public.get_my_tab(t.sess(14, 'acc-a1-token-000001')) -> 'me' ->> 'approved')::boolean), true, 'novo titular via código HOLDER da equipe já entra liberado');"""

assert old_sec8 in s
s = s.replace(old_sec8, new_sec8, 1)
open('/tmp/mesas_access_post4800.sql', 'w').write(s)
PY

STATUS=0
OLD="81_product_options 82_dine_in 83_dine_in_payment_choice 84_dine_in_order_table_labels"

# 1. Baseline BEFORE 20261027004800 (4600 + 4700)
clone acc48_pre
for f in $OLD; do suite acc48_pre $SQLDIR/$f.sql || STATUS=1; done
suite acc48_pre /tmp/mesas_qr_post4700.sql || STATUS=1
report acc48_pre "baseline 81–84 + mesas_qr (antes da 4800)" || STATUS=1

clone acc48_pre_acc
suite acc48_pre_acc "$HERE/mesas_access.sql" || STATUS=1
report acc48_pre_acc "baseline mesas_access (antes da 4800)" || STATUS=1

# 2. Regressions AFTER 20261027004800 + new suite mesas_holder_lock_and_empty_cancel
clone acc48_post
P -d acc48_post -1 -f $MIG
for f in $OLD; do suite acc48_post $SQLDIR/$f.sql || STATUS=1; done
suite acc48_post /tmp/mesas_qr_post4700.sql || STATUS=1
report acc48_post "regressão 81–84 + mesas_qr (depois da 4800)" || STATUS=1

clone acc48_post_acc
P -d acc48_post_acc -1 -f $MIG
suite acc48_post_acc /tmp/mesas_access_post4800.sql || STATUS=1
report acc48_post_acc "regressão mesas_access (depois da 4800)" || STATUS=1

psql -X -q -d acc48_post_acc -c "TRUNCATE t.results"
suite acc48_post_acc "$HERE/mesas_holder_lock_and_empty_cancel.sql" || STATUS=1
report acc48_post_acc "mesas_holder_lock_and_empty_cancel (nova suíte 4800)" || STATUS=1

# 3. Exact rollback to 4700 state and clean re-apply
clone acc48_rb
fnhash() { psql -X -At -d acc48_rb -c "SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY oid::regprocedure::text)) FROM pg_proc WHERE pronamespace='public'::regnamespace"; }
trghash() { psql -X -At -d acc48_rb -c "SELECT md5(string_agg(tgrelid::regclass||tgname,',' ORDER BY tgrelid::regclass::text,tgname)) FROM pg_trigger WHERE NOT tgisinternal"; }
polhash() { psql -X -At -d acc48_rb -c "SELECT md5(string_agg(tablename||':'||policyname||':'||coalesce(qual,''),'|' ORDER BY tablename,policyname)) FROM pg_policies WHERE schemaname='public'"; }
colhash() { psql -X -At -d acc48_rb -c "SELECT md5(string_agg(column_name||':'||data_type,',' ORDER BY ordinal_position)) FROM information_schema.columns WHERE table_schema='public' AND table_name='dining_tab_invites'"; }

before_fn=$(fnhash); before_tr=$(trghash); before_pol=$(polhash); before_col=$(colhash)
P -d acc48_rb -1 -f $MIG
suite acc48_rb /tmp/mesas_access_post4800.sql || STATUS=1
suite acc48_rb "$HERE/mesas_holder_lock_and_empty_cancel.sql" || STATUS=1

cnt() { psql -X -At -d acc48_rb -c "SELECT (SELECT count(*) FROM public.orders)||'/'||(SELECT count(*) FROM public.dining_tabs)||'/'||(SELECT count(*) FROM public.tab_payments)||'/'||(SELECT count(*) FROM public.tab_sessions)||'/'||(SELECT count(*) FROM public.tab_events)||'/'||(SELECT count(*) FROM public.tab_access_events)"; }
data_before=$(cnt)

P -d acc48_rb -1 -f $DOWN
[ "$data_before" = "$(cnt)" ] || { echo 'FALHOU rollback alterou pedidos/comandas/pagamentos/sessões/eventos'; STATUS=1; }
[ "$before_fn" = "$(fnhash)" ] || { echo 'FALHOU rollback alterou funções preexistentes (md5 pg_get_functiondef+proacl)'; STATUS=1; }
[ "$before_tr" = "$(trghash)" ] || { echo 'FALHOU rollback alterou gatilhos'; STATUS=1; }
[ "$before_pol" = "$(polhash)" ] || { echo 'FALHOU rollback deixou policies novas'; STATUS=1; }
[ "$before_col" = "$(colhash)" ] || { echo 'FALHOU rollback deixou colunas novas em dining_tab_invites'; STATUS=1; }
[ "$(psql -X -At -d acc48_rb -c "SELECT to_regprocedure('public.staff_create_holder_code(uuid)') IS NULL AND to_regprocedure('public.release_empty_tab(uuid,text)') IS NULL AND to_regprocedure('public.resolve_table_invite(text,text)') IS NULL")" = t ] || { echo 'FALHOU rollback deixou funções novas'; STATUS=1; }

P -d acc48_rb -1 -f $MIG || { echo 'FALHOU reaplicação da 4800'; STATUS=1; }
P -d acc48_rb -1 -f $DOWN || { echo 'FALHOU segundo rollback da 4800'; STATUS=1; }
[ "$before_fn" = "$(fnhash)" ] || { echo 'FALHOU segundo rollback alterou funções preexistentes'; STATUS=1; }

for d in acc48_fx acc48_pre acc48_pre_acc acc48_post acc48_post_acc acc48_rb; do dropdb --if-exists $d >/dev/null 2>&1; done
[ $STATUS = 0 ] && echo 'PASS: base 4600+4700, regressões 81–84 + mesas_qr + mesas_access, nova suíte 4800, rollback exato e reaplicação' || echo 'FAIL'
exit $STATUS
