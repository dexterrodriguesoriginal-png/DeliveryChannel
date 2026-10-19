SELECT t.ok(to_regclass('public.dining_tables') IS NOT NULL, 'mesa QR criada');
SELECT t.ok(to_regclass('public.dining_tabs') IS NOT NULL, 'comandas criadas');
SELECT t.ok(to_regclass('public.tab_sessions') IS NOT NULL, 'sessões de mesa criadas');
SELECT t.ok(to_regclass('public.waiter_calls') IS NOT NULL, 'chamados de garçom criados');
SELECT t.ok(to_regclass('public.tab_payments') IS NOT NULL, 'pagamentos de comanda criados');
SELECT t.ok(to_regclass('public.tab_events') IS NOT NULL, 'auditoria de comanda criada');
SELECT t.ok((SELECT name = 'Garçom' FROM public.roles WHERE id = 'WAITER'), 'papel WAITER registrado');
SELECT t.ok(
  (SELECT bool_and(relrowsecurity) FROM pg_class
   WHERE oid IN ('public.dining_tables'::regclass, 'public.dining_tabs'::regclass,
                 'public.tab_sessions'::regclass, 'public.waiter_calls'::regclass,
                 'public.tab_payments'::regclass, 'public.tab_events'::regclass)),
  'RLS ativado em todas as tabelas de salão'
);
SELECT t.ok(
  NOT has_function_privilege('anon', 'public._normalize_product_option_selections(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._normalize_product_option_selections(jsonb)', 'EXECUTE'),
  'helper interno de normalização não é executável por clientes'
);
SELECT t.ok(
  has_function_privilege('anon', 'public.submit_round(jsonb,uuid,uuid,uuid)', 'EXECUTE'),
  'RPC de rodada possui uma assinatura customer-facing'
);
SELECT t.ok(
  NOT has_function_privilege('anon', 'public._dine_in_config(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._dine_in_config(uuid)', 'EXECUTE'),
  'helper interno do salão não é executável por clientes'
);

INSERT INTO public.dining_tables (tenant_id, label, qr_token)
VALUES
  ('10000000-0000-0000-0000-00000000000a', 'Mesa teste A', 'dine-in-test-a'),
  ('10000000-0000-0000-0000-00000000000b', 'Mesa teste B', 'dine-in-test-b');

INSERT INTO public.product_option_group_links (tenant_id, product_id, group_id)
VALUES ('10000000-0000-0000-0000-00000000000a',
        'd0000000-0000-0000-0000-0000000000a5',
        'f1000000-0000-0000-0000-0000000000a2')
ON CONFLICT (product_id, group_id) DO NOTHING;

DELETE FROM public.security_rate_limits;
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible($$SELECT id FROM public.dining_tables$$), 1::bigint,
  'equipe da loja A só enxerga suas mesas');
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT t.is(t.visible($$SELECT id FROM public.dining_tables$$), 0::bigint,
  'cliente não consulta diretamente mesas nem QR secretos');
RESET ROLE;
SET ROLE anon;
SELECT t.is((public.resolve_table_qr('dine-in-test-a') ->> 'available')::boolean, false,
  'QR não disponibiliza o salão quando o módulo está desligado');
RESET ROLE;
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000008');
DO $same_product_different_options$
DECLARE
  v_result jsonb;
  v_order uuid;
BEGIN
  v_result := public.process_checkout_atomic_v3(
    'adega-a', 'Cliente Opções', '(11) 97777-6666', 'Rua Y, 20', NULL, 'PIX', 'DELIVERY', NULL,
    jsonb_build_array(
      jsonb_build_object('productId', 'd0000000-0000-0000-0000-0000000000a5', 'quantity', 1,
        'options', jsonb_build_array(
          jsonb_build_object('group_id', 'f1000000-0000-0000-0000-0000000000a1',
            'option_id', 'f2000000-0000-0000-0000-0000000000a1', 'qty', 1),
          jsonb_build_object('group_id', 'f1000000-0000-0000-0000-0000000000a2',
            'option_id', 'f2000000-0000-0000-0000-0000000000a3', 'qty', 1))),
      jsonb_build_object('productId', 'd0000000-0000-0000-0000-0000000000a5', 'quantity', 1,
        'options', jsonb_build_array(
          jsonb_build_object('group_id', 'f1000000-0000-0000-0000-0000000000a1',
            'option_id', 'f2000000-0000-0000-0000-0000000000a2', 'qty', 1)))
    )
  );
  v_order := (v_result ->> 'order_id')::uuid;
  PERFORM t.is((SELECT count(*) FROM public.order_items WHERE order_id = v_order), 2::bigint,
    'um produto com duas seleções distintas gera duas linhas');
  PERFORM t.is((SELECT count(DISTINCT option_name_snapshot) FROM public.order_item_options x
    JOIN public.order_items oi ON oi.id = x.order_item_id WHERE oi.order_id = v_order), 3::bigint,
    'cada linha mantém seus próprios adicionais selecionados');
  PERFORM t.is((SELECT subtotal FROM public.orders WHERE id = v_order), 109.00::numeric,
    'preço de ambas as variantes é recalculado no servidor');
END
$same_product_different_options$;

DO $same_options_reordered$
DECLARE
  v_result jsonb;
  v_order uuid;
BEGIN
  v_result := public.process_checkout_atomic_v3(
    'adega-a', 'Cliente Ordem', '(11) 97777-6666', 'Rua Y, 20', NULL, 'PIX', 'DELIVERY', NULL,
    jsonb_build_array(
      jsonb_build_object('productId', 'd0000000-0000-0000-0000-0000000000a5', 'quantity', 1,
        'options', jsonb_build_array(
          jsonb_build_object('group_id', 'f1000000-0000-0000-0000-0000000000a1',
            'option_id', 'f2000000-0000-0000-0000-0000000000a1', 'qty', 1),
          jsonb_build_object('group_id', 'f1000000-0000-0000-0000-0000000000a2',
            'option_id', 'f2000000-0000-0000-0000-0000000000a3', 'qty', 1))),
      jsonb_build_object('productId', 'd0000000-0000-0000-0000-0000000000a5', 'quantity', 1,
        'options', jsonb_build_array(
          jsonb_build_object('group_id', 'f1000000-0000-0000-0000-0000000000a2',
            'option_id', 'f2000000-0000-0000-0000-0000000000a3', 'qty', 1),
          jsonb_build_object('group_id', 'f1000000-0000-0000-0000-0000000000a1',
            'option_id', 'f2000000-0000-0000-0000-0000000000a1', 'qty', 1)))
    )
  );
  v_order := (v_result ->> 'order_id')::uuid;
  PERFORM t.is((SELECT count(*) FROM public.order_items WHERE order_id = v_order), 1::bigint,
    'a mesma seleção com ordem diferente é agrupada em uma linha');
  PERFORM t.is((SELECT quantity FROM public.order_items WHERE order_id = v_order), 2,
    'quantidades de seleções equivalentes são somadas');
  PERFORM t.is((SELECT count(*) FROM public.order_item_options x
    JOIN public.order_items oi ON oi.id = x.order_item_id WHERE oi.order_id = v_order), 2::bigint,
    'snapshot conserva ambos os adicionais na seleção normalizada');
END
$same_options_reordered$;
RESET ROLE;

-- Fluxo de mesa: liberação, rodada, idempotência, sequestro de comanda, taxa opcional, fechamento.
RESET ROLE;
DELETE FROM public.security_rate_limits;
RESET ROLE;
INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, config) VALUES
  ('10000000-0000-0000-0000-00000000000a', 'dine_in', true, '{"mode":"TABLE","salon_open":true}'),
  ('10000000-0000-0000-0000-00000000000a', 'service_fee', true, '{"percent":10}')
ON CONFLICT (tenant_id, module_key) DO UPDATE SET enabled = true, config = EXCLUDED.config;
SET ROLE anon;
SELECT t.is(public.resolve_table_qr('dine-in-test-a') ? 'tenantId', false, 'QR não expõe tenantId');
RESET ROLE;
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT set_config('t.s8', public.open_or_join_tab('dine-in-test-a', 'Ana', 'dev-8') ->> 'sessionId', false);
SELECT set_config('t.tab', (SELECT public.get_my_tab(current_setting('t.s8')::uuid) ->> 'tabId'), false);
SELECT t.throws(format($$SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]', gen_random_uuid(), %L)$$, current_setting('t.s8')),
  'SESSION_NOT_APPROVED', 'primeira rodada espera o garçom liberar');
SELECT t.login('a0000000-0000-0000-0000-000000000007');
SELECT t.throws(format($$SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]', gen_random_uuid(), NULL, %L)$$, current_setting('t.tab')),
  'FORBIDDEN', 'outro cliente não envia rodada pela comanda (tab_id) alheia');
SELECT t.throws(format($$SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]', gen_random_uuid(), %L)$$, current_setting('t.s8')),
  'SESSION_INVALID', 'outro cliente não usa a sessão alheia');
SELECT t.throws(format($$SELECT public.get_my_tab(%L)$$, current_setting('t.s8')), 'TAB_NOT_FOUND', 'outro cliente não lê a comanda alheia');
SELECT t.throws(format($$SELECT public.close_tab(%L, '[{"method":"CASH","amount_cents":1}]')$$, current_setting('t.tab')),
  'FORBIDDEN', 'cliente não encerra conta');
SELECT t.throws(format($$SELECT public.approve_session(%L)$$, current_setting('t.s8')), 'FORBIDDEN', 'cliente não libera sessão');
SELECT t.login('a0000000-0000-0000-0000-000000000003');
SELECT t.throws(format($$SELECT public.close_tab(%L, '[{"method":"CASH","amount_cents":1}]')$$, current_setting('t.tab')),
  'FORBIDDEN', 'OPERATOR não encerra conta');
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.lives(format($$SELECT public.approve_session(%L)$$, current_setting('t.s8')), 'dono libera a sessão');
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT set_config('t.k1', gen_random_uuid()::text, false);
SELECT set_config('t.r1', public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":3}]', current_setting('t.k1')::uuid, current_setting('t.s8')::uuid)::text, false);
SELECT t.is((current_setting('t.r1')::jsonb ->> 'subtotal')::numeric, 30.00, 'rodada com preço do servidor (3 × 10)');
SELECT t.is((public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":3}]', current_setting('t.k1')::uuid, current_setting('t.s8')::uuid) ->> 'replayed')::boolean,
  true, 'mesma chave não duplica a rodada');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.orders WHERE tab_id = current_setting('t.tab')::uuid), 1::bigint, 'uma rodada gravada');
SELECT t.is((SELECT delivery_fee FROM public.orders WHERE tab_id = current_setting('t.tab')::uuid), 0.00::numeric, 'sem taxa de entrega na mesa');
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.throws(format($$SELECT public.close_tab(%L, '[{"method":"PIX","amount_cents":3000}]')$$, current_setting('t.tab')),
  'PAYMENT_TOTAL_MISMATCH', 'taxa de 10%% é cobrada por padrão (33,00)');
SELECT t.lives(format($$SELECT public.remove_service_fee(%L, 'cliente pediu')$$, current_setting('t.tab')), 'taxa opcional removida');
SELECT t.lives(format($$SELECT public.close_tab(%L, '[{"method":"CASH","amount_cents":3000,"change_given_cents":2000}]')$$, current_setting('t.tab')), 'caixa encerra sem taxa (30,00)');
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT t.throws(format($$SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]', gen_random_uuid(), %L)$$, current_setting('t.s8')),
  'TAB_CLOSED', 'conta encerrada bloqueia novos pedidos');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.tab_events WHERE tab_id = current_setting('t.tab')::uuid AND event_type = 'SERVICE_FEE_REMOVED'), 1::bigint, 'remoção da taxa auditada');
