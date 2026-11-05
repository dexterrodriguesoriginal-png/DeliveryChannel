-- Revisão de segurança dos códigos: fixtures próprias, PostgreSQL local descartável.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set OWNER_B 'b0000000-0000-0000-0000-000000000001'
\set CLIENT 'e1310000-0000-0000-0000-000000000001'
\set WAITER 'e1310000-0000-0000-0000-000000000002'
\set MANAGER 'e13c0000-0000-0000-0000-000000000001'
\set PENDING 'e13c0000-0000-0000-0000-000000000002'
\set TAB 'e13c0000-0000-0000-0000-000000000003'
\set TABLE 'e13c0000-0000-0000-0000-000000000004'
\set SESSION 'e13c0000-0000-0000-0000-000000000005'
\set PENDING_SESSION 'e13c0000-0000-0000-0000-000000000006'
RESET ROLE;
SELECT t.login(NULL);
INSERT INTO auth.users(id,email) VALUES(:'MANAGER','review-manager@test.example'),(:'PENDING','review-pending@test.example');
INSERT INTO public.tenant_users(tenant_id,user_id,role_id,status) VALUES(:'A',:'MANAGER','MANAGER','ACTIVE');
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token) VALUES(:'TABLE',:'A','Mesa código revisão','review-code-table');
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,status,service_fee_percent,responsible_user_id)
 VALUES(:'TAB',:'A','TABLE',:'TABLE','OPEN',0,:'CLIENT');
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at) VALUES
 (:'SESSION',:'A',:'TAB',:'CLIENT','Cliente aprovado','review-code-approved',now()),
 (:'PENDING_SESSION',:'A',:'TAB',:'PENDING','Cliente pendente','review-code-pending',NULL);
INSERT INTO public.waiter_table_assignments(tenant_id,table_id,waiter_id,assigned_by) VALUES(:'A',:'TABLE',:'WAITER',:'OWNER');
-- Rodada antiga sem código; ativar depois não impõe uma credencial inexistente.
UPDATE public.tenant_modules SET config=config||'{"require_delivery_code":false}'::jsonb WHERE tenant_id=:'A' AND module_key='dine_in';
INSERT INTO public.orders(id,tenant_id,tab_id,round_no,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address)
 VALUES('e13c0000-0000-0000-0000-000000000011',:'A',:'TAB',1,'DINE_IN','OUT_FOR_DELIVERY',10,10,'CASH','PENDING','DINE_IN_QR',1411,'Cliente revisão','11900000000','Mesa revisão');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_salon_delivery_code_required(:'A',true);
SELECT t.login(:'MANAGER'::uuid);
SELECT t.throws($q$SELECT public.set_salon_delivery_code_required('10000000-0000-0000-0000-00000000000a',false)$q$,'FORBIDDEN','review-code apenas dono altera opção dedicada');
SELECT t.throws($q$SELECT public.configure_dine_in('10000000-0000-0000-0000-00000000000a','{"mode":"TABLE","release_required":true,"salon_open":true,"round_limit":1000000,"close_roles":["OWNER","MANAGER","CASHIER"],"require_delivery_code":false}',false,'{"percent":10}')$q$,'MODULE_OWNER_REQUIRED','review-code formulário antigo do gerente não desativa credencial do dono');
SELECT t.throws($q$UPDATE public.tenant_modules SET config='{"require_delivery_code":false}' WHERE tenant_id='10000000-0000-0000-0000-00000000000a' AND module_key='dine_in'$q$,'permission denied','review-code gerente não tem escrita direta na configuração');
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.configure_dine_in('10000000-0000-0000-0000-00000000000a','{"mode":"TABLE","release_required":true,"salon_open":true,"round_limit":1000000,"close_roles":["OWNER","MANAGER","CASHIER"],"require_delivery_code":"true"}',false,'{"percent":10}')$q$,'INVALID_DINE_IN_CONFIG','review-code tipo da opção é booleano real');
RESET ROLE;
SELECT t.login(NULL);
INSERT INTO public.orders(id,tenant_id,tab_id,round_no,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address)
SELECT ('e13c0000-0000-0000-0000-'||lpad((10+n)::text,12,'0'))::uuid,:'A',:'TAB',n,'DINE_IN','OUT_FOR_DELIVERY',10,10,'CASH','PENDING','DINE_IN_QR',1410+n,'Cliente revisão','11900000000','Mesa revisão' FROM generate_series(2,4)n;
INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price)
SELECT ('e13c0000-0000-0000-0000-'||lpad((10+n)::text,12,'0'))::uuid,'d0000000-0000-0000-0000-0000000000a1','Item revisão',1,10,10 FROM generate_series(1,4)n;
-- Força a mesma entropia em 30 inserções: a antiga saída após 25 colisões
-- aceitava códigos repetidos. A definição original da extensão é reposta no DO.
DO $test$
DECLARE v_def text; v_tab uuid:='e13c0000-0000-0000-0000-000000000021'; v_table uuid:='e13c0000-0000-0000-0000-000000000022'; n integer;
BEGIN
 INSERT INTO public.dining_tables(id,tenant_id,label,qr_token) VALUES(v_table,'10000000-0000-0000-0000-00000000000a','Colisões','review-code-collisions');
 INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,status,service_fee_percent) VALUES(v_tab,'10000000-0000-0000-0000-00000000000a','TABLE',v_table,'OPEN',0);
 v_def:=pg_catalog.pg_get_functiondef('extensions.gen_random_bytes(integer)'::regprocedure);
 EXECUTE $fn$CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(integer) RETURNS bytea LANGUAGE sql VOLATILE AS 'SELECT decode(repeat(''00'',$1),''hex'')'$fn$;
 FOR n IN 1..30 LOOP
  INSERT INTO public.orders(id,tenant_id,tab_id,round_no,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address)
  VALUES(('e13c0000-0000-0000-0000-'||lpad((100+n)::text,12,'0'))::uuid,'10000000-0000-0000-0000-00000000000a',v_tab,n,'DINE_IN','OUT_FOR_DELIVERY',0,0,'CASH','PENDING','DINE_IN_QR',1500+n,'Colisões','11900000000','Mesa revisão');
 END LOOP;
 EXECUTE v_def;
 PERFORM t.is((SELECT count(DISTINCT c.customer_code) FROM public.salon_order_delivery_codes c WHERE c.tab_id=v_tab),30::bigint,'review-code 30 colisões de entropia produzem 30 códigos diferentes');
 PERFORM t.is((SELECT count(*) FROM (SELECT customer_code FROM public.salon_order_delivery_codes WHERE tenant_id='10000000-0000-0000-0000-00000000000a' GROUP BY customer_code HAVING count(*)>1)dup),0::bigint,'review-code códigos pendentes de contas diferentes também são distintos antes de unir');
END $test$;
SELECT customer_code AS "CODE_OK" FROM public.salon_order_delivery_codes WHERE order_id='e13c0000-0000-0000-0000-000000000013' \gset
SELECT customer_code AS "CODE_LOCKED" FROM public.salon_order_delivery_codes WHERE order_id='e13c0000-0000-0000-0000-000000000012' \gset
SELECT customer_code AS "CODE_EARLY" FROM public.salon_order_delivery_codes WHERE order_id='e13c0000-0000-0000-0000-000000000014' \gset
SET ROLE authenticated;
SELECT t.login(:'PENDING'::uuid);
SELECT t.ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_my_tab(:'PENDING_SESSION')->'rounds') r WHERE r->>'deliveryCode' IS NOT NULL),'review-code cliente não aprovado não recebe código de entrega');
SELECT t.throws($q$SELECT public.salon_delivery_states('10000000-0000-0000-0000-00000000000a',ARRAY['e13c0000-0000-0000-0000-000000000013'::uuid])$q$,'FORBIDDEN','review-code cliente não usa projeção da equipe');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_my_tab(:'SESSION')->'rounds') r WHERE r->>'orderId'='e13c0000-0000-0000-0000-000000000013' AND r->>'deliveryCode'=:'CODE_OK'),'review-code sessão aprovada da própria conta recebe código');
SELECT t.throws($q$SELECT public.get_my_tab('e13c0000-0000-0000-0000-000000000006')$q$,'TAB_NOT_FOUND','review-code sessão de outro cliente continua isolada');
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.throws($q$SELECT public.salon_delivery_states('10000000-0000-0000-0000-00000000000a',ARRAY['e13c0000-0000-0000-0000-000000000013'::uuid])$q$,'FORBIDDEN','review-code outra loja não recebe estado das credenciais');
SELECT t.login(:'WAITER'::uuid);
SELECT public.salon_delivery_states(:'A',ARRAY['e13c0000-0000-0000-0000-000000000011'::uuid,'e13c0000-0000-0000-0000-000000000013'::uuid]) AS "STATES" \gset
SELECT t.ok(:'STATES'::jsonb @> '[{"order_id":"e13c0000-0000-0000-0000-000000000013","delivery_code_required":true}]' AND :'STATES'::jsonb @> '[{"order_id":"e13c0000-0000-0000-0000-000000000011","delivery_code_required":false}]','review-code exigência é por rodada mesmo com configuração ativa');
SELECT t.ok(NOT (:'STATES' LIKE '%'||:'CODE_OK'||'%'),'review-code projeção staff nunca carrega código integral');
SELECT t.throws($q$SELECT public.waiter_mark_delivered('e13c0000-0000-0000-0000-000000000013')$q$,'DELIVERY_CODE_REQUIRED','review-code RPC antigo não contorna código');
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_salon_delivery_code_required(:'A',false);
SELECT t.ok(public.salon_delivery_states(:'A',ARRAY['e13c0000-0000-0000-0000-000000000013'::uuid]) @> '[{"delivery_code_required":true}]','review-code desativar opção não remove código de rodada já criada');
SELECT t.throws($q$SELECT public.update_order_status('e13c0000-0000-0000-0000-000000000013','DELIVERED')$q$,'DELIVERY_CODE_REQUIRED','review-code RPC genérica não contorna código');
RESET ROLE;
SELECT t.login(NULL);
SELECT t.throws($q$UPDATE public.orders SET status='DELIVERED' WHERE id='e13c0000-0000-0000-0000-000000000013'$q$,'DELIVERY_CODE_REQUIRED','review-code guard no dado bloqueia qualquer atualização privilegiada sem confirmar código');
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT t.ok(NOT(public.waiter_mark_delivered('e13c0000-0000-0000-0000-000000000012','0000')->>'success')::boolean,'review-code tentativa errada 1 persiste');
SELECT public.waiter_mark_delivered('e13c0000-0000-0000-0000-000000000012','0000');
SELECT public.waiter_mark_delivered('e13c0000-0000-0000-0000-000000000012','0000');
SELECT public.waiter_mark_delivered('e13c0000-0000-0000-0000-000000000012','0000');
SELECT public.waiter_mark_delivered('e13c0000-0000-0000-0000-000000000012','0000');
SELECT t.throws(format($q$SELECT public.waiter_mark_delivered('e13c0000-0000-0000-0000-000000000012',%L)$q$,:'CODE_LOCKED'),'DELIVERY_CODE_LOCKED','review-code sexta tentativa com código correto é recusada');
RESET ROLE;
SELECT t.login(NULL);
SELECT t.is((SELECT attempts FROM public.salon_order_delivery_codes WHERE order_id='e13c0000-0000-0000-0000-000000000012'),5,'review-code cinco falhas permanecem gravadas');
SELECT t.is((SELECT count(*) FROM public.tab_access_events WHERE tab_id=:'TAB' AND event='DELIVERY_CODE_INVALID'),5::bigint,'review-code auditoria registra cinco falhas sem o código');
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT t.ok((public.waiter_mark_delivered('e13c0000-0000-0000-0000-000000000013',:'CODE_OK')->>'success')::boolean,'review-code código correto entrega rodada');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$SELECT public.customer_dispute_delivery('e13c0000-0000-0000-0000-000000000005','e13c0000-0000-0000-0000-000000000013')$q$,'DELIVERY_CONFIRMED_WITH_CODE','review-code servidor recusa Não recebi após confirmação');
-- Pagamento antecipado conserva o código apenas na sessão aprovada e histórica correta.
SELECT t.login(:'OWNER'::uuid);
SELECT public.close_tab(:'TAB','[{"method":"CASH","amount_cents":4000,"change_given_cents":0}]');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_my_tab(:'SESSION')->'rounds')r WHERE r->>'orderId'='e13c0000-0000-0000-0000-000000000014' AND r->>'deliveryCode'=:'CODE_EARLY'),'review-code conta paga antecipadamente conserva código pendente na sessão aprovada');
SELECT t.login(:'PENDING'::uuid);
SELECT t.ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_my_tab(:'PENDING_SESSION')->'rounds')r WHERE r->>'deliveryCode' IS NOT NULL),'review-code histórico de conta paga não revela código a pendente');
SELECT t.login(:'WAITER'::uuid);
SELECT t.ok((public.waiter_mark_delivered('e13c0000-0000-0000-0000-000000000014',:'CODE_EARLY')->>'success')::boolean,'review-code garçom entrega rodada depois do pagamento antecipado');
RESET ROLE;
SELECT t.login(NULL);

