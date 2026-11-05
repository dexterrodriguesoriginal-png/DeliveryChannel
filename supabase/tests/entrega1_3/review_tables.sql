-- Regressões da revisão: consentimento, escopo, proveniência e dívida após juntar/separar.
\set A '10000000-0000-0000-0000-00000000000a'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set CLIENT 'e1310000-0000-0000-0000-000000000001'
\set CLIENT2 'e1310000-0000-0000-0000-000000000004'
\set WAITER 'e1310000-0000-0000-0000-000000000002'
\set OTHER 'e1310000-0000-0000-0000-000000000003'
\set T41 'e1320000-0000-0000-0000-000000000041'
\set T42 'e1320000-0000-0000-0000-000000000042'
\set T43 'e1320000-0000-0000-0000-000000000043'
\set TAB41 'e1330000-0000-0000-0000-000000000041'
\set TAB42 'e1330000-0000-0000-0000-000000000042'
\set S41 'e1340000-0000-0000-0000-000000000041'
\set S42 'e1340000-0000-0000-0000-000000000042'
\set O41 'e1350000-0000-0000-0000-000000000041'
\set O42 'e1350000-0000-0000-0000-000000000042'
RESET ROLE;
-- A regressão de códigos deve configurar sua própria pré-condição; a suíte
-- anterior também testa desligar a opção sem alterar rodadas existentes.
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_salon_delivery_code_required(:'A',true);
RESET ROLE;
SELECT t.login(NULL);
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token) SELECT ('e1320000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,:'A','Revisão '||n,'review-table-'||n FROM generate_series(41,43) n;
INSERT INTO public.waiter_table_assignments(tenant_id,table_id,waiter_id,assigned_by) VALUES(:'A',:'T41',:'WAITER',:'OWNER'),(:'A',:'T42',:'OTHER',:'OWNER');
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,status,service_fee_percent,responsible_user_id) VALUES
(:'TAB41',:'A','TABLE',:'T41','OPEN',10,:'CLIENT'),(:'TAB42',:'A','TABLE',:'T42','OPEN',10,:'CLIENT2');
-- Mesmo cliente/device em contas diferentes não pode ser descartado ao juntar.
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at) VALUES
(:'S41',:'A',:'TAB41',:'CLIENT','Nome reservado','mesmo-device',now()),
(:'S42',:'A',:'TAB42',:'CLIENT2','Outro nome','outro-device',now()),
('e1340000-0000-0000-0000-000000000044',:'A',:'TAB42',:'CLIENT','Nome reservado','mesmo-device',now());
INSERT INTO public.orders(id,tenant_id,tab_id,ordered_by_session_id,round_no,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address) VALUES
(:'O41',:'A',:'TAB41',:'S41',1,'DINE_IN','READY',40,40,'CASH','PENDING','DINE_IN_QR',1341,'Cliente','11900000000','Revisão 41'),
(:'O42',:'A',:'TAB42',:'S42',1,'DINE_IN','READY',60,60,'CASH','PENDING','DINE_IN_QR',1342,'Cliente','11900000000','Revisão 42');
INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price) VALUES(:'O41','d0000000-0000-0000-0000-0000000000a1','Prato',1,40,40),(:'O42','d0000000-0000-0000-0000-0000000000a1','Prato',1,60,60);
UPDATE public.salon_order_delivery_codes SET attempts=2,last_attempt_at=now() WHERE order_id=:'O42';
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws($q$SELECT public.staff_join_tables(ARRAY['e1320000-0000-0000-0000-000000000041'::uuid,'e1320000-0000-0000-0000-000000000042'::uuid],true)$q$,'FORBIDDEN','revisão mesa atribuída a outro garçom não pode ser juntada');
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.staff_join_tables(ARRAY['e1320000-0000-0000-0000-000000000041'::uuid,'e1320000-0000-0000-0000-000000000042'::uuid])$q$,'OCCUPIED_ACCEPTANCE_REQUIRED','revisão RPC legado não implica aceite de conta ocupada');
RESET ROLE;
UPDATE public.dining_tabs SET status='BILL_REQUESTED' WHERE id=:'TAB42';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.staff_join_tables(ARRAY['e1320000-0000-0000-0000-000000000041'::uuid,'e1320000-0000-0000-0000-000000000042'::uuid],true)$q$,'TABLE_CHANGE_BLOCKED','revisão conta pedida não pode juntar');
RESET ROLE;
UPDATE public.dining_tabs SET status='OPEN',service_fee_percent=15 WHERE id=:'TAB42';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.staff_join_tables(ARRAY['e1320000-0000-0000-0000-000000000041'::uuid,'e1320000-0000-0000-0000-000000000042'::uuid],true)$q$,'SERVICE_FEE_MISMATCH','revisão juntar não altera taxa contratada');
RESET ROLE;
UPDATE public.dining_tabs SET service_fee_percent=10 WHERE id=:'TAB42';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.staff_join_tables(ARRAY[:'T41'::uuid,:'T42'::uuid],true);
SELECT t.login(:'CLIENT2'::uuid);
SELECT t.is((public.get_my_tab(:'S42')->>'subtotal')::numeric,100::numeric,'revisão sessão original acompanha soma das duas dívidas');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.tab_sessions WHERE tab_id=:'TAB41' AND ended_at IS NULL),3::bigint,'revisão preserva sessões duplicadas em vez de abandonar cliente');
SELECT t.is((SELECT count(DISTINCT round_no) FROM public.orders WHERE tab_id=:'TAB41'),2::bigint,'revisão preserva rodadas diferentes na conta unida');
SELECT t.ok((SELECT tab_id=:'TAB41'::uuid FROM public.salon_order_delivery_codes WHERE order_id=:'O42'),'revisão código continua na mesma conta que o pedido após juntar');
SELECT t.ok((SELECT tab_id=:'TAB41'::uuid FROM public.waiter_calls WHERE order_id=:'O42' AND status='OPEN'),'revisão chamado de retirada segue o pedido após juntar');
-- QR secundário restaura a própria sessão física e aceita futuras rodadas nela.
SET ROLE authenticated;
SELECT t.login(:'CLIENT2'::uuid);
SELECT public.enter_table('review-table-42','Cliente2','outro-device') AS restored \gset
SELECT t.is(:'restored'::jsonb->>'sessionId',:'S42','revisão QR secundário restaura mesma sessão');
RESET ROLE;
SELECT t.is((SELECT table_id FROM public._salon_session_seats WHERE session_id=:'S42'),:'T42'::uuid,'revisão sessão do QR secundário mantém proveniência');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.staff_submit_table_round(:'T42','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]','e1360000-0000-0000-0000-000000000041') AS staff_round \gset
RESET ROLE;
SELECT t.is((SELECT table_id FROM public._salon_order_seats WHERE order_id=(:'staff_round'::jsonb->>'orderId')::uuid),:'T42'::uuid,'revisão pedido do staff em mesa secundária mantém destino');
SELECT t.is((SELECT table_label FROM public.get_dine_in_order_table_labels(:'A',ARRAY[(:'staff_round'::jsonb->>'orderId')::uuid]) LIMIT 1),'Revisão 42','revisão balcão informa mesa física correta');
SELECT sum(total_amount) AS original_total FROM public.orders WHERE tab_id=:'TAB41' \gset
UPDATE public.dining_tabs SET status='AWAITING_PAYMENT' WHERE id=:'TAB41';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.staff_separate_table('e1330000-0000-0000-0000-000000000041','e1320000-0000-0000-0000-000000000042')$q$,'TABLE_CHANGE_BLOCKED','revisão não separa durante pagamento PIX');
RESET ROLE;
UPDATE public.dining_tabs SET status='OPEN' WHERE id=:'TAB41';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.staff_separate_table(:'TAB41',:'T42') AS separated \gset
SELECT t.login(:'CLIENT2'::uuid);
SELECT t.is(public.get_my_tab(:'S42')->>'tabId',:'separated'::jsonb->>'separatedTabId','revisão separar leva sessão e conta junto');
RESET ROLE;
SELECT t.is((SELECT sum(total_amount) FROM public.orders WHERE tab_id IN(:'TAB41'::uuid,(:'separated'::jsonb->>'separatedTabId')::uuid)),:'original_total'::numeric,'revisão separar preserva dívida total sem duplicar ou perder');
SELECT t.is((SELECT tab_id FROM public.orders WHERE id=:'O42'),(:'separated'::jsonb->>'separatedTabId')::uuid,'revisão dívida da mesa secundária segue mesa separada');
SELECT t.is((SELECT tab_id FROM public.orders WHERE id=:'O41'),:'TAB41'::uuid,'revisão dívida da mesa principal permanece');
SELECT t.is((SELECT tab_id FROM public.waiter_calls WHERE order_id=:'O42' AND status='OPEN'),(:'separated'::jsonb->>'separatedTabId')::uuid,'revisão separar leva chamado da rodada');
SELECT t.is((SELECT tab_id FROM public.salon_order_delivery_codes WHERE order_id=:'O42'),(:'separated'::jsonb->>'separatedTabId')::uuid,'revisão separar leva código da rodada');
SELECT t.is((SELECT attempts FROM public.salon_order_delivery_codes WHERE order_id=:'O42'),2,'revisão juntar/separar não reinicia tentativas do código');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM public._salon_account_transfers),'revisão autorização de transferência não permanece após RPC');
SET ROLE authenticated;
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$SELECT * FROM public._salon_order_seats$q$,'permission denied','revisão cliente não enumera proveniência de outras mesas');
SELECT t.throws($q$SELECT public._salon_transfer_account('10000000-0000-0000-0000-00000000000a','e1330000-0000-0000-0000-000000000041','e1330000-0000-0000-0000-000000000042')$q$,'permission denied','revisão cliente não forja transferência');
SELECT t.is(t.visible('SELECT * FROM public.tab_table_moves'),0::bigint,'revisão cliente não enumera histórico de pessoas de outras mesas');
RESET ROLE;
SELECT t.ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN('public._salon_order_seats'::regclass,'public._salon_session_seats'::regclass,'public._salon_account_transfers'::regclass)),'revisão RLS também nos auxiliares privados');
-- LGPD: somente atores cliente de contas encerradas antigas perdem o vínculo; staff e recentes permanecem.
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,status,opened_at,closed_at) VALUES('e1330000-0000-0000-0000-000000000049',:'A','TABLE',:'T43','CLOSED',now()-interval '100 days',now()-interval '100 days');
INSERT INTO public.tab_table_moves(id,tenant_id,tab_id,action,from_label,to_label,actor_kind,actor_id,actor_name,created_at) VALUES
('e1370000-0000-0000-0000-000000000041',:'A','e1330000-0000-0000-0000-000000000049','MOVE','A','B','CUSTOMER',:'S41','Nome antigo',now()-interval '100 days'),
('e1370000-0000-0000-0000-000000000042',:'A','e1330000-0000-0000-0000-000000000049','MOVE','A','B','STAFF',:'OWNER','Equipe',now()-interval '100 days'),
('e1370000-0000-0000-0000-000000000043',:'A',:'TAB41','MOVE','A','B','CUSTOMER',:'S41','Nome recente',now());
SELECT public.anonymize_old_tab_sessions(90);
SELECT t.ok((SELECT actor_id IS NULL AND actor_name='Cliente' FROM public.tab_table_moves WHERE id='e1370000-0000-0000-0000-000000000041'),'revisão LGPD anonimiza ator cliente antigo');
SELECT t.ok((SELECT actor_id=:'OWNER'::uuid AND actor_name='Equipe' FROM public.tab_table_moves WHERE id='e1370000-0000-0000-0000-000000000042'),'revisão LGPD preserva auditoria do staff');
SELECT t.ok((SELECT actor_id=:'S41'::uuid AND actor_name='Nome recente' FROM public.tab_table_moves WHERE id='e1370000-0000-0000-0000-000000000043'),'revisão LGPD mantém histórico recente');

-- Modo individual pode ter mais de uma conta na mesma mesa: não as agrupa parcialmente.
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,responsible_user_id,status) VALUES
('e1330000-0000-0000-0000-000000000045',:'A','INDIVIDUAL',:'T43',:'CLIENT','OPEN'),
('e1330000-0000-0000-0000-000000000046',:'A','INDIVIDUAL',:'T43',:'CLIENT2','OPEN');
INSERT INTO public.orders(id,tenant_id,tab_id,round_no,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address)
SELECT ('e1350000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,:'A',('e1330000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,1,'DINE_IN','PREPARING',n,n,'CASH','PENDING','DINE_IN_QR',1300+n,'Cliente','11900000000','Revisão 43' FROM generate_series(45,46) n;
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.staff_join_tables(ARRAY['e1320000-0000-0000-0000-000000000041'::uuid,'e1320000-0000-0000-0000-000000000043'::uuid],true)$q$,'TABLE_MODE_REQUIRED','revisão contas individuais não são unificadas parcialmente');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.ok(NOT(public.list_free_tables_for_session(:'S41') @> '[{"label":"Revisão 43"}]'),'revisão mesa com contas individuais não fica livre');
RESET ROLE;
SELECT t.is((SELECT sum(total_amount) FROM public.orders WHERE tab_id IN('e1330000-0000-0000-0000-000000000045','e1330000-0000-0000-0000-000000000046')),91::numeric,'revisão preserva dívida das duas contas individuais');
-- Fechamento real por garçom da mesa secundária conserva acesso somente ao comprovante.
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.staff_join_tables(ARRAY[:'T41'::uuid,:'T42'::uuid],true);
SELECT public.staff_request_bill(:'TAB41');
SELECT public.authorize_waiter_to_close(:'TAB41');
RESET ROLE;
SELECT public._tab_total_cents(:'A',:'TAB41') AS joined_total_cents \gset
SET ROLE authenticated;
SELECT t.login(:'OTHER'::uuid);
SELECT public.close_tab(:'TAB41',jsonb_build_array(jsonb_build_object('method','CASH','amount_cents',:'joined_total_cents'::integer)));
SELECT t.ok((public.tab_receipt_target(:'TAB41')->>'exists')::boolean,'revisão garçom secundário que fechou pode obter máscara do comprovante');
RESET ROLE;
SELECT t.ok(NOT EXISTS(SELECT 1 FROM public.dining_tab_tables WHERE tab_id=:'TAB41'),'revisão fechamento libera todas mesas unidas');
INSERT INTO auth.users(id,email) VALUES('e1310000-0000-0000-0000-000000000045','unrelatedwaiter@test.example');
INSERT INTO public.tenant_users(tenant_id,user_id,role_id,status) VALUES(:'A','e1310000-0000-0000-0000-000000000045','WAITER','ACTIVE');
INSERT INTO public.waiter_profiles(user_id,tenant_id,username,phone) VALUES('e1310000-0000-0000-0000-000000000045',:'A','review_unrelated','11900000045');
SET ROLE authenticated;
SELECT t.login('e1310000-0000-0000-0000-000000000045');
SELECT t.throws($q$SELECT public.tab_receipt_target('e1330000-0000-0000-0000-000000000041')$q$,'FORBIDDEN','revisão outro garçom não ganha comprovante da conta unida encerrada');
RESET ROLE;

