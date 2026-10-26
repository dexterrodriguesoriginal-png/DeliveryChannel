\set ON_ERROR_STOP 1
BEGIN;
CREATE FUNCTION pg_temp.gate_denied(command text, expected text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE command;
 RAISE EXCEPTION 'Expected 42501: %',command;
EXCEPTION WHEN insufficient_privilege THEN
 IF expected IS NOT NULL AND SQLERRM<>expected THEN RAISE; END IF;
END $$;
-- Isolated customer/product: independent of older suites, current stock and rate-limit buckets.
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ('a4300000-0000-0000-0000-000000000007','gate.customer@test.local','{"name":"Cliente Gate"}');
INSERT INTO public.legal_acceptances(user_id,audience,version)
 SELECT u.id,a.audience,public._legal_version() FROM auth.users u CROSS JOIN (VALUES ('owner'),('customer')) a(audience) ON CONFLICT DO NOTHING;
UPDATE public.tenant_settings SET is_open=true,min_order_value=0 WHERE tenant_id='10000000-0000-0000-0000-00000000000a';
INSERT INTO public.products(id,tenant_id,name,image_url,price,stock_quantity,is_active)
 VALUES('d4300000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','Produto Gate','https://example.test/gate.png',10,1000,true);
INSERT INTO public.kitchen_settings(tenant_id,enabled) VALUES('10000000-0000-0000-0000-00000000000a',true)
 ON CONFLICT(tenant_id) DO UPDATE SET enabled=true,pin_hash=NULL;
INSERT INTO public.store_payment_accounts(tenant_id,provider,status,accepts_pix,accepts_card)
 VALUES('10000000-0000-0000-0000-00000000000a','manual_pix','connected',true,false),
 ('10000000-0000-0000-0000-00000000000a','infinitepay','connected',true,true),
 ('10000000-0000-0000-0000-00000000000a','mercadopago','connected',true,true)
 ON CONFLICT(tenant_id,provider) DO UPDATE SET status='connected',accepts_pix=true,accepts_card=excluded.accepts_card;
INSERT INTO public.drivers(user_id,tenant_id,full_name,status,approval_status)
 SELECT 'a0000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-00000000000a','Entregador Gate','AVAILABLE','APPROVED'
 WHERE NOT EXISTS(SELECT 1 FROM public.drivers WHERE user_id='a0000000-0000-0000-0000-000000000005' AND tenant_id='10000000-0000-0000-0000-00000000000a');
UPDATE public.drivers SET status='AVAILABLE',approval_status='APPROVED' WHERE user_id='a0000000-0000-0000-0000-000000000005' AND tenant_id='10000000-0000-0000-0000-00000000000a';
INSERT INTO public.orders(id,tenant_id,customer_name,customer_phone,delivery_address,subtotal,delivery_fee,total_amount,payment_method,payment_status,fulfillment_type,status,driver_id,awaiting_online_payment)
 VALUES('43000000-0000-0000-0000-00000000000d','10000000-0000-0000-0000-00000000000a','Legado atribuído','11999990000','Rua',10,0,10,'CREDIT_CARD','PENDING','DELIVERY','READY','a0000000-0000-0000-0000-000000000005',true);
UPDATE public.offers SET has_promo_checkout=true,promo_price=8 WHERE id='e0000000-0000-0000-0000-0000000000a1';
SELECT set_config('request.jwt.claim.sub','a4300000-0000-0000-0000-000000000007',true);
SET LOCAL ROLE authenticated;
SELECT set_config('gate.pix',(public.process_checkout_atomic_v2('adega-a','Cliente Gate','11999990000','Rua Gate',NULL,'PIX','DELIVERY',NULL,
 '[{"productId":"d4300000-0000-0000-0000-000000000001","quantity":2}]')->>'order_id'),true);
SELECT set_config('gate.card',(public.process_checkout_atomic_v3('adega-a','Cliente Gate','11999990000','Retirada',NULL,'CREDIT_CARD','PICKUP',NULL,
 '[{"productId":"d4300000-0000-0000-0000-000000000001","quantity":1}]',NULL,NULL,NULL,true)->>'order_id'),true);
SELECT set_config('gate.cash',(public.process_checkout_atomic_v2('adega-a','Cliente Gate','11999990000','Rua Gate',NULL,'CASH','DELIVERY',NULL,
 '[{"productId":"d4300000-0000-0000-0000-000000000001","quantity":1}]')->>'order_id'),true);
SELECT set_config('gate.delivery_card',(public.process_checkout_atomic_v2('adega-a','Cliente Gate','11999990000','Rua Gate',NULL,'CREDIT_CARD','DELIVERY',NULL,
 '[{"productId":"d4300000-0000-0000-0000-000000000001","quantity":1}]')->>'order_id'),true);
SELECT set_config('gate.v1',public.process_checkout_atomic('adega-a','Cliente Gate','11999990000',NULL,'Rua Gate',NULL,'PIX','DELIVERY',NULL,'direct',
 '[{"productId":"d4300000-0000-0000-0000-000000000001","quantity":1}]')::text,true);
SELECT set_config('gate.manual',(public.process_checkout_atomic_v2('adega-a','Cliente Gate','11999990000','Rua Gate',NULL,'PIX','DELIVERY',NULL,
 '[{"productId":"d4300000-0000-0000-0000-000000000001","quantity":1}]')->>'order_id'),true);
SELECT set_config('gate.failed',(public.process_checkout_atomic_v2('adega-a','Cliente Gate','11999990000','Rua Gate',NULL,'PIX','DELIVERY',NULL,
 '[{"productId":"d4300000-0000-0000-0000-000000000001","quantity":1}]')->>'order_id'),true);
SELECT set_config('gate.expired',(public.process_checkout_atomic_v2('adega-a','Cliente Gate','11999990000','Rua Gate',NULL,'PIX','DELIVERY',NULL,
 '[{"productId":"d4300000-0000-0000-0000-000000000001","quantity":1}]')->>'order_id'),true);
SELECT set_config('gate.promo',(public.process_promotional_checkout_atomic('adega-a',NULL,NULL,'e0000000-0000-0000-0000-0000000000a1',1,
 'Cliente Gate','11999990000','Rua',NULL,'CREDIT_CARD','DELIVERY',NULL,NULL,NULL,true)->>'order_id'),true);
DO $$ BEGIN
 ASSERT (SELECT count(*)=5 FROM public.orders WHERE id IN (current_setting('gate.pix')::uuid,current_setting('gate.card')::uuid,current_setting('gate.cash')::uuid,current_setting('gate.delivery_card')::uuid,current_setting('gate.v1')::uuid)), 'customer lost order access';
 ASSERT EXISTS(SELECT 1 FROM public.order_items WHERE order_id=current_setting('gate.pix')::uuid), 'customer lost items';
 ASSERT public.get_customer_order_by_id(current_setting('gate.pix')::uuid) IS NOT NULL;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT bool_and(awaiting_online_payment) FROM public.orders WHERE id IN (current_setting('gate.pix')::uuid,current_setting('gate.card')::uuid,current_setting('gate.v1')::uuid)), 'checkout INSERT not gated';
 ASSERT NOT EXISTS(SELECT 1 FROM public.owner_notifications WHERE kind='ORDER_NEW' AND ref_id IN (current_setting('gate.pix')::uuid,current_setting('gate.card')::uuid,current_setting('gate.v1')::uuid)), 'premature notification';
 ASSERT (SELECT awaiting_online_payment FROM public.orders WHERE id=current_setting('gate.promo')::uuid), 'promotional checkout not gated';
 ASSERT (SELECT NOT awaiting_online_payment FROM public.orders WHERE id=current_setting('gate.cash')::uuid);
 ASSERT (SELECT NOT awaiting_online_payment FROM public.orders WHERE id=current_setting('gate.delivery_card')::uuid);
END $$;
-- B has its own manual payment. Knowing its order number must not grant access.
INSERT INTO public.orders(id,tenant_id,customer_name,customer_phone,delivery_address,subtotal,delivery_fee,total_amount,payment_method,payment_status,fulfillment_type,status,awaiting_online_payment)
 VALUES('43000000-0000-0000-0000-00000000000b','10000000-0000-0000-0000-00000000000b','Cliente B','11999990000','Rua B',10,0,10,'PIX','PENDING','DELIVERY','PENDING',true);
SELECT set_config('gate.number_b',(SELECT order_number::text FROM public.orders WHERE id='43000000-0000-0000-0000-00000000000b'),true);
SELECT set_config('gate.number_pix',(SELECT order_number::text FROM public.orders WHERE id=current_setting('gate.pix')::uuid),true);
SELECT set_config('gate.number_manual',(SELECT order_number::text FROM public.orders WHERE id=current_setting('gate.manual')::uuid),true);
SELECT set_config('gate.number_card',(SELECT order_number::text FROM public.orders WHERE id=current_setting('gate.card')::uuid),true);
-- Same visible totals before and after adding gated records, including CONFIRMED backfill.
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE uid text; BEGIN
 FOREACH uid IN ARRAY ARRAY['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000006'] LOOP
   PERFORM set_config('request.jwt.claim.sub',uid,true);
   ASSERT NOT EXISTS(SELECT 1 FROM public.orders WHERE awaiting_online_payment), 'staff reads gated order';
   ASSERT NOT EXISTS(SELECT 1 FROM public.order_items WHERE order_id=current_setting('gate.pix')::uuid), 'staff reads items';
   ASSERT NOT EXISTS(SELECT 1 FROM public.order_status_history WHERE order_id=current_setting('gate.pix')::uuid), 'staff reads history';
   ASSERT NOT EXISTS(SELECT 1 FROM public.pickup_arrivals WHERE order_id=current_setting('gate.card')::uuid), 'staff reads arrival';
   ASSERT public.get_handoff_status(current_setting('gate.pix')::uuid) IS NULL;
   IF uid<>'a0000000-0000-0000-0000-000000000006' THEN
     ASSERT NOT public.kitchen_list_orders('10000000-0000-0000-0000-00000000000a')::text LIKE '%43000000-0000-0000-0000-000000000005%', 'KDS leaks confirmed backfill';
   END IF;
   PERFORM pg_temp.gate_denied(format('SELECT public.update_order_status(%L,''CONFIRMED'')',current_setting('gate.pix')),'PAYMENT_REQUIRED');
   PERFORM pg_temp.gate_denied(format('SELECT public.update_order_status(%L,''CANCELLED'',''Loja tentou cancelar'')',current_setting('gate.pix')),'PAYMENT_REQUIRED');
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE summary jsonb; BEGIN
 PERFORM pg_temp.gate_denied(format('SELECT public.assign_order_to_driver(%L,%L)',current_setting('gate.pix'),'a0000000-0000-0000-0000-000000000005'),'PAYMENT_REQUIRED');
 PERFORM pg_temp.gate_denied(format('SELECT public.update_order_payment_status(%L,''PAID'')',current_setting('gate.card')),'PAYMENT_REQUIRED');
 PERFORM pg_temp.gate_denied(format('UPDATE public.orders SET status=''CONFIRMED'' WHERE id=%L',current_setting('gate.pix')));
 PERFORM pg_temp.gate_denied(format('SELECT public.list_payments_to_confirm(%L)','10000000-0000-0000-0000-00000000000b'));
 PERFORM pg_temp.gate_denied(format('SELECT public.confirm_pending_online_payment(%L,%s)','10000000-0000-0000-0000-00000000000b',current_setting('gate.number_b')));
 ASSERT NOT EXISTS(SELECT 1 FROM public.list_payments_to_confirm('10000000-0000-0000-0000-00000000000a') WHERE customer_first_name='Cliente B');
 ASSERT EXISTS(SELECT 1 FROM public.list_payments_to_confirm('10000000-0000-0000-0000-00000000000a') WHERE order_number=current_setting('gate.number_pix')::integer AND customer_first_name='Cliente');
 ASSERT (public.get_tenant_financial_summary('10000000-0000-0000-0000-00000000000a',now()-interval '1 day',now()+interval '1 day')->>'validOrdersCount')::integer=
 (SELECT count(*) FROM public.orders WHERE tenant_id='10000000-0000-0000-0000-00000000000a' AND status<>'CANCELLED' AND created_at>=now()-interval '1 day' AND created_at<now()+interval '1 day'), 'financial count includes hidden orders';
 ASSERT (public.get_tenant_reports_summary('10000000-0000-0000-0000-00000000000a',now()-interval '1 day',now()+interval '1 day')->>'totalOrders')::integer=
 (SELECT count(*) FROM public.orders WHERE tenant_id='10000000-0000-0000-0000-00000000000a' AND status<>'CANCELLED' AND created_at>=now()-interval '1 day' AND created_at<now()+interval '1 day'), 'report count includes hidden orders';
 ASSERT (public.get_dispatch_queue('10000000-0000-0000-0000-00000000000a')->'drivers') @> '[{"user_id":"a0000000-0000-0000-0000-000000000005"}]'::jsonb, 'hidden assignment affected dispatch queue';
 -- PDV (including PIX) remains visible and ungated; payment on delivery still accepts normally.
 PERFORM public.update_order_status(current_setting('gate.cash')::uuid,'CONFIRMED');
 PERFORM public.update_order_status(current_setting('gate.delivery_card')::uuid,'CONFIRMED');
 PERFORM set_config('gate.pos',(public.process_pos_sale_atomic('10000000-0000-0000-0000-00000000000a','[{"productId":"d4300000-0000-0000-0000-000000000001","quantity":1}]','PIX')->>'order_id'),true);
 ASSERT EXISTS(SELECT 1 FROM public.orders WHERE id=current_setting('gate.pos')::uuid AND NOT awaiting_online_payment);
 -- Hidden PIX without a charge can be checked only through the minimal list.
 PERFORM public.confirm_pending_online_payment('10000000-0000-0000-0000-00000000000a',current_setting('gate.number_pix')::integer);
 ASSERT EXISTS(SELECT 1 FROM public.orders WHERE id=current_setting('gate.pix')::uuid AND NOT awaiting_online_payment AND payment_status='PAID');
 ASSERT (SELECT count(*)=1 FROM public.owner_notifications WHERE kind='ORDER_NEW' AND ref_id=current_setting('gate.pix')::uuid);
 PERFORM public.update_order_status(current_setting('gate.pix')::uuid,'CONFIRMED');
 PERFORM public.update_order_status(current_setting('gate.pix')::uuid,'PREPARING');
 PERFORM public.update_order_status(current_setting('gate.pix')::uuid,'READY');
 PERFORM public.assign_order_to_driver(current_setting('gate.pix')::uuid,'a0000000-0000-0000-0000-000000000005');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000005',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.orders WHERE id='43000000-0000-0000-0000-00000000000d'), 'driver sees unpaid assignment';
 ASSERT public.get_order_pickup_code('43000000-0000-0000-0000-00000000000d') IS NULL;
 ASSERT EXISTS(SELECT 1 FROM public.orders WHERE id=current_setting('gate.pix')::uuid), 'driver cannot see paid assignment';
END $$;
RESET ROLE;
-- Paired KDS uses an anonymous Auth identity, with the authenticated database role.
INSERT INTO auth.users(id,email) VALUES('a4300000-0000-0000-0000-000000000009',NULL);
INSERT INTO public.kitchen_devices(tenant_id,user_id,name) VALUES('10000000-0000-0000-0000-00000000000a','a4300000-0000-0000-0000-000000000009','Tablet Gate');
SELECT set_config('request.jwt.claim.sub','a4300000-0000-0000-0000-000000000009',true);
SELECT set_config('request.jwt.claims','{"is_anonymous":true}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT NOT public.kitchen_list_orders()::text LIKE '%43000000-0000-0000-0000-000000000005%';
 ASSERT NOT EXISTS(SELECT 1 FROM public.kitchen_order_signals WHERE order_id='43000000-0000-0000-0000-000000000005');
 ASSERT NOT EXISTS(SELECT 1 FROM public.orders WHERE awaiting_online_payment);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
-- Reserve retries gate old card clients, but never PDV; confirmations release in the same transaction.
SET LOCAL ROLE service_role;
SELECT public.reserve_order_payment(current_setting('gate.manual')::uuid,'a4300000-0000-0000-0000-000000000007','manual_pix','pix');
SELECT public.save_order_charge((SELECT id FROM public.order_payments WHERE order_id=current_setting('gate.manual')::uuid),'{"manualConfirmation":true}');
SELECT public.reserve_order_payment(current_setting('gate.card')::uuid,'a4300000-0000-0000-0000-000000000007','infinitepay','card');
SELECT public.reserve_order_payment(current_setting('gate.card')::uuid,'a4300000-0000-0000-0000-000000000007','infinitepay','card');
SELECT public.save_order_charge((SELECT id FROM public.order_payments WHERE order_id=current_setting('gate.card')::uuid),'{"manualConfirmation":true}');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.gate_denied('SELECT * FROM public.list_payments_to_confirm(''10000000-0000-0000-0000-00000000000a'')');
SELECT pg_temp.gate_denied(format('SELECT public.confirm_pending_online_payment(%L,%s)','10000000-0000-0000-0000-00000000000a',current_setting('gate.number_card')));
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000002',true);
SELECT public.confirm_pending_online_payment('10000000-0000-0000-0000-00000000000a',current_setting('gate.number_manual')::integer);
SELECT public.confirm_pending_online_payment('10000000-0000-0000-0000-00000000000a',current_setting('gate.number_card')::integer);
SELECT public.confirm_pending_online_payment('10000000-0000-0000-0000-00000000000a',current_setting('gate.number_card')::integer);
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.orders WHERE id=current_setting('gate.card')::uuid AND payment_status='PAID' AND NOT awaiting_online_payment);
 ASSERT (SELECT count(*)=1 FROM public.owner_notifications WHERE kind='ORDER_NEW' AND ref_id=current_setting('gate.card')::uuid), 'duplicate release notice';
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.reserve_order_payment(current_setting('gate.delivery_card')::uuid,'a4300000-0000-0000-0000-000000000007','mercadopago','card');
SELECT public.save_order_charge((SELECT id FROM public.order_payments WHERE order_id=current_setting('gate.delivery_card')::uuid),'{"manualConfirmation":false,"providerPaymentId":"gate-provider-card"}');
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.orders WHERE id=current_setting('gate.delivery_card')::uuid), 'old-client card not gated by reserve';
 PERFORM pg_temp.gate_denied(format('SELECT public.update_order_payment_status(%L,''PAID'')',current_setting('gate.delivery_card')));
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ DECLARE p uuid; c jsonb; BEGIN
 SELECT id INTO p FROM public.order_payments WHERE order_id=current_setting('gate.delivery_card')::uuid;
 c:=jsonb_build_object('currency','BRL','orderId',current_setting('gate.delivery_card'),'amountCents',
 (SELECT amount*100 FROM public.order_payments WHERE order_id=current_setting('gate.delivery_card')::uuid),'paid',true,'providerPaymentId','gate-provider-card');
 PERFORM public.confirm_order_payment(p,c);
 PERFORM public.confirm_order_payment(p,c);
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.orders WHERE id=current_setting('gate.delivery_card')::uuid AND payment_status='PAID' AND NOT awaiting_online_payment);
 ASSERT (SELECT count(*)=1 FROM public.owner_notifications WHERE ref_id=current_setting('gate.delivery_card')::uuid AND kind='ORDER_NEW');
END $$;
RESET ROLE;
-- Failure and expiry are terminal even before the one-hour age limit.
INSERT INTO public.order_payments(order_id,tenant_id,provider,method,amount,status)
 SELECT o.id,o.tenant_id,'manual_pix','pix',o.total_amount,CASE WHEN o.id=current_setting('gate.failed')::uuid THEN 'failed' ELSE 'expired' END
 FROM public.orders o WHERE id IN(current_setting('gate.failed')::uuid,current_setting('gate.expired')::uuid);
-- Trigger cannot be bypassed by another SECURITY DEFINER function or a privileged direct UPDATE.
SELECT pg_temp.gate_denied('UPDATE public.orders SET status=''PREPARING'' WHERE id=''43000000-0000-0000-0000-000000000005''','PAYMENT_REQUIRED');
SELECT pg_temp.gate_denied('UPDATE public.orders SET awaiting_online_payment=false,status=''CONFIRMED'' WHERE id=''43000000-0000-0000-0000-000000000005''','PAYMENT_REQUIRED');
-- Expire a real checkout reservation. Keep the gate set after cancellation; retry is stock-neutral.
ALTER TABLE public.orders DISABLE TRIGGER trg_orders_protect_columns;
UPDATE public.orders SET created_at=now()-interval '61 minutes' WHERE id=current_setting('gate.v1')::uuid;
ALTER TABLE public.orders ENABLE TRIGGER trg_orders_protect_columns;
SELECT set_config('gate.stock',(SELECT stock_quantity::text FROM public.products WHERE id='d4300000-0000-0000-0000-000000000001'),true);
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
SELECT public.expire_unpaid_online_orders();
SELECT public.expire_unpaid_online_orders();
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT status='CANCELLED' AND awaiting_online_payment AND notes LIKE '%Pagamento não concluído%' FROM public.orders WHERE id=current_setting('gate.v1')::uuid);
 ASSERT (SELECT stock_quantity=current_setting('gate.stock')::numeric+3 FROM public.products WHERE id='d4300000-0000-0000-0000-000000000001'), 'expiry stock must return once';
 ASSERT (SELECT count(*)=1 FROM public.inventory_movements WHERE reference_id=current_setting('gate.v1') AND type='ESTORNO');
 ASSERT (SELECT count(*)=1 FROM public.order_status_history WHERE order_id=current_setting('gate.v1')::uuid AND status='CANCELLED');
 ASSERT (SELECT count(*)=1 FROM public.audit_logs WHERE resource_id=current_setting('gate.v1') AND action='ONLINE_PAYMENT_EXPIRED');
END $$;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.orders WHERE id=current_setting('gate.v1')::uuid), 'expired order became visible';
 ASSERT NOT EXISTS(SELECT 1 FROM public.owner_notifications WHERE kind='ORDER_NEW' AND ref_id=current_setting('gate.v1')::uuid);
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.gate_denied('SELECT public.list_payments_to_confirm(''10000000-0000-0000-0000-00000000000a'')');
SELECT pg_temp.gate_denied('SELECT public.expire_unpaid_online_orders()');
RESET ROLE;
ROLLBACK;
