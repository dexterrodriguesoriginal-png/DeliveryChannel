#!/usr/bin/env bash
# Concorrência REAL: N conexões psql paralelas independentes contra o PostgreSQL LOCAL.
# 1) cupom com limite 20 disputado por 30 clientes: exatamente 20 sucessos, 21º+ falham (COUPON_EXHAUSTED).
# 2) produto com estoque 1 disputado por 8 clientes: exatamente 1 sucesso.
# 3) dois cancelamentos simultâneos do mesmo pedido com cupom: estorno aplicado uma única vez.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../harness/lib.sh"
set +e
DB="$1"
OUT="$(mktemp -d /tmp/n1n6_conc.XXXX)"
Q() { psql -X -At -d "$DB" -c "$1"; }
rec() { Q "INSERT INTO t.results(suite,name,ok,detail) VALUES ('80_concurrency', \$n\$$1\$n\$, $2, \$d\$$3\$d\$)" >/dev/null; }

# usuários clientes sintéticos
Q "INSERT INTO auth.users (id, email) SELECT ('e1000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'conc' || g || '@test.local' FROM generate_series(1,40) g ON CONFLICT DO NOTHING" >/dev/null
Q "UPDATE public.products SET stock_quantity = 1 WHERE id = 'd0000000-0000-0000-0000-0000000000a4'" >/dev/null 2>&1

START=$(date -d '+3 seconds' '+%Y-%m-%d %H:%M:%S%z')
run_buyer() { # $1 = idx, $2 = items json, $3 = coupon or NULL, $4 = tag
  local uid; uid=$(printf 'e1000000-0000-0000-0000-%012d' "$1")
  psql -X -At -v ON_ERROR_STOP=1 -d "$DB" >"$OUT/$4_$1.out" 2>&1 <<SQL
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','$uid','role','authenticated')::text, false);
SELECT pg_sleep(GREATEST(0, extract(epoch FROM ('$START'::timestamptz - clock_timestamp()))));
SELECT public.process_checkout_atomic_v2('adega-a','Cliente Conc $1','11900000$(printf '%03d' "$1")','Rua C',NULL,'CASH','DELIVERY',NULL,'$2'::jsonb, $3) ->> 'order_id';
SQL
}
for i in $(seq 1 30); do run_buyer "$i" '[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]' "'CONC20'" coupon & done
wait
OK=$(grep -l -E '^[0-9a-f-]{36}$' "$OUT"/coupon_*.out | wc -l)
EXH=$(grep -l 'COUPON_EXHAUSTED' "$OUT"/coupon_*.out | wc -l)
OTHER=$((30 - OK - EXH))
USED=$(Q "SELECT times_used FROM public.coupons WHERE code='CONC20'")
APPLIED=$(Q "SELECT count(*) FROM public.coupon_redemptions r JOIN public.coupons c ON c.id=r.coupon_id WHERE c.code='CONC20' AND r.status='APPLIED'")
echo "cupom: sucesso=$OK esgotado=$EXH outros=$OTHER times_used=$USED applied=$APPLIED"
rec "cupom limite 20 sob 30 conexões paralelas: exatamente 20 pedidos com cupom" "$([ "$OK" = 20 ] && echo true || echo false)" "sucesso=$OK"
rec "cupom: 21º em diante falha com COUPON_EXHAUSTED (10 falhas)" "$([ "$EXH" = 10 ] && [ "$OTHER" = 0 ] && echo true || echo false)" "esgotado=$EXH outros=$OTHER"
rec "cupom: times_used = 20 = resgates APPLIED" "$([ "$USED" = 20 ] && [ "$APPLIED" = 20 ] && echo true || echo false)" "times_used=$USED applied=$APPLIED"

START=$(date -d '+3 seconds' '+%Y-%m-%d %H:%M:%S%z')
for i in $(seq 31 38); do run_buyer "$i" '[{"productId":"d0000000-0000-0000-0000-0000000000a4","quantity":1}]' "NULL" stock & done
wait
SOK=$(grep -l -E '^[0-9a-f-]{36}$' "$OUT"/stock_*.out | wc -l)
SOUT=$(grep -l 'OUT_OF_STOCK' "$OUT"/stock_*.out | wc -l)
STOCK=$(Q "SELECT stock_quantity FROM public.products WHERE id='d0000000-0000-0000-0000-0000000000a4'")
echo "estoque: sucesso=$SOK sem_estoque=$SOUT estoque_final=$STOCK"
rec "estoque 1 sob 8 compradores paralelos: 1 sucesso, 7 OUT_OF_STOCK, estoque 0" "$([ "$SOK" = 1 ] && [ "$SOUT" = 7 ] && [ "$STOCK" = 0 ] && echo true || echo false)" "ok=$SOK out=$SOUT stock=$STOCK"

# Dois pedidos aceitos concorrem pela última unidade no gatilho de reserva.
PRODUCT='d0000000-0000-0000-0000-0000000000a4'
Q "UPDATE public.products SET stock_quantity = 1 WHERE id = '$PRODUCT';
   INSERT INTO public.inventory_movements
     (tenant_id,product_id,product_name,quantity,type,reason,previous_stock,new_stock,created_by_name,location_id,unit)
   SELECT p.tenant_id,p.id,p.name,1 - COALESCE(b.ledger_quantity,0),'COUNT_ADJUSTMENT',
          'Preparação da disputa concorrente',0,1,'Harness',l.id,p.stock_unit
   FROM public.products p
   JOIN public.stock_locations l ON l.tenant_id=p.tenant_id AND l.is_default
   LEFT JOIN public.stock_location_balances b ON b.tenant_id=p.tenant_id AND b.product_id=p.id AND b.location_id=l.id
   WHERE p.id='$PRODUCT'" >/dev/null
ORDER_A=$(Q "SELECT t.mk_stock_order('$PRODUCT'::uuid)")
ORDER_B=$(Q "SELECT t.mk_stock_order('$PRODUCT'::uuid)")
START=$(date -d '+3 seconds' '+%Y-%m-%d %H:%M:%S%z')
run_reserver() {
  local order="$1" tag="$2"
  psql -X -At -v ON_ERROR_STOP=1 -d "$DB" >"$OUT/$tag.out" 2>&1 <<SQL
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, false);
SELECT pg_sleep(GREATEST(0, extract(epoch FROM ('$START'::timestamptz - clock_timestamp()))));
SELECT public.update_order_status('$order','CONFIRMED',NULL) ->> 'status';
SQL
}
run_reserver "$ORDER_A" reserve_a &
run_reserver "$ORDER_B" reserve_b &
wait
RA_OK=$(grep -l '^CONFIRMED$' "$OUT"/reserve_*.out | wc -l)
RA_OUT=$(grep -l 'OUT_OF_STOCK' "$OUT"/reserve_*.out | wc -l)
RA_STATUS=$(Q "SELECT count(*) FROM public.orders WHERE id IN ('$ORDER_A','$ORDER_B') AND status='CONFIRMED'")
RA_PENDING=$(Q "SELECT count(*) FROM public.orders WHERE id IN ('$ORDER_A','$ORDER_B') AND status='PENDING'")
RA_STOCK=$(Q "SELECT stock_quantity FROM public.products WHERE id='$PRODUCT'")
RA_HELD=$(Q "SELECT count(*) FROM public.stock_reservations WHERE order_id IN ('$ORDER_A','$ORDER_B') AND status='ACTIVE'")
echo "reserva: aceitos=$RA_OK sem_estoque=$RA_OUT estoque=$RA_STOCK reservados=$RA_HELD"
rec "reserva da última unidade sob duas aceitações concorrentes: exatamente um pedido confirmado" "$([ "$RA_OK" = 1 ] && [ "$RA_OUT" = 1 ] && [ "$RA_STATUS" = 1 ] && [ "$RA_PENDING" = 1 ] && [ "$RA_STOCK" = 0 ] && [ "$RA_HELD" = 1 ] && echo true || echo false)" "ok=$RA_OK out=$RA_OUT status=$RA_STATUS pending=$RA_PENDING stock=$RA_STOCK reserved=$RA_HELD"

# Cancelamentos simultâneos do mesmo pedido com cupom
ORD=$(grep -h -E '^[0-9a-f-]{36}$' "$OUT"/coupon_*.out | head -1)
START=$(date -d '+3 seconds' '+%Y-%m-%d %H:%M:%S%z')
for k in 1 2; do
  psql -X -At -d "$DB" >"$OUT/cancel_$k.out" 2>&1 <<SQL &
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, false);
SELECT pg_sleep(GREATEST(0, extract(epoch FROM ('$START'::timestamptz - clock_timestamp()))));
SELECT public.update_order_status('$ORD','CANCELLED','concorrência') ->> 'status';
SQL
done
wait
COK=$(grep -l '^CANCELLED$' "$OUT"/cancel_*.out | wc -l)
CFIN=$(grep -l 'ORDER_CANCELLED_IS_FINAL' "$OUT"/cancel_*.out | wc -l)
USED2=$(Q "SELECT times_used FROM public.coupons WHERE code='CONC20'")
EST=$(Q "SELECT count(*) FROM public.inventory_movements WHERE reference_id='$ORD' AND type='ESTORNO'")
echo "cancelamento: ok=$COK final=$CFIN times_used=$USED2 estornos_estoque=$EST"
rec "2 cancelamentos simultâneos: 1 efetivo, 1 recusado; cupom estornado 1 vez (20→19); estoque devolvido 1 vez" "$([ "$COK" = 1 ] && [ "$CFIN" = 1 ] && [ "$USED2" = 19 ] && [ "$EST" = 1 ] && echo true || echo false)" "ok=$COK final=$CFIN used=$USED2 est=$EST"
# 4) Checkout promocional: oferta com limite 5 disputada por 12 compradores paralelos (qty 1)
Q "UPDATE public.offers SET has_promo_checkout = true, promo_price = 7, promo_usage_limit = 5, promo_times_used = 0, promo_usage_limit_per_customer = NULL, promo_max_qty_per_order = NULL, promo_fulfillment = 'BOTH' WHERE id = 'e0000000-0000-0000-0000-0000000000a5'" >/dev/null 2>&1 || \
Q "INSERT INTO public.offers (id, tenant_id, product_id, title, image_url, has_promo_checkout, promo_price, promo_usage_limit) VALUES ('e0000000-0000-0000-0000-0000000000c5','10000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000a5','Conc','x',true,7,5)" >/dev/null
PROMO_OFFER=$(Q "SELECT id FROM public.offers WHERE id IN ('e0000000-0000-0000-0000-0000000000a5','e0000000-0000-0000-0000-0000000000c5') AND has_promo_checkout LIMIT 1")
START=$(date -d '+3 seconds' '+%Y-%m-%d %H:%M:%S%z')
for i in $(seq 1 12); do
  uid=$(printf 'e1000000-0000-0000-0000-%012d' "$i")
  psql -X -At -v ON_ERROR_STOP=1 -d "$DB" >"$OUT/promo_$i.out" 2>&1 <<SQL &
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','$uid','role','authenticated')::text, false);
SELECT pg_sleep(GREATEST(0, extract(epoch FROM ('$START'::timestamptz - clock_timestamp()))));
SELECT public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'$PROMO_OFFER',1,'Cliente Promo $i','11910000$(printf '%03d' "$i")','',NULL,'CASH','PICKUP',NULL) ->> 'order_id';
SQL
done
wait
POK=$(grep -l -E '^[0-9a-f-]{36}$' "$OUT"/promo_*.out | wc -l)
PEXH=$(grep -l 'PROMO_EXHAUSTED' "$OUT"/promo_*.out | wc -l)
PUSED=$(Q "SELECT promo_times_used FROM public.offers WHERE id='$PROMO_OFFER'")
echo "promo: sucesso=$POK esgotado=$PEXH promo_times_used=$PUSED"
rec "checkout promocional limite 5 sob 12 conexões paralelas: 5 sucessos, 7 PROMO_EXHAUSTED, contador 5" "$([ "$POK" = 5 ] && [ "$PEXH" = 7 ] && [ "$PUSED" = 5 ] && echo true || echo false)" "ok=$POK exh=$PEXH used=$PUSED"
rm -rf "$OUT"
