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
  VALUES (v_test_uid, 'waiter_a1@mesas.local', '{"waiter":true}'::jsonb, '{"provider":"email"}'::jsonb);
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
  EXISTS (SELECT 1 FROM public.tab_events WHERE tab_id = 'd2000000-0000-0000-0000-000000000011' AND event_type = 'WAITER_AUTHORIZED_TO_CLOSE'),
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
