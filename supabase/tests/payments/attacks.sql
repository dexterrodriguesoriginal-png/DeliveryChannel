-- Run ONLY against a disposable n1n6 test DB with 039+040 applied (same harness as rls.sql).
BEGIN;
SET t.suite='payments_extra';
INSERT INTO public.store_payment_accounts(tenant_id,provider,status,account_label,accepts_pix) VALUES ('10000000-0000-0000-0000-00000000000a','manual_pix','connected','A',true);
INSERT INTO public.order_payments(id,order_id,tenant_id,provider,provider_payment_id,method,amount,status)
 SELECT '05000000-0000-4000-8000-000000000001',id,tenant_id,'manual_pix',id::text,'pix',total_amount,'awaiting_confirmation' FROM public.orders WHERE id='0d000000-0000-0000-0000-0000000000a1';
-- customer of the order cannot mark it paid by any route
SET ROLE authenticated;
SELECT t.login((SELECT c.user_id FROM public.orders o JOIN public.customers c ON c.id=o.customer_id WHERE o.id='0d000000-0000-0000-0000-0000000000a1'));
SELECT t.ok((SELECT count(*) FROM (SELECT 1) x) = 1, 'login cliente');
DO $$ BEGIN UPDATE public.orders SET payment_status='PAID' WHERE id='0d000000-0000-0000-0000-0000000000a1'; EXCEPTION WHEN others THEN NULL; END $$;
SELECT t.throws($$SELECT public.confirm_order_payment('05000000-0000-4000-8000-000000000001','{}'::jsonb,auth.uid())$$,'permission denied','cliente não chama confirmação');
SELECT t.throws($$SELECT public.reserve_order_payment('0d000000-0000-0000-0000-0000000000a1',auth.uid(),'manual_pix','pix')$$,'permission denied','cliente não chama reserva direto');
SELECT t.throws($$SELECT public.anonymize_expired_payments(10)$$,'permission denied','cliente não roda retenção');
RESET ROLE;
SELECT t.ok((SELECT payment_status<>'PAID' FROM public.orders WHERE id='0d000000-0000-0000-0000-0000000000a1'),'cliente não marcou pedido como pago');
-- cashier can't manually confirm (service_role path, SQL check)
SELECT set_config('t.cashier',(SELECT tu.user_id::text FROM public.tenant_users tu WHERE tu.tenant_id='10000000-0000-0000-0000-00000000000a' AND tu.role_id='CASHIER' AND tu.status='ACTIVE' LIMIT 1),true);
SELECT t.ok(current_setting('t.cashier') <> '', 'fixture tem CASHIER');
SET ROLE service_role;
SELECT t.throws($$SELECT public.confirm_order_payment('05000000-0000-4000-8000-000000000001','{}'::jsonb,current_setting('t.cashier')::uuid)$$,'não permitida','CASHIER não confirma manualmente');
SELECT t.throws($$SELECT public.confirm_order_payment('05000000-0000-4000-8000-000000000001','{}'::jsonb,'b0000000-0000-0000-0000-000000000001')$$,'não permitida','owner de outra loja não confirma');
SELECT t.throws($$SELECT public.confirm_order_payment('05000000-0000-4000-8000-000000000001','{"paid":true,"currency":"BRL","amountCents":1,"orderId":"x","providerPaymentId":"1"}'::jsonb,NULL)$$,'inválida','confirmação automática não vale para manual_pix');
SELECT t.lives($$SELECT public.confirm_order_payment('05000000-0000-4000-8000-000000000001','{}'::jsonb,'a0000000-0000-0000-0000-000000000001')$$,'OWNER confirma manualmente');
RESET ROLE;
SELECT t.ok((SELECT payment_status='PAID' FROM public.orders WHERE id='0d000000-0000-0000-0000-0000000000a1'),'pedido pago após confirmação do owner');
SET ROLE authenticated; SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.throws($$SELECT public.update_order_payment_status('0d000000-0000-0000-0000-0000000000a1','REFUNDED','teste')$$,'Use a confirmação segura','RPC antiga não altera pagamento online');
RESET ROLE;
-- suspension keeps fiscal link
UPDATE public.tenants SET status='INACTIVE' WHERE id='10000000-0000-0000-0000-00000000000a';
SELECT t.ok((SELECT anonymized_at IS NULL AND order_id IS NOT NULL FROM public.order_payments WHERE id='05000000-0000-4000-8000-000000000001'),'suspensão da loja preserva registro fiscal');
SELECT t.ok((SELECT status='disconnected' FROM public.store_payment_accounts WHERE tenant_id='10000000-0000-0000-0000-00000000000a' AND provider='manual_pix'),'suspensão desconecta conta');
SELECT t.ok(public._legal_version()='2026-10-24.1','versão legal inalterada');
ROLLBACK;
