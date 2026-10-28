-- Garçom v2 — testes SQL (banco LOCAL descartável). Roda depois de 20261027004900.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set MGR 'a0000000-0000-0000-0000-000000000002'
\set W1 'bb000000-0000-0000-0000-000000000001'
\set W2 'bb000000-0000-0000-0000-000000000002'
\set W3 'bb000000-0000-0000-0000-000000000003'
\set WB 'bb000000-0000-0000-0000-0000000000b1'
RESET ROLE;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
DELETE FROM public.security_rate_limits;

INSERT INTO auth.users (id, email) VALUES
  (:'W1', 'joao.adega-a@garcom.deliverychannel.local'), (:'W2', 'maria.adega-a@garcom.deliverychannel.local'),
  (:'W3', 'pedro.adega-a@garcom.deliverychannel.local'), (:'WB', 'ze.adega-b@garcom.deliverychannel.local'),
  ('bb000000-0000-0000-0000-0000000000c1', 'cliente.mesa@test.local');
INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, config) VALUES
  (:'A', 'dine_in', true, '{"mode":"TABLE","salon_open":true}')
ON CONFLICT (tenant_id, module_key) DO UPDATE SET enabled = true, config = EXCLUDED.config;
INSERT INTO public.dining_tables (id, tenant_id, label, qr_token) VALUES
  ('d1000000-0000-0000-0000-000000000001', :'A', 'Mesa 1', 'gv2-token-000000001'), ('d1000000-0000-0000-0000-000000000002', :'A', 'Mesa 2', 'gv2-token-000000002'),
  ('d1000000-0000-0000-0000-000000000003', :'A', 'Mesa 3', 'gv2-token-000000003'), ('d1000000-0000-0000-0000-000000000004', :'A', 'Mesa 4', 'gv2-token-000000004'),
  ('d1000000-0000-0000-0000-000000000005', :'A', 'Mesa 5', 'gv2-token-000000005'), ('d1000000-0000-0000-0000-0000000000b1', :'B', 'Mesa B1', 'gv2-token-0000000b1');
INSERT INTO public.dining_tabs (id, tenant_id, mode, table_id)
SELECT ('d2000000-0000-0000-0000-00000000000' || n)::uuid, :'A', 'TABLE', ('d1000000-0000-0000-0000-00000000000' || n)::uuid FROM generate_series(1, 5) n;

CREATE OR REPLACE FUNCTION t.gv_call(n int) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid; BEGIN
  INSERT INTO public.waiter_calls (tenant_id, tab_id, type) VALUES ('10000000-0000-0000-0000-00000000000a', ('d2000000-0000-0000-0000-00000000000' || n)::uuid, 'CALL') RETURNING id INTO v;
  RETURN v; END $$;
CREATE OR REPLACE FUNCTION t.gv_seen(p_call uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM public.waiter_calls WHERE id = p_call $$;
CREATE OR REPLACE FUNCTION t.gv_row(p_call uuid) RETURNS public.waiter_calls LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT * FROM public.waiter_calls WHERE id = p_call $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- 1. Provisionamento: só service_role -------------------------------------------------------------
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($$SELECT public.waiter_provision('10000000-0000-0000-0000-00000000000a', 'bb000000-0000-0000-0000-000000000001', 'x', '11999990000', 'joao', 'a@b.c', NULL, NULL, NULL)$$,
  'permission denied', 'dono NÃO executa waiter_provision direto (só a Edge Function com service role)');
SET ROLE anon;
SELECT t.throws($$SELECT public.waiter_login_check('adega-a', 'joao', 'h')$$, 'permission denied', 'anon não executa waiter_login_check');
RESET ROLE;
SET ROLE service_role;
SELECT public.waiter_provision(:'A', :'W1', 'João Silva', '11999991111', 'joao', 'joao.adega-a@garcom.deliverychannel.local', 'joao@x.com', NULL, :'OWNER');
SELECT public.waiter_provision(:'A', :'W2', 'Maria Souza', '11999992222', 'maria', 'maria.adega-a@garcom.deliverychannel.local', NULL, NULL, :'OWNER');
SELECT public.waiter_provision(:'A', :'W3', 'Pedro Lima', '11999993333', 'pedro', 'pedro.adega-a@garcom.deliverychannel.local', NULL, NULL, :'OWNER');
SELECT public.waiter_provision(:'B', :'WB', 'Zé B', '11999994444', 'joao', 'ze.adega-b@garcom.deliverychannel.local', NULL, NULL, NULL);
SELECT t.ok((SELECT role_id = 'WAITER' AND status = 'ACTIVE' FROM public.tenant_users WHERE user_id = :'W1' AND tenant_id = :'A'), 'garçom vinculado como WAITER ativo');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND column_name ILIKE '%password%' AND table_name IN ('waiter_profiles', 'users', 'tenant_users')),
  'nenhuma tabela guarda senha');
SELECT t.is((public.waiter_username_state(:'A', 'JOAO') ->> 'state'), 'ACTIVE', 'usuário existente: estado ACTIVE (case-insensitive)');
SELECT t.is((public.waiter_username_state(:'B', 'maria') ->> 'state'), 'FREE', 'usuário único por loja: "maria" livre na loja B');
SELECT t.throws($$SELECT public.waiter_provision('10000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'Outro João', '11999990000', 'joao', 'x@garcom.local', NULL, NULL, NULL)$$,
  'WAITER_USERNAME_TAKEN|permission denied|foreign key', 'mesmo usuário na mesma loja é recusado');
RESET ROLE;

-- 2. RLS de waiter_profiles: telefone/e-mail de outros garçons ficam ocultos ---------------------
SET ROLE authenticated;
SELECT t.login(:'W1'::uuid);
SELECT t.is(t.visible('SELECT 1 FROM public.waiter_profiles'), 1::bigint, 'garçom lê só o PRÓPRIO perfil (sem telefone de colegas)');
SELECT t.is(t.visible($$SELECT 1 FROM public.waiter_profiles WHERE user_id <> 'bb000000-0000-0000-0000-000000000001'$$), 0::bigint, 'garçom não vê perfil de outro garçom');
SELECT t.throws($$SELECT * FROM public.list_team_directory('10000000-0000-0000-0000-00000000000a')$$, 'FORBIDDEN', 'garçom não lista a equipe com contatos');
SELECT t.login(:'OWNER'::uuid);
SELECT t.is(t.visible('SELECT 1 FROM public.waiter_profiles'), 3::bigint, 'dono vê os 3 garçons da própria loja (e não o da loja B)');
SELECT t.ok((SELECT name = 'João Silva' AND phone = '11999991111' FROM public.list_team_directory(:'A') WHERE user_id = :'W1'), 'diretório da equipe mostra nome e telefone (corrige "Colaborador / Sem e-mail")');
SELECT t.ok((SELECT email = 'joao@x.com' FROM public.list_team_directory(:'A') WHERE user_id = :'W1')
        AND (SELECT email = '' FROM public.list_team_directory(:'A') WHERE user_id = :'W2'), 'e-mail sintético nunca é exibido');
SELECT t.throws($$SELECT * FROM public.list_team_directory('10000000-0000-0000-0000-00000000000b')$$, 'FORBIDDEN', 'dono da loja A não lista equipe da loja B');

-- 3. Modo LIVRE: o primeiro que toca "Vou atender" assume; some para os outros ----------------------
RESET ROLE;
SELECT set_config('t.c1', t.gv_call(1)::text, false);
SET ROLE authenticated;
SELECT t.login(:'W1'::uuid); SELECT public.waiter_heartbeat(:'A');
SELECT t.login(:'W2'::uuid); SELECT public.waiter_heartbeat(:'A');
SELECT t.login(:'W3'::uuid); SELECT public.waiter_heartbeat(:'A');
SELECT t.is(t.gv_seen(current_setting('t.c1')::uuid), 1::bigint, 'LIVRE: W3 vê o chamado');
SELECT t.login(:'W1'::uuid);
SELECT t.is(t.gv_seen(current_setting('t.c1')::uuid), 1::bigint, 'LIVRE: W1 vê o chamado');
SELECT public.accept_waiter_call(current_setting('t.c1')::uuid);
SELECT t.login(:'W2'::uuid);
SELECT t.is(t.gv_seen(current_setting('t.c1')::uuid), 0::bigint, 'LIVRE: depois de "Vou atender" o chamado some para os outros');
SELECT t.throws(format('SELECT public.accept_waiter_call(%L)', current_setting('t.c1')), 'WAITER_CALL_TAKEN|já assumiu', 'LIVRE: segundo garçom não consegue assumir');
SELECT t.throws(format('SELECT public.handle_waiter_call(%L)', current_setting('t.c1')), 'WAITER_CALL_TAKEN|já assumiu|WAITER_CALL_NOT_FOUND', 'LIVRE: outro garçom não conclui chamado assumido');
SELECT t.login(:'W1'::uuid);
SELECT public.handle_waiter_call(current_setting('t.c1')::uuid);
RESET ROLE;
SELECT t.ok((SELECT status = 'HANDLED' AND handled_by = :'W1' AND accepted_by = :'W1' AND accepted_at IS NOT NULL FROM public.waiter_calls WHERE id = current_setting('t.c1')::uuid), 'quem atendeu fica registrado (accepted_by/handled_by)');

-- 4. Configuração do modo: só dono/gerente ------------------------------------------------------------
SET ROLE authenticated;
SELECT t.login(:'W1'::uuid);
SELECT t.throws($$SELECT public.set_waiter_service_settings('10000000-0000-0000-0000-00000000000a', 'FIXED', false, 60, 60)$$, 'FORBIDDEN', 'garçom não muda o modo');
SELECT t.throws($$SELECT public.assign_waiter_tables('10000000-0000-0000-0000-00000000000a', 'bb000000-0000-0000-0000-000000000001', ARRAY['d1000000-0000-0000-0000-000000000001']::uuid[])$$, 'FORBIDDEN', 'garçom não distribui mesas');
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($$SELECT public.set_waiter_service_settings('10000000-0000-0000-0000-00000000000a', 'XPTO', false, 60, 60)$$, 'INVALID_INPUT', 'modo inválido é recusado');
SELECT t.throws($$SELECT public.set_waiter_service_settings('10000000-0000-0000-0000-00000000000a', 'FIXED', false, 5, 60)$$, 'INVALID_INPUT', 'tempo fora de 10–600 s é recusado');
SELECT t.throws($$SELECT public.set_waiter_service_settings('10000000-0000-0000-0000-00000000000b', 'FIXED', false, 60, 60)$$, 'FORBIDDEN', 'dono da A não configura a loja B');

-- 5. Modo MESAS FIXAS -------------------------------------------------------------------------------------
SELECT public.set_waiter_service_settings(:'A', 'FIXED', true, 60, 60);
SELECT t.is(public.assign_waiter_tables(:'A', :'W1', ARRAY['d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002']::uuid[]), 2, 'João recebe as mesas 1 e 2');
SELECT public.assign_waiter_tables(:'A', :'W2', ARRAY['d1000000-0000-0000-0000-000000000003']::uuid[]);
SELECT public.assign_waiter_tables(:'A', :'W3', ARRAY['d1000000-0000-0000-0000-000000000004']::uuid[]);
SELECT t.throws($$SELECT public.assign_waiter_tables('10000000-0000-0000-0000-00000000000a', 'bb000000-0000-0000-0000-000000000001', ARRAY['d1000000-0000-0000-0000-0000000000b1']::uuid[])$$, 'INVALID_INPUT', 'mesa de outra loja é recusada');
SELECT t.throws($$SELECT public.assign_waiter_tables('10000000-0000-0000-0000-00000000000a', 'bb000000-0000-0000-0000-0000000000b1', ARRAY['d1000000-0000-0000-0000-000000000001']::uuid[])$$, 'WAITER_NOT_FOUND', 'garçom de outra loja é recusado');
RESET ROLE;
SELECT set_config('t.c2', t.gv_call(1)::text, false);   -- mesa do João (online)
SELECT set_config('t.c3', t.gv_call(5)::text, false);   -- mesa sem responsável
-- W3 fica offline: expira a presença
UPDATE public.waiter_presence SET last_seen_at = now() - interval '10 minutes' WHERE user_id = :'W3';
SELECT set_config('t.c4', t.gv_call(4)::text, false);   -- mesa do Pedro (offline)
SELECT t.ok((SELECT route = 'ASSIGNED' AND assigned_to = :'W1' AND escalated_at IS NULL FROM public.waiter_calls WHERE id = current_setting('t.c2')::uuid), 'FIXO: chamado da mesa 1 vai ao João');
SELECT t.ok((SELECT route = 'ALL' FROM public.waiter_calls WHERE id = current_setting('t.c3')::uuid), 'FIXO: mesa sem responsável vai para todos');
SELECT t.ok((SELECT escalated_at IS NOT NULL FROM public.waiter_calls WHERE id = current_setting('t.c4')::uuid), 'FIXO: responsável offline => escalonado na hora');
SET ROLE authenticated;
SELECT t.login(:'W1'::uuid);
SELECT t.is(t.gv_seen(current_setting('t.c2')::uuid), 1::bigint, 'FIXO: responsável vê o chamado');
SELECT t.login(:'W2'::uuid);
SELECT t.is(t.gv_seen(current_setting('t.c2')::uuid), 0::bigint, 'FIXO: outro garçom NÃO vê o chamado da mesa do João');
SELECT t.throws(format('SELECT public.accept_waiter_call(%L)', current_setting('t.c2')), 'FORBIDDEN|não é da sua mesa', 'FIXO: outro garçom não consegue assumir');
SELECT t.is(t.gv_seen(current_setting('t.c3')::uuid), 1::bigint, 'FIXO: chamado sem responsável aparece para todos');
SELECT t.is(t.gv_seen(current_setting('t.c4')::uuid), 1::bigint, 'FIXO: chamado de responsável offline aparece para todos');
RESET ROLE;
UPDATE public.waiter_calls SET created_at = now() - interval '61 seconds' WHERE id = current_setting('t.c2')::uuid;
SET ROLE authenticated;
SELECT t.login(:'W2'::uuid);
SELECT t.is(t.gv_seen(current_setting('t.c2')::uuid), 1::bigint, 'FIXO: passou X segundos sem aceite => escalona para todos (ninguém fica sem atendimento)');
SELECT t.ok(public.escalate_due_waiter_calls(:'A') >= 1, 'escalonamento é gravado (escalate_due_waiter_calls)');
SELECT t.ok((SELECT escalated_at IS NOT NULL FROM public.waiter_calls WHERE id = current_setting('t.c2')::uuid), 'escalated_at preenchido');
SELECT t.login(:'W2'::uuid);
SELECT public.waiter_help_table(:'A', 'd1000000-0000-0000-0000-000000000001');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.waiter_table_helpers WHERE waiter_id = :'W2' AND table_id = 'd1000000-0000-0000-0000-000000000001'), 1::bigint, 'HÍBRIDO: "Ajudar" fica registrado');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_waiter_service_settings(:'A', 'FIXED', false, 60, 60);
SELECT t.login(:'W2'::uuid);
SELECT t.throws($$SELECT public.waiter_help_table('10000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001')$$, 'HYBRID_DISABLED', 'sem modo híbrido, "Ajudar" é recusado');

-- 6. Troca de turno ---------------------------------------------------------------------------------------
SELECT t.login(:'W1'::uuid);
SELECT t.throws($$SELECT public.pass_waiter_tables('10000000-0000-0000-0000-00000000000a', 'bb000000-0000-0000-0000-000000000002', 'bb000000-0000-0000-0000-000000000001', NULL)$$, 'FORBIDDEN', 'garçom não passa as mesas de outro');
SELECT t.is(public.pass_waiter_tables(:'A', :'W1', :'W2', ARRAY['d1000000-0000-0000-0000-000000000002']::uuid[]), 1, 'garçom passa uma das suas mesas');
SELECT t.is(public.pass_waiter_tables(:'A', :'W1', :'W2', NULL), 1, 'garçom passa todas as que restaram');
SELECT t.login(:'OWNER'::uuid);
SELECT t.is(public.pass_waiter_tables(:'A', :'W2', :'W1', NULL), 3, 'dono passa as mesas do turno entre garçons');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.waiter_table_assignments WHERE waiter_id = :'W1'), 3::bigint, 'João ficou com 3 mesas');

-- 7. Desativar garçom solta as mesas ---------------------------------------------------------------------
SET ROLE service_role;
SELECT public.waiter_set_active(:'A', :'W1', false);
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.waiter_table_assignments WHERE waiter_id = :'W1'), 0::bigint, 'desativar garçom libera as mesas dele');
SELECT t.ok((SELECT status = 'SUSPENDED' FROM public.tenant_users WHERE user_id = :'W1' AND tenant_id = :'A'), 'vínculo suspenso ao desativar');
SELECT t.is((public.waiter_username_state(:'A', 'joao') ->> 'state'), 'INACTIVE', 'estado INACTIVE => UI oferece "Reativar"');
SET ROLE service_role;
SELECT public.waiter_set_active(:'A', :'W1', true);
RESET ROLE;
SELECT t.ok((SELECT status = 'ACTIVE' FROM public.tenant_users WHERE user_id = :'W1' AND tenant_id = :'A'), 'reativar devolve o acesso');

-- 8. Modo CENTRAL ---------------------------------------------------------------------------------------
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_waiter_service_settings(:'A', 'CENTRAL', false, 60, 45);
SELECT t.login(:'W1'::uuid); SELECT public.waiter_heartbeat(:'A');
SELECT t.login(:'W2'::uuid); SELECT public.waiter_heartbeat(:'A');
RESET ROLE;
SELECT set_config('t.c5', t.gv_call(2)::text, false);
SET ROLE authenticated;
SELECT t.login(:'W1'::uuid);
SELECT t.is(t.gv_seen(current_setting('t.c5')::uuid), 0::bigint, 'CENTRAL: chamado NÃO vai direto ao garçom');
SELECT t.throws(format('SELECT public.accept_waiter_call(%L)', current_setting('t.c5')), 'FORBIDDEN|não é da sua mesa', 'CENTRAL: garçom não assume sem despacho');
SELECT t.throws(format('SELECT public.dispatch_waiter_call(%L, %L)', current_setting('t.c5'), :'W2'), 'FORBIDDEN', 'CENTRAL: garçom não despacha');
SELECT t.login(:'MGR'::uuid);
SELECT t.is(t.gv_seen(current_setting('t.c5')::uuid), 1::bigint, 'CENTRAL: gerente vê o chamado no painel');
SELECT t.ok((SELECT count(*) = 3 AND bool_or(online) FROM public.waiter_roster(:'A')), 'CENTRAL: lista de garçons com status online');
SELECT t.ok((SELECT online AND NOT busy FROM public.waiter_roster(:'A') WHERE user_id = :'W2'), 'roster: W2 online e livre');
SELECT public.dispatch_waiter_call(current_setting('t.c5')::uuid, :'W2');
SELECT t.login(:'W1'::uuid);
SELECT t.is(t.gv_seen(current_setting('t.c5')::uuid), 0::bigint, 'CENTRAL: só o garçom escolhido recebe (W1 não vê)');
SELECT t.login(:'W2'::uuid);
SELECT t.is(t.gv_seen(current_setting('t.c5')::uuid), 1::bigint, 'CENTRAL: o escolhido recebe');
SELECT public.accept_waiter_call(current_setting('t.c5')::uuid);
SELECT t.login(:'MGR'::uuid);
SELECT t.ok((SELECT busy AND open_calls = 1 FROM public.waiter_roster(:'A') WHERE user_id = :'W2'), 'roster: W2 ocupado após assumir');
RESET ROLE;
SELECT set_config('t.c6', t.gv_call(3)::text, false);
SET ROLE authenticated;
SELECT t.login(:'W1'::uuid);
SELECT t.is(t.gv_seen(current_setting('t.c6')::uuid), 0::bigint, 'CENTRAL: novo chamado oculto');
SELECT t.login(:'MGR'::uuid);
SELECT public.escalate_waiter_call(current_setting('t.c6')::uuid);
SELECT t.login(:'W1'::uuid);
SELECT t.is(t.gv_seen(current_setting('t.c6')::uuid), 1::bigint, 'CENTRAL: escalonar libera para todos');
SELECT t.throws(format('SELECT public.escalate_waiter_call(%L)', current_setting('t.c6')), 'FORBIDDEN', 'garçom não escalona pela central');
RESET ROLE;

-- 9. Rastreio: pedidos, comandas e relatório -------------------------------------------------------------
UPDATE public.tenant_modules SET config = config WHERE tenant_id = :'A';
SELECT t.login(:'W2'::uuid);
INSERT INTO public.tab_sessions (id, tenant_id, tab_id, auth_user_id, display_name, device_id, approved_at)
VALUES ('d3000000-0000-0000-0000-000000000001', :'A', 'd2000000-0000-0000-0000-000000000003', 'bb000000-0000-0000-0000-0000000000c1', 'Cliente', 'dev-x', now());
INSERT INTO public.orders (tenant_id, customer_name, customer_phone, delivery_address, subtotal, delivery_fee, discount, total_amount,
                           payment_method, payment_status, fulfillment_type, status, origin, tab_id, round_no, ordered_by_session_id)
VALUES (:'A', 'Mesa 3', '11999990000', 'Mesa', 100, 0, 0, 100, 'CASH', 'PENDING', 'DINE_IN', 'CONFIRMED', 'qr_code', 'd2000000-0000-0000-0000-000000000003', 1, 'd3000000-0000-0000-0000-000000000001');
SELECT t.login(NULL);
INSERT INTO public.orders (tenant_id, customer_name, customer_phone, delivery_address, subtotal, delivery_fee, discount, total_amount,
                           payment_method, payment_status, fulfillment_type, status, origin, tab_id, round_no, ordered_by_session_id)
VALUES (:'A', 'Mesa 3', '11999990000', 'Mesa', 50, 0, 0, 50, 'CASH', 'PENDING', 'DINE_IN', 'CONFIRMED', 'qr_code', 'd2000000-0000-0000-0000-000000000003', 2, 'd3000000-0000-0000-0000-000000000001');
SELECT t.is((SELECT count(*) FROM public.orders WHERE waiter_id = :'W2'), 1::bigint, 'pedido lançado pelo garçom guarda waiter_id; pedido do cliente não');
SELECT t.is((SELECT count(*) FROM public.orders WHERE tab_id = 'd2000000-0000-0000-0000-000000000003' AND waiter_id IS NULL), 1::bigint, 'pedido do cliente (QR) não recebe waiter_id');
UPDATE public.dining_tabs SET service_fee_percent = 10 WHERE id = 'd2000000-0000-0000-0000-000000000003';
SELECT t.login(:'W2'::uuid);
UPDATE public.dining_tabs SET status = 'CLOSED', closed_at = now() WHERE id = 'd2000000-0000-0000-0000-000000000003';
SELECT t.ok((SELECT closed_by = :'W2' FROM public.dining_tabs WHERE id = 'd2000000-0000-0000-0000-000000000003'), 'closed_by registra quem fechou');
UPDATE public.waiter_calls SET created_at = now() - interval '30 seconds', accepted_at = now() WHERE id = current_setting('t.c5')::uuid;
SET ROLE authenticated;
SELECT t.login(:'W2'::uuid);
SELECT t.is((SELECT count(*) FROM public.waiter_performance_report(:'A', now() - interval '1 day', now() + interval '1 day')), 1::bigint, 'relatório: garçom vê só a si mesmo');
SELECT t.ok((SELECT orders_count = 1 AND total_sold = 100 AND tabs_attended >= 1 FROM public.waiter_performance_report(:'A', now() - interval '1 day', now() + interval '1 day')), 'relatório: pedidos e total vendido');
SELECT t.ok((SELECT service_fee_total = 15 FROM public.waiter_performance_report(:'A', now() - interval '1 day', now() + interval '1 day')), 'relatório: gorjeta/10% sobre o subtotal da comanda fechada');
SELECT t.ok((SELECT avg_response_seconds BETWEEN 25 AND 35 AND calls_handled = 1 FROM public.waiter_performance_report(:'A', now() - interval '1 day', now() + interval '1 day')), 'relatório: tempo médio de resposta calculado');
SELECT t.login(:'OWNER'::uuid);
SELECT t.is((SELECT count(*) FROM public.waiter_performance_report(:'A', now() - interval '1 day', now() + interval '1 day')), 3::bigint, 'relatório: dono vê todos os garçons');
SELECT t.throws($$SELECT * FROM public.waiter_performance_report('10000000-0000-0000-0000-00000000000b', now() - interval '1 day', now())$$, 'FORBIDDEN', 'relatório de outra loja é recusado');

-- 10. "Seu garçom" (LGPD: só nome e foto) ----------------------------------------------------------------------
RESET ROLE;
UPDATE public.waiter_profiles SET photo_url = 'https://cdn.test/foto.jpg' WHERE user_id = :'W1';
INSERT INTO public.dining_tabs (id, tenant_id, mode, table_id, waiter_id) VALUES
  ('d2000000-0000-0000-0000-0000000000f1', :'A', 'TABLE', 'd1000000-0000-0000-0000-000000000005', :'W1');
INSERT INTO public.tab_sessions (id, tenant_id, tab_id, auth_user_id, display_name, device_id, approved_at)
VALUES ('d3000000-0000-0000-0000-0000000000f1', :'A', 'd2000000-0000-0000-0000-0000000000f1', 'bb000000-0000-0000-0000-0000000000c1', 'Cliente', 'dev-y', now());
SET ROLE authenticated;
SELECT t.login('bb000000-0000-0000-0000-0000000000c1'::uuid);
SELECT t.ok((SELECT public.get_my_table_waiter('d3000000-0000-0000-0000-0000000000f1') ?& ARRAY['name', 'photo_url']
         AND (SELECT count(*) FROM jsonb_object_keys(public.get_my_table_waiter('d3000000-0000-0000-0000-0000000000f1'))) = 2), 'cliente recebe só nome e foto');
SELECT t.is((public.get_my_table_waiter('d3000000-0000-0000-0000-0000000000f1') ->> 'name'), 'João Silva', 'nome do garçom da mesa');
SELECT t.login(:'W3'::uuid);
SELECT t.ok(public.get_my_table_waiter('d3000000-0000-0000-0000-0000000000f1') IS NULL, 'sessão de outra pessoa não revela garçom');

-- 11. Rate limit do login: 5/min por usuário+IP ----------------------------------------------------------------
RESET ROLE;
SET ROLE service_role;
SELECT t.is((public.waiter_login_check('adega-a', 'maria', 'iphash') ->> 'allowed')::boolean, true, 'login_check: usuário ativo permitido');
SELECT public.waiter_login_check('adega-a', 'maria', 'iphash');
SELECT public.waiter_login_check('adega-a', 'maria', 'iphash');
SELECT public.waiter_login_check('adega-a', 'maria', 'iphash');
SELECT public.waiter_login_check('adega-a', 'maria', 'iphash');
SELECT t.is((public.waiter_login_check('adega-a', 'maria', 'iphash') ->> 'reason'), 'RATE_LIMITED', 'login_check: 6ª tentativa em 1 min é bloqueada');
SELECT t.is((public.waiter_login_check('adega-a', 'naoexiste', 'ip2') ->> 'allowed')::boolean, false, 'login_check: usuário inexistente não passa');
RESET ROLE;

-- 12. Capacidades e loja pública --------------------------------------------------------------------------------
SET ROLE anon;
SELECT t.is((public.get_waiter_login_store('adega-a') ->> 'name'), 'Adega A', 'tela de login pública mostra só o nome da loja');
SELECT t.ok(public.get_waiter_login_store('nao-existe') IS NULL, 'loja inexistente => nulo');
SELECT t.is((public.waiter_v2_capabilities() ->> 'version')::int, 1, 'capacidades v2 acessíveis');
RESET ROLE;
