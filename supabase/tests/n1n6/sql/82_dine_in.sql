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
