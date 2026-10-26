\set A '\'10000000-0000-0000-0000-00000000000a\''
-- Pedidos de teste
SELECT set_config('t.o1', t.mk_order(:A,'PENDING')::text, false);
SELECT set_config('t.o2', t.mk_order(:A,'PENDING','PICKUP')::text, false);
SELECT set_config('t.o3', t.mk_order(:A,'WAITING_FOR_DRIVER')::text, false);
SELECT set_config('t.o4', t.mk_order(:A,'PREPARING')::text, false);
SELECT set_config('t.o5', t.mk_order(:A,'PENDING','DELIVERY','PIX','PENDING')::text, false);
SELECT set_config('t.o6', t.mk_order(:A,'READY')::text, false);
SELECT set_config('t.stock_a1', t.stock('d0000000-0000-0000-0000-0000000000a1')::text, false);

-- Superusuário/DEFINER também não altera campo financeiro (trigger INVOKER)
SELECT t.throws(format($$UPDATE public.orders SET total_amount = 1 WHERE id = %L$$, current_setting('t.o1')), 'ORDER_FIELD_IMMUTABLE', 'trigger: total_amount imutável até para superusuário');
SELECT t.throws(format($$UPDATE public.orders SET tenant_id = '10000000-0000-0000-0000-00000000000b' WHERE id = %L$$, current_setting('t.o1')), 'ORDER_FIELD_IMMUTABLE', 'trigger: tenant_id imutável');
SELECT t.throws(format($$UPDATE public.order_items SET unit_price = 0 WHERE order_id = %L$$, current_setting('t.o1')), 'ORDER_ITEM_IMMUTABLE', 'trigger: item de pedido imutável');
SELECT t.lives(format($$UPDATE public.orders SET notes = 'obs' WHERE id = %L$$, current_setting('t.o1')), 'trigger: notes continua mutável');

SET ROLE authenticated;
-- OPERATOR
SELECT t.login('a0000000-0000-0000-0000-000000000003');
SELECT t.throws(format($$UPDATE public.orders SET total_amount = 1 WHERE id = %L$$, current_setting('t.o1')), 'permission denied', 'OPERATOR: UPDATE direto em orders negado');
SELECT t.throws($$INSERT INTO public.orders (tenant_id, customer_name, customer_phone, delivery_address, subtotal, total_amount, payment_method) VALUES ('10000000-0000-0000-0000-00000000000a','x','1','r',1,1,'CASH')$$, 'permission denied', 'authenticated: INSERT direto em orders negado');
SELECT t.throws(format($$UPDATE public.order_items SET unit_price = 0 WHERE order_id = %L$$, current_setting('t.o1')), 'permission denied', 'OPERATOR: UPDATE em order_items negado (policy FOR ALL removida)');
SELECT t.throws(format($$INSERT INTO public.order_status_history (order_id, status, changed_by) VALUES (%L,'READY','x')$$, current_setting('t.o1')), 'permission denied', 'authenticated: INSERT em order_status_history negado');
SELECT t.lives(format($$SELECT public.update_order_status(%L,'CONFIRMED')$$, current_setting('t.o1')), 'OPERATOR: PENDING→CONFIRMED');
SELECT t.throws(format($$SELECT public.update_order_status(%L,'PENDING')$$, current_setting('t.o1')), 'TRANSITION_FORBIDDEN', 'OPERATOR: retrocesso proibido');
SELECT t.throws(format($$SELECT public.update_order_status(%L,'CANCELLED','x')$$, current_setting('t.o4')), 'TRANSITION_FORBIDDEN', 'OPERATOR: não cancela pedido em PREPARING');
SELECT t.throws(format($$SELECT public.update_order_status(%L,'CANCELLED')$$, current_setting('t.o1')), 'NOTE_REQUIRED', 'cancelamento exige nota');
SELECT t.lives(format($$SELECT public.update_order_status(%L,'CANCELLED','cliente desistiu')$$, current_setting('t.o1')), 'OPERATOR: cancela CONFIRMED com nota');
SELECT t.is(t.stock('d0000000-0000-0000-0000-0000000000a1'), current_setting('t.stock_a1')::int, 'cancelamento devolve estoque no servidor (fase 1: reserva na aceitação −1, estorno +1 = saldo líquido inalterado)');
SELECT t.is(t.sq(format($$SELECT count(*) FROM public.inventory_movements WHERE reference_id = %L AND type = 'ESTORNO'$$, current_setting('t.o1'))), '1', 'devolução registrada uma única vez (ESTORNO)');
SELECT t.throws(format($$SELECT public.update_order_status(%L,'CANCELLED','de novo')$$, current_setting('t.o1')), 'ORDER_CANCELLED_IS_FINAL', 'cancelar de novo é recusado');
SELECT t.throws(format($$SELECT public.update_order_status(%L,'READY')$$, current_setting('t.o1')), 'ORDER_CANCELLED_IS_FINAL', 'OPERATOR: cancelado não reabre');
SELECT t.throws(format($$SELECT public.update_order_payment_status(%L,'PAID')$$, current_setting('t.o5')), 'ORDER_NOT_FOUND', 'OPERATOR: não altera pagamento');

-- OWNER
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.throws(format($$SELECT public.update_order_status(%L,'PENDING')$$, current_setting('t.o1')), 'ORDER_CANCELLED_IS_FINAL', 'F5: OWNER não reabre pedido CANCELLED');
SELECT t.throws(format($$UPDATE public.orders SET status = 'PENDING' WHERE id = %L$$, current_setting('t.o1')), 'permission denied', 'OWNER: UPDATE direto negado (policy orders_staff_update removida)');
SELECT t.lives($$SELECT public.update_order_status('0d000000-0000-0000-0000-0000000000a2','PREPARING')$$, 'pedido legado com total inconsistente ainda muda de status');
SELECT t.ok(t.sq(format($$SELECT changed_by FROM public.order_status_history WHERE order_id = %L AND status = 'CANCELLED'$$, current_setting('t.o1'))) LIKE '%(OPERATOR)', 'histórico registra o usuário e o papel');
SELECT t.ok(t.sq(format($$SELECT count(*) FROM public.audit_logs WHERE resource_id = %L AND action = 'ORDER_STATUS_CHANGED'$$, current_setting('t.o1')))::int >= 2, 'auditoria de mudança de status');

-- CASHIER (retirada: READY→DELIVERED; pagamento)
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.lives(format($$SELECT public.update_order_status(%L,'CONFIRMED')$$, current_setting('t.o2')), 'CASHIER: PENDING→CONFIRMED');
SELECT t.lives(format($$SELECT public.update_order_status(%L,'PREPARING')$$, current_setting('t.o2')), 'CASHIER: →PREPARING');
SELECT t.lives(format($$SELECT public.update_order_status(%L,'READY')$$, current_setting('t.o2')), 'CASHIER: →READY');
SELECT t.throws(format($$SELECT public.update_order_status(%L,'WAITING_FOR_DRIVER')$$, current_setting('t.o2')), 'TRANSITION_FORBIDDEN', 'CASHIER: retirada não vai para WAITING_FOR_DRIVER');
SELECT t.lives(format($$SELECT public.update_order_status(%L,'DELIVERED')$$, current_setting('t.o2')), 'CASHIER: retirada READY→DELIVERED');
SELECT t.lives(format($$SELECT public.update_order_payment_status(%L,'PAID')$$, current_setting('t.o5')), 'CASHIER: PENDING→PAID');
SELECT t.throws(format($$SELECT public.update_order_payment_status(%L,'REFUNDED','x')$$, current_setting('t.o5')), 'somente OWNER/MANAGER', 'CASHIER: não registra estorno');

-- MANAGER (estorno)
SELECT t.login('a0000000-0000-0000-0000-000000000002');
SELECT t.throws(format($$SELECT public.update_order_payment_status(%L,'REFUNDED')$$, current_setting('t.o5')), 'NOTE_REQUIRED', 'estorno exige nota');
SELECT t.lives(format($$SELECT public.update_order_payment_status(%L,'REFUNDED','devolução')$$, current_setting('t.o5')), 'MANAGER: PAID→REFUNDED');
SELECT t.throws(format($$SELECT public.update_order_payment_status(%L,'PAID')$$, current_setting('t.o5')), 'PAYMENT_TRANSITION_FORBIDDEN|ORDER_REFUND_IS_FINAL', 'REFUNDED é terminal');

-- DELIVERY_MANAGER
SELECT t.login('a0000000-0000-0000-0000-000000000006');
SELECT t.lives(format($$SELECT public.update_order_status(%L,'OUT_FOR_DELIVERY')$$, current_setting('t.o3')), 'DELIVERY_MANAGER: WAITING→OUT_FOR_DELIVERY');
SELECT t.throws(format($$SELECT public.update_order_status(%L,'CONFIRMED')$$, current_setting('t.o4')), 'TRANSITION_FORBIDDEN', 'DELIVERY_MANAGER: não mexe na cozinha');

-- DRIVER: sem acesso à RPC de staff; RPC própria (005) continua funcionando
SELECT t.login('a0000000-0000-0000-0000-000000000005');
SELECT t.throws(format($$SELECT public.update_order_status(%L,'OUT_FOR_DELIVERY')$$, current_setting('t.o6')), 'ORDER_NOT_FOUND', 'DRIVER: update_order_status negado');
RESET ROLE;
SELECT t.lives(format($$UPDATE public.orders SET driver_id = 'a0000000-0000-0000-0000-000000000005' WHERE id = %L$$, current_setting('t.o6')), 'driver_id é mutável (RPCs 005)');
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000005');
SELECT t.lives(format($$SELECT public.update_driver_order_status(%L,'OUT_FOR_DELIVERY')$$, current_setting('t.o6')), 'DRIVER: update_driver_order_status (005) segue funcionando com as triggers novas');

-- Outro tenant e CEO/SUPER_ADMIN
SELECT t.login('b0000000-0000-0000-0000-000000000001');
SELECT t.throws(format($$SELECT public.update_order_status(%L,'CONFIRMED')$$, current_setting('t.o4')), 'ORDER_NOT_FOUND', 'OWNER de B não altera pedido de A');
SELECT t.login('c0000000-0000-0000-0000-000000000001');
SELECT t.throws(format($$SELECT public.update_order_status(%L,'READY')$$, current_setting('t.o4')), 'ORDER_NOT_FOUND', 'CEO: sem poder operacional escopado');

-- Exclusão de pedidos foi substituída por arquivamento reversível.
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.throws(format($$DELETE FROM public.orders WHERE id = %L$$, current_setting('t.o1')), 'permission denied', 'OWNER: exclusão de cancelado negada');
SELECT t.is(t.order_status(current_setting('t.o1')::uuid), 'CANCELLED', 'pedido cancelado preservado');
RESET ROLE;
SELECT t.throws(format($$DELETE FROM public.orders WHERE id = %L$$, current_setting('t.o1')), 'ORDER_DELETE_FORBIDDEN', 'trigger: nem operação de sistema exclui pedido');
