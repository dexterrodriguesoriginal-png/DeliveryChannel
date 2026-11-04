-- Item 1: autorização real no servidor, sem expor dados pessoais ou outras contas.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set OWNER_B 'b0000000-0000-0000-0000-000000000001'
\set MANAGER 'a0000000-0000-0000-0000-000000000002'
\set CASHIER 'a0000000-0000-0000-0000-000000000004'
\set CLIENT 'e1310000-0000-0000-0000-000000000001'
\set CLIENT2 'e1310000-0000-0000-0000-000000000004'
\set WAITER 'e1310000-0000-0000-0000-000000000002'
\set OTHER 'e1310000-0000-0000-0000-000000000003'
\set TAB 'e1430000-0000-0000-0000-000000000101'
\set TAB2 'e1430000-0000-0000-0000-000000000105'
\set SESSION 'e1440000-0000-0000-0000-000000000101'
\set SESSION2 'e1440000-0000-0000-0000-000000000105'
\set T101 'e1420000-0000-0000-0000-000000000101'
\set T102 'e1420000-0000-0000-0000-000000000102'
\set T103 'e1420000-0000-0000-0000-000000000103'
\set T104 'e1420000-0000-0000-0000-000000000104'
RESET ROLE;
SELECT t.login(NULL);
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token)
SELECT ('e1420000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,:'A','1.4 Mesa '||n,'entrega14-table-'||n FROM generate_series(101,112) n;
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token) VALUES('e1420000-0000-0000-0000-000000000113',:'B','1.4 Outra loja','entrega14-table-113');
INSERT INTO public.waiter_table_assignments(tenant_id,table_id,waiter_id,assigned_by)
SELECT :'A',('e1420000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n IN(104,105) THEN :'OTHER'::uuid ELSE :'WAITER'::uuid END,:'OWNER' FROM generate_series(101,105) n;
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,responsible_user_id)
VALUES(:'TAB',:'A','TABLE',:'T101',:'CLIENT'),(:'TAB2',:'A','TABLE','e1420000-0000-0000-0000-000000000105',:'CLIENT2');
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at)
VALUES(:'SESSION',:'A',:'TAB',:'CLIENT','Nome privado','entrega14-101',now()),(:'SESSION2',:'A',:'TAB2',:'CLIENT2','Outro privado','entrega14-105',now());
INSERT INTO public.orders(id,tenant_id,tab_id,ordered_by_session_id,round_no,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address)
VALUES('e1450000-0000-0000-0000-000000000101',:'A',:'TAB',:'SESSION',1,'DINE_IN','PREPARING',47,47,'CASH','PENDING','DINE_IN_QR',14101,'Nome privado','11900000000','Mesa 101');
INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price)
VALUES('e1450000-0000-0000-0000-000000000101','d0000000-0000-0000-0000-0000000000a1','Prato',1,47,47);
SELECT t.ok(NOT (public._waiter_settings(:'A')).allow_waiter_table_move_approval AND NOT (public._waiter_settings(:'B')).allow_waiter_table_move_approval,'1.4.1 permissão desligada inclusive no fallback sem configuração');
SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.table_move_requests'::regclass) AND (SELECT relrowsecurity FROM pg_class WHERE oid='public._entrega1_4_move_restore'::regclass),'1.4.1 RLS em todas as tabelas novas');
SELECT t.ok(NOT has_table_privilege('anon','public.table_move_requests','SELECT') AND NOT has_function_privilege('anon','public.resolve_table_move_request(uuid,boolean)','EXECUTE') AND NOT has_function_privilege('anon','public.customer_move_table(uuid,uuid,text)','EXECUTE'),'1.4.1 nenhuma permissão nova para anon');

SET ROLE authenticated;
SELECT t.login(:'CLIENT'::uuid);
SELECT public.customer_move_table(:'SESSION',:'T102') AS request1 \gset
SELECT t.is(:'request1'::jsonb->>'status','PENDING','1.4.1 cliente cria solicitação pendente');
SELECT t.is(public.get_my_tab(:'SESSION')->>'tableLabel','1.4 Mesa 101','1.4.1 solicitar não muda mesa ou conta');
SELECT t.is(public.customer_move_table(:'SESSION',:'T102')->>'requestId',:'request1'::jsonb->>'requestId','1.4.1 repetição da mesma solicitação é idempotente');
SELECT t.is(jsonb_array_length(public.list_my_table_move_requests(:'SESSION')),1,'1.4.1 cliente acompanha sua própria solicitação');
SELECT t.is(t.visible('SELECT * FROM public.table_move_requests'),1::bigint,'1.4.1 RLS cliente lê somente sua solicitação');
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'request1'::jsonb->>'requestId'),'FORBIDDEN','1.4.1 cliente não autoriza a própria solicitação');
SELECT t.throws($q$SELECT public.customer_move_table('e1440000-0000-0000-0000-000000000101','e1420000-0000-0000-0000-000000000113')$q$,'TABLE_UNAVAILABLE','1.4.1 cliente não solicita mesa de outra loja');
SELECT t.login(:'CLIENT2'::uuid);
SELECT t.is(t.visible('SELECT * FROM public.table_move_requests'),0::bigint,'1.4.1 outra conta não lê solicitação nem sessão do cliente');
SELECT t.throws($q$SELECT public.list_my_table_move_requests('e1440000-0000-0000-0000-000000000101')$q$,'FORBIDDEN','1.4.1 getter de cliente impede outra sessão');
SELECT t.login(:'WAITER'::uuid);
SELECT t.is(t.visible('SELECT * FROM public.table_move_requests'),0::bigint,'1.4.1 garçom sem permissão não enxerga solicitação');
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'request1'::jsonb->>'requestId'),'FORBIDDEN','1.4.1 RPC recusa garçom por padrão');
SELECT t.throws(format('SELECT public.list_table_move_requests(%L)',:'A'),'FORBIDDEN','1.4.1 listagem recusa garçom sem permissão');
SELECT t.login(:'MANAGER'::uuid);
SELECT t.is(t.visible('SELECT * FROM public.table_move_requests'),0::bigint,'1.4.1 gerente não ganha permissão do dono');
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'request1'::jsonb->>'requestId'),'FORBIDDEN','1.4.1 gerente não autoriza por padrão');
SELECT t.throws(format('SELECT public.set_waiter_table_move_approval(%L,true)',:'A'),'FORBIDDEN','1.4.1 gerente não habilita permissão do garçom');
SELECT t.throws(format('UPDATE public.waiter_service_settings SET allow_waiter_table_move_approval=true WHERE tenant_id=%L',:'A'),'permission denied','1.4.1 escrita direta na configuração é proibida');
SELECT t.login(:'CASHIER'::uuid);
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'request1'::jsonb->>'requestId'),'FORBIDDEN','1.4.1 caixa não autoriza');
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.is(t.visible('SELECT * FROM public.table_move_requests'),0::bigint,'1.4.1 dono de outra loja não lê solicitações');
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'request1'::jsonb->>'requestId'),'FORBIDDEN','1.4.1 dono de outra loja não autoriza');
SELECT t.throws(format('SELECT public.set_waiter_table_move_approval(%L,true)',:'A'),'FORBIDDEN','1.4.1 dono de outra loja não configura');
SELECT t.login(:'OWNER'::uuid);
SELECT t.is(jsonb_array_length(public.list_table_move_requests(:'A')),1,'1.4.1 dono recebe solicitação pendente sem dados pessoais');
SELECT t.ok(NOT (public.list_table_move_requests(:'A')::text ~ 'Nome privado|email|session|auth_user'),'1.4.1 projeção da equipe não inclui identidade/email/sessão');
SELECT t.is(public.resolve_table_move_request((:'request1'::jsonb->>'requestId')::uuid,false)->>'status','REJECTED','1.4.1 dono recusa solicitação');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.is(public.get_my_tab(:'SESSION')->>'tableLabel','1.4 Mesa 101','1.4.1 recusar preserva mesa original');
SELECT t.is(public.list_my_table_move_requests(:'SESSION')->0->>'status','REJECTED','1.4.1 cliente vê recusa');
SELECT public.customer_move_table(:'SESSION',NULL,'https://app.test/?mesa=entrega14-table-102') AS request2 \gset
RESET ROLE;
UPDATE public.dining_tabs SET status='BILL_REQUESTED' WHERE id=:'TAB';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'request2'::jsonb->>'requestId'),'TABLE_CHANGE_BLOCKED','1.4.1 aprovação revalida conta pedida');
RESET ROLE;
UPDATE public.dining_tabs SET status='OPEN' WHERE id=:'TAB';
UPDATE public.tab_sessions SET approved_at=NULL WHERE id=:'SESSION';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'request2'::jsonb->>'requestId'),'MOVE_SESSION_INVALID','1.4.1 aprovação revalida sessão aprovada');
RESET ROLE;
UPDATE public.tab_sessions SET approved_at=now() WHERE id=:'SESSION';
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id) VALUES('e1430000-0000-0000-0000-000000000102',:'A','TABLE',:'T102');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'request2'::jsonb->>'requestId'),'TABLE_OCCUPIED','1.4.1 destino ocupado após pedido bloqueia autorização');
RESET ROLE;
UPDATE public.dining_tabs SET status='CANCELLED' WHERE id='e1430000-0000-0000-0000-000000000102';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.is(public.resolve_table_move_request((:'request2'::jsonb->>'requestId')::uuid,true)->>'status','APPROVED','1.4.1 dono autoriza mudança de mesa');
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'request2'::jsonb->>'requestId'),'REQUEST_ALREADY_RESOLVED','1.4.1 solicitação só pode ser resolvida uma vez');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.is(public.get_my_tab(:'SESSION')->>'tableLabel','1.4 Mesa 102','1.4.1 dívida/sessão acompanham mesa somente depois da autorização');
SELECT t.is((public.get_my_tab(:'SESSION')->>'subtotal')::numeric,47::numeric,'1.4.1 subtotal preservado');
RESET ROLE;
SELECT t.ok(public._table_active_tab(:'A',:'T101') IS NULL AND public._table_active_tab(:'A',:'T102')=:'TAB'::uuid,'1.4.1 libera antiga sem abandonar conta');
SELECT t.is((SELECT table_id FROM public._salon_order_seats WHERE order_id='e1450000-0000-0000-0000-000000000101'),:'T102'::uuid,'1.4.1 pedidos mantêm destino e proveniência');
SELECT t.ok(EXISTS(SELECT 1 FROM public.owner_notifications WHERE tenant_id=:'A' AND ref_id=:'TAB' AND kind='TABLE_MOVED' AND title='1.4 Mesa 101 → 1.4 Mesa 102'),'1.4.1 dono é notificado apenas da mudança autorizada');
SELECT t.ok(EXISTS(SELECT 1 FROM public.tab_table_moves WHERE tab_id=:'TAB' AND actor_kind='STAFF' AND actor_id=:'OWNER'),'1.4.1 histórico registra quem autorizou');

SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_waiter_table_move_approval(:'A',true);
SELECT t.login(:'MANAGER'::uuid);
SELECT public.set_waiter_service_settings(:'A','FREE',false,60,60);
SELECT t.login(:'CLIENT'::uuid);
SELECT public.customer_move_table(:'SESSION',:'T103') AS request3 \gset
SELECT t.login(:'OTHER'::uuid);
SELECT t.is(t.visible(format('SELECT * FROM public.table_move_requests WHERE id=%L',:'request3'::jsonb->>'requestId')),0::bigint,'1.4.1 permissão não expõe solicitações de mesas de outro garçom');
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'request3'::jsonb->>'requestId'),'FORBIDDEN','1.4.1 garçom de outra mesa não autoriza mesmo habilitado');
SELECT t.login(:'WAITER'::uuid);
SELECT t.ok(jsonb_array_length(public.list_table_move_requests(:'A'))=1,'1.4.1 garçom habilitado vê apenas sua mesa');
SELECT t.is(public.resolve_table_move_request((:'request3'::jsonb->>'requestId')::uuid,true)->>'status','APPROVED','1.4.1 garçom habilitado e ativo autoriza sua mesa');
SELECT t.login(:'CLIENT'::uuid);
SELECT public.customer_move_table(:'SESSION',:'T104') AS request4 \gset
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'request4'::jsonb->>'requestId'),'FORBIDDEN','1.4.1 garçom não move para destino de outro garçom');
SELECT t.login(:'OWNER'::uuid);
SELECT public.resolve_table_move_request((:'request4'::jsonb->>'requestId')::uuid,false);
SELECT t.login(:'CLIENT'::uuid);
SELECT public.customer_move_table(:'SESSION',:'T102') AS request5 \gset
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_waiter_table_move_approval(:'A',false);
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'request5'::jsonb->>'requestId'),'FORBIDDEN','1.4.1 desligar revoga imediatamente autorização de solicitação existente');
SELECT t.is(t.visible('SELECT * FROM public.table_move_requests'),0::bigint,'1.4.1 desligar revoga também a leitura RLS');
SELECT t.login(:'OWNER'::uuid);
SELECT public.resolve_table_move_request((:'request5'::jsonb->>'requestId')::uuid,true);
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$SELECT public.customer_move_table('e1440000-0000-0000-0000-000000000101','e1420000-0000-0000-0000-000000000103')$q$,'RATE_LIMITED','1.4.1 limite por conta evita abuso de solicitações');

-- Nova escolha não pode alterar silenciosamente o destino que o dono já viu.
SELECT t.login(:'CLIENT2'::uuid);
SELECT public.customer_move_table(:'SESSION2','e1420000-0000-0000-0000-000000000106') AS replaced \gset
SELECT public.customer_move_table(:'SESSION2','e1420000-0000-0000-0000-000000000107') AS replacement \gset
SELECT t.ok(:'replaced'::jsonb->>'requestId'<>:'replacement'::jsonb->>'requestId','1.4.1 novo destino usa novo UUID de solicitação');
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'replaced'::jsonb->>'requestId'),'REQUEST_ALREADY_RESOLVED','1.4.1 dono não aprova pedido substituído com outro destino');
RESET ROLE;
UPDATE public.tab_sessions SET approved_at=now()-interval '10 minutes',expires_at=now()-interval '1 second' WHERE id=:'SESSION2';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws(format('SELECT public.resolve_table_move_request(%L,true)',:'replacement'::jsonb->>'requestId'),'MOVE_SESSION_INVALID','1.4.1 sessão expirada não move a dívida');
SELECT t.is(public.resolve_table_move_request((:'replacement'::jsonb->>'requestId')::uuid,false)->>'status','REJECTED','1.4.1 dono ainda pode recusar solicitação expirada');
RESET ROLE;
SELECT t.login(NULL);
