-- Garçom v3 — testes SQL (banco LOCAL descartável). Roda depois de 20261027005000.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set MGR 'a0000000-0000-0000-0000-000000000002'
\set W1 'bb000000-0000-0000-0000-000000000001'
\set W2 'bb000000-0000-0000-0000-000000000002'
\set CLIENT 'bb000000-0000-0000-0000-0000000000c1'
\set CLIENT_OTHER 'bb000000-0000-0000-0000-0000000000c2'
RESET ROLE;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
DELETE FROM public.security_rate_limits;

-- Setup inicial
INSERT INTO auth.users (id, email) VALUES
  (:'W1', 'joao.v3@garcom.deliverychannel.local'),
  (:'W2', 'maria.v3@garcom.deliverychannel.local'),
  (:'CLIENT', 'cliente.v3@test.local'),
  (:'CLIENT_OTHER', 'outro.cliente@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, config) VALUES
  (:'A', 'dine_in', true, '{"mode":"TABLE","salon_open":true,"close_roles":["OWNER","MANAGER","CASHIER"]}')
ON CONFLICT (tenant_id, module_key) DO UPDATE SET enabled = true, config = EXCLUDED.config;

-- Cadastra garçons na loja A
SET ROLE service_role;
SELECT public.waiter_provision(:'A', :'W1', 'Garcom Um', '11999990001', 'garcom1', 'garcom1.adega-a@garcom.deliverychannel.local', NULL, NULL, :'OWNER');
SELECT public.waiter_provision(:'A', :'W2', 'Garcom Dois', '11999990002', 'garcom2', 'garcom2.adega-a@garcom.deliverychannel.local', NULL, NULL, :'OWNER');
RESET ROLE;

-- Mesas de teste
INSERT INTO public.dining_tables (id, tenant_id, label, qr_token) VALUES
  ('d1000000-0000-0000-0000-000000000011', :'A', 'Mesa 11', 'gv3-token-000000011'),
  ('d1000000-0000-0000-0000-000000000012', :'A', 'Mesa 12', 'gv3-token-000000012')
ON CONFLICT (id) DO NOTHING;

-- Comandas de teste
DELETE FROM public.dining_tabs WHERE id IN ('d2000000-0000-0000-0000-000000000011', 'd2000000-0000-0000-0000-000000000012');
INSERT INTO public.dining_tabs (id, tenant_id, mode, table_id, status) VALUES
  ('d2000000-0000-0000-0000-000000000011', :'A', 'TABLE', 'd1000000-0000-0000-0000-000000000011', 'OPEN'),
  ('d2000000-0000-0000-0000-000000000012', :'A', 'TABLE', 'd1000000-0000-0000-0000-000000000012', 'OPEN');

-- Pedidos vinculados às comandas (para ter subtotal)
INSERT INTO public.orders (id, tenant_id, tab_id, fulfillment_type, status, subtotal, total_amount, payment_method, payment_status, origin, order_number, customer_name, customer_phone, delivery_address)
VALUES
  ('e1000000-0000-0000-0000-000000000011', :'A', 'd2000000-0000-0000-0000-000000000011', 'DINE_IN', 'CONFIRMED', 50.00, 50.00, 'CASH', 'PENDING', 'DINE_IN_QR', 101, 'Cliente Teste', '11999998888', 'Mesa 11'),
  ('e1000000-0000-0000-0000-000000000012', :'A', 'd2000000-0000-0000-0000-000000000012', 'DINE_IN', 'PREPARING', 80.00, 80.00, 'PIX', 'PENDING', 'DINE_IN_QR', 102, 'Cliente Teste', '11999998888', 'Mesa 12');

-- ===========================================================================
-- TESTE 1: A1 - _legal_signup_check isenta usuários garçom
-- ===========================================================================
DO $$
DECLARE
  v_test_uid uuid := gen_random_uuid();
BEGIN
  -- Com waiter: true não deve lançar 22023 mesmo sendo provider email sem legal_accepted
  INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_test_uid, 'waiter_a1@mesas.local', '{"waiter":true}'::jsonb, '{"provider":"email","waiter_tenant_id":"10000000-0000-0000-0000-00000000000a"}'::jsonb);
END $$;
SELECT t.ok(true, 'A1: _legal_signup_check não bloqueia signup com waiter=true');

-- ===========================================================================
-- TESTE 2: B1 - Garçom NÃO pode pedir a conta por conta própria
-- ===========================================================================
SET ROLE authenticated;
SELECT t.login(:'W1'::uuid);
SELECT t.throws(
  $$SELECT public.staff_request_bill('d2000000-0000-0000-0000-000000000011')$$,
  'FORBIDDEN',
  'B1: garçom NÃO pode pedir a conta por conta própria via staff_request_bill'
);

-- Dono pode pedir a conta
SELECT t.login(:'OWNER'::uuid);
SELECT public.staff_request_bill('d2000000-0000-0000-0000-000000000011');
SELECT t.is(
  (SELECT status FROM public.dining_tabs WHERE id = 'd2000000-0000-0000-0000-000000000011'),
  'BILL_REQUESTED',
  'B2: dono pediu a conta -> mesa fica BILL_REQUESTED (lilás)'
);

-- ===========================================================================
-- TESTE 3: B2 & B4 - Garçom NÃO pode fechar se mesa estiver apenas BILL_REQUESTED
-- ===========================================================================
SELECT t.login(:'W1'::uuid);
SELECT t.throws(
  $$SELECT public.close_tab('d2000000-0000-0000-0000-000000000011', '[{"method":"CASH","amount_cents":5000}]'::jsonb)$$,
  'WAITER_NOT_AUTHORIZED',
  'B4: garçom não fecha conta em BILL_REQUESTED sem autorização do dono'
);

-- ===========================================================================
-- TESTE 4: B3 & B4 - Garçom não pode se autorizar a fechar
-- ===========================================================================
SELECT t.throws(
  $$SELECT public.authorize_waiter_to_close('d2000000-0000-0000-0000-000000000011')$$,
  'FORBIDDEN',
  'B3: garçom NÃO tem permissão para chamar authorize_waiter_to_close'
);

-- Dono autoriza o garçom a fechar
SELECT t.login(:'OWNER'::uuid);
SELECT public.authorize_waiter_to_close('d2000000-0000-0000-0000-000000000011');
SELECT t.is(
  (SELECT status FROM public.dining_tabs WHERE id = 'd2000000-0000-0000-0000-000000000011'),
  'WAITER_AUTHORIZED',
  'B3: dono autorizou -> mesa fica WAITER_AUTHORIZED (roxo forte)'
);
SELECT t.is(
  (SELECT waiter_authorized_by FROM public.dining_tabs WHERE id = 'd2000000-0000-0000-0000-000000000011'),
  :'OWNER'::uuid,
  'B4: auditoria registra quem autorizou'
);
SELECT t.ok(
  (SELECT waiter_authorized_at IS NOT NULL FROM public.dining_tabs WHERE id = 'd2000000-0000-0000-0000-000000000011'),
  'B4: auditoria registra quando autorizou'
);
SELECT t.ok(
  EXISTS (SELECT 1 FROM public.tab_access_events WHERE tab_id = 'd2000000-0000-0000-0000-000000000011' AND event = 'WAITER_AUTHORIZED_TO_CLOSE'),
  'B4: evento WAITER_AUTHORIZED_TO_CLOSE gravado em tab_events'
);

-- ===========================================================================
-- TESTE 5: A5 - Fechar com PIX sem PIX confirmado é PROIBIDO no backend
-- ===========================================================================
SELECT t.login(:'W1'::uuid);
SELECT t.throws(
  $$SELECT public.close_tab('d2000000-0000-0000-0000-000000000011', '[{"method":"PIX","amount_cents":5000}]'::jsonb)$$,
  'PIX_NOT_CONFIRMED',
  'A5 CRÍTICO: close_tab com PIX falha se o Pix não foi confirmado/pago'
);

-- Também falha para o próprio dono se o Pix não foi pago
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws(
  $$SELECT public.close_tab('d2000000-0000-0000-0000-000000000011', '[{"method":"PIX","amount_cents":5000}]'::jsonb)$$,
  'PIX_NOT_CONFIRMED',
  'A5 CRÍTICO: dono também não fecha com PIX sem cobrança Pix confirmada'
);

-- ===========================================================================
-- TESTE 6: B4 & A5 - Garçom fecha conta autorizada com Dinheiro/Cartão
-- ===========================================================================
SELECT t.login(:'W1'::uuid);
SELECT public.close_tab('d2000000-0000-0000-0000-000000000011', '[{"method":"CASH","amount_cents":5000,"change_given_cents":0}]'::jsonb);
SELECT t.is(
  (SELECT status FROM public.dining_tabs WHERE id = 'd2000000-0000-0000-0000-000000000011'),
  'CLOSED',
  'B4: garçom fecha comanda com dinheiro após ser autorizado'
);

-- ===========================================================================
-- TESTE 7: A5 - Fechar com PIX após cobrança PIX paga com sucesso
-- ===========================================================================
RESET ROLE;
SET ROLE service_role;
INSERT INTO public.tab_pix_charges (id, tenant_id, tab_id, amount_cents, status, paid_at)
VALUES ('c1000000-0000-0000-0000-000000000012', :'A', 'd2000000-0000-0000-0000-000000000012', 8000, 'paid', now());
RESET ROLE;

SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.close_tab('d2000000-0000-0000-0000-000000000012', '[{"method":"PIX","amount_cents":8000}]'::jsonb);
SELECT t.is(
  (SELECT status FROM public.dining_tabs WHERE id = 'd2000000-0000-0000-0000-000000000012'),
  'CLOSED',
  'A5: close_tab com PIX sucede quando a cobrança Pix está paga'
);

-- ===========================================================================
-- TESTE 8: A2 - list_team_directory oculta membros inativos
-- ===========================================================================
RESET ROLE;
SET ROLE service_role;
-- Inativa um colaborador
UPDATE public.tenant_users SET status = 'INACTIVE' WHERE tenant_id = :'A' AND user_id = :'W2';
RESET ROLE;

SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.ok(
  NOT EXISTS (SELECT 1 FROM public.list_team_directory(:'A') WHERE user_id = :'W2'),
  'A2: list_team_directory oculta membro com status INACTIVE'
);
SELECT t.ok(
  EXISTS (SELECT 1 FROM public.list_team_directory(:'A') WHERE user_id = :'W1'),
  'A2: list_team_directory mantém membro ativo'
);

-- ===========================================================================
-- TESTE 9: Capabilities v3
-- ===========================================================================
SELECT t.is(
  (public.waiter_v2_capabilities() ->> 'version'),
  '2',
  'Capabilities versão 2'
);
SELECT t.is(
  (public.waiter_v2_capabilities() ->> 'bill_flow_v3'),
  'true',
  'Capabilities reporta bill_flow_v3'
);

-- A1: metadata pública nunca substitui o aceite legal; só app_metadata do Admin API é confiável.
RESET ROLE;
SELECT t.throws($q$INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES(gen_random_uuid(),'forged@mesas.local','{"waiter":true}','{"provider":"email"}')$q$,'Aceite obrigatório','A1: cliente não burla termos com waiter=true');
SELECT t.throws($q$INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES(gen_random_uuid(),'forged2@mesas.local','{"waiter":"inválido"}','{"provider":"email"}')$q$,'Aceite obrigatório','A1: flag inválida não dispara cast nem burla termos');
SELECT t.throws($q$INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES(gen_random_uuid(),'forged3@mesas.local','{"provider":"email","waiter_tenant_id":"ffffffff-ffff-ffff-ffff-ffffffffffff"}')$q$,'Aceite obrigatório','A1: loja inexistente não isenta aceite');

-- Fixtures isoladas para cliente, Pix, fila e estados da cozinha.
INSERT INTO public.tenant_modules(tenant_id,module_key,enabled,config) VALUES(:'B','dine_in',true,'{"mode":"TABLE","salon_open":true}') ON CONFLICT(tenant_id,module_key) DO UPDATE SET enabled=true,config=EXCLUDED.config;
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token) VALUES
 ('d1000000-0000-0000-0000-000000000013',:'A','Mesa 13','gv3-token-000000013'),
 ('d1000000-0000-0000-0000-000000000014',:'A','Mesa 14','gv3-token-000000014'),
 ('d1000000-0000-0000-0000-000000000015',:'A','Mesa 15','gv3-token-000000015'),
 ('d1000000-0000-0000-0000-000000000016',:'B','Mesa 16','gv3-token-000000016');
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,status) VALUES
 ('d2000000-0000-0000-0000-000000000013',:'A','TABLE','d1000000-0000-0000-0000-000000000013','OPEN'),
 ('d2000000-0000-0000-0000-000000000014',:'A','TABLE','d1000000-0000-0000-0000-000000000014','OPEN'),
 ('d2000000-0000-0000-0000-000000000015',:'A','TABLE','d1000000-0000-0000-0000-000000000015','OPEN'),
 ('d2000000-0000-0000-0000-000000000016',:'B','TABLE','d1000000-0000-0000-0000-000000000016','OPEN');
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at) VALUES
 ('d3000000-0000-0000-0000-000000000013',:'A','d2000000-0000-0000-0000-000000000013',:'CLIENT','Cliente da mesa','gv3client13',now());
UPDATE public.dining_tabs SET responsible_user_id=:'CLIENT',waiter_id=:'W1' WHERE id='d2000000-0000-0000-0000-000000000013';
INSERT INTO public.orders(id,tenant_id,tab_id,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,round_no,customer_name,customer_phone,delivery_address,ordered_by_session_id,created_at) VALUES
 ('e1000000-0000-0000-0000-000000000013',:'A','d2000000-0000-0000-0000-000000000013','DINE_IN','PENDING',10,10,'CASH','PENDING','DINE_IN_QR',113,1,'Cliente da mesa','11999998888','Mesa 13','d3000000-0000-0000-0000-000000000013','2099-01-01'),
 ('e1000000-0000-0000-0000-000000000014',:'A','d2000000-0000-0000-0000-000000000014','DINE_IN','PENDING',20,20,'PIX','PENDING','DINE_IN_QR',114,1,'Outro cliente','11999990000','Mesa 14',NULL,'2098-01-01'),
 ('e1000000-0000-0000-0000-000000000015',:'A','d2000000-0000-0000-0000-000000000015','DINE_IN','PENDING',30,30,'PIX','PENDING','DINE_IN_QR',115,1,'Mais um cliente','11999990000','Mesa 15',NULL,'2099-01-01'),
 ('e1000000-0000-0000-0000-000000000016',:'B','d2000000-0000-0000-0000-000000000016','DINE_IN','PENDING',40,40,'CASH','PENDING','DINE_IN_QR',116,1,'SEGREDO_OUTRA_LOJA','11999990000','Mesa 16',NULL,'2000-01-01');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.authorize_waiter_to_close('d2000000-0000-0000-0000-000000000013')$q$,'INVALID_STATE','B3: autorização exige conta solicitada');
SELECT t.throws($q$SELECT public.authorize_waiter_to_close('d2000000-0000-0000-0000-000000000016')$q$,'FORBIDDEN','RLS: dono A não autoriza mesa B');
SELECT t.throws($q$SELECT public.close_tab('d2000000-0000-0000-0000-000000000016','[{"method":"CASH","amount_cents":4000}]')$q$,'FORBIDDEN','RLS: dono A não fecha mesa B');
SELECT t.throws($q$UPDATE public.dining_tabs SET status='CLOSED' WHERE id='d2000000-0000-0000-0000-000000000014'$q$,'permission denied','A5: dono não contorna RPC por UPDATE direto');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.is(t.visible('SELECT * FROM public.dining_tracking_revisions'),1::bigint,'LGPD realtime: cliente lê apenas sinal da sua comanda');
SELECT t.ok(public.get_my_tab('d3000000-0000-0000-0000-000000000013')::text !~ 'SEGREDO_OUTRA_LOJA|Outro cliente|11999990000','LGPD: snapshot não vaza outros clientes/lojas');
SELECT t.is((public.get_my_tab('d3000000-0000-0000-0000-000000000013')->'rounds'->0->>'queuePosition')::bigint,
 t.sq($q$SELECT count(*)+1 FROM public.orders WHERE tenant_id='10000000-0000-0000-0000-00000000000a' AND status IN ('PENDING','CONFIRMED','PREPARING') AND (created_at,id)<('2099-01-01'::timestamptz,'e1000000-0000-0000-0000-000000000013'::uuid)$q$)::bigint,
 'C5: fila usa somente loja e ordenação estável');
SELECT t.throws($q$SELECT public.close_tab('d2000000-0000-0000-0000-000000000013','[{"method":"CASH","amount_cents":1000}]')$q$,'FORBIDDEN','B4: cliente nunca confirma dinheiro');
SELECT t.throws($q$SELECT public.authorize_waiter_to_close('d2000000-0000-0000-0000-000000000013')$q$,'FORBIDDEN','B4: cliente não se autoriza');
SELECT t.login(:'CLIENT_OTHER'::uuid);
SELECT t.is(t.visible('SELECT * FROM public.dining_tracking_revisions'),0::bigint,'LGPD realtime: cliente sem sessão não lê sinais');
SELECT t.throws($q$SELECT public.get_my_tab('d3000000-0000-0000-0000-000000000013')$q$,'TAB_NOT_FOUND','LGPD: outro cliente não usa sessionId alheio');

-- C4/D: linha do tempo completa, servindo sem fluxo de entregador.
SELECT t.login(:'OWNER'::uuid);
SELECT public.update_order_status('e1000000-0000-0000-0000-000000000013','CONFIRMED');
SELECT public.update_order_status('e1000000-0000-0000-0000-000000000013','PREPARING');
SELECT public.update_order_status('e1000000-0000-0000-0000-000000000013','READY');
SELECT t.login(:'W1'::uuid);
SELECT public.update_order_status('e1000000-0000-0000-0000-000000000013','OUT_FOR_DELIVERY');
SELECT t.is(t.order_status('e1000000-0000-0000-0000-000000000013'),'OUT_FOR_DELIVERY','C4: servir salão não exige entregador');
SELECT public.update_order_status('e1000000-0000-0000-0000-000000000013','DELIVERED');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.ok((SELECT bool_and(value IS NOT NULL AND value<>'null'::jsonb) FROM jsonb_each(public.get_my_tab('d3000000-0000-0000-0000-000000000013')->'rounds'->0) WHERE key IN ('confirmedAt','preparingAt','readyAt','servedAt','deliveredAt')),'C4: horários aceito/preparo/pronto/servido/entregue persistidos');
SELECT public.request_bill('d3000000-0000-0000-0000-000000000013');
SELECT t.is(public.get_my_tab('d3000000-0000-0000-0000-000000000013')->>'status','BILL_REQUESTED','B2: cliente pede conta da própria mesa');
SELECT t.login(:'OWNER'::uuid);
SELECT public.authorize_waiter_to_close('d2000000-0000-0000-0000-000000000013');
SELECT t.login(:'CLIENT'::uuid);
SELECT public.request_bill('d3000000-0000-0000-0000-000000000013');
SELECT t.is(public.get_my_tab('d3000000-0000-0000-0000-000000000013')->>'status','WAITER_AUTHORIZED','B5: repetição do cliente não remove autorização');

-- Pix: autorizado cria QR; nem dono/garçom nem UPDATE direto encerra enquanto pendente.
RESET ROLE;
SET ROLE service_role;
SELECT t.throws($q$SELECT public.reserve_tab_pix('d2000000-0000-0000-0000-000000000014','bb000000-0000-0000-0000-000000000001')$q$,'Acesso negado','B4: garçom não gera Pix sem autorização');
SELECT public.reserve_tab_pix('d2000000-0000-0000-0000-000000000013',:'W1') AS v3pix \gset
SELECT (:'v3pix'::jsonb->'charge'->>'id') AS v3charge \gset
SELECT public.save_tab_pix_charge(:'v3charge','{"providerPaymentId":"gv3-pix-13","brcode":"qr-fixture","expiresAt":"2099-01-01T00:00:00Z"}');
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id='d2000000-0000-0000-0000-000000000013'),'AWAITING_PAYMENT','A5: QR pendente mantém conta aguardando pagamento');
SELECT t.throws($q$UPDATE public.dining_tabs SET status='CLOSED' WHERE id='d2000000-0000-0000-0000-000000000013'$q$,'PAYMENT_REQUIRED','A5: trigger impede UPDATE privilegiado sem pagamento');
SELECT t.throws($q$UPDATE public.orders SET subtotal=11 WHERE id='e1000000-0000-0000-0000-000000000013'$q$,'TAB_PAYMENT_IN_PROGRESS','A5: total não muda durante Pix');
SELECT t.throws($q$UPDATE public.orders SET status='CANCELLED' WHERE id='e1000000-0000-0000-0000-000000000013'$q$,'TAB_PAYMENT_IN_PROGRESS','A5: cancelamento não muda total de Pix pendente');
SELECT t.throws($q$UPDATE public.dining_tabs SET service_fee_removed=true WHERE id='d2000000-0000-0000-0000-000000000013'$q$,'TAB_PAYMENT_IN_PROGRESS','A5: taxa não muda durante Pix');
SELECT t.throws($q$SELECT public.reserve_tab_pix('d2000000-0000-0000-0000-000000000016','a0000000-0000-0000-0000-000000000001')$q$,'Acesso negado','RLS: usuário A não gera Pix B via servidor');
RESET ROLE;
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.close_tab('d2000000-0000-0000-0000-000000000013','[{"method":"CASH","amount_cents":1000}]')$q$,'PIX_NOT_CONFIRMED','A5: dinheiro exige cancelar Pix pendente');
SELECT t.throws($q$SELECT public.confirm_tab_pix('c1000000-0000-0000-0000-000000000012','{"paid":true}')$q$,'permission denied','A5: dono não forja webhook');
SELECT t.is(public.staff_open_tab('d1000000-0000-0000-0000-000000000013')->>'tabId','d2000000-0000-0000-0000-000000000013','B4: abrir mesa aguardando retorna mesma comanda');
RESET ROLE;
SELECT t.ok(array_to_string(public._tenant_module_disable_blockers(:'A','dine_in'),',') LIKE '%AWAITING_PAYMENT%','B4: módulo detecta comandas no novo ciclo');
RESET ROLE;
SET ROLE service_role;
SELECT t.throws(format('SELECT public.confirm_tab_pix(%L,%L::jsonb)',:'v3charge','{"paid":true,"providerPaymentId":"gv3-pix-13","orderId":"tab:d2000000-0000-0000-0000-000000000013","currency":"BRL","amountCents":999}'),'não corresponde','A5: webhook com valor divergente não confirma');
SELECT public.confirm_tab_pix(:'v3charge','{"paid":false,"rawStatus":"pending"}');
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id='d2000000-0000-0000-0000-000000000013'),'AWAITING_PAYMENT','A5: status pendente nunca fecha');
SELECT public.confirm_tab_pix(:'v3charge','{"paid":true,"rawStatus":"approved","providerPaymentId":"gv3-pix-13","orderId":"tab:d2000000-0000-0000-0000-000000000013","currency":"BRL","amountCents":1000}');
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id='d2000000-0000-0000-0000-000000000013'),'CLOSED','A5: somente confirmação confiável fecha Pix');
SELECT public.confirm_tab_pix(:'v3charge','{"paid":true,"rawStatus":"approved","providerPaymentId":"gv3-pix-13","orderId":"tab:d2000000-0000-0000-0000-000000000013","currency":"BRL","amountCents":1000}');
SELECT t.is((SELECT count(*) FROM public.tab_payments WHERE tab_id='d2000000-0000-0000-0000-000000000013'),1::bigint,'A5: webhook repetido não duplica pagamento');
SELECT t.throws($q$UPDATE public.dining_tabs SET status='OPEN' WHERE id='d2000000-0000-0000-0000-000000000013'$q$,'TAB_CLOSED','A5: pagamento confirmado não reabre comanda');
RESET ROLE;
SET ROLE authenticated;
SELECT t.login(:'W1'::uuid);
RESET ROLE;
SET ROLE service_role;
SELECT t.is(public.get_tab_pix_charge('d2000000-0000-0000-0000-000000000013',:'W1')->>'tab_status','CLOSED','A5: garçom autorizado consulta o resultado final do Pix');

-- Pix falha/cancelado/expirado retorna ao fluxo seguro, sem perder a auditoria.
SELECT public.reserve_tab_pix('d2000000-0000-0000-0000-000000000015',:'OWNER') AS pix15 \gset
SELECT (:'pix15'::jsonb->'charge'->>'id') AS charge15 \gset
SELECT public.fail_tab_pix_charge(:'charge15');
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id='d2000000-0000-0000-0000-000000000015'),'BILL_REQUESTED','A5: falha de criação não deixa mesa presa aguardando pagamento');
SELECT public.reserve_tab_pix('d2000000-0000-0000-0000-000000000015',:'OWNER');
SELECT public.cancel_tab_pix('d2000000-0000-0000-0000-000000000015',:'OWNER');
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id='d2000000-0000-0000-0000-000000000015'),'BILL_REQUESTED','A5: cancelar QR preserva conta aberta');
SELECT public.reserve_tab_pix('d2000000-0000-0000-0000-000000000015',:'OWNER') AS pix15expired \gset
SELECT (:'pix15expired'::jsonb->'charge'->>'id') AS charge15expired \gset
SELECT public.save_tab_pix_charge(:'charge15expired','{"providerPaymentId":"gv3-expired-15","brcode":"qr-expired","expiresAt":"2000-01-01T00:00:00Z"}');
SELECT public.confirm_tab_pix(:'charge15expired','{"paid":false,"rawStatus":"expired"}');
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id='d2000000-0000-0000-0000-000000000015'),'BILL_REQUESTED','A5: QR expirado não fecha e permite nova cobrança');
SELECT public.reserve_tab_pix('d2000000-0000-0000-0000-000000000015',:'OWNER') AS pix15late \gset
SELECT (:'pix15late'::jsonb->'charge'->>'id') AS charge15late \gset
SELECT public.save_tab_pix_charge(:'charge15late','{"providerPaymentId":"gv3-late-15","brcode":"qr-late","expiresAt":"2099-01-01T00:00:00Z"}');
SELECT public.cancel_tab_pix('d2000000-0000-0000-0000-000000000015',:'OWNER');
SELECT public.confirm_tab_pix(:'charge15late','{"paid":true,"rawStatus":"approved","providerPaymentId":"gv3-late-15","orderId":"tab:d2000000-0000-0000-0000-000000000015","currency":"BRL","amountCents":3000}');
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id='d2000000-0000-0000-0000-000000000015'),'BILL_REQUESTED','A5: webhook de QR cancelado não encerra conta indevidamente');
SELECT t.ok((SELECT status='paid' AND needs_review AND paid_at IS NOT NULL FROM public.tab_pix_charges WHERE id=:'charge15late'),'A5: Pix pago tardiamente fica registrado para conferência');

-- A atribuição atual prevalece sobre o histórico do garçom que abriu a comanda.
SELECT public.waiter_set_active(:'A',:'W2',true);
UPDATE public.dining_tabs SET waiter_id=:'W1' WHERE id='d2000000-0000-0000-0000-000000000014';
INSERT INTO public.waiter_table_assignments(tenant_id,table_id,waiter_id) VALUES(:'A','d1000000-0000-0000-0000-000000000014',:'W2');
RESET ROLE;
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.staff_request_bill('d2000000-0000-0000-0000-000000000014');
SELECT public.authorize_waiter_to_close('d2000000-0000-0000-0000-000000000014');
SELECT t.login(:'W1'::uuid);
SELECT t.throws($q$SELECT public.close_tab('d2000000-0000-0000-0000-000000000014','[{"method":"CREDIT_CARD","amount_cents":2000}]')$q$,'WAITER_NOT_AUTHORIZED','B4: antigo garçom não cobra mesa transferida');
SELECT t.login(:'W2'::uuid);
SELECT public.close_tab('d2000000-0000-0000-0000-000000000014','[{"method":"CREDIT_CARD","amount_cents":2000}]');
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id='d2000000-0000-0000-0000-000000000014'),'CLOSED','B4: novo responsável cobra cartão após autorização');

-- A2: revogação funciona com/sem perfil v2 e mantém vínculo legítimo na outra loja.
RESET ROLE;
INSERT INTO auth.users(id,email) VALUES('bb000000-0000-0000-0000-0000000000f1','legacy-v3@mesas.local');
INSERT INTO public.tenant_users(tenant_id,user_id,role_id,status) VALUES(:'A','bb000000-0000-0000-0000-0000000000f1','WAITER','ACTIVE'),(:'B','bb000000-0000-0000-0000-0000000000f1','OPERATOR','ACTIVE');
INSERT INTO public.waiter_presence(tenant_id,user_id) VALUES(:'A','bb000000-0000-0000-0000-0000000000f1');
INSERT INTO public.waiter_table_assignments(tenant_id,table_id,waiter_id) VALUES(:'A','d1000000-0000-0000-0000-000000000015','bb000000-0000-0000-0000-0000000000f1');
SELECT id AS legacy_member FROM public.tenant_users WHERE tenant_id=:'A' AND user_id='bb000000-0000-0000-0000-0000000000f1' \gset
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.remove_team_member(:'legacy_member');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM public.list_team_directory(:'A') WHERE user_id='bb000000-0000-0000-0000-0000000000f1'),'A2: revogar garçom legado remove da lista');
RESET ROLE;
SELECT t.ok(NOT EXISTS(SELECT 1 FROM public.waiter_presence WHERE tenant_id=:'A' AND user_id='bb000000-0000-0000-0000-0000000000f1'),'A2: legado perde presença após revogar');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM public.waiter_table_assignments WHERE tenant_id=:'A' AND waiter_id='bb000000-0000-0000-0000-0000000000f1'),'A2: legado perde atribuições após revogar');
SELECT t.is((SELECT status FROM public.tenant_users WHERE tenant_id=:'B' AND user_id='bb000000-0000-0000-0000-0000000000f1'),'ACTIVE','LGPD: revogação preserva acesso na outra loja');
UPDATE public.tenant_users SET status='INACTIVE' WHERE tenant_id=:'A' AND user_id=:'W2';
SELECT t.is((SELECT active FROM public.waiter_profiles WHERE tenant_id=:'A' AND user_id=:'W2'),false,'A2: vínculo v2 revogado também desativa login');
SELECT t.ok(NOT public._tab_can_collect('d2000000-0000-0000-0000-000000000014',:'W2'),'B4: autorização antiga não sobrevive à revogação de acesso');

-- O sinal atualiza mesmo quando outro pedido da loja avança e altera a posição da fila.
SELECT revision AS tracking_before FROM public.dining_tracking_revisions WHERE tab_id='d2000000-0000-0000-0000-000000000015' \gset
UPDATE public.orders SET status='PREPARING' WHERE id='e1000000-0000-0000-0000-000000000014';
SELECT t.ok((SELECT revision>:'tracking_before'::timestamptz FROM public.dining_tracking_revisions WHERE tab_id='d2000000-0000-0000-0000-000000000015'),'C5: mudança em pedido da loja emite sinal de fila');
SELECT t.ok(EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='dining_tracking_revisions'),'C4: sinais seguros publicados no Supabase realtime');
SET ROLE anon;
SELECT t.login(NULL::uuid);
SELECT t.is(t.visible('SELECT * FROM public.dining_tracking_revisions'),0::bigint,'LGPD: anon sem sessão não lê realtime');
RESET ROLE;

-- B1: possuir uma sessão de QR não permite que o garçom contorne a regra de pedir a conta.
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at) VALUES
 ('d3000000-0000-0000-0000-000000000015',:'A','d2000000-0000-0000-0000-000000000015',:'W1','Garçom na mesa','gv3waiter-session',now());
SET ROLE authenticated;
SELECT t.login(:'W1'::uuid);
SELECT t.throws($q$SELECT public.request_bill('d3000000-0000-0000-0000-000000000015')$q$,'FORBIDDEN','B1: garçom não pede conta usando sessão cliente QR');
SELECT t.throws($q$UPDATE public.dining_tabs SET waiter_authorized_by=auth.uid(),waiter_authorized_at=now(),status='WAITER_AUTHORIZED' WHERE id='d2000000-0000-0000-0000-000000000015'$q$,'permission denied','B4: garçom não forja auditoria por UPDATE');
RESET ROLE;

