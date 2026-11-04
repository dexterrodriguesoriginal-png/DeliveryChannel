-- Dados sintéticos: duas rodadas na mesma conta e uma mesa/loja alheia.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set OWNER_B 'b0000000-0000-0000-0000-000000000001'
\set CLIENT 'e1310000-0000-0000-0000-000000000001'
\set WAITER 'e1310000-0000-0000-0000-000000000002'
\set WAITER_OTHER 'e1310000-0000-0000-0000-000000000003'
\set TAB 'e1330000-0000-0000-0000-000000000001'
\set SESSION 'e1340000-0000-0000-0000-000000000001'
RESET ROLE;
SELECT t.login(NULL);
INSERT INTO auth.users(id,email) VALUES(:'CLIENT','cliente@test.example'),(:'WAITER','garcom@test.example'),(:'WAITER_OTHER','outrogarcom@test.example');
INSERT INTO public.tenant_users(tenant_id,user_id,role_id,status) VALUES(:'A',:'WAITER','WAITER','ACTIVE'),(:'A',:'WAITER_OTHER','WAITER','ACTIVE');
INSERT INTO public.tenant_modules(tenant_id,module_key,enabled,config) VALUES
 (:'A','dine_in',true,'{"mode":"TABLE","salon_open":true}'),(:'B','dine_in',true,'{"mode":"TABLE","salon_open":true}')
ON CONFLICT(tenant_id,module_key) DO UPDATE SET enabled=true,config=EXCLUDED.config;
INSERT INTO public.store_tools(tenant_id,tool,enabled) VALUES(:'A','waiter',true),(:'B','waiter',true)
ON CONFLICT(tenant_id,tool) DO UPDATE SET enabled=true;
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token)
SELECT ('e1320000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n=2 THEN :'B'::uuid ELSE :'A'::uuid END,
 'Mesa A '||n,'entrega1-3-token-'||n FROM generate_series(1,3) n;
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,status,service_fee_percent,responsible_user_id)
SELECT ('e1330000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n=2 THEN :'B'::uuid ELSE :'A'::uuid END,'TABLE',
 ('e1320000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'OPEN',0,:'CLIENT' FROM generate_series(1,3) n;
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at)
SELECT ('e1340000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n=2 THEN :'B'::uuid ELSE :'A'::uuid END,
 ('e1330000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,:'CLIENT','Cliente sintético','entrega1-3-fixture-'||n,now() FROM generate_series(1,3) n;
INSERT INTO public.waiter_table_assignments(tenant_id,table_id,waiter_id,assigned_by)
VALUES(:'A','e1320000-0000-0000-0000-000000000001',:'WAITER',:'OWNER'),
 (:'A','e1320000-0000-0000-0000-000000000003',:'WAITER_OTHER',:'OWNER');
INSERT INTO public.orders(id,tenant_id,tab_id,round_no,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address)
SELECT ('e1350000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,:'A',:'TAB',n,
 'DINE_IN',CASE WHEN n=4 THEN 'PENDING' ELSE 'PREPARING' END,10,10,'CASH','PENDING','DINE_IN_QR',1300+n,'Cliente sintético','11900000000','Mesa sintética'
FROM generate_series(1,4) n;
INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price)
SELECT ('e1350000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'d0000000-0000-0000-0000-0000000000a1','Item sintético',1,10,10 FROM generate_series(1,4) n;

SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws($q$SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000001')$q$,'INVALID_STATE.*Aguardando balcão','A2 PREPARING não pode ser entregue');
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.update_order_status('e1350000-0000-0000-0000-000000000001','OUT_FOR_DELIVERY')$q$,'INVALID_STATE.*pronto','A2 nem dono pode servir antes de terminar o preparo');
SELECT t.throws($q$SELECT public.update_order_status('e1350000-0000-0000-0000-000000000004','OUT_FOR_DELIVERY')$q$,'INVALID_STATE.*pronto','A2 pedido novo não pode pular direto para servido');
SELECT public.update_order_status('e1350000-0000-0000-0000-000000000001','READY');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.waiter_calls WHERE order_id='e1350000-0000-0000-0000-000000000001' AND status='OPEN'),1::bigint,'A5 primeira rodada pronta cria chamado próprio');
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws($q$SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000001')$q$,'INVALID_STATE.*Aguardando balcão','A2 READY também aguarda balcão');
SELECT t.throws($q$SELECT public.update_order_status('e1350000-0000-0000-0000-000000000001','OUT_FOR_DELIVERY')$q$,'TRANSITION_FORBIDDEN','A2 garçom não pode liberar seu próprio pedido');
SELECT t.throws($q$SELECT public.update_order_status('e1350000-0000-0000-0000-000000000001','DELIVERED')$q$,'INVALID_STATE','A2 RPC geral não contorna liberação do balcão');
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.update_order_status('e1350000-0000-0000-0000-000000000001','DELIVERED')$q$,'INVALID_STATE','A2 dono também precisa liberar no balcão antes de entregar');
SELECT public.update_order_status('e1350000-0000-0000-0000-000000000001','OUT_FOR_DELIVERY');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000001')$q$,'ORDER_NOT_FOUND','A segurança cliente não marca entrega');
SELECT t.is(t.visible('SELECT * FROM public.waiter_calls'),0::bigint,'A segurança cliente não enumera chamados de mesas');
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.throws($q$SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000001')$q$,'ORDER_NOT_FOUND','A segurança outra loja não entrega rodada');
SELECT t.is(t.visible('SELECT * FROM public.waiter_calls'),0::bigint,'A segurança outra loja não enxerga chamado');
SELECT t.login(:'WAITER_OTHER'::uuid);
SELECT t.throws($q$SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000001')$q$,'ORDER_NOT_FOUND','A segurança garçom de outra mesa na mesma loja não entrega rodada');
SELECT t.throws($q$SELECT public.update_order_status('e1350000-0000-0000-0000-000000000001','DELIVERED')$q$,'ORDER_NOT_FOUND','A segurança RPC geral também recusa garçom de outra mesa');
SELECT t.login(:'WAITER'::uuid);
SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000001') AS delivered_a1 \gset
SELECT t.is(public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000001'),:'delivered_a1'::jsonb,'A entrega idempotente após liberação');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.waiter_calls WHERE order_id='e1350000-0000-0000-0000-000000000001' AND status='HANDLED'),1::bigint,'A5 entrega encerra apenas chamado da rodada');
SELECT t.is((SELECT count(*) FROM public.order_status_history WHERE order_id='e1350000-0000-0000-0000-000000000001' AND status='DELIVERED'),1::bigint,'A entrega idempotente sem histórico duplicado');

-- Segunda e terceira rodadas repetem o fluxo com a conta ainda aberta.
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.update_order_status('e1350000-0000-0000-0000-000000000002','READY');
SELECT public.update_order_status('e1350000-0000-0000-0000-000000000003','READY');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.waiter_calls WHERE tab_id=:'TAB' AND status='OPEN'),2::bigint,'A5 segunda e terceira rodadas geram chamados independentes na mesma conta');
UPDATE public.orders SET status='READY' WHERE id IN ('e1350000-0000-0000-0000-000000000002','e1350000-0000-0000-0000-000000000003');
SELECT t.is((SELECT count(*) FROM public.waiter_calls WHERE tab_id=:'TAB' AND status='OPEN'),2::bigint,'A5 atualização repetida não duplica chamados');
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws($q$SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000002')$q$,'INVALID_STATE','A2 segunda rodada também precisa ser servida');
SELECT t.login(:'OWNER'::uuid);
SELECT public.update_order_status('e1350000-0000-0000-0000-000000000002','OUT_FOR_DELIVERY');
SELECT t.login(:'WAITER'::uuid);
SELECT public.waiter_mark_delivered('e1350000-0000-0000-0000-000000000002');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.waiter_calls WHERE tab_id=:'TAB' AND status='OPEN'),1::bigint,'A5 entregar segunda rodada mantém chamada da terceira');
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id=:'TAB'),'OPEN','A5 entrega das rodadas preserva conta aberta e dívida');
SET ROLE authenticated;
SELECT t.login(:'CLIENT'::uuid);
SELECT t.ok((public.get_my_tab(:'SESSION')->'rounds')::text LIKE '%READY%','A5 sessão acompanha rodada atual depois de duas entregas');
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.throws($q$SELECT public.get_my_tab('e1340000-0000-0000-0000-000000000001')$q$,'FORBIDDEN|TAB_NOT_FOUND|SESSION','A segurança sessão não pode ser usada por outro cliente');
RESET ROLE;
SELECT t.login(NULL);
SELECT t.throws($q$INSERT INTO public.waiter_calls(tenant_id,tab_id,type,order_id) VALUES('10000000-0000-0000-0000-00000000000b','e1330000-0000-0000-0000-000000000002','CALL','e1350000-0000-0000-0000-000000000001')$q$,'foreign key','A segurança vínculo do chamado exige mesma loja do pedido');
SET ROLE authenticated;
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$INSERT INTO public.waiter_calls(tenant_id,tab_id,type,order_id) VALUES('10000000-0000-0000-0000-00000000000a','e1330000-0000-0000-0000-000000000001','CALL','e1350000-0000-0000-0000-000000000003')$q$,'permission denied','A segurança cliente não falsifica chamada de rodada');
SELECT t.throws($q$SELECT * FROM public._entrega1_3_a_restore$q$,'permission denied','A segurança snapshot de rollback é privado mesmo com privilégios herdados');
SELECT t.throws($q$SELECT public._salon_order_pickup_call()$q$,'permission denied','A segurança trigger não é RPC pública');
RESET ROLE;
SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public._entrega1_3_a_restore'::regclass),'A segurança RLS no snapshot novo');
