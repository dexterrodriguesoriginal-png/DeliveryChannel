-- Run ONLY against a disposable test DB after explicit migration review/application.
-- Requires the existing n1n6 t.* harness + fixtures and proposal 20261024003900.
-- Not included in the automatic migration runner. This file never applies migrations.
BEGIN;
INSERT INTO public.store_payment_accounts(tenant_id,provider,status,account_label,accepts_pix)
VALUES ('10000000-0000-0000-0000-00000000000a','manual_pix','connected','Conta A',true),
       ('10000000-0000-0000-0000-00000000000b','manual_pix','connected','Conta B',true);
INSERT INTO public.order_payments(order_id,tenant_id,provider,provider_payment_id,method,amount,status)
SELECT id,tenant_id,'manual_pix',id::text,'pix',total_amount,'awaiting_confirmation' FROM public.orders
 WHERE id='0d000000-0000-0000-0000-0000000000a1';
SET ROLE anon;
SELECT t.login(NULL);
SELECT t.throws($$SELECT * FROM public.store_payment_accounts$$,'permission denied','anon não lê contas');
SELECT t.throws($$SELECT * FROM public.order_payments$$,'permission denied','anon não lê pagamentos');
SELECT t.throws($$SELECT public.payment_secret('get',NULL,NULL,NULL,NULL)$$,'permission denied','anon não chama gateway de segredos');
RESET ROLE;
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible('SELECT * FROM public.store_payment_accounts'),1::bigint,'owner A lê somente conta A');
SELECT t.is(t.visible('SELECT * FROM public.order_payments'),1::bigint,'owner A lê pagamento A');
SELECT t.throws($$SELECT * FROM private.store_payment_credentials$$,'permission denied','owner não lê tokens');
SELECT t.throws($$SELECT * FROM private.order_payment_webhook_tokens$$,'permission denied','owner não lê tokens de webhook');
SELECT t.throws($$SELECT public.payment_secret('get',NULL,NULL,NULL,NULL)$$,'permission denied','owner não executa gateway de segredos');
SELECT t.throws($$UPDATE public.store_payment_accounts SET is_primary=true$$,'permission denied','owner não grava direto');
SELECT t.throws($$SELECT public.update_order_payment_status('0d000000-0000-0000-0000-0000000000a1','PAID',NULL)$$,'Use a confirmação segura','RPC antiga não contorna confirmação');
SELECT t.login('b0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible($$SELECT * FROM public.store_payment_accounts WHERE tenant_id='10000000-0000-0000-0000-00000000000a'$$),0::bigint,'loja B não lê conta A');
SELECT t.is(t.visible('SELECT * FROM public.order_payments'),0::bigint,'loja B não lê pagamento A');
SELECT t.login('c0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible('SELECT * FROM public.store_payment_accounts'),0::bigint,'CEO não tem bypass global');
SELECT t.login('a0000000-0000-0000-0000-000000000007');
SELECT t.is(t.visible('SELECT * FROM public.order_payments'),0::bigint,'cliente usa endpoint autenticado, sem acesso à tabela');
RESET ROLE;
-- Same established CRC helper used by the new manual adapter.
SELECT t.is(public._crc16_ccitt('123456789'),'29B1','CRC16-CCITT-FALSE conhecido');
SELECT t.is(public._pix_brcode('123e4567-e12b-12d1-a456-426655440000','Fulano de Tal','BRASILIA',NULL,'***'),
 '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D','vetor BR Code do BCB');
ROLLBACK;
