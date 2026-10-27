-- Mesas e QR Code: RLS, token abuse, pause, rate limits, PIX per tab, name rule, LGPD. Local disposable DB only.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
RESET ROLE;
-- Supabase gives service_role table grants by default (it bypasses RLS); the strict local stubs do not.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
DELETE FROM public.security_rate_limits;

-- Fixtures: extra users (customers, waiter), a B product, tables, modules.
INSERT INTO auth.users (id, email) SELECT ('e0000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'anon' || g || '@test.local'
FROM generate_series(1, 90) g;
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000009', 'waiter.a@test.local'),
  ('a0000000-0000-0000-0000-00000000000a', 'waiter2.a@test.local');
INSERT INTO public.users (id, email, name) SELECT id, email, 'x' FROM auth.users WHERE id::text LIKE 'e0000000%' OR id::text IN ('a0000000-0000-0000-0000-000000000009','a0000000-0000-0000-0000-00000000000a')
ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  IF to_regclass('public.legal_acceptances') IS NOT NULL THEN
    INSERT INTO public.legal_acceptances(user_id, audience, version)
    SELECT u.id, a.audience, public._legal_version() FROM auth.users u CROSS JOIN (VALUES ('owner'),('customer')) a(audience)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
INSERT INTO public.tenant_users (user_id, tenant_id, role_id, status) VALUES
  ('a0000000-0000-0000-0000-000000000009', :'A', 'WAITER', 'ACTIVE'),
  ('a0000000-0000-0000-0000-00000000000a', :'A', 'WAITER', 'ACTIVE');
INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, config) VALUES
  (:'A', 'dine_in', true, '{"mode":"TABLE","salon_open":true,"release_required":false,"close_roles":["OWNER","MANAGER","CASHIER"]}'),
  (:'B', 'dine_in', true, '{"mode":"TABLE","salon_open":true,"release_required":false}')
ON CONFLICT (tenant_id, module_key) DO UPDATE SET enabled = true, config = EXCLUDED.config;
INSERT INTO public.dining_tables (tenant_id, label, qr_token) VALUES
  (:'A', 'Mesa 01', 'mesas-a1-token-0001'), (:'A', 'Mesa 02', 'mesas-a2-token-0002'), (:'A', 'Mesa 03', 'mesas-a3-token-0003'),
  (:'A', 'Mesa 04', 'mesas-a4-token-0004'), (:'B', 'Mesa B1', 'mesas-b1-token-0001');
SELECT set_config('t.tblB1', (SELECT id::text FROM public.dining_tables WHERE qr_token = 'mesas-b1-token-0001'), false);

-- ===== 0. Tokens: opaque, non-sequential (default generator) =====
INSERT INTO public.dining_tables (tenant_id, label) SELECT :'A', 'Gerada ' || g FROM generate_series(1, 20) g;
SELECT t.ok((SELECT bool_and(qr_token ~ '^[0-9a-f]{48}$') FROM public.dining_tables WHERE label LIKE 'Gerada %'), 'token padrão tem 192 bits em hex (opaco)');
SELECT t.is((SELECT count(DISTINCT qr_token) FROM public.dining_tables WHERE label LIKE 'Gerada %'), 20::bigint, 'tokens gerados não se repetem');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.dining_tables d WHERE d.label LIKE 'Gerada %' AND d.qr_token ~ '^[0-9]+$'), 'token não é sequencial/numérico');
DELETE FROM public.dining_tables WHERE label LIKE 'Gerada %';

-- ===== 1. Grants / RLS =====
SELECT t.ok(has_function_privilege('authenticated', 'public.mesas_qr_capabilities()', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.mesas_qr_capabilities()', 'EXECUTE'), 'capabilities: só autenticado');
SELECT t.ok(NOT has_function_privilege('anon', 'public.reserve_tab_pix(uuid,uuid)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.reserve_tab_pix(uuid,uuid)', 'EXECUTE')
        AND has_function_privilege('service_role', 'public.reserve_tab_pix(uuid,uuid)', 'EXECUTE'), 'reserve_tab_pix: só service_role');
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.confirm_tab_pix(uuid,jsonb)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.confirm_tab_pix(uuid,jsonb)', 'EXECUTE'), 'confirm_tab_pix: navegador nunca confirma pagamento');
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.save_tab_pix_charge(uuid,jsonb)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.cancel_tab_pix(uuid,uuid)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.get_tab_pix_charge(uuid,uuid)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.anonymize_old_tab_sessions(integer)', 'EXECUTE'), 'demais RPCs de PIX/LGPD: só service_role');
SELECT t.ok(NOT has_function_privilege('anon', 'public.set_dining_qr_pause(uuid,uuid,boolean)', 'EXECUTE')
        AND has_function_privilege('anon', 'public.get_table_qr_status(text)', 'EXECUTE'), 'pausa: só autenticado; status do QR: público');
SELECT t.ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.tab_pix_charges'::regclass, 'public.dining_qr_pauses'::regclass)), 'RLS ativa nas tabelas novas');
SELECT t.ok(NOT has_table_privilege('authenticated', 'public.tab_pix_charges', 'INSERT')
        AND NOT has_table_privilege('authenticated', 'public.tab_pix_charges', 'UPDATE')
        AND NOT has_table_privilege('authenticated', 'public.tab_pix_charges', 'DELETE')
        AND NOT has_table_privilege('anon', 'public.tab_pix_charges', 'SELECT')
        AND NOT has_table_privilege('authenticated', 'public.dining_qr_pauses', 'INSERT')
        AND NOT has_table_privilege('anon', 'public.dining_qr_pauses', 'SELECT'), 'tabelas novas: sem escrita direta e sem leitura anônima');

-- ===== 2. Joining by QR, cross-store isolation =====
SET ROLE authenticated;
SELECT t.login('e0000000-0000-0000-0000-000000000001');
SELECT set_config('t.s1', public.open_or_join_tab('mesas-a1-token-0001', 'Cliente', 'dev-1') ->> 'sessionId', false);
SELECT t.ok(current_setting('t.s1') ~ '^[0-9a-f-]{36}$', 'cliente entra na mesa pelo token (nome opcional)') ;
RESET ROLE;
SELECT set_config('t.tab1', (SELECT tab_id::text FROM public.tab_sessions WHERE id = current_setting('t.s1')::uuid), false);
SELECT t.is((SELECT tb.tenant_id FROM public.dining_tabs tb WHERE tb.id = current_setting('t.tab1')::uuid), :'A'::uuid, 'comanda pertence à loja do token');
SET ROLE authenticated;
SELECT t.login('e0000000-0000-0000-0000-000000000001');
SELECT t.throws($$SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000b1","quantity":1}]', gen_random_uuid(), current_setting('t.s1')::uuid)$$,
  '.', 'token/sessão da loja A não pede produto da loja B');
SELECT t.lives($$SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":3}]', gen_random_uuid(), current_setting('t.s1')::uuid)$$, 'sessão pede item da própria loja na comanda aberta');
SELECT t.is(t.visible($$SELECT id FROM public.dining_tables$$), 0::bigint, 'cliente não lê mesas nem tokens');
SELECT t.is(t.visible($$SELECT id FROM public.tab_pix_charges$$), 0::bigint, 'cliente não lê cobranças PIX');
SELECT t.is(t.visible($$SELECT id FROM public.dining_qr_pauses$$), 0::bigint, 'cliente não lê pausas');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.orders WHERE tenant_id = :'B'), 0::bigint, 'nenhum pedido vazou para a loja B');
SET ROLE anon;
SELECT t.is(public.get_table_qr_status('mesas-a1-token-0001') ->> 'found', 'true', 'status do QR: token válido');
SELECT t.is(public.get_table_qr_status('token-inexistente-xyz') ->> 'found', 'false', 'status do QR: token inválido não revela nada');
SELECT t.is(public.get_table_qr_status('x') ->> 'found', 'false', 'status do QR: token curto rejeitado');
SELECT t.ok(NOT (public.get_table_qr_status('mesas-a1-token-0001') ? 'tenantId'), 'status do QR não expõe tenant');
SELECT t.throws($$SELECT public.open_or_join_tab('token-inexistente-xyz', 'Fulano', 'dev-x')$$, '.', 'token inexistente não abre comanda');
RESET ROLE;

-- ===== 3. Staff RLS by tenant =====
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.ok(t.visible($$SELECT id FROM public.dining_tables$$) >= 4, 'dono A enxerga as mesas da loja A');
SELECT t.is(t.visible($$SELECT id FROM public.dining_tables WHERE tenant_id = '10000000-0000-0000-0000-00000000000b'$$), 0::bigint, 'dono A não enxerga mesas da loja B');
SELECT t.login('b0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible($$SELECT id FROM public.dining_tables WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'$$), 0::bigint, 'dono B não enxerga mesas da loja A');
SELECT t.is(t.visible($$SELECT id FROM public.dining_tabs WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'$$), 0::bigint, 'dono B não enxerga comandas da loja A');
SELECT t.throws($$SELECT public.set_dining_qr_pause('10000000-0000-0000-0000-00000000000a', NULL, true)$$, 'FORBIDDEN', 'dono B não pausa o QR da loja A');
SELECT t.throws($$SELECT public.regenerate_dining_table_qr((SELECT id FROM public.dining_tables WHERE qr_token = 'mesas-a3-token-0003'))$$, 'FORBIDDEN', 'dono B não rotaciona token da loja A');
SELECT t.is(t.visible($$SELECT id FROM public.dining_tables WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'$$), 0::bigint, 'dono B continua sem ver mesas de A');
RESET ROLE;

-- ===== 4. Pause =====
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.throws($$SELECT public.set_dining_qr_pause('10000000-0000-0000-0000-00000000000a', NULL, true)$$, 'FORBIDDEN', 'caixa não pausa o QR');
SELECT t.login('a0000000-0000-0000-0000-000000000002');
SELECT t.lives($$SELECT public.set_dining_qr_pause('10000000-0000-0000-0000-00000000000a', (SELECT id FROM public.dining_tables WHERE qr_token = 'mesas-a2-token-0002'), true)$$, 'gerente pausa uma mesa');
SELECT t.throws(format($$SELECT public.set_dining_qr_pause('10000000-0000-0000-0000-00000000000a', %L, true)$$, current_setting('t.tblB1')), 'TABLE_NOT_FOUND|FORBIDDEN', 'não pausa mesa de outra loja');
SELECT t.is(t.visible($$SELECT id FROM public.dining_qr_pauses$$), 1::bigint, 'gerente enxerga a pausa da própria loja');
SELECT t.login('e0000000-0000-0000-0000-000000000002');
SELECT t.throws($$SELECT public.open_or_join_tab('mesas-a2-token-0002', 'Ana', 'dev-2')$$, 'QR_PAUSED', 'mesa pausada recusa novos clientes');
SELECT t.lives($$SELECT public.open_or_join_tab('mesas-a3-token-0003', 'Ana', 'dev-2')$$, 'pausar uma mesa não afeta outra');
RESET ROLE;
SELECT t.is((SELECT public.get_table_qr_status('mesas-a2-token-0002') ->> 'paused'), 'true', 'status do QR informa a pausa');
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000002');
SELECT t.lives($$SELECT public.set_dining_qr_pause('10000000-0000-0000-0000-00000000000a', NULL, true)$$, 'gerente pausa a loja inteira');
SELECT t.login('e0000000-0000-0000-0000-000000000001');
SELECT t.throws($$SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]', gen_random_uuid(), current_setting('t.s1')::uuid)$$,
  'QR_PAUSED', 'loja pausada: sessão existente não envia novas rodadas');
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.lives($$SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]', gen_random_uuid(), NULL, current_setting('t.tab1')::uuid)$$,
  'loja pausada: equipe ainda lança pedidos na comanda');
SELECT t.login('a0000000-0000-0000-0000-000000000002');
SELECT t.lives($$SELECT public.set_dining_qr_pause('10000000-0000-0000-0000-00000000000a', NULL, false)$$, 'gerente retoma a loja');
SELECT t.lives($$SELECT public.set_dining_qr_pause('10000000-0000-0000-0000-00000000000a', (SELECT id FROM public.dining_tables WHERE qr_token = 'mesas-a2-token-0002'), false)$$, 'gerente retoma a mesa');
SELECT t.login('e0000000-0000-0000-0000-000000000001');
SELECT t.lives($$SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]', gen_random_uuid(), current_setting('t.s1')::uuid)$$, 'após retomar, a sessão volta a pedir');
RESET ROLE;

-- ===== 5. Rate limits =====
DELETE FROM public.security_rate_limits;
DO $rl$
DECLARE i int; n int := 0; v_blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'e0000000-0000-0000-0000-000000000010', 'role', 'authenticated')::text, false);
  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000010', false);
  SET LOCAL ROLE authenticated;
  FOR i IN 1..20 LOOP
    n := n + 1;
    BEGIN
      PERFORM public.open_or_join_tab('mesas-a4-token-0004', 'Cliente', 'rl-dev-' || i);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'RATE_LIMITED%' THEN v_blocked := true; EXIT; END IF;
      RAISE;
    END;
  END LOOP;
  RESET ROLE;
  PERFORM t.ok(v_blocked AND n = 16, format('mesma conta não entra mais de 15 vezes em 10 min (bloqueou na tentativa %s)', n));
END $rl$;
DELETE FROM public.security_rate_limits;
DO $rl2$
DECLARE i int; n int := 0; v_blocked boolean := false;
BEGIN
  SET LOCAL ROLE authenticated;
  FOR i IN 20..90 LOOP
    n := n + 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', 'e0000000-0000-0000-0000-' || lpad(i::text, 12, '0'), 'role', 'authenticated')::text, false);
    PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-' || lpad(i::text, 12, '0'), false);
    BEGIN
      PERFORM public.open_or_join_tab('mesas-a4-token-0004', 'Cliente', 'dev-' || i);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'RATE_LIMITED%' THEN v_blocked := true; EXIT; END IF;
      RAISE;
    END;
  END LOOP;
  RESET ROLE;
  PERFORM t.ok(v_blocked, format('enxurrada de contas descartáveis na mesma mesa é barrada (tentativa %s)', n));
END $rl2$;
DELETE FROM public.security_rate_limits;
DO $rl3$
DECLARE i int; n int := 0; v_blocked boolean := false; v_session uuid;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'e0000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, false);
  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', false);
  v_session := current_setting('t.s1')::uuid;
  FOR i IN 1..20 LOOP
    n := n + 1;
    BEGIN
      PERFORM public.call_waiter(v_session, 'CALL');
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'RATE_LIMITED%' THEN v_blocked := true; EXIT; END IF;
      RAISE;
    END;
  END LOOP;
  RESET ROLE;
  PERFORM t.ok(v_blocked, format('chamados de garçom em enxurrada são barrados (tentativa %s)', n));
END $rl3$;
DELETE FROM public.security_rate_limits;

-- ===== 6. Table name rule (3–15) and token rotation =====
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.throws($$UPDATE public.dining_tables SET label = 'ab' WHERE qr_token = 'mesas-a3-token-0003'$$, 'INVALID_TABLE_NAME', 'nome com 2 caracteres é recusado');
SELECT t.throws($$UPDATE public.dining_tables SET label = 'Nome bem grande demais' WHERE qr_token = 'mesas-a3-token-0003'$$, 'INVALID_TABLE_NAME', 'nome com mais de 15 caracteres é recusado');
SELECT t.throws($$UPDATE public.dining_tables SET label = '   a  ' WHERE qr_token = 'mesas-a3-token-0003'$$, 'INVALID_TABLE_NAME', 'espaços não contam para o tamanho');
SELECT t.lives($$UPDATE public.dining_tables SET label = 'Varanda 1' WHERE qr_token = 'mesas-a3-token-0003'$$, 'nome de 3 a 15 caracteres é aceito');
SELECT t.lives($$UPDATE public.dining_tables SET seats = 6 WHERE qr_token = 'mesas-a3-token-0003'$$, 'outras edições não revalidam o nome');
SELECT t.lives($$UPDATE public.dining_tables SET seats = 4 WHERE qr_token = 'mesas-a1-token-0001'$$, 'mesa existente continua editável');
RESET ROLE;
UPDATE public.tenant_modules SET config = config || '{"release_required":true}' WHERE tenant_id = :'A' AND module_key = 'dine_in';
SET ROLE authenticated;
SELECT t.login('e0000000-0000-0000-0000-000000000003');
SELECT set_config('t.s3', public.open_or_join_tab('mesas-a3-token-0003', 'Beto', 'dev-3') ->> 'sessionId', false);
SELECT t.login('a0000000-0000-0000-0000-000000000009');
SELECT t.throws($$SELECT public.regenerate_dining_table_qr((SELECT id FROM public.dining_tables WHERE label = 'Varanda 1'))$$, 'FORBIDDEN', 'garçom não rotaciona token');
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT set_config('t.newtoken', public.regenerate_dining_table_qr((SELECT id FROM public.dining_tables WHERE label = 'Varanda 1')), false);
SELECT t.ok(current_setting('t.newtoken') ~ '^[0-9a-f]{48}$' AND current_setting('t.newtoken') <> 'mesas-a3-token-0003', 'dono rotaciona o token (novo valor opaco)');
RESET ROLE;
SELECT t.is(public.resolve_table_qr('mesas-a3-token-0003') ->> 'available', 'false', 'token antigo deixa de funcionar');
SELECT t.is(public.resolve_table_qr(current_setting('t.newtoken')) ->> 'available', 'true', 'token novo funciona');
SELECT t.ok((SELECT expires_at <= now() FROM public.tab_sessions WHERE id = current_setting('t.s3')::uuid), 'rotação expira sessões nunca aprovadas');
UPDATE public.tenant_modules SET config = config || '{"release_required":false}' WHERE tenant_id = :'A' AND module_key = 'dine_in';

-- ===== 7. PIX per tab (service role = Express server) =====
DELETE FROM public.security_rate_limits;
SELECT set_config('t.tab1', (SELECT tab_id::text FROM public.tab_sessions WHERE id = current_setting('t.s1')::uuid), false);
SET ROLE service_role;
SELECT t.throws(format($$SELECT public.reserve_tab_pix(%L, 'e0000000-0000-0000-0000-000000000001')$$, current_setting('t.tab1')), 'Acesso negado', 'cliente da mesa não gera o PIX da conta');
SELECT t.throws(format($$SELECT public.reserve_tab_pix(%L, 'b0000000-0000-0000-0000-000000000001')$$, current_setting('t.tab1')), 'Acesso negado', 'dono de outra loja não gera PIX da comanda');
SELECT t.throws(format($$SELECT public.reserve_tab_pix(%L, 'a0000000-0000-0000-0000-000000000009')$$, current_setting('t.tab1')), 'Acesso negado', 'garçom sem permissão de fechar não gera PIX');
SELECT t.throws($$SELECT public.reserve_tab_pix(gen_random_uuid(), 'a0000000-0000-0000-0000-000000000004')$$, 'Acesso negado', 'comanda inexistente');
SELECT set_config('t.r1', public.reserve_tab_pix(current_setting('t.tab1')::uuid, 'a0000000-0000-0000-0000-000000000004')::text, false);
SELECT t.is((current_setting('t.r1')::jsonb -> 'charge' ->> 'amount_cents')::int, 5000, 'valor do PIX vem do servidor (3×10 + 1×10 + 1×10 = 50,00)');
SELECT t.is((current_setting('t.r1')::jsonb ->> 'claimed')::boolean, true, 'primeira reserva é reivindicada');
SELECT set_config('t.c1', current_setting('t.r1')::jsonb -> 'charge' ->> 'id', false);
SELECT t.is((public.reserve_tab_pix(current_setting('t.tab1')::uuid, 'a0000000-0000-0000-0000-000000000004') ->> 'claimed')::boolean, false, 'segunda reserva simultânea não duplica a cobrança');
SELECT t.is((SELECT count(*) FROM public.tab_pix_charges WHERE tab_id = current_setting('t.tab1')::uuid), 1::bigint, 'uma cobrança viva por comanda');
SELECT t.lives(format($$SELECT public.save_tab_pix_charge(%L, '{"providerPaymentId":"mp-1001","brcode":"000201BR","expiresAt":"2999-01-01T00:00:00Z"}')$$, current_setting('t.c1')), 'servidor grava a cobrança criada no Mercado Pago');
SELECT t.is((SELECT status FROM public.tab_pix_charges WHERE id = current_setting('t.c1')::uuid), 'pending', 'cobrança fica pendente');
RESET ROLE;
SET ROLE authenticated;
SELECT t.login('e0000000-0000-0000-0000-000000000001');
SELECT t.throws($$SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]', gen_random_uuid(), current_setting('t.s1')::uuid)$$,
  'TAB_PAYMENT_IN_PROGRESS', 'cliente não altera o total enquanto a conta está em pagamento');
SELECT t.is(t.visible($$SELECT id FROM public.tab_pix_charges$$), 0::bigint, 'cliente não vê a cobrança PIX');
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.is(t.visible($$SELECT id FROM public.tab_pix_charges$$), 1::bigint, 'caixa A vê a cobrança PIX da loja');
SELECT t.login('b0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible($$SELECT id FROM public.tab_pix_charges$$), 0::bigint, 'dono B não vê cobranças da loja A');
RESET ROLE;
SET ROLE service_role;
SELECT t.throws(format($$SELECT public.confirm_tab_pix(%L, '{"paid":true,"providerPaymentId":"mp-1001","orderId":"tab:%s","amountCents":4999,"currency":"BRL","rawStatus":"approved"}')$$, current_setting('t.c1'), current_setting('t.tab1')),
  'não corresponde', 'valor divergente não confirma');
SELECT t.throws(format($$SELECT public.confirm_tab_pix(%L, '{"paid":true,"providerPaymentId":"mp-1001","orderId":"tab:%s","amountCents":5000,"currency":"BRL","rawStatus":"approved"}')$$, current_setting('t.c1'), gen_random_uuid()),
  'não corresponde', 'referência de outra comanda não confirma');
SELECT t.throws(format($$SELECT public.confirm_tab_pix(%L, '{"paid":true,"providerPaymentId":"mp-OTHER","orderId":"tab:%s","amountCents":5000,"currency":"BRL","rawStatus":"approved"}')$$, current_setting('t.c1'), current_setting('t.tab1')),
  'não corresponde', 'pagamento de outro id do provedor não confirma');
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id = current_setting('t.tab1')::uuid), 'OPEN', 'comanda segue aberta após confirmações inválidas');
SELECT set_config('t.conf', public.confirm_tab_pix(current_setting('t.c1')::uuid,
  format('{"paid":true,"providerPaymentId":"mp-1001","orderId":"tab:%s","amountCents":5000,"currency":"BRL","rawStatus":"approved"}', current_setting('t.tab1'))::jsonb)::text, false);
SELECT t.is((current_setting('t.conf')::jsonb ->> 'closed')::boolean, true, 'PIX confirmado fecha a conta e libera a mesa');
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id = current_setting('t.tab1')::uuid), 'CLOSED', 'comanda CLOSED');
SELECT t.is((SELECT count(*) FROM public.tab_payments WHERE tab_id = current_setting('t.tab1')::uuid AND method = 'PIX' AND amount_cents = 5000), 1::bigint, 'pagamento PIX registrado uma vez');
SELECT t.is((SELECT count(*) FROM public.tab_events WHERE tab_id = current_setting('t.tab1')::uuid AND event_type = 'TAB_CLOSED' AND details ->> 'via' = 'pix_mercadopago'), 1::bigint, 'fechamento por PIX auditado');
SELECT t.is((public.confirm_tab_pix(current_setting('t.c1')::uuid,
  format('{"paid":true,"providerPaymentId":"mp-1001","orderId":"tab:%s","amountCents":5000,"currency":"BRL","rawStatus":"approved"}', current_setting('t.tab1'))::jsonb) ->> 'status'), 'paid', 'webhook repetido é idempotente');
SELECT t.is((SELECT count(*) FROM public.tab_payments WHERE tab_id = current_setting('t.tab1')::uuid), 1::bigint, 'repetição não duplica pagamento');
SELECT t.ok((SELECT brcode IS NULL AND paid_at IS NOT NULL AND NOT needs_review FROM public.tab_pix_charges WHERE id = current_setting('t.c1')::uuid), 'código PIX é apagado após pago');
SELECT t.throws(format($$SELECT public.reserve_tab_pix(%L, 'a0000000-0000-0000-0000-000000000004')$$, current_setting('t.tab1')), 'encerrada', 'comanda encerrada não gera novo PIX');
RESET ROLE;
SET ROLE authenticated;
SELECT t.login('e0000000-0000-0000-0000-000000000001');
SELECT t.throws($$SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]', gen_random_uuid(), current_setting('t.s1')::uuid)$$, 'TAB_CLOSED', 'mesa liberada: sessão antiga não pede mais');
RESET ROLE;

-- 7b. total changes while PIX is pending -> money is recorded, tab stays open, staff alerted
DELETE FROM public.security_rate_limits;
SET ROLE authenticated;
SELECT t.login('e0000000-0000-0000-0000-000000000004');
SELECT set_config('t.s4', public.open_or_join_tab('mesas-a2-token-0002', 'Cliente', 'dev-4') ->> 'sessionId', false);
SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":2}]', gen_random_uuid(), current_setting('t.s4')::uuid);
RESET ROLE;
SELECT set_config('t.tab4', (SELECT tab_id::text FROM public.tab_sessions WHERE id = current_setting('t.s4')::uuid), false);
SET ROLE service_role;
SELECT set_config('t.c4', public.reserve_tab_pix(current_setting('t.tab4')::uuid, 'a0000000-0000-0000-0000-000000000004') -> 'charge' ->> 'id', false);
SELECT public.save_tab_pix_charge(current_setting('t.c4')::uuid, '{"providerPaymentId":"mp-2002","brcode":"000201BR2","expiresAt":"2999-01-01T00:00:00Z"}');
RESET ROLE;
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]', gen_random_uuid(), NULL, current_setting('t.tab4')::uuid);
RESET ROLE;
SET ROLE service_role;
SELECT set_config('t.conf4', public.confirm_tab_pix(current_setting('t.c4')::uuid,
  format('{"paid":true,"providerPaymentId":"mp-2002","orderId":"tab:%s","amountCents":2000,"currency":"BRL","rawStatus":"approved"}', current_setting('t.tab4'))::jsonb)::text, false);
SELECT t.is((current_setting('t.conf4')::jsonb ->> 'closed')::boolean, false, 'total mudou: conta não fecha sozinha');
SELECT t.is((current_setting('t.conf4')::jsonb ->> 'needs_review')::boolean, true, 'total mudou: cobrança marcada para conferência');
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id = current_setting('t.tab4')::uuid), 'OPEN', 'conta segue aberta');
SELECT t.is((SELECT count(*) FROM public.waiter_calls WHERE tab_id = current_setting('t.tab4')::uuid AND type = 'HELP' AND status = 'OPEN'), 1::bigint, 'equipe é avisada (chamado)');
SELECT t.is((SELECT status FROM public.tab_pix_charges WHERE id = current_setting('t.c4')::uuid), 'paid', 'dinheiro recebido fica registrado como pago');
RESET ROLE;
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.lives(format($$SELECT public.close_tab(%L, '[{"method":"PIX","amount_cents":2000},{"method":"CASH","amount_cents":1000}]')$$, current_setting('t.tab4')), 'caixa fecha com o PIX já recebido + dinheiro (fechamento manual)');
RESET ROLE;

-- 7c. re-reserve when total changed / expiry / cancel / staff rounds
DELETE FROM public.security_rate_limits;
SET ROLE authenticated;
SELECT t.login('e0000000-0000-0000-0000-000000000005');
SELECT set_config('t.s5', public.open_or_join_tab('mesas-a2-token-0002', 'Cliente', 'dev-5') ->> 'sessionId', false);
SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]', gen_random_uuid(), current_setting('t.s5')::uuid);
RESET ROLE;
SELECT set_config('t.tab5', (SELECT tab_id::text FROM public.tab_sessions WHERE id = current_setting('t.s5')::uuid), false);
SET ROLE service_role;
SELECT set_config('t.c5', public.reserve_tab_pix(current_setting('t.tab5')::uuid, 'a0000000-0000-0000-0000-000000000002') -> 'charge' ->> 'id', false);
SELECT public.save_tab_pix_charge(current_setting('t.c5')::uuid, '{"providerPaymentId":"mp-3003","brcode":"BR3","expiresAt":"2999-01-01T00:00:00Z"}');
RESET ROLE;
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]', gen_random_uuid(), NULL, current_setting('t.tab5')::uuid);
RESET ROLE;
SET ROLE service_role;
SELECT set_config('t.c5b', public.reserve_tab_pix(current_setting('t.tab5')::uuid, 'a0000000-0000-0000-0000-000000000002') -> 'charge' ->> 'id', false);
SELECT t.ok(current_setting('t.c5b') <> current_setting('t.c5'), 'total mudou: nova cobrança no valor atual');
SELECT t.is((SELECT status FROM public.tab_pix_charges WHERE id = current_setting('t.c5')::uuid), 'cancelled', 'cobrança antiga é cancelada');
SELECT t.is((SELECT amount_cents FROM public.tab_pix_charges WHERE id = current_setting('t.c5b')::uuid), 2000, 'nova cobrança com 20,00');
SELECT public.save_tab_pix_charge(current_setting('t.c5b')::uuid, '{"providerPaymentId":"mp-3004","brcode":"BR4","expiresAt":"2999-01-01T00:00:00Z"}');
SELECT t.lives(format($$SELECT public.cancel_tab_pix(%L, 'a0000000-0000-0000-0000-000000000004')$$, current_setting('t.tab5')), 'caixa cancela o PIX da conta');
SELECT t.throws(format($$SELECT public.cancel_tab_pix(%L, 'b0000000-0000-0000-0000-000000000001')$$, current_setting('t.tab5')), 'Acesso negado', 'outra loja não cancela PIX');
SELECT t.is((SELECT status FROM public.tab_pix_charges WHERE id = current_setting('t.c5b')::uuid), 'cancelled', 'PIX cancelado');
SELECT t.is((public.get_tab_pix_charge(current_setting('t.tab5')::uuid, 'a0000000-0000-0000-0000-000000000004') -> 'charge' ->> 'status'), 'cancelled', 'status consultado pelo servidor');
SELECT t.throws(format($$SELECT public.get_tab_pix_charge(%L, 'b0000000-0000-0000-0000-000000000001')$$, current_setting('t.tab5')), 'Acesso negado', 'status do PIX não vaza entre lojas');
-- late payment of a cancelled charge: money recorded for review, nothing duplicated
SELECT set_config('t.late', public.confirm_tab_pix(current_setting('t.c5b')::uuid,
  format('{"paid":true,"providerPaymentId":"mp-3004","orderId":"tab:%s","amountCents":2000,"currency":"BRL","rawStatus":"approved"}', current_setting('t.tab5'))::jsonb)::text, false);
SELECT t.is((current_setting('t.late')::jsonb ->> 'closed')::boolean, true, 'cobrança cancelada mas paga na hora certa ainda fecha a conta (valor confere)');
RESET ROLE;
-- expiry and closed-tab late payment
SET ROLE service_role;
SELECT t.is((SELECT public.confirm_tab_pix(current_setting('t.c1')::uuid,
  format('{"paid":true,"providerPaymentId":"mp-1001","orderId":"tab:%s","amountCents":5000,"currency":"BRL","rawStatus":"approved"}', current_setting('t.tab1'))::jsonb) ->> 'closed'), 'true', 'repetição não muda resultado');
RESET ROLE;
-- rate limit of charge creation
DELETE FROM public.security_rate_limits;
SET ROLE authenticated;
SELECT t.login('e0000000-0000-0000-0000-000000000006');
SELECT set_config('t.s6', public.open_or_join_tab('mesas-a2-token-0002', 'Cliente', 'dev-6') ->> 'sessionId', false);
SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]', gen_random_uuid(), current_setting('t.s6')::uuid);
RESET ROLE;
SELECT set_config('t.tab6', (SELECT tab_id::text FROM public.tab_sessions WHERE id = current_setting('t.s6')::uuid), false);
DO $rl4$
DECLARE i int; n int := 0; v_blocked boolean := false;
BEGIN
  SET LOCAL ROLE service_role;
  FOR i IN 1..14 LOOP
    n := n + 1;
    BEGIN
      PERFORM public.reserve_tab_pix(current_setting('t.tab6')::uuid, 'a0000000-0000-0000-0000-000000000004');
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'Muitas tentativas%' THEN v_blocked := true; EXIT; END IF;
      RAISE;
    END;
  END LOOP;
  RESET ROLE;
  PERFORM t.ok(v_blocked, format('geração de PIX tem limite por comanda (bloqueou na tentativa %s)', n));
END $rl4$;
DELETE FROM public.security_rate_limits;
-- expiry
UPDATE public.tab_pix_charges SET status = 'pending', provider_payment_id = 'mp-6006', expires_at = now() - interval '1 minute' WHERE tab_id = current_setting('t.tab6')::uuid AND status = 'creating';
SET ROLE service_role;
SELECT set_config('t.c6b', public.reserve_tab_pix(current_setting('t.tab6')::uuid, 'a0000000-0000-0000-0000-000000000004') -> 'charge' ->> 'id', false);
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.tab_pix_charges WHERE tab_id = current_setting('t.tab6')::uuid AND status = 'expired'), 1::bigint, 'PIX vencido é marcado e substituído');
-- fail
SET ROLE service_role;
SELECT public.fail_tab_pix_charge(current_setting('t.c6b')::uuid);
RESET ROLE;
SELECT t.is((SELECT status FROM public.tab_pix_charges WHERE id = current_setting('t.c6b')::uuid), 'failed', 'falha no provedor libera nova tentativa');

-- ===== 8. LGPD =====
INSERT INTO public.dining_tabs (id, tenant_id, mode, table_id, status, closed_at)
SELECT gen_random_uuid(), :'A', 'TABLE', id, 'CLOSED', now() - interval '200 days' FROM public.dining_tables WHERE qr_token = 'mesas-a4-token-0004' LIMIT 1;
INSERT INTO public.tab_sessions (tenant_id, tab_id, auth_user_id, display_name, device_id, expires_at)
SELECT :'A', tb.id, 'e0000000-0000-0000-0000-000000000070', 'Maria da Silva', 'dev-privado-123', now() - interval '200 days'
FROM public.dining_tabs tb WHERE tb.status = 'CLOSED' AND tb.closed_at < now() - interval '100 days' LIMIT 1;
SET ROLE service_role;
SELECT t.throws($$SELECT public.anonymize_old_tab_sessions(1)$$, 'p_days', 'anonimização exige janela mínima de 7 dias');
SELECT t.ok(public.anonymize_old_tab_sessions(90) >= 1, 'sessões antigas de comandas encerradas são anonimizadas');
RESET ROLE;
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.tab_sessions WHERE display_name = 'Maria da Silva' OR device_id = 'dev-privado-123'), 'nome e dispositivo antigos não permanecem');
SELECT t.ok((SELECT display_name FROM public.tab_sessions WHERE id = current_setting('t.s1')::uuid) IS NOT NULL, 'nome vazio no QR vira rótulo genérico (nunca NULL)');
