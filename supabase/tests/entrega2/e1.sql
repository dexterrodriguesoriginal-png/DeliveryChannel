-- E1: ranking e autorização executados no PostgreSQL real, sem dados pessoais públicos.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set MANAGER 'a0000000-0000-0000-0000-000000000002'
\set CLIENT 'a0000000-0000-0000-0000-000000000007'
\set OWNER_B 'b0000000-0000-0000-0000-000000000001'
RESET ROLE;
SELECT t.login(NULL);
SELECT t.ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid=ANY(ARRAY['public.upsell_settings'::regclass,'public.upsell_pins'::regclass,'public.upsell_rank_cache'::regclass,'public.upsell_offers'::regclass,'public.upsell_metrics_daily'::regclass,'public.upsell_conversions'::regclass])),'E1: todas as novas tabelas têm RLS');
SELECT t.ok(NOT has_table_privilege('anon','public.upsell_offers','SELECT') AND NOT has_table_privilege('authenticated','public.upsell_offers','SELECT') AND NOT has_table_privilege('service_role','public.upsell_offers','SELECT'),'E1: tokens opacos não podem ser enumerados');
SELECT t.ok(NOT has_function_privilege('anon','public._upsell_rank(uuid,uuid,uuid[],numeric,text,timestamptz)','EXECUTE'),'E1: helper interno não é RPC pública');
SET ROLE authenticated;
SELECT t.login(:'OWNER');
SELECT t.is(public.get_upsell_settings(:'A'),' {"enabled":false}'::jsonb,'E1: opt-in desligado por padrão');
SELECT t.is(public.set_upsell_enabled(:'A',true),'{"enabled":true}'::jsonb,'E1: dono ativa sugestões');
RESET ROLE;
SELECT t.login(NULL);
-- Catálogo isolado, com uma categoria de prato e duas complementares.
INSERT INTO public.categories(id,tenant_id,name,display_order,is_active) VALUES
 ('e1000000-0000-0000-0000-000000000001',:'A','Pratos',0,true),
 ('e1000000-0000-0000-0000-000000000002',:'A','Bebidas',1,true),
 ('e1000000-0000-0000-0000-000000000003',:'A','Sobremesas',2,true);
INSERT INTO public.products(id,tenant_id,category_id,name,image_url,price,stock_quantity,is_active) VALUES
 ('e1100000-0000-0000-0000-000000000001',:'A','e1000000-0000-0000-0000-000000000001','Prato da casa','/prato.png',50,100,true),
 ('e1100000-0000-0000-0000-000000000002',:'A','e1000000-0000-0000-0000-000000000002','Suco natural','/suco.png',10,100,true),
 ('e1100000-0000-0000-0000-000000000003',:'A','e1000000-0000-0000-0000-000000000003','Doce da casa','/doce.png',8,100,true),
 ('e1100000-0000-0000-0000-000000000004',:'A','e1000000-0000-0000-0000-000000000002','Café da manhã','/cafe.png',5,100,true),
 ('e1100000-0000-0000-0000-000000000005',:'A','e1000000-0000-0000-0000-000000000001','Prato pequeno','/prato2.png',12,100,true),
 ('e1100000-0000-0000-0000-000000000006',:'A','e1000000-0000-0000-0000-000000000002','Produto caro','/caro.png',80,100,true),
 ('e1100000-0000-0000-0000-000000000007',:'A','e1000000-0000-0000-0000-000000000002','Inativo','/inativo.png',5,100,false),
 ('e1100000-0000-0000-0000-000000000008',:'A','e1000000-0000-0000-0000-000000000002','Sem estoque','/zero.png',5,0,true),
 ('e1100000-0000-0000-0000-000000000009',:'B',NULL,'Produto outra loja','/outra.png',2,100,true),
 ('e1100000-0000-0000-0000-000000000010',:'A','e1000000-0000-0000-0000-000000000002','Água bloqueada','/bloqueio.png',3,100,true),
 ('e1100000-0000-0000-0000-000000000011',:'A','e1000000-0000-0000-0000-000000000001','Novo prato','/novoprato.png',50,100,true);
\set SRC 'e1100000-0000-0000-0000-000000000001'
\set DRINK 'e1100000-0000-0000-0000-000000000002'
\set DESSERT 'e1100000-0000-0000-0000-000000000003'
\set COFFEE 'e1100000-0000-0000-0000-000000000004'
\set BLOCKED 'e1100000-0000-0000-0000-000000000010'
\set NEW_SRC 'e1100000-0000-0000-0000-000000000011'
SELECT format('[{"productId":"%s","quantity":1}]',:'SRC') AS cart \gset
INSERT INTO public.stock_blocks(tenant_id,product_id,location_id,quantity,created_by,status,reason)
 SELECT :'A',:'BLOCKED',public._stock_default_location(:'A'),100,:'OWNER','ACTIVE','Fixture de bloqueio';
SELECT t.ok(NOT public._upsell_available((SELECT p FROM public.products p WHERE id=:'BLOCKED'),now()),'E1: saldo bloqueado não é estoque vendável');
SET ROLE authenticated;
SELECT t.login(:'OWNER_B');
SELECT t.throws(format('SELECT public.set_upsell_enabled(%L,true)',:'A'),'FORBIDDEN','E1: dono de outra loja não altera sugestões');
SELECT t.throws(format('SELECT public.get_upsell_stats(%L)',:'A'),'FORBIDDEN','E1: estatísticas não cruzam lojas');
SELECT t.login(:'CLIENT');
SELECT t.throws(format('SELECT public.get_upsell_settings(%L)',:'A'),'FORBIDDEN','E1: cliente não acessa administração');
SELECT t.throws(format('SELECT public.set_upsell_pins(%L,%L,ARRAY[%L]::uuid[])',:'A',:'SRC',:'DRINK'),'FORBIDDEN','E1: cliente não fixa sugestões');
SELECT t.login(:'OWNER');
SELECT t.throws(format('SELECT public.set_upsell_pins(%L,%L,ARRAY[%L]::uuid[])',:'A',:'SRC','e1100000-0000-0000-0000-000000000009'),'UPSELL_INVALID','E1: pin de outra loja recusado no servidor');
SELECT t.throws(format('SELECT public.set_upsell_pins(%L,%L,ARRAY[%L,%L]::uuid[])',:'A',:'SRC',:'DRINK',:'DRINK'),'UPSELL_INVALID','E1: pins duplicados recusados');
SELECT t.throws(format('SELECT public.set_upsell_pins(%L,%L,ARRAY[%L]::uuid[])',:'A',:'SRC',:'SRC'),'UPSELL_INVALID','E1: produto não sugere a si próprio');
SELECT public.set_upsell_pins(:'A',:'SRC',ARRAY[:'COFFEE']::uuid[]);
SELECT t.is(public.get_upsell_pins(:'A',:'SRC'),jsonb_build_object('productIds',jsonb_build_array(:'COFFEE')),'E1: pins persistem na ordem do dono');
RESET ROLE;
SELECT t.login(NULL);
SET ROLE anon;
SELECT public.recommend_upsell('adega-a',:'SRC',:'cart','DINE_IN') AS cold \gset
SELECT t.is((:'cold'::jsonb->'suggestions'->0->>'productId'),:'COFFEE','E1: pin elegível é primeiro mesmo em cold start');
SELECT t.ok(jsonb_array_length(:'cold'::jsonb->'suggestions') BETWEEN 1 AND 3,'E1: cold start retorna até três sugestões reais');
SELECT t.ok((SELECT count(*)=count(DISTINCT x->>'productId') FROM jsonb_array_elements(:'cold'::jsonb->'suggestions') x),'E1: ranking não duplica produtos');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(:'cold'::jsonb->'suggestions') x WHERE x->>'productId'=ANY(ARRAY[:'SRC','e1100000-0000-0000-0000-000000000006','e1100000-0000-0000-0000-000000000007','e1100000-0000-0000-0000-000000000008','e1100000-0000-0000-0000-000000000009',:'BLOCKED'])),'E1: exclui sacola, caro, inativo, sem estoque, bloqueado e outra loja');
SELECT t.ok((SELECT bool_and(k IN('offerToken','suggestions')) FROM jsonb_object_keys(:'cold') k) AND (SELECT bool_and(k IN('productId','reason')) FROM jsonb_array_elements(:'cold'::jsonb->'suggestions') x CROSS JOIN LATERAL jsonb_object_keys(x) k),'E1: payload público só possui campos públicos');
SELECT t.throws(format('SELECT public.recommend_upsell(%L,%L,%L,%L)','adega-a',:'SRC','[{"productId":"e1100000-0000-0000-0000-000000000009","quantity":1}]','DELIVERY'),'UPSELL_INVALID','E1: cliente não força produto de outra loja');
SELECT t.throws(format('SELECT public.recommend_upsell(%L,%L,%L,%L)','adega-a',:'SRC','[{"productId":"e1100000-0000-0000-0000-000000000001","quantity":999}]','DELIVERY'),'UPSELL_INVALID','E1: quantidade não pode inflar orçamento arbitrariamente');
SELECT t.throws(format('SELECT public.recommend_upsell(%L,%L,%L,%L)','adega-a',:'SRC',:'cart','INTERNAL'),'UPSELL_INVALID','E1: canal arbitrário recusado');
SELECT t.ok(NOT public.accept_upsell((:'cold'::jsonb->>'offerToken')::uuid,:'COFFEE'),'E1: aceite sem impressão não altera métricas');
SELECT t.ok(public.record_upsell_impression((:'cold'::jsonb->>'offerToken')::uuid),'E1: impressão vinculada a oferta opaca emitida');
SELECT t.ok(public.record_upsell_impression((:'cold'::jsonb->>'offerToken')::uuid),'E1: repetir impressão é idempotente');
SELECT t.ok(public.accept_upsell((:'cold'::jsonb->>'offerToken')::uuid,:'COFFEE') AND public.accept_upsell((:'cold'::jsonb->>'offerToken')::uuid,:'COFFEE'),'E1: aceite repetido é idempotente');
SELECT t.ok(NOT public.accept_upsell((:'cold'::jsonb->>'offerToken')::uuid,:'SRC') AND NOT public.record_upsell_impression(gen_random_uuid()),'E1: produto não emitido e token inventado não registram eventos');
RESET ROLE;
SELECT t.login(NULL);
SELECT t.is((SELECT accepts FROM public.upsell_metrics_daily WHERE source_product_id=:'SRC' AND product_id=:'COFFEE'),1::bigint,'E1: repetição de clique não infla aceite');
SELECT t.is((SELECT impressions FROM public.upsell_metrics_daily WHERE source_product_id=:'SRC' AND product_id=:'COFFEE'),1::bigint,'E1: repetição de render não infla impressão');

CREATE FUNCTION t.e1_order(p_products uuid[],p_when timestamptz DEFAULT now(),p_status text DEFAULT 'DELIVERED',p_payment text DEFAULT 'PAID',p_customer uuid DEFAULT NULL,p_channel text DEFAULT 'DELIVERY') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_order_id uuid; total numeric;
BEGIN
 SELECT sum(price) INTO total FROM public.products WHERE products.id=ANY(p_products);
 INSERT INTO public.orders(tenant_id,customer_id,customer_name,customer_phone,delivery_address,subtotal,total_amount,payment_method,payment_status,fulfillment_type,status,created_at)
 VALUES('10000000-0000-0000-0000-00000000000a',p_customer,'Cliente teste','11999990000','Rua Teste',total,total,'CASH',p_payment,p_channel,p_status,p_when) RETURNING orders.id INTO v_order_id;
 INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price)
 SELECT v_order_id,p.id,p.name,1,p.price,p.price FROM public.products p WHERE p.id=ANY(p_products);
 RETURN v_order_id;
END $$;
-- Seis pares fortes, três pares menores, duas ocorrências abaixo do suporte mínimo.
SELECT t.e1_order(ARRAY[:'SRC',:'DRINK']::uuid[]) FROM generate_series(1,6);
SELECT t.e1_order(ARRAY[:'SRC',:'DESSERT']::uuid[]) FROM generate_series(1,3);
SELECT t.e1_order(ARRAY[:'DESSERT']::uuid[]) FROM generate_series(1,10);
SELECT t.e1_order(ARRAY[:'SRC',:'COFFEE']::uuid[]) FROM generate_series(1,2);
SELECT t.e1_order(ARRAY[:'SRC',:'COFFEE']::uuid[],now()-interval '91 days');
SELECT t.e1_order(ARRAY[:'SRC',:'COFFEE']::uuid[],now(),'CANCELLED','PAID');
SELECT t.e1_order(ARRAY[:'SRC',:'COFFEE']::uuid[],now(),'PENDING','PENDING');
UPDATE public.upsell_rank_cache SET refreshed_at=now()-interval '61 seconds' WHERE tenant_id=:'A';
SELECT public._upsell_refresh_cache(:'A',now());
SELECT t.ok((SELECT (p->>'n')::integer=2 FROM public.upsell_rank_cache c CROSS JOIN LATERAL jsonb_array_elements(c.product_stats) p WHERE c.tenant_id=:'A' AND p->>'product_id'=:'COFFEE'),'E1: cache exclui além de 90 dias, cancelados e não pagos/não entregues');
SET ROLE authenticated;
SELECT t.login(:'OWNER');
SELECT public.set_upsell_pins(:'A',:'SRC','{}');
RESET ROLE;
SELECT t.login(NULL);
SELECT t.is((SELECT product_id::text FROM public._upsell_rank(:'A',:'SRC',ARRAY[:'SRC']::uuid[],50,'DELIVERY',now()) LIMIT 1),:'DRINK','E1: confiança/lift com suporte suficiente supera venda avulsa');
SELECT t.is((SELECT reason FROM public._upsell_rank(:'A',:'SRC',ARRAY[:'SRC']::uuid[],50,'DELIVERY',now()) WHERE product_id=:'COFFEE'),'Para completar seu pedido','E1: coocorrência com suporte menor que três não afirma par frequente');
-- O teste de popularidade fixa a tarde para isolar a regra do bônus matinal de café.
SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date + time '15:00') AT TIME ZONE 'America/Sao_Paulo' AS afternoon \gset
SELECT t.is((SELECT product_id::text FROM public._upsell_rank(:'A',:'NEW_SRC',ARRAY[:'NEW_SRC']::uuid[],50,'DELIVERY',:'afternoon'::timestamptz) LIMIT 1),:'DESSERT','E1: cold start do produto usa bestseller complementar da loja');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM public._upsell_rank(:'A',:'SRC',ARRAY[:'SRC',:'DRINK']::uuid[],60,'DELIVERY',now()) WHERE product_id=:'DRINK'),'E1: produto já na sacola nunca é sugerido');
INSERT INTO public.upsell_metrics_daily(tenant_id,day,source_product_id,product_id,impressions,accepts)
 VALUES(:'A',(now() AT TIME ZONE 'America/Sao_Paulo')::date,:'SRC',:'DRINK',100,0)
 ON CONFLICT(tenant_id,day,source_product_id,product_id) DO UPDATE SET impressions=100,accepts=0;
SELECT t.is((SELECT product_id::text FROM public._upsell_rank(:'A',:'SRC',ARRAY[:'SRC']::uuid[],50,'DELIVERY',now()) LIMIT 1),:'DESSERT','E1: sugestão repetidamente ignorada perde posição');
-- Alterações de estoque são lidas ao vivo, sem esperar TTL do cache.
INSERT INTO public.stock_blocks(tenant_id,product_id,location_id,quantity,created_by,status,reason)
 SELECT :'A',:'DESSERT',public._stock_default_location(:'A'),100,:'OWNER','ACTIVE','Fixture sem saldo';
SELECT t.ok(NOT EXISTS(SELECT 1 FROM public._upsell_rank(:'A',:'SRC',ARRAY[:'SRC']::uuid[],50,'DELIVERY',now()) WHERE product_id=:'DESSERT'),'E1: estoque bloqueado após cache some imediatamente');
UPDATE public.stock_blocks SET status='RELEASED' WHERE product_id=:'DESSERT';
-- Ofertas assinadas pela sessão real não podem ser usadas por outra conta.
SET ROLE authenticated;
SELECT t.login(:'CLIENT');
SELECT public.recommend_upsell('adega-a',:'SRC',:'cart','DELIVERY') AS owned_offer \gset
SELECT t.ok(public.record_upsell_impression((:'owned_offer'::jsonb->>'offerToken')::uuid),'E1: própria conta pode registrar a impressão');
SELECT t.login(:'OWNER_B');
SELECT t.ok(NOT public.accept_upsell((:'owned_offer'::jsonb->>'offerToken')::uuid,(:'owned_offer'::jsonb->'suggestions'->0->>'productId')::uuid),'E1: token de conta real é vinculado à própria identidade');
SELECT t.login(:'CLIENT');
SELECT t.ok(public.accept_upsell((:'owned_offer'::jsonb->>'offerToken')::uuid,(:'owned_offer'::jsonb->'suggestions'->0->>'productId')::uuid),'E1: conta de origem aceita o produto');
RESET ROLE;
SELECT t.login(NULL);
INSERT INTO public.customers(id,tenant_id,user_id,name,phone,email) VALUES
 ('e1c00000-0000-0000-0000-000000000001',:'A',:'CLIENT','Cliente próprio','11988880000','teste-proprio@example.invalid')
 ON CONFLICT DO NOTHING;
SELECT id AS own_customer FROM public.customers WHERE tenant_id=:'A' AND user_id=:'CLIENT' \gset
SELECT t.e1_order(ARRAY[:'SRC',(:'owned_offer'::jsonb->'suggestions'->0->>'productId')]::uuid[],now(),'PENDING','PENDING',:'own_customer') AS own_order \gset
SET ROLE authenticated;
SELECT t.login(:'OWNER_B');
SELECT t.is(public.record_upsell_conversion((:'owned_offer'::jsonb->>'offerToken')::uuid,:'own_order'),0,'E1: outro cliente não atribui venda ao pedido alheio');
SELECT t.login(:'CLIENT');
SELECT t.is(public.record_upsell_conversion((:'owned_offer'::jsonb->>'offerToken')::uuid,:'own_order'),1,'E1: atribui somente item aceito realmente presente no próprio pedido');
SELECT t.is(public.record_upsell_conversion((:'owned_offer'::jsonb->>'offerToken')::uuid,:'own_order'),0,'E1: repetição da atribuição não duplica venda');
SELECT t.login(:'OWNER');
SELECT t.is((public.get_upsell_stats(:'A')->>'itemsSold')::integer,0,'E1: aceite e pedido pendente não contam como item vendido');
RESET ROLE;
SELECT t.login(NULL);
UPDATE public.orders SET status='DELIVERED' WHERE id=:'own_order';
SELECT t.e1_order(ARRAY[:'SRC',(:'owned_offer'::jsonb->'suggestions'->0->>'productId')]::uuid[],now(),'DELIVERED','PAID',:'own_customer') AS second_order \gset
SET ROLE authenticated;
SELECT t.login(:'CLIENT');
SELECT t.is(public.record_upsell_conversion((:'owned_offer'::jsonb->>'offerToken')::uuid,:'second_order'),0,'E1: mesma oferta não pode atribuir múltiplos pedidos');
SELECT t.ok(NOT public.accept_upsell((:'owned_offer'::jsonb->>'offerToken')::uuid,(:'owned_offer'::jsonb->'suggestions'->0->>'productId')::uuid),'E1: oferta já vinculada não aceita novos itens retroativamente');
SELECT t.login(:'OWNER');
SELECT t.is((public.get_upsell_stats(:'A')->>'itemsSold')::integer,1,'E1: entrega efetiva passa a contar uma unidade');
SELECT t.is((public.get_upsell_stats(:'A')->>'revenue')::numeric,(SELECT price FROM public.products WHERE id=(:'owned_offer'::jsonb->'suggestions'->0->>'productId')::uuid),'E1: receita usa preço persistido no pedido, não valor do cliente');
SELECT t.ok((public.get_upsell_stats(:'A')->>'acceptanceRate')::numeric BETWEEN 0 AND 1,'E1: taxa de aceitação é agregada');
RESET ROLE;
SELECT t.login(NULL);
UPDATE public.orders SET payment_status='REFUNDED' WHERE id=:'own_order';
SET ROLE authenticated;
SELECT t.login(:'OWNER');
SELECT t.is((public.get_upsell_stats(:'A')->>'itemsSold')::integer,0,'E1: reembolso deixa de contar como venda');
RESET ROLE;
SELECT t.login(NULL);
-- Não aceita registrar oferta retroativamente sobre pedido anterior ao aceite.
SET ROLE anon;
SELECT public.recommend_upsell('adega-a',:'SRC',:'cart','TOTEM') AS late_offer \gset
SELECT public.record_upsell_impression((:'late_offer'::jsonb->>'offerToken')::uuid);
RESET ROLE;
SELECT t.login(NULL);
SELECT t.e1_order(ARRAY[:'SRC',(:'late_offer'::jsonb->'suggestions'->0->>'productId')]::uuid[],now(),'DELIVERED','PAID',:'own_customer') AS prior_order \gset
SELECT pg_sleep(0.005);
SET ROLE anon;
SELECT public.accept_upsell((:'late_offer'::jsonb->>'offerToken')::uuid,(:'late_offer'::jsonb->'suggestions'->0->>'productId')::uuid);
RESET ROLE;
SET ROLE authenticated;
SELECT t.login(:'CLIENT');
SELECT t.is(public.record_upsell_conversion((:'late_offer'::jsonb->>'offerToken')::uuid,:'prior_order'),0,'E1: aceite posterior ao pedido não cria atribuição retroativa');
RESET ROLE;
SELECT t.login(NULL);
-- Oferta anônima pode seguir a sacola até o cadastro, sem armazenar identidade.
SET ROLE anon;
SELECT public.recommend_upsell('adega-a',:'SRC',:'cart','DELIVERY') AS guest_offer \gset
SELECT public.record_upsell_impression((:'guest_offer'::jsonb->>'offerToken')::uuid);
SELECT public.accept_upsell((:'guest_offer'::jsonb->>'offerToken')::uuid,(:'guest_offer'::jsonb->'suggestions'->0->>'productId')::uuid);
RESET ROLE;
SELECT t.login(NULL);
SELECT t.e1_order(ARRAY[:'SRC',(:'guest_offer'::jsonb->'suggestions'->0->>'productId')]::uuid[],now(),'DELIVERED','PAID',:'own_customer') AS guest_order \gset
SET ROLE authenticated;
SELECT t.login(:'CLIENT');
SELECT t.is(public.record_upsell_conversion((:'guest_offer'::jsonb->>'offerToken')::uuid,:'guest_order'),1,'E1: sacola anônima mantém atribuição após login no próprio pedido');
SELECT t.login(:'MANAGER');
SELECT t.ok(public.get_upsell_stats(:'A') ? 'topPairs','E1: gerente ativo vê estatísticas agregadas da própria loja');
RESET ROLE;
SELECT t.login(NULL);
UPDATE public.tenant_users SET status='INACTIVE' WHERE user_id=:'MANAGER' AND tenant_id=:'A';
SET ROLE authenticated;
SELECT t.login(:'MANAGER');
SELECT t.throws(format('SELECT public.set_upsell_enabled(%L,false)',:'A'),'FORBIDDEN','E1: revogar vínculo bloqueia imediatamente o gerenciamento');
RESET ROLE;
SELECT t.login(NULL);
UPDATE public.tenant_users SET status='ACTIVE' WHERE user_id=:'MANAGER' AND tenant_id=:'A';
UPDATE public.tenants SET status='SUSPENDED' WHERE id=:'A';
SET ROLE anon;
SELECT t.is(public.recommend_upsell('adega-a',:'SRC',:'cart','DELIVERY'),'{"offerToken":null,"suggestions":[]}'::jsonb,'E1: loja suspensa não oferece recomendações');
RESET ROLE;
SELECT t.login(NULL);
UPDATE public.tenants SET status='ACTIVE' WHERE id=:'A';
