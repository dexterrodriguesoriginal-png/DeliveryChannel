#!/bin/sh
set -eu
: "${PGDATABASE:?Banco local do harness obrigatório}"
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo 'Somente banco local sintético' >&2; exit 2 ;; esac
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/driver_ride_offers/concurrency_fixture.sql
race_dir=$(mktemp -d)
psql -X -v ON_ERROR_STOP=1 > "$race_dir/a.log" 2>&1 <<'SQL' &
BEGIN;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.set_dispatch_mode('10000000-0000-0000-0000-00000000000a','AUTO_QUEUE');
SELECT public.offer_order_to_driver('45000000-0000-0000-0000-000000000071');
SELECT pg_advisory_xact_lock(450071);
SELECT pg_sleep(2);
COMMIT;
SQL
first_pid=$!
# Sinal após o INSERT ainda não confirmado: B precisa disputar o índice único global.
for attempt in $(seq 1 30); do
 held=$(psql -X -At -c "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND locktype='advisory' AND objid=450071 AND granted)")
 [ "$held" = t ] && break
 sleep 0.05
done
[ "$held" = t ] || { cat "$race_dir/a.log"; exit 1; }
psql -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.set_dispatch_mode('10000000-0000-0000-0000-00000000000b','AUTO_QUEUE');
SELECT public.offer_order_to_driver('45000000-0000-0000-0000-000000000072');
COMMIT;
DO $$ BEGIN
 ASSERT (SELECT count(*)=1 FROM public.order_driver_offers WHERE driver_user_id='a0000000-0000-0000-0000-000000000045' AND status='OFFERED');
 ASSERT EXISTS(SELECT 1 FROM public.order_driver_offers WHERE order_id='45000000-0000-0000-0000-000000000072' AND driver_user_id='b0000000-0000-0000-0000-000000000045' AND status='OFFERED');
END $$;
SQL
wait "$first_pid"
echo 'PASS: disputa entre lojas usa o próximo entregador sem duplicar oferta'
