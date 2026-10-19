-- Adicionais (issue 2): preço recalculado no servidor, min/max, opções de outra loja, snapshot, RLS.
RESET ROLE;
INSERT INTO public.tenant_modules (tenant_id, module_key, enabled) VALUES ('10000000-0000-0000-0000-00000000000a','addons',true), ('10000000-0000-0000-0000-00000000000a','delivery',true)
  ON CONFLICT (tenant_id, module_key) DO UPDATE SET enabled = true;
INSERT INTO public.product_option_groups (id, tenant_id, name, min_select, max_select) VALUES
  ('f1000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','Extras A',1,1),
  ('f1000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-00000000000a','Solto A',0,1),
  ('f1000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','Extras B',0,1);
INSERT INTO public.product_options (id, tenant_id, group_id, name, extra_price_cents) VALUES
  ('f2000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','f1000000-0000-0000-0000-0000000000a1','Gelo',300),
  ('f2000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-00000000000a','f1000000-0000-0000-0000-0000000000a1','Limão',500),
  ('f2000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-00000000000a','f1000000-0000-0000-0000-0000000000a2','Copo',100),
  ('f2000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','f1000000-0000-0000-0000-0000000000b1','Extra B',0);
INSERT INTO public.product_option_group_links (tenant_id, product_id, group_id) VALUES
  ('10000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000a5','f1000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-00000000000b','d0000000-0000-0000-0000-0000000000b1','f1000000-0000-0000-0000-0000000000b1');
SELECT t.throws($$INSERT INTO public.product_option_group_links (tenant_id, product_id, group_id) VALUES
  ('10000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000a1','f1000000-0000-0000-0000-0000000000b1')$$,
  'foreign key', 'grupo de outra loja não pode ser ligado a produto da loja A');

SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT t.is((public.process_checkout_atomic_v3('adega-a','Cliente Opc','(11) 97777-6666','Rua Y, 20',NULL,'PIX','DELIVERY',NULL,
  '[{"productId":"d0000000-0000-0000-0000-0000000000a5","quantity":2,"options":[{"group_id":"f1000000-0000-0000-0000-0000000000a1","option_id":"f2000000-0000-0000-0000-0000000000a1","qty":1,"extra_price_cents":0,"price":0}]}]')
  ->> 'subtotal')::numeric, 106.00, 'com adicional: 2 × (50 + 3) no servidor, preço enviado pelo cliente ignorado');
SELECT t.is((public.process_checkout_atomic_v2('adega-a','Cliente Opc','(11) 97777-6666','Rua Y, 20',NULL,'PIX','DELIVERY',NULL,
  '[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":3}]') ->> 'subtotal')::numeric, 30.00,
  'sem adicionais: produto sem grupo continua igual (3 × 10)');
SELECT t.throws($$SELECT public.process_checkout_atomic_v3('adega-a','C','(11) 97777-6666','Rua',NULL,'PIX','DELIVERY',NULL,
  '[{"productId":"d0000000-0000-0000-0000-0000000000a5","quantity":1,"unitPrice":1}]')$$, 'UNEXPECTED_FIELD', 'preço no item é recusado');
SELECT t.throws($$SELECT public.process_checkout_atomic_v3('adega-a','C','(11) 97777-6666','Rua',NULL,'PIX','DELIVERY',NULL,
  '[{"productId":"d0000000-0000-0000-0000-0000000000a5","quantity":1}]')$$, 'ADICIONAIS_MINIMO', 'mínimo obrigatório aplicado');
SELECT t.throws($$SELECT public.process_checkout_atomic_v3('adega-a','C','(11) 97777-6666','Rua',NULL,'PIX','DELIVERY',NULL,
  '[{"productId":"d0000000-0000-0000-0000-0000000000a5","quantity":1,"options":[{"group_id":"f1000000-0000-0000-0000-0000000000a1","option_id":"f2000000-0000-0000-0000-0000000000a1","qty":1},{"group_id":"f1000000-0000-0000-0000-0000000000a1","option_id":"f2000000-0000-0000-0000-0000000000a2","qty":1}]}]')$$,
  'ADICIONAIS_MAXIMO', 'máximo aplicado');
SELECT t.throws($$SELECT public.process_checkout_atomic_v3('adega-a','C','(11) 97777-6666','Rua',NULL,'PIX','DELIVERY',NULL,
  '[{"productId":"d0000000-0000-0000-0000-0000000000a5","quantity":1,"options":[{"group_id":"f1000000-0000-0000-0000-0000000000b1","option_id":"f2000000-0000-0000-0000-0000000000b1","qty":1}]}]')$$,
  'não pertence', 'opção de outra loja recusada');
SELECT t.throws($$SELECT public.process_checkout_atomic_v3('adega-a','C','(11) 97777-6666','Rua',NULL,'PIX','DELIVERY',NULL,
  '[{"productId":"d0000000-0000-0000-0000-0000000000a5","quantity":1,"options":[{"group_id":"f1000000-0000-0000-0000-0000000000a2","option_id":"f2000000-0000-0000-0000-0000000000a3","qty":1}]}]')$$,
  'não pertence', 'grupo não ligado ao produto recusado');
SELECT t.throws($$SELECT public.process_checkout_atomic_v3('adega-a','C','(11) 97777-6666','Rua',NULL,'PIX','DELIVERY',NULL,
  '[{"productId":"d0000000-0000-0000-0000-0000000000a5","quantity":1,"options":[{"group_id":"f1000000-0000-0000-0000-0000000000a1","option_id":"f2000000-0000-0000-0000-0000000000a3","qty":1}]}]')$$,
  'INDISPONIVEL', 'opção de outro grupo com group_id trocado recusada');
SELECT t.throws($$SELECT public.process_checkout_atomic_v3('adega-a','C','(11) 97777-6666','Rua',NULL,'PIX','DELIVERY',NULL,
  '[{"productId":"d0000000-0000-0000-0000-0000000000a5","quantity":1,"options":[{"group_id":"f1000000-0000-0000-0000-0000000000a1","option_id":"f2000000-0000-0000-0000-0000000000a1","qty":2}]}]')$$,
  'ADICIONAIS_(MAXIMO|REPETICAO)', 'qty acima do permitido recusada');
SELECT t.throws($$INSERT INTO public.product_options (tenant_id, group_id, name) VALUES ('10000000-0000-0000-0000-00000000000a','f1000000-0000-0000-0000-0000000000a1','Hack')$$,
  'row-level security|permission denied', 'cliente não cria opções');
SELECT t.is(t.visible($$SELECT 1 FROM public.order_item_options$$), 1::bigint, 'cliente vê só o snapshot do próprio pedido');
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.throws($$INSERT INTO public.product_option_groups (tenant_id, name) VALUES ('10000000-0000-0000-0000-00000000000b','Hack')$$,
  'row-level security', 'dono da loja A não cria grupo na loja B');
SELECT t.is(t.visible($$SELECT 1 FROM public.product_options WHERE tenant_id = '10000000-0000-0000-0000-00000000000b'$$), 0::bigint,
  'dono da loja A não lê opções da loja B (adicionais desligados em B)');
RESET ROLE;
SET ROLE anon;
SELECT t.throws($$INSERT INTO public.product_option_groups (tenant_id, name) VALUES ('10000000-0000-0000-0000-00000000000a','Hack')$$,
  'permission denied', 'anon não escreve');
SELECT t.is(t.visible($$SELECT 1 FROM public.product_options WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'$$), 2::bigint,
  'anon lê só opções ativas de grupos ligados a produtos ativos');
RESET ROLE;
SELECT t.is((SELECT string_agg(option_name_snapshot || ':' || unit_price_cents || ':' || qty, ',') FROM public.order_item_options), 'Gelo:300:1',
  'snapshot grava nome e preço da opção');
SELECT t.is((SELECT unit_price FROM public.order_items oi JOIN public.order_item_options x ON x.order_item_id = oi.id), 53.00::numeric,
  'preço unitário do item inclui o adicional');
