-- 2800: rótulos de mesa somente para equipe do próprio tenant, somente leitura.
SELECT t.ok(
  (SELECT prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc
   WHERE oid = 'public.get_dine_in_order_table_labels(uuid,uuid[])'::regprocedure),
  'get_dine_in_order_table_labels: SECURITY DEFINER, STABLE, search_path vazio'
);
SELECT t.ok(
  NOT has_function_privilege('anon', 'public.get_dine_in_order_table_labels(uuid,uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_dine_in_order_table_labels(uuid,uuid[])', 'EXECUTE'),
  'rótulos de mesa: anon não executa; authenticated executa'
);
SELECT set_config('t.lbl_orders',
  COALESCE((SELECT array_agg(id)::text FROM public.orders
            WHERE tenant_id = '10000000-0000-0000-0000-00000000000a' AND fulfillment_type = 'DINE_IN' AND tab_id IS NOT NULL), '{}'),
  false);
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.ok(
  (SELECT count(*) FROM public.get_dine_in_order_table_labels('10000000-0000-0000-0000-00000000000a', current_setting('t.lbl_orders')::uuid[]))
    = cardinality(current_setting('t.lbl_orders')::uuid[]),
  'dono recebe o rótulo de cada pedido de mesa do próprio tenant'
);
SELECT t.is(
  (SELECT count(*) FROM public.get_dine_in_order_table_labels('10000000-0000-0000-0000-00000000000a', ARRAY[gen_random_uuid()])),
  0::bigint, 'ids desconhecidos não retornam nada'
);
SELECT t.throws(
  format($$SELECT * FROM public.get_dine_in_order_table_labels('10000000-0000-0000-0000-00000000000b', %L::uuid[])$$, current_setting('t.lbl_orders')),
  'FORBIDDEN', 'equipe do tenant A não lê rótulos do tenant B'
);
SELECT t.is(
  (SELECT count(*) FROM public.get_dine_in_order_table_labels('10000000-0000-0000-0000-00000000000a',
     ARRAY(SELECT id FROM public.orders WHERE tenant_id <> '10000000-0000-0000-0000-00000000000a' LIMIT 50))),
  0::bigint, 'ids de pedidos de outro tenant não vazam pelo tenant próprio'
);
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT t.throws($$SELECT * FROM public.get_dine_in_order_table_labels('10000000-0000-0000-0000-00000000000a', '{}')$$,
  'FORBIDDEN', 'cliente não lê rótulos de mesa');
RESET ROLE;
