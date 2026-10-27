-- Mesas: modelo de acesso (Responsável, convite, aprovação, sessões na conta, limites). Local disposable DB only.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
RESET ROLE;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
DELETE FROM public.security_rate_limits;
INSERT INTO auth.users (id, email) SELECT ('e0000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'c' || g || '@test.local' FROM generate_series(1, 120) g;
INSERT INTO auth.users (id, email) VALUES ('a0000000-0000-0000-0000-000000000009', 'waiter.a@test.local');
INSERT INTO public.users (id, email, name) SELECT id, email, 'x' FROM auth.users WHERE id::text LIKE 'e0000000%' OR id::text = 'a0000000-0000-0000-0000-000000000009' ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  IF to_regclass('public.legal_acceptances') IS NOT NULL THEN
    INSERT INTO public.legal_acceptances(user_id, audience, version)
    SELECT u.id, a.audience, public._legal_version() FROM auth.users u CROSS JOIN (VALUES ('owner'),('customer')) a(audience) ON CONFLICT DO NOTHING;
  END IF;
END $$;
INSERT INTO public.tenant_users (user_id, tenant_id, role_id, status) VALUES ('a0000000-0000-0000-0000-000000000009', :'A', 'WAITER', 'ACTIVE');
INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, config) VALUES
  (:'A', 'dine_in', true, '{"mode":"TABLE","salon_open":true,"release_required":true,"close_roles":["OWNER","MANAGER","CASHIER"]}'),
  (:'B', 'dine_in', true, '{"mode":"TABLE","salon_open":true,"release_required":true}')
ON CONFLICT (tenant_id, module_key) DO UPDATE SET enabled = true, config = EXCLUDED.config;
INSERT INTO public.dining_tables (tenant_id, label, qr_token) VALUES
  (:'A', 'Mesa 01', 'acc-a1-token-000001'), (:'A', 'Mesa 02', 'acc-a2-token-000002'), (:'A', 'Mesa 03', 'acc-a3-token-000003'),
  (:'A', 'Mesa 04', 'acc-a4-token-000004'), (:'A', 'Mesa 05', 'acc-a5-token-000005'), (:'A', 'Mesa 06', 'acc-a6-token-000006'),
  (:'B', 'Mesa B1', 'acc-b1-token-000001');
CREATE OR REPLACE FUNCTION t.uid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('e0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION t.as_user(n int, p_anon boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', t.uid(n), 'role', 'authenticated', 'is_anonymous', p_anon)::text, false);
  PERFORM set_config('request.jwt.claim.sub', t.uid(n)::text, false);
END $$;
CREATE OR REPLACE FUNCTION t.enter(n int, tok text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM t.as_user(n); RETURN public.enter_table(tok, 'Pessoa ' || n, 'dev-' || n); END $$;
CREATE OR REPLACE FUNCTION t.order_as(n int, p_session uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM t.as_user(n);
  RETURN public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]'::jsonb, gen_random_uuid(), p_session); END $$;
CREATE OR REPLACE FUNCTION t.sess(n int, tok text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT ts.id FROM tab_sessions ts JOIN dining_tabs tb ON tb.id = ts.tab_id JOIN dining_tables dt ON dt.id = tb.table_id
  WHERE dt.qr_token = tok AND ts.auth_user_id = t.uid(n) ORDER BY ts.created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION t.tabof(tok text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT tb.id FROM dining_tabs tb JOIN dining_tables dt ON dt.id = tb.table_id WHERE dt.qr_token = tok AND tb.status IN ('OPEN','BILL_REQUESTED') ORDER BY tb.opened_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION t.tab_total(p_tab uuid) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT public._tab_total_cents(tenant_id, id) FROM public.dining_tabs WHERE id = p_tab $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- ===== 1. grants / RLS / capabilities =====
SELECT t.ok(NOT has_function_privilege('anon', 'public.enter_table(text,text,text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.join_with_code(text,text,text,text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.create_tab_invite(uuid,integer)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.reject_session(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.staff_open_tab(uuid)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.enter_table(text,text,text)', 'EXECUTE'), 'RPCs de acesso: nada para anon');
SELECT t.ok(NOT has_function_privilege('authenticated', 'public._responsible_session(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public._end_session(uuid,text)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public._customer_identified()', 'EXECUTE'), 'helpers internos não são chamáveis pelo cliente');
SELECT t.ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.dining_tab_invites'::regclass, 'public.tab_access_events'::regclass)), 'RLS ativa nas tabelas novas');
SELECT t.ok(NOT has_table_privilege('authenticated', 'public.dining_tab_invites', 'SELECT') AND NOT has_table_privilege('anon', 'public.dining_tab_invites', 'SELECT')
        AND NOT has_table_privilege('authenticated', 'public.dining_tab_invites', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.tab_access_events', 'INSERT'), 'códigos de convite: sem acesso direto');
SET ROLE authenticated; SELECT t.as_user(1);
SELECT t.is((public.mesas_qr_capabilities() ->> 'version')::int, 2, 'capacidades: versão 2');
SELECT t.ok((public.mesas_qr_capabilities() ->> 'table_access')::boolean AND (public.mesas_qr_capabilities() ->> 'waiter_app')::boolean, 'capacidades: table_access e waiter_app');
RESET ROLE;
SELECT t.is((SELECT provolatile::text FROM pg_proc WHERE proname = 'resolve_table_qr'), 'v', 'resolve_table_qr agora é VOLATILE (limite de taxa)');

-- ===== 2. identificação obrigatória =====
SET ROLE authenticated; SELECT t.as_user(2, true);
SELECT t.throws($$SELECT public.enter_table('acc-a1-token-000001', 'Anon', 'dev-x')$$, 'IDENTIFICATION_REQUIRED', 'conta anônima não abre mesa');
SELECT t.throws($$SELECT public.open_or_join_tab('acc-a1-token-000001', 'Anon', 'dev-x')$$, 'IDENTIFICATION_REQUIRED', 'nome antigo da função também exige identificação');
SELECT t.throws($$SELECT public.join_with_code('acc-a1-token-000001', 'ABCDEF', 'Anon', 'dev-x')$$, 'IDENTIFICATION_REQUIRED', 'conta anônima não usa código');
RESET ROLE; SELECT t.is((SELECT count(*) FROM public.dining_tabs WHERE tenant_id = :'A'::uuid), 0::bigint, 'nenhuma comanda criada por conta anônima');
SET ROLE authenticated; SELECT set_config('request.jwt.claims', '', false); SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.throws($$SELECT public.enter_table('acc-a1-token-000001', 'Sem login', 'dev-x')$$, 'AUTH_REQUIRED', 'sem login não abre mesa');
RESET ROLE;

-- ===== 3. primeiro a ler vira Responsável; os demais veem "em uso" =====
SET ROLE authenticated;
SELECT set_config('t.r1', t.enter(10, 'acc-a1-token-000001')::text, false);
SELECT t.is(current_setting('t.r1')::jsonb ->> 'state', 'RESPONSIBLE', 'primeiro a ler a mesa livre vira Responsável');
SELECT t.is((current_setting('t.r1')::jsonb ->> 'approved')::boolean, false, 'com aprovação ligada o Responsável começa aguardando liberação');
SELECT set_config('t.r2', t.enter(11, 'acc-a1-token-000001')::text, false);
SELECT t.is(current_setting('t.r2')::jsonb ->> 'state', 'IN_USE', 'segundo a ler vê mesa em uso');
SELECT t.ok(current_setting('t.r2')::jsonb ->> 'sessionId' IS NULL, 'mesa em uso não devolve sessão');
SELECT t.throws($$SELECT public.open_or_join_tab('acc-a1-token-000001', 'Pessoa 12', 'dev-12')$$ , 'TABLE_IN_USE', 'função antiga não permite entrar em mesa ocupada');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.tab_sessions ts JOIN public.dining_tabs tb ON tb.id = ts.tab_id WHERE tb.id = t.tabof('acc-a1-token-000001')), 1::bigint, 'só o Responsável tem sessão');
SELECT t.is((SELECT responsible_user_id FROM public.dining_tabs WHERE id = t.tabof('acc-a1-token-000001')), t.uid(10), 'comanda registra o Responsável');
SET ROLE authenticated;
SELECT t.is(t.enter(10, 'acc-a1-token-000001') ->> 'sessionId', current_setting('t.r1')::jsonb ->> 'sessionId', 'reabrir o navegador restaura a mesma sessão (conta)');
SELECT t.is((public.enter_table('acc-a1-token-000001', 'Pessoa 10', 'outro-celular') ->> 'sessionId'), current_setting('t.r1')::jsonb ->> 'sessionId', 'outro aparelho, mesma conta: restaura a mesma sessão');
-- pendente: não pede nem convida
SELECT t.throws($$SELECT t.order_as(10, t.sess(10, 'acc-a1-token-000001'))$$, 'SESSION_NOT_APPROVED', 'sessão pendente não consegue pedir');
SELECT t.throws($$SELECT public.create_tab_invite(t.sess(10, 'acc-a1-token-000001'))$$, 'SESSION_NOT_APPROVED', 'Responsável pendente não convida');
SELECT t.lives($$SELECT public.ping_pending_approval(t.sess(10, 'acc-a1-token-000001'))$$, 'pedido bloqueado avisa a equipe sem perder a sessão');
RESET ROLE;
SELECT t.ok((SELECT approval_requested_at IS NOT NULL FROM public.tab_sessions WHERE id = t.sess(10, 'acc-a1-token-000001')), 'equipe vê que a mesa tentou pedir');
-- cliente nunca aprova
SET ROLE authenticated;
SELECT t.throws($$SELECT public.approve_session(t.sess(10, 'acc-a1-token-000001'))$$, 'FORBIDDEN', 'cliente não se aprova');
SELECT t.throws($$SELECT public.reject_session(t.sess(10, 'acc-a1-token-000001'))$$, 'FORBIDDEN', 'cliente não recusa');
-- outra loja não aprova
SELECT t.login('b0000000-0000-0000-0000-000000000001');
SELECT t.throws($$SELECT public.approve_session(t.sess(10, 'acc-a1-token-000001'))$$, 'FORBIDDEN', 'dono de outra loja não aprova');
SELECT t.throws($$SELECT public.staff_reset_tab_holder(t.tabof('acc-a1-token-000001'))$$, 'FORBIDDEN', 'outra loja não troca responsável');
-- garçom aprova
SELECT t.login('a0000000-0000-0000-0000-000000000009');
SELECT t.lives($$SELECT public.approve_session(t.sess(10, 'acc-a1-token-000001'))$$, 'garçom aprova a mesa');
RESET ROLE;
SELECT t.ok((SELECT approved_at IS NOT NULL AND approved_by IS NOT NULL FROM public.tab_sessions WHERE id = t.sess(10, 'acc-a1-token-000001')), 'aprovação registra quem aprovou');

-- ===== 4. convite =====
SET ROLE authenticated;
SELECT t.as_user(10);
SELECT set_config('t.inv', public.create_tab_invite(t.sess(10, 'acc-a1-token-000001')) ::text, false);
SELECT t.ok((current_setting('t.inv')::jsonb ->> 'code') ~ '^[A-Z2-9]{6}$', 'código curto de 6 caracteres sem ambíguos');
SELECT t.ok(((current_setting('t.inv')::jsonb ->> 'expiresAt')::timestamptz) > now() AND ((current_setting('t.inv')::jsonb ->> 'expiresAt')::timestamptz) <= now() + interval '121 minutes', 'código expira');
SELECT t.is(public.get_tab_invite(t.sess(10, 'acc-a1-token-000001')) ->> 'code', current_setting('t.inv')::jsonb ->> 'code', 'reabrir mostra o mesmo código ativo');
SELECT t.as_user(11);
SELECT t.is(public.join_with_code('acc-a1-token-000001', 'ZZZZZZ', 'Pessoa 11', 'dev-11') ->> 'state', 'INVALID_CODE', 'código errado é recusado');
SELECT t.is(public.join_with_code('acc-a1-token-000001', 'ab', 'Pessoa 11', 'dev-11') ->> 'state', 'INVALID_CODE', 'código malformado tem a mesma resposta genérica');
SELECT set_config('t.g1', public.join_with_code('acc-a1-token-000001', lower(current_setting('t.inv')::jsonb ->> 'code'), 'Pessoa 11', 'dev-11')::text, false);
SELECT t.is(current_setting('t.g1')::jsonb ->> 'state', 'GUEST', 'convidado entra com o código (aceita minúsculas)');
SELECT t.is((current_setting('t.g1')::jsonb ->> 'approved')::boolean, true, 'convidado entra liberado pelo Responsável');
SELECT t.lives($$SELECT t.order_as(11, t.sess(11, 'acc-a1-token-000001'))$$, 'convidado pede na mesma comanda');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.orders WHERE tab_id = t.tabof('acc-a1-token-000001')), 1::bigint, 'pedido do convidado na comanda do Responsável');
SELECT t.is((SELECT o.customer_name FROM public.orders o WHERE o.tab_id = t.tabof('acc-a1-token-000001') LIMIT 1), 'Pessoa 11', 'pedido mostra quem pediu');
SET ROLE authenticated; SELECT t.as_user(10);
SELECT t.lives($$SELECT t.order_as(10, t.sess(10, 'acc-a1-token-000001'))$$, 'Responsável aprovado pede');
SELECT t.is(jsonb_array_length(public.get_my_tab(t.sess(10, 'acc-a1-token-000001')) -> 'members'), 2, 'Responsável vê os membros');
SELECT t.is(jsonb_array_length(public.get_my_tab(t.sess(10, 'acc-a1-token-000001')) -> 'rounds'), 2, 'comanda tem as duas rodadas');
SELECT t.ok((SELECT bool_or((r ->> 'mine')::boolean) AND bool_or(NOT (r ->> 'mine')::boolean) FROM jsonb_array_elements(public.get_my_tab(t.sess(10, 'acc-a1-token-000001')) -> 'rounds') r), 'rodadas indicam quais são minhas');
SELECT t.as_user(11);
SELECT t.is(jsonb_array_length(public.get_my_tab(t.sess(11, 'acc-a1-token-000001')) -> 'members'), 0, 'convidado não vê a lista de membros');
SELECT t.is(public.get_my_tab(t.sess(11, 'acc-a1-token-000001')) -> 'me' ->> 'role', 'GUEST', 'convidado sabe que é convidado');
SELECT t.throws($$SELECT public.create_tab_invite(t.sess(11, 'acc-a1-token-000001'))$$, 'FORBIDDEN', 'convidado não gera código');
SELECT t.throws($$SELECT public.remove_tab_guest(t.sess(11, 'acc-a1-token-000001'), t.sess(10, 'acc-a1-token-000001'))$$, 'FORBIDDEN', 'convidado não remove ninguém');
SELECT t.throws($$SELECT public.transfer_tab_responsibility(t.sess(11, 'acc-a1-token-000001'), t.sess(11, 'acc-a1-token-000001'))$$, 'FORBIDDEN', 'convidado não transfere responsabilidade');
-- Cliente de outra comanda não lê esta
SELECT t.enter(12, 'acc-a2-token-000002');
SELECT t.as_user(12);
SELECT t.throws($$SELECT public.get_my_tab(t.sess(10, 'acc-a1-token-000001'))$$, 'TAB_NOT_FOUND', 'outra pessoa não lê a conta alheia');
SELECT t.throws($$SELECT public.join_with_code('acc-a2-token-000002', (public.get_tab_invite(t.sess(10, 'acc-a1-token-000001')) ->> 'code'), 'P', 'd')$$, '.', 'conta alheia não gera/lê convite');
RESET ROLE;

-- ===== 5. remover, revogar, expirar =====
SET ROLE authenticated; SELECT t.as_user(10);
SELECT t.lives($$SELECT public.remove_tab_guest(t.sess(10, 'acc-a1-token-000001'), t.sess(11, 'acc-a1-token-000001'))$$, 'Responsável remove convidado');
SELECT t.as_user(11);
SELECT t.is(public.get_my_tab(t.sess(11, 'acc-a1-token-000001')) ->> 'endedReason', 'REMOVED', 'convidado removido é informado');
SELECT t.throws($$SELECT t.order_as(11, t.sess(11, 'acc-a1-token-000001'))$$, 'SESSION_INVALID', 'convidado removido não pede');
SELECT t.is(public.enter_table('acc-a1-token-000001', 'Pessoa 11', 'dev-11') ->> 'state', 'IN_USE', 'removido que lê o QR vê mesa em uso');
SELECT t.is(public.join_with_code('acc-a1-token-000001', current_setting('t.inv')::jsonb ->> 'code', 'Pessoa 11', 'dev-11') ->> 'state', 'GUEST', 'código ainda válido: removido pode voltar (Responsável decide revogando)');
SELECT t.as_user(10);
SELECT t.lives($$SELECT public.revoke_tab_invite(t.sess(10, 'acc-a1-token-000001'))$$, 'Responsável revoga o código');
SELECT t.is(public.get_tab_invite(t.sess(10, 'acc-a1-token-000001')) IS NULL, true, 'sem código ativo depois de revogar');
SELECT t.lives($$SELECT public.remove_tab_guest(t.sess(10, 'acc-a1-token-000001'), t.sess(11, 'acc-a1-token-000001'))$$, 'remove de novo');
SELECT t.as_user(11);
SELECT t.is(public.join_with_code('acc-a1-token-000001', current_setting('t.inv')::jsonb ->> 'code', 'Pessoa 11', 'dev-11') ->> 'state', 'INVALID_CODE', 'código revogado não funciona');
SELECT t.as_user(10);
SELECT set_config('t.inv2', public.create_tab_invite(t.sess(10, 'acc-a1-token-000001'), 5)::text, false);
RESET ROLE;
UPDATE public.dining_tab_invites SET expires_at = now() - interval '1 minute' WHERE revoked_at IS NULL AND tab_id = t.tabof('acc-a1-token-000001');
SET ROLE authenticated; SELECT t.as_user(11);
SELECT t.is(public.join_with_code('acc-a1-token-000001', current_setting('t.inv2')::jsonb ->> 'code', 'Pessoa 11', 'dev-11') ->> 'state', 'INVALID_CODE', 'código expirado não funciona');
SELECT t.as_user(10);
SELECT set_config('t.inv3', public.create_tab_invite(t.sess(10, 'acc-a1-token-000001'))::text, false);
SELECT t.ok((current_setting('t.inv3')::jsonb ->> 'code') <> (current_setting('t.inv2')::jsonb ->> 'code'), 'novo código substitui o anterior');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.dining_tab_invites WHERE tab_id = t.tabof('acc-a1-token-000001') AND revoked_at IS NULL), 1::bigint, 'só um código ativo por comanda');

-- ===== 6. força bruta =====
-- Regression: failed attempts must persist (an exception would roll the counter back).
RESET ROLE; DELETE FROM public.security_rate_limits; SET ROLE authenticated; SELECT t.as_user(31);
SELECT public.join_with_code('acc-a1-token-000001', 'ZZZZZZ', 'Pessoa 31', 'dev-31');
SELECT public.join_with_code('acc-a1-token-000001', 'YYYYYY', 'Pessoa 31', 'dev-31');
RESET ROLE;
SELECT t.is((SELECT sum(hits) FROM public.security_rate_limits WHERE scope = 'invite_try_user'), 2::bigint, 'tentativas erradas ficam registradas (contador não é desfeito)');
DELETE FROM public.security_rate_limits;
DO $bf$
DECLARE i int; v_blocked_at int := 0;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM t.as_user(30);
  FOR i IN 1..10 LOOP
    BEGIN PERFORM public.join_with_code('acc-a1-token-000001', 'ZZZZZZ', 'Pessoa 30', 'dev-30');
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'RATE_LIMITED%' THEN v_blocked_at := i; EXIT; END IF;
      RAISE;
    END;
  END LOOP;
  RESET ROLE;
  PERFORM t.ok(v_blocked_at = 7, format('mesma conta é barrada na 7ª tentativa de código (barrou em %s)', v_blocked_at));
END $bf$;
DELETE FROM public.security_rate_limits;
DO $bf2$
DECLARE i int; v_blocked_at int := 0;
BEGIN
  SET LOCAL ROLE authenticated;
  FOR i IN 40..100 LOOP
    PERFORM t.as_user(i);
    BEGIN PERFORM public.join_with_code('acc-a1-token-000001', 'ZZZZZZ', 'P', 'd' || i);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'RATE_LIMITED%' THEN v_blocked_at := i; EXIT; END IF;
      RAISE;
    END;
  END LOOP;
  RESET ROLE;
  PERFORM t.ok(v_blocked_at BETWEEN 60 AND 100, format('contas diferentes na mesma mesa também são barradas (barrou na conta %s)', v_blocked_at));
END $bf2$;
DELETE FROM public.security_rate_limits;
DO $rq$
DECLARE i int; v_blocked boolean := false;
BEGIN
  SET LOCAL ROLE anon;
  FOR i IN 1..130 LOOP
    BEGIN PERFORM public.resolve_table_qr('acc-a2-token-000002');
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'RATE_LIMITED%' THEN v_blocked := true; EXIT; END IF; RAISE; END;
  END LOOP;
  RESET ROLE;
  PERFORM t.ok(v_blocked, 'resolve_table_qr é limitado por token');
END $rq$;
DELETE FROM public.security_rate_limits;
SET ROLE anon;
SELECT t.is(public.resolve_table_qr('acc-a2-token-000002') ->> 'available', 'true', 'resolve_table_qr continua devolvendo a mesa');
SELECT t.is(public.resolve_table_qr('nada') ->> 'available', 'false', 'token curto/desconhecido: indisponível');
RESET ROLE;

-- ===== 7. transferir responsabilidade =====
SET ROLE authenticated; SELECT t.as_user(10);
SELECT set_config('t.inv4', public.create_tab_invite(t.sess(10, 'acc-a1-token-000001'))::text, false);
SELECT t.as_user(13);
SELECT t.enter(13, 'acc-a1-token-000001');
SELECT t.is(public.join_with_code('acc-a1-token-000001', current_setting('t.inv4')::jsonb ->> 'code', 'Pessoa 13', 'dev-13') ->> 'state', 'GUEST', 'terceira pessoa entra com o código');
SELECT t.as_user(10);
SELECT t.lives($$SELECT public.transfer_tab_responsibility(t.sess(10, 'acc-a1-token-000001'), t.sess(13, 'acc-a1-token-000001'))$$, 'Responsável transfere para um convidado');
SELECT t.is(public.get_my_tab(t.sess(10, 'acc-a1-token-000001')) -> 'me' ->> 'role', 'GUEST', 'ex-Responsável vira convidado (continua na mesa)');
SELECT t.throws($$SELECT public.create_tab_invite(t.sess(10, 'acc-a1-token-000001'))$$, 'FORBIDDEN', 'ex-Responsável não convida mais');
SELECT t.as_user(13);
SELECT t.is(public.get_my_tab(t.sess(13, 'acc-a1-token-000001')) -> 'me' ->> 'role', 'RESPONSIBLE', 'novo Responsável');
SELECT t.lives($$SELECT public.create_tab_invite(t.sess(13, 'acc-a1-token-000001'))$$, 'novo Responsável gera código');
RESET ROLE;
SELECT t.ok((SELECT count(*) FROM public.dining_tab_invites WHERE tab_id = t.tabof('acc-a1-token-000001') AND revoked_at IS NULL) = 1, 'transferência revoga o código antigo');

-- ===== 8. equipe: trocar o titular (celular perdido) =====
SET ROLE authenticated; SELECT t.login('a0000000-0000-0000-0000-000000000009');
SELECT t.lives($$SELECT public.staff_reset_tab_holder(t.tabof('acc-a1-token-000001'))$$, 'garçom reinicia o titular da mesa');
RESET ROLE;
SELECT t.ok((SELECT responsible_user_id IS NULL AND holder_claimable FROM public.dining_tabs WHERE id = t.tabof('acc-a1-token-000001')), 'mesa fica sem titular, liberada para ser assumida');
SELECT t.ok((SELECT ended_reason = 'STAFF_RESET' FROM public.tab_sessions WHERE id = t.sess(13, 'acc-a1-token-000001')), 'sessão do titular antigo foi encerrada');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.dining_tab_invites WHERE tab_id = t.tabof('acc-a1-token-000001') AND revoked_at IS NULL), 'reinício revoga códigos');
SET ROLE authenticated;
SELECT t.as_user(13);
SELECT t.is(public.get_my_tab(t.sess(13, 'acc-a1-token-000001')) ->> 'endedReason', 'STAFF_RESET', 'antigo titular é avisado');
SELECT t.is((t.enter(14, 'acc-a1-token-000001')) ->> 'state', 'RESPONSIBLE', 'quem ler o QR depois assume como Responsável');
SELECT t.is((SELECT (public.get_my_tab(t.sess(14, 'acc-a1-token-000001')) -> 'me' ->> 'approved')::boolean), false, 'novo titular aguarda a equipe aprovar');
SELECT t.login('a0000000-0000-0000-0000-000000000009');
SELECT t.lives($$SELECT public.approve_session(t.sess(14, 'acc-a1-token-000001'))$$, 'equipe libera o novo titular');
SELECT t.as_user(15);
SELECT t.is(public.enter_table('acc-a1-token-000001', 'Pessoa 15', 'dev-15') ->> 'state', 'IN_USE', 'depois de assumida, mesa volta a "em uso"');
SELECT t.as_user(10);
SELECT t.is(public.enter_table('acc-a1-token-000001', 'Pessoa 10', 'dev-10') ->> 'state', 'GUEST', 'ex-Responsável segue na mesa como convidado (sessão preservada)');
SELECT t.login('a0000000-0000-0000-0000-000000000009');
SELECT t.lives($$SELECT public.staff_transfer_tab_holder(t.tabof('acc-a1-token-000001'), t.sess(14, 'acc-a1-token-000001'))$$, 'transferir para quem já é titular não quebra');
RESET ROLE;

-- ===== 9. fechar a conta encerra todas as sessões =====
SELECT t.ok((SELECT count(*) FROM public.tab_sessions WHERE tab_id = t.tabof('acc-a1-token-000001') AND ended_at IS NULL) >= 1, 'há sessões ativas antes de fechar');
SELECT set_config('t.tab1', t.tabof('acc-a1-token-000001')::text, false);
SELECT set_config('t.s14', t.sess(14, 'acc-a1-token-000001')::text, false);
SET ROLE authenticated; SELECT t.as_user(14); SELECT t.lives($$SELECT t.order_as(14, current_setting('t.s14')::uuid)$$, 'titular pede antes de fechar');
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.staff_request_bill(current_setting('t.tab1')::uuid);
RESET ROLE;
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id = current_setting('t.tab1')::uuid), 'BILL_REQUESTED', 'staff_request_bill muda para conta pedida');
SET ROLE authenticated; SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.close_tab(current_setting('t.tab1')::uuid, jsonb_build_array(jsonb_build_object('method','CAIXA','amount_cents', t.tab_total(current_setting('t.tab1')::uuid))));
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.tab_sessions WHERE tab_id = current_setting('t.tab1')::uuid AND ended_at IS NULL), 0::bigint, 'fechar a conta encerra todas as sessões');
SELECT t.is((SELECT count(*) FROM public.dining_tab_invites WHERE tab_id = current_setting('t.tab1')::uuid AND revoked_at IS NULL), 0::bigint, 'fechar a conta revoga os códigos');
SET ROLE authenticated; SELECT t.as_user(14);
SELECT t.is(public.get_my_tab(current_setting('t.s14')::uuid) ->> 'status', 'CLOSED', 'cliente ainda vê a conta encerrada');
SELECT t.throws($$SELECT t.order_as(14, current_setting('t.s14')::uuid)$$, 'TAB_CLOSED', 'depois de fechar ninguém pede');
SELECT t.is(t.enter(15, 'acc-a1-token-000001') ->> 'state', 'RESPONSIBLE', 'mesa livre de novo: próximo a ler vira Responsável');
RESET ROLE;

-- ===== 10. recusar =====
SET ROLE authenticated;
SELECT t.enter(16, 'acc-a3-token-000003');
SELECT t.login('a0000000-0000-0000-0000-000000000009');
SELECT t.lives($$SELECT public.reject_session(t.sess(16, 'acc-a3-token-000003'))$$, 'garçom recusa a pessoa');
RESET ROLE;
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id = (SELECT tab_id FROM public.tab_sessions WHERE id = t.sess(16, 'acc-a3-token-000003'))), 'CANCELLED', 'comanda vazia recusada é cancelada (mesa livre)');
SET ROLE authenticated; SELECT t.as_user(16);
SELECT t.is(public.get_my_tab(t.sess(16, 'acc-a3-token-000003')) ->> 'endedReason', 'REJECTED', 'cliente recusado é informado');
SELECT t.is(t.enter(17, 'acc-a3-token-000003') ->> 'state', 'RESPONSIBLE', 'mesa recusada fica livre para o verdadeiro cliente');
SELECT t.login('a0000000-0000-0000-0000-000000000009');
SELECT public.approve_session(t.sess(17, 'acc-a3-token-000003'));
SELECT t.throws($$SELECT public.reject_session(t.sess(17, 'acc-a3-token-000003'))$$, 'SESSION_EXPIRED', 'não recusa quem já foi liberado');
RESET ROLE;

-- ===== 11. garçom abre mesa e pede a conta; isolamento =====
SET ROLE authenticated; SELECT t.login('a0000000-0000-0000-0000-000000000009');
SELECT set_config('t.open', public.staff_open_tab((SELECT id FROM public.dining_tables WHERE qr_token = 'acc-a5-token-000005'))::text, false);
SELECT t.is((current_setting('t.open')::jsonb ->> 'existing')::boolean, false, 'garçom abre mesa livre');
SELECT t.is((public.staff_open_tab((SELECT id FROM public.dining_tables WHERE qr_token = 'acc-a5-token-000005')) ->> 'existing')::boolean, true, 'abrir de novo devolve a mesma comanda');
SELECT t.lives($$SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":2}]'::jsonb, gen_random_uuid(), NULL, (current_setting('t.open')::jsonb ->> 'tabId')::uuid)$$, 'garçom lança pedido na mesa aberta');
SELECT t.as_user(20);
SELECT t.throws($$SELECT public.staff_open_tab((SELECT id FROM public.dining_tables WHERE qr_token = 'acc-a6-token-000006'))$$, 'FORBIDDEN', 'cliente não abre mesa pelo garçom');
SELECT t.throws($$SELECT public.staff_request_bill((current_setting('t.open')::jsonb ->> 'tabId')::uuid)$$, 'FORBIDDEN', 'cliente não pede conta pelo garçom');
SELECT t.is(t.enter(21, 'acc-a5-token-000005') ->> 'state', 'IN_USE', 'mesa aberta pelo garçom aparece "em uso" para clientes');
SELECT t.login('b0000000-0000-0000-0000-000000000001');
SELECT t.throws($$SELECT public.staff_open_tab((SELECT id FROM public.dining_tables WHERE qr_token = 'acc-a5-token-000005'))$$, 'FORBIDDEN', 'outra loja não abre mesa daqui');
SELECT t.throws($$SELECT public.staff_request_bill((current_setting('t.open')::jsonb ->> 'tabId')::uuid)$$, 'FORBIDDEN', 'outra loja não pede conta daqui');
RESET ROLE;
SELECT t.ok((SELECT responsible_user_id IS NULL AND NOT holder_claimable FROM public.dining_tabs WHERE id = (current_setting('t.open')::jsonb ->> 'tabId')::uuid), 'mesa do garçom não é assumível por cliente');

-- ===== 12. sessão sobrevive a noites longas =====
SET ROLE authenticated; SELECT t.as_user(22);
SELECT set_config('t.long', t.enter(22, 'acc-a6-token-000006')::text, false);
RESET ROLE;
UPDATE public.tab_sessions SET approved_at = now() - interval '9 hours', approved_by = NULL, created_at = now() - interval '9 hours', expires_at = now() + interval '30 minutes' WHERE id = (current_setting('t.long')::jsonb ->> 'sessionId')::uuid;
SET ROLE authenticated; SELECT t.as_user(22);
SELECT t.lives($$SELECT t.order_as(22, (current_setting('t.long')::jsonb ->> 'sessionId')::uuid)$$, 'aprovação não vence em 6h: sessão liberada continua pedindo');
SELECT public.get_my_tab((current_setting('t.long')::jsonb ->> 'sessionId')::uuid);
RESET ROLE;
SELECT t.ok((SELECT expires_at > now() + interval '5 hours' FROM public.tab_sessions WHERE id = (current_setting('t.long')::jsonb ->> 'sessionId')::uuid), 'atividade renova a sessão (janela deslizante)');

-- ===== 13. modo comanda individual e aprovação desligada =====
UPDATE public.tenant_modules SET config = '{"mode":"INDIVIDUAL","salon_open":true,"release_required":false}'::jsonb WHERE tenant_id = :'A' AND module_key = 'dine_in';
SET ROLE authenticated;
SELECT t.is(t.enter(23, 'acc-a2-token-000002') ->> 'state', 'RESPONSIBLE', 'individual: cada pessoa abre a sua comanda');
SELECT t.is(t.enter(24, 'acc-a2-token-000002') ->> 'state', 'RESPONSIBLE', 'individual: segunda pessoa também abre a sua');
SELECT t.is((public.enter_table('acc-a2-token-000002', 'Pessoa 24', 'dev-24') ->> 'approved')::boolean, true, 'aprovação desligada: entra já liberado');
SELECT t.lives($$SELECT t.order_as(23, t.sess(23, 'acc-a2-token-000002'))$$, 'sem aprovação: pede direto');
RESET ROLE;
SELECT t.is((SELECT count(DISTINCT tab_id) FROM public.tab_sessions WHERE auth_user_id IN (t.uid(23), t.uid(24))), 2::bigint, 'individual: duas comandas distintas');
UPDATE public.tenant_modules SET config = '{"mode":"TABLE","salon_open":true,"release_required":true,"close_roles":["OWNER","MANAGER","CASHIER"]}'::jsonb WHERE tenant_id = :'A' AND module_key = 'dine_in';

-- ===== 14. pausa do QR vale para a entrada =====
SET ROLE authenticated; SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.set_dining_qr_pause(:'A'::uuid, NULL, true);
SELECT t.throws($$SELECT t.enter(25, 'acc-a4-token-000004')$$, 'QR_PAUSED', 'QR pausado: ninguém novo abre mesa');
SELECT t.is(t.enter(22, 'acc-a6-token-000006') ->> 'state', 'RESPONSIBLE', 'QR pausado: quem já está na mesa continua (restaura sessão)');
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT public.set_dining_qr_pause(:'A'::uuid, NULL, false);
RESET ROLE;

-- ===== 15. LGPD =====
UPDATE public.dining_tabs SET status = 'CLOSED', closed_at = now() - interval '200 days' WHERE id = current_setting('t.tab1')::uuid;
UPDATE public.tab_sessions SET approved_at = LEAST(approved_at, now() - interval '201 days'), expires_at = now() - interval '200 days', ended_at = now() - interval '200 days' WHERE tab_id = current_setting('t.tab1')::uuid;
UPDATE public.dining_tab_invites SET created_at = now() - interval '200 days' WHERE tab_id = current_setting('t.tab1')::uuid;
SELECT t.ok((SELECT responsible_user_id IS NOT NULL FROM public.dining_tabs WHERE id = current_setting('t.tab1')::uuid), 'antes: comanda antiga aponta para a conta');
SELECT public.anonymize_old_tab_sessions(90);
SELECT t.ok((SELECT responsible_user_id IS NULL FROM public.dining_tabs WHERE id = current_setting('t.tab1')::uuid), 'LGPD: vínculo com a conta removido após o prazo');
SELECT t.is((SELECT count(*) FROM public.dining_tab_invites WHERE tab_id = current_setting('t.tab1')::uuid), 0::bigint, 'LGPD: códigos antigos apagados');
SELECT t.ok((SELECT bool_and(display_name = 'Cliente') FROM public.tab_sessions WHERE tab_id = current_setting('t.tab1')::uuid), 'LGPD: nomes antigos anonimizados');
SELECT t.ok((SELECT count(*) FROM public.tab_access_events WHERE tab_id = current_setting('t.tab1')::uuid) > 3, 'trilha de acesso registrada');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.tab_access_events e WHERE e.details::text ~* '(phone|telefone|email|@)'), 'trilha não guarda telefone nem e-mail');
-- staff lê a trilha, cliente não
SET ROLE authenticated; SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.ok(t.visible($$SELECT id FROM public.tab_access_events$$) > 0, 'equipe lê a trilha da própria loja');
SELECT t.login('b0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible($$SELECT id FROM public.tab_access_events$$), 0::bigint, 'outra loja não lê a trilha');
SELECT t.as_user(10);
SELECT t.is(t.visible($$SELECT id FROM public.tab_access_events$$), 0::bigint, 'cliente não lê a trilha');
SELECT t.ok(t.visible($$SELECT id FROM public.dining_tab_invites$$) <= 0, 'cliente não lê códigos (nem pelas tabelas): sem privilégio ou zero linhas');
RESET ROLE;
