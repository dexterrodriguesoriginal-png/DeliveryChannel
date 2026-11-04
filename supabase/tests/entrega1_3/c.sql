-- Parte C: trocar de mesa, juntar/separar mesas e código de entrega por rodada.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set OWNER_B 'b0000000-0000-0000-0000-000000000001'
\set CLIENT 'e1310000-0000-0000-0000-000000000001'
\set CLIENT_2 'e1310000-0000-0000-0000-000000000004'
\set WAITER 'e1310000-0000-0000-0000-000000000002'
\set WAITER_OTHER 'e1310000-0000-0000-0000-000000000003'
\set TBL3 'e1320000-0000-0000-0000-000000000023'
\set TBL7 'e1320000-0000-0000-0000-000000000027'
\set TBL8 'e1320000-0000-0000-0000-000000000028'
\set TBL9 'e1320000-0000-0000-0000-000000000029'
\set TBL_B 'e1320000-0000-0000-0000-000000000099'
\set TAB_C 'e1330000-0000-0000-0000-000000000023'
\set TAB_C8 'e1330000-0000-0000-0000-000000000028'
\set SESS_C 'e1340000-0000-0000-0000-000000000023'
\set SESS_C8 'e1340000-0000-0000-0000-000000000028'
RESET ROLE;
SELECT t.login(NULL);

INSERT INTO auth.users(id,email) VALUES(:'CLIENT_2','cliente2@test.example') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token) VALUES
 (:'TBL3',:'A','Mesa 3','entrega1-3-c-token-3'),
 (:'TBL7',:'A','Mesa 7','entrega1-3-c-token-7'),
 (:'TBL8',:'A','Mesa 8','entrega1-3-c-token-8'),
 (:'TBL9',:'A','Mesa 9','entrega1-3-c-token-9'),
 (:'TBL_B',:'B','Mesa B 99','entrega1-3-c-token-b99');
INSERT INTO public.waiter_table_assignments(tenant_id,table_id,waiter_id,assigned_by) VALUES
 (:'A',:'TBL3',:'WAITER',:'OWNER'),
 (:'A',:'TBL7',:'WAITER',:'OWNER'),
 (:'A',:'TBL8',:'WAITER',:'OWNER'),
 (:'A',:'TBL9',:'WAITER',:'OWNER');
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,status,service_fee_percent,responsible_user_id) VALUES
 (:'TAB_C',:'A','TABLE',:'TBL3','OPEN',10,:'CLIENT'),
 (:'TAB_C8',:'A','TABLE',:'TBL8','OPEN',10,:'CLIENT_2');
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at) VALUES
 (:'SESS_C',:'A',:'TAB_C',:'CLIENT','Cliente C','entrega1-3-c-23',now()),
 (:'SESS_C8',:'A',:'TAB_C8',:'CLIENT_2','Cliente C8','entrega1-3-c-28',now());
INSERT INTO public.orders(id,tenant_id,tab_id,round_no,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address) VALUES
 ('e1350000-0000-0000-0000-000000000023',:'A',:'TAB_C',1,'DINE_IN','PREPARING',50,50,'CASH','PENDING','DINE_IN_QR',1323,'Cliente C','11900000000','Mesa 3'),
 ('e1350000-0000-0000-0000-000000000028',:'A',:'TAB_C8',1,'DINE_IN','PREPARING',30,30,'CASH','PENDING','DINE_IN_QR',1328,'Cliente C8','11900000000','Mesa 8');
INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price) VALUES
 ('e1350000-0000-0000-0000-000000000023','d0000000-0000-0000-0000-0000000000a1','Prato C',1,50,50),
 ('e1350000-0000-0000-0000-000000000028','d0000000-0000-0000-0000-0000000000a1','Prato C8',1,30,30);

-- Item 1: listagem de mesas livres, antifraude e troca de mesa pelo cliente.
SET ROLE authenticated;
SELECT t.login(:'CLIENT'::uuid);
SELECT public.list_free_tables_for_session(:'SESS_C') AS free_tables \gset
SELECT t.ok(:'free_tables'::jsonb @> '[{"label":"Mesa 7"}]' AND :'free_tables'::jsonb @> '[{"label":"Mesa 9"}]','C1 lista mesas livres da própria loja');
SELECT t.ok(NOT (:'free_tables'::jsonb @> '[{"label":"Mesa 3"}]') AND NOT (:'free_tables'::jsonb @> '[{"label":"Mesa 8"}]'),'C1 não lista mesas ocupadas');
SELECT t.ok(NOT (:'free_tables'::jsonb @> '[{"label":"Mesa B 99"}]'),'C1 isolamento: nunca lista mesas de outra loja');

-- Antifraude: não permite mudar para mesa ocupada nem para outra loja.
SELECT t.throws($q$SELECT public.customer_move_table('e1340000-0000-0000-0000-000000000023','e1320000-0000-0000-0000-000000000028',NULL)$q$,'TABLE_OCCUPIED','C1 antifraude bloqueia mudança para mesa ocupada');
SELECT t.throws($q$SELECT public.customer_move_table('e1340000-0000-0000-0000-000000000023','e1320000-0000-0000-0000-000000000099',NULL)$q$,'TABLE_UNAVAILABLE','C1 antifraude bloqueia mesa de outra loja');

-- Antifraude: mudança bloqueada com conta pedida / aguardando PIX.
RESET ROLE;
UPDATE public.dining_tabs SET status='BILL_REQUESTED' WHERE id=:'TAB_C';
SET ROLE authenticated;
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$SELECT public.customer_move_table('e1340000-0000-0000-0000-000000000023','e1320000-0000-0000-0000-000000000027',NULL)$q$,'MOVE_BLOCKED_BILL','C1 antifraude bloqueia mudança com conta pedida');
RESET ROLE;
UPDATE public.dining_tabs SET status='OPEN' WHERE id=:'TAB_C';

-- Cliente muda da Mesa 3 para a Mesa 7: dívida, pedidos e sessão seguem para a nova mesa; Mesa 3 fica livre.
SET ROLE authenticated;
SELECT t.login(:'CLIENT'::uuid);
SELECT public.customer_move_table(:'SESS_C',:'TBL7',NULL) AS move_res \gset
SELECT t.is(:'move_res'::jsonb->>'notice','Mesa 3 → Mesa 7','C1 aviso Mesa 3 → Mesa 7 retornado na troca');
SELECT t.is(public.get_my_tab(:'SESS_C')->>'tableLabel','Mesa 7','C1 conta aberta e dívida seguem a sessão na Mesa 7');
SELECT t.is((public.get_my_tab(:'SESS_C')->>'subtotal')::numeric,50::numeric,'C1 subtotal preservado após troca de mesa');
-- Também aceita troca lendo o QR/link de outra mesa livre (Mesa 7 -> Mesa 3).
SELECT public.customer_move_table(:'SESS_C',NULL,'https://app.exemplo/loja?mesa=entrega1-3-c-token-3') AS move_qr_res \gset
SELECT t.is(:'move_qr_res'::jsonb->>'notice','Mesa 7 → Mesa 3','C1 troca via QR token funciona');
-- Move de volta para Mesa 7 para os próximos testes.
SELECT public.customer_move_table(:'SESS_C',:'TBL7',NULL);

RESET ROLE;
SELECT t.ok(public._table_active_tab(:'A',:'TBL3') IS NULL,'C1 mesa antiga (Mesa 3) fica livre');
SELECT t.is(public._table_active_tab(:'A',:'TBL7'),:'TAB_C'::uuid,'C1 nova mesa (Mesa 7) aponta para a mesma comanda');
SELECT t.ok(EXISTS(SELECT 1 FROM public.owner_notifications WHERE tenant_id=:'A' AND kind='TABLE_MOVED' AND ref_id=:'TAB_C' AND title='Mesa 3 → Mesa 7'),'C1 dono recebe aviso Mesa 3 → Mesa 7');
SELECT t.is((SELECT count(*) FROM public.tab_table_moves WHERE tenant_id=:'A' AND tab_id=:'TAB_C' AND action='MOVE'),3::bigint,'C1 histórico de trocas registrado na conta');

-- Item 1: Garçom/dono junta mesas (Mesa 7 + Mesa 8 + Mesa 9) numa única conta e depois separa.
SET ROLE authenticated;
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$SELECT public.staff_join_tables(ARRAY['e1320000-0000-0000-0000-000000000027'::uuid,'e1320000-0000-0000-0000-000000000028'::uuid])$q$,'FORBIDDEN','C1 cliente não pode juntar mesas');
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.throws($q$SELECT public.staff_join_tables(ARRAY['e1320000-0000-0000-0000-000000000027'::uuid,'e1320000-0000-0000-0000-000000000028'::uuid])$q$,'FORBIDDEN','C1 outra loja não junta mesas');
SELECT t.login(:'WAITER'::uuid);
SELECT public.staff_join_tables(ARRAY[:'TBL7'::uuid,:'TBL8'::uuid,:'TBL9'::uuid]) AS join_res \gset
SELECT t.is((:'join_res'::jsonb->>'tabId')::uuid,:'TAB_C'::uuid,'C1 juntar mesas unifica na comanda principal');
SELECT t.is(jsonb_array_length(:'join_res'::jsonb->'joinedTableIds'),2,'C1 duas mesas secundárias vinculadas à comanda');

SELECT t.login(:'CLIENT'::uuid);
SELECT t.is((public.get_my_tab(:'SESS_C')->>'subtotal')::numeric,80::numeric,'C1 pedidos e valores das mesas juntadas somados na mesma conta');
SELECT t.is(jsonb_array_length(public.get_my_tab(:'SESS_C')->'joinedTables'),2,'C1 get_my_tab informa mesas ligadas');

-- Separar a Mesa 9 deixa a Mesa 9 livre mantendo Mesa 7 + Mesa 8 juntas.
SELECT t.login(:'WAITER'::uuid);
SELECT public.staff_separate_table(:'TAB_C',:'TBL9');
RESET ROLE;
SELECT t.ok(public._table_active_tab(:'A',:'TBL9') IS NULL,'C1 separar mesa libera a mesa separada');
SELECT t.is(public._table_active_tab(:'A',:'TBL8'),:'TAB_C'::uuid,'C1 mesa 8 permanece ligada à comanda');

-- Item 3: Código de entrega por rodada (opcional, padrão DESLIGADO).
SELECT t.ok(NOT public._salon_delivery_code_required(:'A'),'C3 padrão desligado');
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws($q$SELECT public.set_salon_delivery_code_required('10000000-0000-0000-0000-00000000000a',true)$q$,'FORBIDDEN','C3 somente dono/gerente altera configuração de código de entrega');
SELECT t.login(:'OWNER'::uuid);
SELECT t.ok((public.set_salon_delivery_code_required(:'A',true)->>'require_delivery_code')::boolean,'C3 dono ativa exigência de código de entrega na mesa');

-- Novas rodadas geram códigos de 4 dígitos diferentes por rodada, visíveis só ao cliente daquela conta.
RESET ROLE;
INSERT INTO public.orders(id,tenant_id,tab_id,round_no,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address) VALUES
 ('e1350000-0000-0000-0000-000000000031',:'A',:'TAB_C',3,'DINE_IN','OUT_FOR_DELIVERY',20,20,'CASH','PENDING','DINE_IN_QR',1331,'Cliente C','11900000000','Mesa 7'),
 ('e1350000-0000-0000-0000-000000000032',:'A',:'TAB_C',4,'DINE_IN','OUT_FOR_DELIVERY',25,25,'CASH','PENDING','DINE_IN_QR',1332,'Cliente C','11900000000','Mesa 7');
SELECT customer_code AS code_r3 FROM public.salon_order_delivery_codes WHERE order_id='e1350000-0000-0000-0000-000000000031' \gset
SELECT customer_code AS code_r4 FROM public.salon_order_delivery_codes WHERE order_id='e1350000-0000-0000-0000-000000000032' \gset
SELECT t.ok(length(:'code_r3')=4 AND length(:'code_r4')=4 AND :'code_r3'<>:'code_r4','C3 cada rodada gera código de 4 dígitos diferente');

SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws($q$SELECT * FROM public.salon_order_delivery_codes$q$,'permission denied','C3 garçom não lê tabela de códigos de entrega');
SELECT t.throws($q$SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000031')$q$,'DELIVERY_CODE_REQUIRED','C3 garçom não marca entregue sem código');
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.update_order_status('e1350000-0000-0000-0000-000000000031','DELIVERED')$q$,'DELIVERY_CODE_REQUIRED','C3 update_order_status também exige código de entrega');

-- Tentativa incorreta incrementa contador e registra log; código correto valida e bloqueia "Não recebi".
SELECT t.login(:'WAITER'::uuid);
SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000031','0000') AS bad_try \gset
SELECT t.ok(NOT (:'bad_try'::jsonb->>'success')::boolean AND :'bad_try'::jsonb->>'error'='DELIVERY_CODE_INVALID','C3 código incorreto recusado com contagem de tentativa');
SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000031',:'code_r3') AS ok_try \gset
SELECT t.ok((:'ok_try'::jsonb->>'success')::boolean AND (:'ok_try'::jsonb->>'confirmed_with_code')::boolean,'C3 código correto confirma entrega da rodada 3');

SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$SELECT public.customer_dispute_delivery('e1340000-0000-0000-0000-000000000023','e1350000-0000-0000-0000-000000000031')$q$,'DELIVERY_CONFIRMED_WITH_CODE','C3 Não recebi bloqueado após confirmação com código');

-- Limite de 5 tentativas na rodada 4 bloqueia novas tentativas.
SELECT t.login(:'WAITER'::uuid);
SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000032','0000');
SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000032','0000');
SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000032','0000');
SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000032','0000');
SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000032','0000');
SELECT t.throws(format($q$SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000032',%L)$q$,:'code_r4'),'DELIVERY_CODE_LOCKED','C3 bloqueia após 5 tentativas incorretas');

RESET ROLE;
SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public._entrega1_3_c_restore'::regclass),'C segurança RLS no snapshot de C');
SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.salon_order_delivery_codes'::regclass),'C segurança RLS em salon_order_delivery_codes');
SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.dining_tab_tables'::regclass),'C segurança RLS em dining_tab_tables');
SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.tab_table_moves'::regclass),'C segurança RLS em tab_table_moves');
