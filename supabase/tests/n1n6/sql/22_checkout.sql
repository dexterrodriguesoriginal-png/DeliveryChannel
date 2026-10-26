-- Checkout v1 (wrapper) e v2: auth obrigatória, preço no servidor, tenant + IDs, cupom atômico, estorno.
\set ITEMS '\'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":3},{"productId":"d0000000-0000-0000-0000-0000000000a2","quantity":1,"notes":"gelada"}]\''
SELECT set_config('t.s_a1', t.stock('d0000000-0000-0000-0000-0000000000a1')::text, false);
SET ROLE anon;
SELECT t.login(NULL);
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-a','X','11999998888','Rua',NULL,'PIX','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]')$$, 'permission denied', 'anon não compra (v2)');
SELECT t.throws($$SELECT public.process_checkout_atomic('adega-a','X','11999998888',NULL,'Rua',NULL,'PIX','DELIVERY',NULL,NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]')$$, 'permission denied', 'anon não compra (v1)');
RESET ROLE;
SET ROLE authenticated;
SELECT t.login(NULL);
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-a','X','11999998888','Rua',NULL,'PIX','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]')$$, 'AUTH_REQUIRED', 'sem auth.uid() não compra');
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT set_config('t.r1', public.process_checkout_atomic_v2('adega-a','Cliente Dois','(11) 97777-6666','Rua Y, 20',NULL,'PIX','DELIVERY','sem cebola', :ITEMS, 'dez10', '11111111-1111-1111-1111-111111111111')::text, false);
SELECT t.is((current_setting('t.r1')::jsonb ->> 'subtotal')::numeric, 45.00, 'subtotal = 3×10 + 1×15 (promo do produto) calculado no servidor');
SELECT t.is((current_setting('t.r1')::jsonb ->> 'discount')::numeric, 3.00, 'cupom 10% só sobre itens não promocionais (30)');
SELECT t.is((current_setting('t.r1')::jsonb ->> 'delivery_fee')::numeric, 5.00, 'taxa de entrega das configurações');
SELECT t.is((current_setting('t.r1')::jsonb ->> 'total_amount')::numeric, 47.00, 'total = 45 − 3 + 5');
SELECT t.is((current_setting('t.r1')::jsonb -> 'payment' ->> 'pix_available')::boolean, true, 'PIX disponível para o pedido');
RESET ROLE;
SELECT set_config('t.o1', current_setting('t.r1')::jsonb ->> 'order_id', false);
SELECT t.ok((t.order_row(current_setting('t.o1')::uuid) ->> 'origin') = 'storefront' AND (t.order_row(current_setting('t.o1')::uuid) ->> 'payment_status') = 'PENDING', 'origem storefront e PIX PENDING');
SELECT t.is((t.order_row(current_setting('t.o1')::uuid) ->> 'prep_time_minutes')::int, (SELECT default_prep_time_minutes FROM public.tenant_settings WHERE tenant_id='10000000-0000-0000-0000-00000000000a'), 'prep_time do pedido vem das configurações (sem 30 fixo)');
SELECT t.is(t.sq(format($$SELECT string_agg(discount_amount::text || '/' || item_kind || '/' || COALESCE(original_unit_price::text,'-'), ',' ORDER BY product_id) FROM public.order_items WHERE order_id = %L$$, current_setting('t.o1'))), '3.00/PRODUCT/10.00,0.00/PRODUCT/20.00', 'rateio do desconto só no item não promocional; preço original gravado');
SELECT t.is(t.sq($$SELECT times_used FROM public.coupons WHERE code='DEZ10'$$), '1', 'cupom consumido (times_used = 1)');
SELECT t.is(t.sq(format($$SELECT status || '/' || channel FROM public.coupon_redemptions WHERE order_id = %L$$, current_setting('t.o1'))), 'APPLIED/ONLINE', 'resgate APPLIED canal ONLINE');
SELECT t.is(t.stock('d0000000-0000-0000-0000-0000000000a1'), current_setting('t.s_a1')::int - 3, 'estoque baixado no servidor');
SELECT t.is(t.sq(format($$SELECT count(*) FROM public.inventory_movements WHERE reference_id = %L AND type='VENDA'$$, current_setting('t.o1'))), '2', 'kardex VENDA por produto');

SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000008');
-- Idempotência
SELECT t.is((public.process_checkout_atomic_v2('adega-a','Cliente Dois','11977776666','Rua Y, 20',NULL,'PIX','DELIVERY',NULL, :ITEMS, 'DEZ10', '11111111-1111-1111-1111-111111111111') ->> 'order_id'), current_setting('t.o1'), 'idempotência: mesma chave devolve o mesmo pedido');
SELECT t.login('a0000000-0000-0000-0000-000000000007');
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-a','Cliente Um','11977776666','Rua',NULL,'PIX','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]',NULL,'11111111-1111-1111-1111-111111111111')$$, 'IDEMPOTENCY_CONFLICT', 'idempotência: chave de outro usuário recusada');
-- Validações
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-a','Cliente Um','11977776666','Rua',NULL,'PIX','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1,"price":0.01}]')$$, 'UNEXPECTED_FIELD', 'preço do cliente rejeitado');
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-a','Cliente Um','11977776666','Rua',NULL,'PIX','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1,"discount":5}]')$$, 'UNEXPECTED_FIELD', 'desconto do cliente rejeitado');
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-a','Cliente Um','11977776666','Rua',NULL,'PIX','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000b1","quantity":1}]')$$, 'PRODUCT_NOT_FOUND', 'regra 25: produto de outro tenant recusado');
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-a','Cliente Um','11977776666','Rua',NULL,'PIX','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a3","quantity":1}]')$$, 'PRODUCT_UNAVAILABLE', 'produto inativo recusado');
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-a','Cliente Um','11977776666','Rua',NULL,'PIX','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a4","quantity":2}]')$$, 'OUT_OF_STOCK', 'estoque insuficiente');
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-a','Cliente Um','11977776666','',NULL,'PIX','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]')$$, 'ADDRESS_REQUIRED', 'endereço obrigatório em DELIVERY');
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-a','Cliente Um','11977776666','Rua',NULL,'BOLETO','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]')$$, 'INVALID_PAYMENT_METHOD', 'forma de pagamento inválida');
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-a','Cliente Um','11977776666','Rua',NULL,'PIX','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]','PRIMEIRA')$$, 'COUPON_FIRST_ORDER_ONLY', 'cupom de primeira compra recusado para cliente com pedidos');
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-a','Cliente Um','11977776666','Rua',NULL,'PIX','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a2","quantity":1}]','DEZ10')$$, 'COUPON_NOT_APPLICABLE_PROMO', 'decisão 8: cupom sobre item promocional recusado');
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-a','Cliente Um','11977776666','Rua',NULL,'PIX','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]','BSOMENTE')$$, 'COUPON_INVALID', 'cupom de outro tenant recusado no checkout');
-- v1 continua funcionando (mesma assinatura, RETURNS uuid, sem cupom)
SELECT set_config('t.v1', public.process_checkout_atomic('adega-a','Cliente Um','11977776666','x@x.com','Rua Z',NULL,'CASH','DELIVERY',NULL,'direct','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]')::text, false);
RESET ROLE;
SELECT t.ok(current_setting('t.v1') ~ '^[0-9a-f-]{36}$', 'v1: retorna UUID');
SELECT t.is((t.order_row(current_setting('t.v1')::uuid) ->> 'total_amount')::numeric, 15.00, 'v1: preço do servidor (10 + entrega 5), sem cupom');
SELECT t.is((t.order_row(current_setting('t.v1')::uuid) ->> 'customer_email'), 'cliente1@test.local', 'v1: e-mail vem de auth.users');
-- Loja fechada
UPDATE public.tenant_settings SET is_open = false WHERE tenant_id = '10000000-0000-0000-0000-00000000000b';
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000007');
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-b','Cliente Um','11977776666','Rua',NULL,'CASH','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000b1","quantity":1}]')$$, 'STORE_CLOSED', 'loja fechada não vende');
RESET ROLE;
UPDATE public.tenant_settings SET is_open = true WHERE tenant_id = '10000000-0000-0000-0000-00000000000b';

-- Limite por cliente e estorno (decisão 28)
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT set_config('t.u1', public.process_checkout_atomic_v2('adega-a','Cliente Dois','11977776666','Rua',NULL,'CASH','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]','UMAVEZ') ->> 'order_id', false);
SELECT t.throws($$SELECT public.process_checkout_atomic_v2('adega-a','Cliente Dois','11977776666','Rua',NULL,'CASH','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]','UMAVEZ')$$, 'COUPON_CUSTOMER_LIMIT', 'limite por cliente');
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.lives(format($$SELECT public.update_order_status(%L,'CANCELLED','teste estorno')$$, current_setting('t.u1')), 'OWNER cancela pedido com cupom');
RESET ROLE;
SELECT t.is(t.sq(format($$SELECT status || '/' || reversal_reason || '/' || (reversed_at IS NOT NULL) FROM public.coupon_redemptions WHERE order_id = %L$$, current_setting('t.u1'))), 'REVERSED/ORDER_CANCELLED/true', 'estorno: resgate mantido como REVERSED (histórico)');
SELECT t.is(t.sq($$SELECT times_used FROM public.coupons WHERE code='UMAVEZ'$$), '0', 'estorno: contador devolvido');
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT t.lives($$SELECT public.process_checkout_atomic_v2('adega-a','Cliente Dois','11977776666','Rua',NULL,'CASH','DELIVERY',NULL,'[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]','UMAVEZ')$$, 'após estorno o cliente pode usar de novo');
-- Estorno de pagamento também devolve o cupom
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.lives(format($$SELECT public.update_order_payment_status(%L,'PAID')$$, current_setting('t.o1')), 'CASHIER marca PAID');
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.lives(format($$SELECT public.update_order_payment_status(%L,'REFUNDED','devolvido')$$, current_setting('t.o1')), 'OWNER registra REFUNDED');
RESET ROLE;
SELECT t.is(t.sq(format($$SELECT status || '/' || reversal_reason FROM public.coupon_redemptions WHERE order_id = %L$$, current_setting('t.o1'))), 'REVERSED/ORDER_REFUNDED', 'REFUNDED estorna o cupom');
SELECT t.is(t.sq($$SELECT times_used FROM public.coupons WHERE code='DEZ10'$$), '0', 'contador DEZ10 devolvido após REFUNDED');
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.lives(format($$SELECT public.update_order_status(%L,'CANCELLED','após estorno')$$, current_setting('t.o1')), 'cancelar pedido já estornado: no-op no cupom');
RESET ROLE;
SELECT t.is(t.sq($$SELECT times_used FROM public.coupons WHERE code='DEZ10'$$), '0', 'inválido→inválido não estorna duas vezes');
SELECT t.throws(format($$DELETE FROM public.orders WHERE id = %L$$, current_setting('t.o1')), 'ORDER_DELETE_FORBIDDEN', 'pedido com histórico de cupom não é apagado (histórico preservado)');
SELECT t.throws($$DELETE FROM public.coupons WHERE code='DEZ10'$$, 'foreign key|coupon_redemptions', 'cupom com histórico não é apagado (arquivar)');
SELECT t.ok((SELECT bool_and(drift = 0) FROM (SELECT c.times_used - (SELECT count(*) FROM public.coupon_redemptions r WHERE r.coupon_id = c.id AND r.status='APPLIED') AS drift FROM public.coupons c) x), 'invariante times_used = resgates APPLIED');
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.ok((SELECT bool_and(drift = 0) FROM public.audit_coupon_counters('10000000-0000-0000-0000-00000000000a')), 'audit_coupon_counters sem divergência');
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.throws($$SELECT * FROM public.audit_coupon_counters('10000000-0000-0000-0000-00000000000a')$$, 'FORBIDDEN', 'CASHIER não audita contadores');
RESET ROLE;
