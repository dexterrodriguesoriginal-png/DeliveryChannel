#!/bin/sh
# Executado somente pelo harness local, no banco descartável gv3_run.
set -eu
P() { psql -X -q -v ON_ERROR_STOP=1 -d gv3_run "$@"; }
P >/dev/null <<'SQL'
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token) VALUES('d1000000-0000-0000-0000-000000000017','10000000-0000-0000-0000-00000000000a','Mesa 17','gv3-token-000000017');
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,status) VALUES('d2000000-0000-0000-0000-000000000017','10000000-0000-0000-0000-00000000000a','TABLE','d1000000-0000-0000-0000-000000000017','OPEN');
INSERT INTO public.orders(id,tenant_id,tab_id,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address) VALUES('e1000000-0000-0000-0000-000000000017','10000000-0000-0000-0000-00000000000a','d2000000-0000-0000-0000-000000000017','DINE_IN','DELIVERED',10,10,'CASH','PENDING','DINE_IN_QR',117,'Cliente','11999998888','Mesa 17');
SQL
# Mantém o lock depois de receber R$ 100 para uma conta de R$ 10 (troco R$ 90).
PGAPPNAME=garcom_v3_close_concurrency P >/tmp/gv3_close_first.log 2>&1 <<'SQL' &
BEGIN;
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.close_tab('d2000000-0000-0000-0000-000000000017','[{"method":"CASH","amount_cents":1000,"change_given_cents":9000}]');
SELECT pg_sleep(0.5);
COMMIT;
SQL
first=$!
i=0
while [ "$(psql -X -At -d gv3_run -c "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='garcom_v3_close_concurrency' AND wait_event='PgSleep')")" != t ]; do
 i=$((i+1))
 if [ "$i" -ge 100 ] || ! kill -0 "$first" 2>/dev/null; then cat /tmp/gv3_close_first.log; exit 1; fi
 sleep 0.01
done
P >/tmp/gv3_close_second.log 2>&1 <<'SQL' &
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.close_tab('d2000000-0000-0000-0000-000000000017','[{"method":"CASH","amount_cents":1000}]');
SQL
second=$!
P >/tmp/gv3_order_concurrent.log 2>&1 <<'SQL' &
INSERT INTO public.orders(id,tenant_id,tab_id,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address) VALUES('e1000000-0000-0000-0000-000000000018','10000000-0000-0000-0000-00000000000a','d2000000-0000-0000-0000-000000000017','DINE_IN','PENDING',10,10,'CASH','PENDING','DINE_IN_QR',118,'Cliente','11999998888','Mesa 17');
SQL
order_pid=$!
wait "$first" || { cat /tmp/gv3_close_first.log; exit 1; }
if wait "$second"; then echo 'FALHOU: segundo fechamento concorrente foi aceito'; exit 1; fi
if wait "$order_pid"; then echo 'FALHOU: novo consumo concorrente entrou em conta encerrada'; exit 1; fi
grep -q TAB_CLOSED /tmp/gv3_close_second.log || { cat /tmp/gv3_close_second.log; exit 1; }
grep -q TAB_PAYMENT_IN_PROGRESS /tmp/gv3_order_concurrent.log || { cat /tmp/gv3_order_concurrent.log; exit 1; }
P >/dev/null <<'SQL'
SET t.suite='garcom_v3';
SELECT t.is((SELECT count(*) FROM public.tab_payments WHERE tab_id='d2000000-0000-0000-0000-000000000017'),1::bigint,'A5 concorrência: dois caixas registram só um pagamento');
SELECT t.is((SELECT change_given_cents FROM public.tab_payments WHERE tab_id='d2000000-0000-0000-0000-000000000017'),9000,'A4: dinheiro aceita nota maior que o dobro da conta e troco correto');
SELECT t.is((SELECT count(*) FROM public.orders WHERE tab_id='d2000000-0000-0000-0000-000000000017'),1::bigint,'A5 concorrência: consumo novo não entra depois do fechamento');
SQL

