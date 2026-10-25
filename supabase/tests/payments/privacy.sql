-- Review/run ONLY on a disposable DB prepared with n1n6 t.* fixtures + 039 + 040.
-- This script does not apply migrations. Fiscal ledger is never deleted by these operations.
BEGIN;
INSERT INTO public.store_payment_accounts(tenant_id,provider,status,account_label,accepts_pix)
 VALUES('10000000-0000-0000-0000-00000000000a','mercadopago','connected','Conta A',true)
 ON CONFLICT(tenant_id,provider) DO UPDATE SET status='connected';
INSERT INTO public.order_payments(id,order_id,tenant_id,provider,provider_payment_id,method,amount,status)
 SELECT '04000000-0000-4000-8000-000000000001',o.id,o.tenant_id,'mercadopago','123','pix',o.total_amount,'pending'
 FROM public.orders o WHERE o.id='0d000000-0000-0000-0000-0000000000a1';
INSERT INTO private.store_payment_credentials(tenant_id,provider,ciphertext)
 VALUES('10000000-0000-0000-0000-00000000000a','mercadopago','opaque-encrypted-oauth');
INSERT INTO private.order_payment_webhook_tokens(payment_id,ciphertext)
 VALUES('04000000-0000-4000-8000-000000000001','opaque-encrypted-signature');
-- Update dates (not payment amount/order total) to exercise the actual boundary.
UPDATE public.order_payments SET created_at=statement_timestamp()-interval '5 years'+interval '1 day' WHERE id='04000000-0000-4000-8000-000000000001';
SELECT public.anonymize_expired_payments(500);
SELECT t.ok((SELECT anonymized_at IS NULL FROM public.order_payments WHERE id='04000000-0000-4000-8000-000000000001'),'antes de cinco anos conserva vínculo fiscal');
UPDATE public.order_payments SET created_at=statement_timestamp()-interval '5 years'-interval '1 second' WHERE id='04000000-0000-4000-8000-000000000001';
SELECT set_config('t.payment_amount',(SELECT amount::text FROM public.order_payments WHERE id='04000000-0000-4000-8000-000000000001'),true);
SELECT set_config('t.payment_date',(SELECT created_at::text FROM public.order_payments WHERE id='04000000-0000-4000-8000-000000000001'),true);
SELECT public.anonymize_expired_payments(500);
SELECT t.ok((SELECT order_id IS NULL AND tenant_id IS NULL AND provider_payment_id IS NULL AND brcode IS NULL AND checkout_url IS NULL AND anonymized_at IS NOT NULL
 FROM public.order_payments WHERE id='04000000-0000-4000-8000-000000000001'),'depois de cinco anos remove todos os vínculos e instruções');
SELECT t.is((SELECT amount::text FROM public.order_payments WHERE id='04000000-0000-4000-8000-000000000001'),current_setting('t.payment_amount'),'valor mantido');
SELECT t.is((SELECT created_at::text FROM public.order_payments WHERE id='04000000-0000-4000-8000-000000000001'),current_setting('t.payment_date'),'data mantida');
SELECT t.is((SELECT count(*) FROM private.order_payment_webhook_tokens WHERE payment_id='04000000-0000-4000-8000-000000000001'),0::bigint,'credencial do pagamento anonimizado apagada');
-- A second row demonstrates customer deletion while fiscal retention is still active.
INSERT INTO public.order_payments(id,order_id,tenant_id,provider,provider_payment_id,method,amount,status)
 SELECT '04000000-0000-4000-8000-000000000002',o.id,o.tenant_id,'mercadopago','456','pix',o.total_amount,'pending'
 FROM public.orders o WHERE o.id='0d000000-0000-0000-0000-0000000000a2';
INSERT INTO public.customer_account_deletion_requests(user_id,status,processed_at)
 SELECT c.user_id,'PROCESSED',now() FROM public.orders o JOIN public.customers c ON c.id=o.customer_id AND c.tenant_id=o.tenant_id WHERE o.id='0d000000-0000-0000-0000000000a2';
SELECT t.ok((SELECT order_id IS NULL AND provider_payment_id IS NULL AND amount IS NOT NULL AND created_at IS NOT NULL AND anonymized_at IS NOT NULL
 FROM public.order_payments WHERE id='04000000-0000-4000-8000-000000000002'),'exclusão do cliente desvincula pagamento e preserva valor/data');
SELECT t.ok(EXISTS(SELECT 1 FROM private.payment_erased_orders WHERE order_id='0d000000-0000-0000-0000-0000000000a2'),'pedido excluído não pode ser religado ao pagamento');
UPDATE public.store_payment_accounts SET status='disconnected',is_primary=false WHERE tenant_id='10000000-0000-0000-0000-00000000000a' AND provider='mercadopago';
SELECT t.is((SELECT count(*) FROM private.store_payment_credentials WHERE tenant_id='10000000-0000-0000-0000-00000000000a'),0::bigint,'desconexão remove OAuth imediatamente, mesmo com cobranças pendentes');
SELECT t.is((SELECT count(*) FROM private.payment_oauth_states WHERE tenant_id='10000000-0000-0000-0000-00000000000a'),0::bigint,'desconexão invalida estados');
INSERT INTO private.store_payment_credentials(tenant_id,provider,ciphertext) VALUES('10000000-0000-0000-0000-00000000000a','mercadopago','opaque-secret');
INSERT INTO private.payment_oauth_states(state_hash,ciphertext,tenant_id,provider) VALUES('opaque-state','opaque-state-cipher','10000000-0000-0000-0000-00000000000a','mercadopago');
UPDATE public.tenants SET status='INACTIVE' WHERE id='10000000-0000-0000-0000-00000000000a';
SELECT t.is((SELECT count(*) FROM private.store_payment_credentials WHERE tenant_id='10000000-0000-0000-0000-00000000000a'),0::bigint,'exclusão lógica da loja apaga tokens');
SELECT t.is((SELECT count(*) FROM private.payment_oauth_states WHERE tenant_id='10000000-0000-0000-0000-00000000000a'),0::bigint,'exclusão da loja apaga OAuth pendente');
SELECT t.is((SELECT count(*) FROM public.order_payments WHERE tenant_id='10000000-0000-0000-0000-00000000000a'),0::bigint,'exclusão da loja remove o vínculo sem apagar registros fiscais');
SET ROLE anon;
SELECT t.throws($$SELECT public.anonymize_expired_payments(500)$$,'permission denied','anon não executa manutenção');
SELECT t.throws($$SELECT * FROM private.payment_erased_orders$$,'permission denied','tombstones não são públicos');
RESET ROLE;
SET ROLE authenticated;
SELECT t.throws($$SELECT public.anonymize_expired_payments(500)$$,'permission denied','cliente/equipe não executam manutenção');
RESET ROLE;
ROLLBACK;
