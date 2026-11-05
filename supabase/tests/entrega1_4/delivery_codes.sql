-- Item 3: caminho real configuração -> submit_round -> trigger -> get_my_tab.
-- Fixtures isoladas; executar no PostgreSQL local com baseline Entrega 1.3.
\set A '10000000-0000-0000-0000-00000000000a'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set OWNER_B 'b0000000-0000-0000-0000-000000000001'
\set CLIENT 'e1430000-0000-0000-0000-000000000001'
\set GUEST 'e1430000-0000-0000-0000-000000000002'
\set PENDING 'e1430000-0000-0000-0000-000000000003'
\set WAITER 'e1430000-0000-0000-0000-000000000004'
\set TABLE 'e1430000-0000-0000-0000-000000000010'
\set TAB 'e1430000-0000-0000-0000-000000000020'
\set SESSION 'e1430000-0000-0000-0000-000000000031'
\set GUEST_SESSION 'e1430000-0000-0000-0000-000000000032'
\set PENDING_SESSION 'e1430000-0000-0000-0000-000000000033'
RESET ROLE;
SELECT t.login(NULL);
INSERT INTO auth.users(id,email) VALUES
 (:'CLIENT','e14-code-client@test.example'),(:'GUEST','e14-code-guest@test.example'),
 (:'PENDING','e14-code-pending@test.example'),(:'WAITER','e14-code-waiter@test.example');
INSERT INTO public.legal_acceptances(user_id,audience,version)
 SELECT u.id,'customer',public._legal_version() FROM auth.users u WHERE u.id IN (:'CLIENT',:'GUEST',:'PENDING');
INSERT INTO public.tenant_users(tenant_id,user_id,role_id,status) VALUES(:'A',:'WAITER','WAITER','ACTIVE');
INSERT INTO public.waiter_profiles(user_id,tenant_id,username,phone)
 VALUES(:'WAITER',:'A','e14_code_waiter','11900001403');
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token) VALUES(:'TABLE',:'A','Mesa teste código 1.4','entrega14-code-table');
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,status,service_fee_percent,responsible_user_id)
 VALUES(:'TAB',:'A','TABLE',:'TABLE','OPEN',0,:'CLIENT');
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at) VALUES
 (:'SESSION',:'A',:'TAB',:'CLIENT','Cliente código 1.4','e14-code-client',now()),
 (:'GUEST_SESSION',:'A',:'TAB',:'GUEST','Convidado código 1.4','e14-code-guest',now()),
 (:'PENDING_SESSION',:'A',:'TAB',:'PENDING','Pendente código 1.4','e14-code-pending',NULL);
INSERT INTO public.waiter_table_assignments(tenant_id,table_id,waiter_id,assigned_by) VALUES(:'A',:'TABLE',:'WAITER',:'OWNER');
UPDATE public.tenant_modules SET config=config-'require_delivery_code' WHERE tenant_id=:'A' AND module_key='dine_in';
SELECT t.ok(NOT public._salon_delivery_code_required(:'A'),'E14.3 ausência de opção usa padrão desligado');
UPDATE public.tenant_modules SET config=config||'{"require_delivery_code":true}',enabled=false WHERE tenant_id=:'A' AND module_key='dine_in';
SELECT t.ok(NOT public._salon_delivery_code_required(:'A'),'E14.3 módulo desabilitado não exige código mesmo com configuração antiga ligada');
UPDATE public.tenant_modules SET config=config-'require_delivery_code',enabled=true WHERE tenant_id=:'A' AND module_key='dine_in';

SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.configure_dine_in(:'A','{"mode":"TABLE","release_required":true,"salon_open":true,"round_limit":1000000,"close_roles":["OWNER","MANAGER","CASHIER"]}',false,'{"percent":10}');
SELECT public.set_salon_delivery_code_required(:'A',false);
SELECT t.login(:'CLIENT'::uuid);
SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]',
 'e1430000-0000-0000-0000-000000000041',:'SESSION') AS old_round \gset
SELECT t.ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_my_tab(:'SESSION')->'rounds') r WHERE r->>'deliveryCode' IS NOT NULL),
 'E14.3 opção desligada não gera nem expõe código em rodada real');
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws($q$SELECT public.set_salon_delivery_code_required('10000000-0000-0000-0000-00000000000a',true)$q$,'FORBIDDEN','E14.3 garçom não ativa opção no servidor');
SELECT t.login(:'OWNER'::uuid);
SELECT t.ok((public.set_salon_delivery_code_required(:'A',true)->>'require_delivery_code')::boolean,'E14.3 setter persiste opção correta');
SELECT t.login(:'GUEST'::uuid);
SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]',
 'e1430000-0000-0000-0000-000000000042',:'GUEST_SESSION') AS guest_round \gset
SELECT t.login(:'CLIENT'::uuid);
SELECT public.submit_round('[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]',
 'e1430000-0000-0000-0000-000000000043',:'SESSION') AS client_round \gset
SELECT t.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_my_tab(:'SESSION')->'rounds') r
 WHERE r->>'orderId'=:'guest_round'::jsonb->>'orderId' AND (r->>'mine')::boolean=false AND r->>'deliveryCode' ~ '^[0-9]{4}$'),
 'E14.3 reprodução: rodada de outro integrante retorna código para conta aprovada apesar de mine=false');
SELECT t.ok((SELECT count(DISTINCT r->>'deliveryCode') FROM jsonb_array_elements(public.get_my_tab(:'SESSION')->'rounds') r)=2,
 'E14.3 cada rodada criada pelo RPC gera código diferente pelo trigger');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_my_tab(:'SESSION')->'rounds') r
 WHERE r->>'orderId'=:'old_round'::jsonb->>'orderId' AND r->>'deliveryCode' IS NOT NULL),
 'E14.3 habilitar não inventa código para rodada anterior');
SELECT t.login(:'PENDING'::uuid);
SELECT t.ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_my_tab(:'PENDING_SESSION')->'rounds') r WHERE r->>'deliveryCode' IS NOT NULL),
 'E14.3 sessão pendente da mesma conta não recebe código');
SELECT t.throws($q$SELECT public.get_my_tab('e1430000-0000-0000-0000-000000000031')$q$,'TAB_NOT_FOUND','E14.3 cliente não usa sessão aprovada alheia');
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.throws($q$SELECT public.get_my_tab('e1430000-0000-0000-0000-000000000031')$q$,'TAB_NOT_FOUND','E14.3 outra loja não obtém projeção dos códigos');

-- O formulário da equipe não lê os códigos, só a exigência por rodada.
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws($q$SELECT * FROM public.salon_order_delivery_codes$q$,'permission denied','E14.3 códigos continuam privados com RLS e sem SELECT da equipe');
SELECT public.salon_delivery_states(:'A',ARRAY[(:'guest_round'::jsonb->>'orderId')::uuid,(:'client_round'::jsonb->>'orderId')::uuid]) AS staff_states \gset
SELECT t.ok(jsonb_array_length(:'staff_states'::jsonb)=2 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(:'staff_states'::jsonb) r
 WHERE NOT (r->>'delivery_code_required')::boolean OR r ? 'deliveryCode' OR r ? 'customer_code' OR r ? 'code_hash'),
 'E14.3 garçom recebe somente sinalização segura para abrir campo de quatro dígitos');

SELECT t.login(:'OWNER'::uuid);
SELECT public.set_salon_delivery_code_required(:'A',false);
SELECT public.update_order_status((:'guest_round'::jsonb->>'orderId')::uuid,'READY');
SELECT public.update_order_status((:'guest_round'::jsonb->>'orderId')::uuid,'OUT_FOR_DELIVERY');
SELECT public.update_order_status((:'client_round'::jsonb->>'orderId')::uuid,'READY');
SELECT public.update_order_status((:'client_round'::jsonb->>'orderId')::uuid,'OUT_FOR_DELIVERY');
SELECT t.login(:'CLIENT'::uuid);
SELECT r->>'deliveryCode' AS guest_code FROM jsonb_array_elements(public.get_my_tab(:'SESSION')->'rounds') r
 WHERE r->>'orderId'=:'guest_round'::jsonb->>'orderId' \gset
SELECT r->>'deliveryCode' AS client_code FROM jsonb_array_elements(public.get_my_tab(:'SESSION')->'rounds') r
 WHERE r->>'orderId'=:'client_round'::jsonb->>'orderId' \gset
SELECT t.ok(length(:'guest_code')=4 AND length(:'client_code')=4,'E14.3 desligar depois preserva códigos das rodadas já criadas');
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws(format('SELECT public.waiter_mark_delivered(%L::uuid)',:'guest_round'::jsonb->>'orderId'),'DELIVERY_CODE_REQUIRED',
 'E14.3 entrega continua exigindo código após desligar opção');
SELECT public.waiter_mark_delivered((:'guest_round'::jsonb->>'orderId')::uuid,'0000');
SELECT public.waiter_mark_delivered((:'guest_round'::jsonb->>'orderId')::uuid,'0000');
SELECT public.waiter_mark_delivered((:'guest_round'::jsonb->>'orderId')::uuid,'0000');
SELECT public.waiter_mark_delivered((:'guest_round'::jsonb->>'orderId')::uuid,'0000');
SELECT public.waiter_mark_delivered((:'guest_round'::jsonb->>'orderId')::uuid,'0000');
SELECT t.throws(format('SELECT public.waiter_mark_delivered(%L::uuid,%L)',:'guest_round'::jsonb->>'orderId',:'guest_code'),'DELIVERY_CODE_LOCKED',
 'E14.3 servidor bloqueia sexta tentativa mesmo correta');
SELECT t.ok((public.waiter_mark_delivered((:'client_round'::jsonb->>'orderId')::uuid,:'client_code')->>'confirmed_with_code')::boolean,
 'E14.3 código correto confirma outra rodada liberada pelo balcão');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_my_tab(:'SESSION')->'rounds') r
 WHERE r->>'orderId'=:'client_round'::jsonb->>'orderId' AND r->>'deliveryCode' IS NULL
 AND (r->>'deliveryConfirmedWithCode')::boolean AND NOT (r->>'canDisputeDelivery')::boolean),
 'E14.3 entregue remove código e bloqueia Não recebi');
RESET ROLE;
SELECT t.ok((SELECT attempts=5 FROM public.salon_order_delivery_codes WHERE order_id=(:'guest_round'::jsonb->>'orderId')::uuid),
 'E14.3 cinco falhas persistem sem rollback do contador');
SELECT t.is((SELECT count(*) FROM public.tab_access_events WHERE tab_id=:'TAB' AND event='DELIVERY_CODE_INVALID'),5::bigint,
 'E14.3 cinco falhas são auditadas sem expor código');
SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.salon_order_delivery_codes'::regclass)
 AND NOT has_table_privilege('anon','public.salon_order_delivery_codes','SELECT')
 AND NOT has_table_privilege('authenticated','public.salon_order_delivery_codes','SELECT'),
 'E14.3 RLS e ausência de acesso direto dos clientes preservados');

