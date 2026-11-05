-- Entrega 1: executar apenas em PostgreSQL LOCAL descartável, após fixtures n1n6.
-- Os contatos abaixo são dados sintéticos de teste.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set MGR 'a0000000-0000-0000-0000-000000000002'
\set OWNER_B 'b0000000-0000-0000-0000-000000000001'
\set KITCHEN 'e1100000-0000-0000-0000-000000000001'
\set ORPHAN 'e1100000-0000-0000-0000-000000000002'
\set PRIVILEGED 'e1100000-0000-0000-0000-000000000003'
RESET ROLE;
SELECT t.login(NULL);
SELECT set_config('request.headers','{}',false);
DELETE FROM public.security_rate_limits;
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 (:'KITCHEN','cozinha.entrega1@test.local','{"name":"Cozinha A"}','{}'),
 (:'ORPHAN','retorno.adega-a@garcom.deliverychannel.local','{"name":"Garçom removido"}','{"waiter_tenant_id":"10000000-0000-0000-0000-00000000000a"}'),
 (:'PRIVILEGED','privilegiado.adega-a@garcom.deliverychannel.local','{"name":"Identidade privilegiada"}','{"waiter_tenant_id":"10000000-0000-0000-0000-00000000000a"}');
INSERT INTO public.tenant_users(user_id,tenant_id,role_id,status) VALUES
 (:'KITCHEN',:'A','KITCHEN','ACTIVE'),
 (:'ORPHAN',:'A','WAITER','SUSPENDED'),
 (:'PRIVILEGED',:'A','OWNER','ACTIVE');
INSERT INTO public.tenant_modules(tenant_id,module_key,enabled,config) VALUES
 (:'A','dine_in',true,'{"mode":"TABLE","salon_open":true}'),
 (:'B','dine_in',true,'{"mode":"TABLE","salon_open":true}')
ON CONFLICT(tenant_id,module_key) DO UPDATE SET enabled=true,config=EXCLUDED.config;
INSERT INTO public.store_payment_accounts(tenant_id,provider,status,account_label) VALUES
 (:'A','manual_pix','disconnected','Conta sintética A'),
 (:'B','manual_pix','disconnected','Conta sintética B')
ON CONFLICT(tenant_id,provider) DO UPDATE SET account_label=EXCLUDED.account_label;

-- Ferramentas e defaults são por loja; escrita nunca é feita por tabela direta.
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_store_tool(:'A','waiter',true);
SELECT public.set_store_tool(:'A','kitchen',true);
SELECT t.ok(public.list_store_tools(:'A') @> '{"waiter":true,"kitchen":true}', 'ferramentas habilitadas pelo dono');
SELECT t.ok(public.has_store_permission(:'A','view_finances'), 'dono conserva acesso financeiro');
SELECT t.ok(public.has_store_permission(:'A','manage_subscription'), 'dono conserva acesso à assinatura');
SELECT t.ok(NOT public.has_store_permission(:'A','permissao_inexistente'), 'permissão desconhecida falha fechada');
SELECT t.throws($q$SELECT public.set_store_role_permission('10000000-0000-0000-0000-00000000000a','OWNER','view_orders',false)$q$,
 'INVALID_INPUT|FORBIDDEN|reservad', 'dono não remove permissões do papel Dono');
SELECT t.throws($q$UPDATE public.store_tools SET enabled=false WHERE tenant_id='10000000-0000-0000-0000-00000000000a'$q$,
 'permission denied', 'ferramentas só são escritas por RPC');
SELECT t.throws($q$INSERT INTO public.store_role_permissions VALUES('10000000-0000-0000-0000-00000000000a','MANAGER','view_finances',true)$q$,
 'permission denied', 'permissões só são escritas por RPC');
SELECT t.throws($q$SELECT public.set_store_tool('10000000-0000-0000-0000-00000000000b','kitchen',true)$q$,
 'FORBIDDEN|negad', 'dono A não altera ferramentas B');
SELECT t.throws($q$SELECT public.list_store_tools('10000000-0000-0000-0000-00000000000b')$q$,
 'FORBIDDEN|negad', 'dono A não consulta ferramentas B');
SELECT t.throws($q$SELECT public.get_store_access('10000000-0000-0000-0000-00000000000b')$q$,
 'FORBIDDEN|negad', 'snapshot de acesso é isolado por loja');
SELECT t.throws($q$SELECT public.set_store_role_permission('10000000-0000-0000-0000-00000000000b','MANAGER','view_reports',false)$q$,
 'FORBIDDEN|negad', 'dono A não altera permissões B');

SELECT t.login(:'MGR'::uuid);
SELECT t.ok(public.has_store_permission(:'A','manage_team') AND public.has_store_permission(:'A','view_reports'), 'gerente recebe equipe e relatórios por default');
SELECT t.ok(NOT public.has_store_permission(:'A','view_finances') AND NOT public.has_store_permission(:'A','manage_subscription'), 'gerente sem financeiro sensível e assinatura');
SELECT t.throws($q$SELECT public.set_store_tool('10000000-0000-0000-0000-00000000000a','kitchen',false)$q$,
 'FORBIDDEN|negad', 'gerente não altera ferramentas');
SELECT t.throws($q$SELECT public.set_store_role_permission('10000000-0000-0000-0000-00000000000a','MANAGER','view_finances',true)$q$,
 'FORBIDDEN|negad', 'gerente não se concede financeiro');
SELECT t.throws($q$SELECT public.set_store_role_permission('10000000-0000-0000-0000-00000000000a','KITCHEN','view_reports',true)$q$,
 'FORBIDDEN|negad', 'não dono não altera chaves de permissões');
SELECT t.throws($q$SELECT public.get_tenant_financial_summary('10000000-0000-0000-0000-00000000000a',now()-interval '1 day',now())$q$,
 'FORBIDDEN|negad|financeir', 'RPC financeira recusa gerente no servidor');
SELECT t.is(t.visible($q$SELECT * FROM public.store_payment_accounts$q$),0::bigint, 'RLS financeiro não entrega contas ao gerente');
SELECT t.is(t.visible($q$SELECT * FROM public.store_access_audit$q$),0::bigint, 'gerente não lê auditoria sensível do dono');

-- Override explícito afeta o servidor e a listagem, conserva o isolamento e gera auditoria.
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_store_role_permission(:'A','MANAGER','view_reports',false);
SELECT t.ok(public.list_store_role_permissions(:'A') @> '[{"role":"MANAGER","permission":"view_reports","enabled":false}]', 'lista inclui override desativado');
SELECT t.throws($q$SELECT public.set_store_role_permission('10000000-0000-0000-0000-00000000000a','MANAGER','view_finances',true)$q$,
 'INVALID_INPUT|FORBIDDEN|reservad', 'financeiro permanece reservado ao dono mesmo com override');
SELECT t.ok(EXISTS(SELECT 1 FROM public.store_access_audit WHERE tenant_id=:'A' AND actor_id=:'OWNER' AND kind='PERMISSION' AND role='MANAGER' AND permission='view_reports' AND enabled=false AND changed_at IS NOT NULL), 'auditoria registra ator, horário, papel e chave');
SELECT t.ok(EXISTS(SELECT 1 FROM public.store_access_audit WHERE tenant_id=:'A' AND actor_id=:'OWNER' AND kind='TOOL' AND tool='kitchen' AND enabled=true), 'auditoria registra ferramenta habilitada');
SELECT t.login(:'MGR'::uuid);
SELECT t.ok(NOT public.has_store_permission(:'A','view_reports'), 'override remove permissão efetiva do gerente');
SELECT t.ok(NOT (public.get_store_access(:'A')->'permissions' ? 'view_reports'), 'snapshot usado pelo menu reflete override');
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.is(t.visible($q$SELECT * FROM public.store_role_permissions WHERE tenant_id='10000000-0000-0000-0000-00000000000a'$q$),0::bigint, 'override A não vaza para dono B');
SELECT t.is(t.visible($q$SELECT * FROM public.store_access_audit WHERE tenant_id='10000000-0000-0000-0000-00000000000a'$q$),0::bigint, 'auditoria A não vaza para dono B');
SELECT t.ok(public.has_store_permission(:'B','view_reports'), 'override A não remove permissão do dono B');
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_store_role_permission(:'A','MANAGER','view_reports',true);

-- Limites de privacidade dos papéis dedicados persistem mesmo com um override indevido.
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.set_store_role_permission('10000000-0000-0000-0000-00000000000a','KITCHEN','view_orders',true)$q$, 'INVALID_INPUT|FORBIDDEN|reservad', 'dono não concede pedidos brutos ao papel Cozinha');
SELECT t.throws($q$SELECT public.set_store_role_permission('10000000-0000-0000-0000-00000000000a','KITCHEN','manage_tables',true)$q$, 'INVALID_INPUT|FORBIDDEN|reservad', 'dono não concede mesas com dados de cliente ao papel Cozinha');
SET ROLE service_role;
INSERT INTO public.store_role_permissions(tenant_id,role,permission,enabled) VALUES
 (:'A','KITCHEN','view_orders',true),(:'A','KITCHEN','manage_tables',true)
ON CONFLICT(tenant_id,role,permission) DO UPDATE SET enabled=true;
SET ROLE authenticated;
SELECT t.login(:'KITCHEN'::uuid);
SELECT t.ok(NOT public.has_store_permission(:'A','view_orders') AND NOT public.has_store_permission(:'A','manage_tables'), 'limite LGPD da cozinha prevalece sobre override inserido pelo serviço');
SET ROLE service_role;
DELETE FROM public.store_role_permissions WHERE tenant_id=:'A' AND role='KITCHEN' AND permission IN('view_orders','manage_tables');

-- Convites públicos: resultado mínimo, loja e papel exatos, e comparação case-insensitive.
RESET ROLE;
INSERT INTO public.team_invites(id,tenant_id,email,role_id,invited_by,status,expires_at) VALUES
 ('e1200000-0000-0000-0000-000000000001',:'A','ana.entrega1@test.local','WAITER',:'OWNER','PENDING',now()+interval '1 day'),
 ('e1200000-0000-0000-0000-000000000002',:'B','outraloja.entrega1@test.local','WAITER',:'OWNER_B','PENDING',now()+interval '1 day'),
 ('e1200000-0000-0000-0000-000000000003',:'A','chef.entrega1@test.local','KITCHEN',:'OWNER','PENDING',now()+interval '1 day'),
 ('e1200000-0000-0000-0000-000000000004',:'A','expirado.entrega1@test.local','WAITER',:'OWNER','PENDING',now()-interval '1 second'),
 ('e1200000-0000-0000-0000-000000000005',:'A','revogado.entrega1@test.local','WAITER',:'OWNER','REVOKED',now()+interval '1 day');
SET ROLE anon;
SELECT t.login(NULL);
SELECT t.is(public.waiter_invite_check('adega-a','ANA.ENTREGA1@TEST.LOCAL'),'{"invited":true}'::jsonb, 'anon checa e-mail em maiúsculas com apenas booleano');
SELECT t.is(public.waiter_invite_check('adega-a','outraloja.entrega1@test.local'),'{"invited":false}'::jsonb, 'convite de outra loja não é aceito');
SELECT t.is(public.waiter_invite_check('loja-inexistente','ana.entrega1@test.local'),'{"invited":false}'::jsonb, 'slug inexistente não revela loja nem conta');
SELECT t.is(public.waiter_invite_check('adega-a','nao-convidado@test.local'),'{"invited":false}'::jsonb, 'não convidado não revela existência de conta');
SELECT t.is(public.waiter_invite_check('adega-a','expirado.entrega1@test.local'),'{"invited":false}'::jsonb, 'convite expirado recusa cadastro');
SELECT t.is(public.waiter_invite_check('adega-a','revogado.entrega1@test.local'),'{"invited":false}'::jsonb, 'convite revogado recusa cadastro');
SELECT t.is(public.team_invite_check('adega-a','chef.entrega1@test.local','KITCHEN'),'{"invited":true}'::jsonb, 'pré-checagem generalizada aceita papel convidado');
SELECT t.is(public.team_invite_check('adega-a','chef.entrega1@test.local','MANAGER'),'{"invited":false}'::jsonb, 'convite de cozinha não concede papel gerente');
SELECT t.is(public.team_invite_check('adega-a','chef.entrega1@test.local','OWNER'),'{"invited":false}'::jsonb, 'pré-checagem nunca convida dono');
SELECT t.ok(t.visible('SELECT * FROM public.team_invites')<=0, 'anon não lê tabela de convites');
SELECT t.ok(t.visible('SELECT * FROM public.users')<=0, 'anon não enumera contas');
SELECT t.ok(t.visible('SELECT * FROM public.store_role_permissions')<=0, 'anon não lê permissões');
SELECT t.throws($q$SELECT public.list_store_role_permissions('10000000-0000-0000-0000-00000000000a')$q$, 'permission denied', 'anon não executa RPC de gestão');
SELECT t.throws($q$SELECT public.waiter_reusable_identity('10000000-0000-0000-0000-00000000000a','retorno')$q$, 'permission denied', 'anon não consulta identidades reutilizáveis');

RESET ROLE;
DELETE FROM public.security_rate_limits WHERE scope IN('waiter_invite_check','team_invite_check');
SELECT set_config('request.headers','{"x-forwarded-for":"192.0.2.81"}',false);
SET ROLE anon;
DO $$
DECLARE n integer; v jsonb;
BEGIN
 FOR n IN 1..10 LOOP
  v:=public.waiter_invite_check('adega-a','ana.entrega1@test.local');
  PERFORM t.ok(v='{"invited":true}'::jsonb,'cota de convite permite chamada '||n||'/10');
 END LOOP;
 PERFORM t.is(public.waiter_invite_check('adega-a','ana.entrega1@test.local'),'{"invited":false,"rate_limited":true}'::jsonb,'11ª chamada é limitada por 600 segundos');
 PERFORM t.is(public.waiter_invite_check('adega-a','troca-email@test.local'),'{"invited":false,"rate_limited":true}'::jsonb,'trocar e-mail no mesmo IP não contorna a cota da loja');
END $$;
RESET ROLE;
SELECT t.ok(EXISTS(SELECT 1 FROM public.security_rate_limits WHERE scope='waiter_invite_check' AND tenant_id=:'A' AND subject_key~'^[0-9a-f]{64}$' AND subject_key NOT LIKE '%192.0.2.81%'), 'rate limit guarda hash em vez de e-mail/IP puro');
SELECT set_config('request.headers','{}',false);
DELETE FROM public.security_rate_limits;

-- Signup Auth também verifica convite, mesmo se a UI for contornada.
SELECT t.throws($q$INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES(gen_random_uuid(),'semconvite.entrega1@test.local','{"waiter_signup_slug":"adega-a"}','{"provider":"email"}')$q$,
 'INVITE|convidad|convite', 'trigger rejeita signup de garçom sem convite');
SELECT t.throws($q$INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES(gen_random_uuid(),'outraloja.entrega1@test.local','{"waiter_signup_slug":"adega-a"}','{"provider":"email"}')$q$,
 'INVITE|convidad|convite', 'trigger rejeita convite válido somente em outra loja');
SELECT t.throws($q$INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES(gen_random_uuid(),'ana.entrega1@test.local','{"team_signup_slug":"adega-a","team_signup_role":"MANAGER"}','{"provider":"email"}')$q$,
 'INVITE|convidad|convite', 'metadados não trocam convite de garçom por papel de gerente');
SELECT t.lives($q$INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES('e1100000-0000-0000-0000-000000000011','ANA.ENTREGA1@TEST.LOCAL','{"name":"Ana da equipe","waiter_signup_slug":"adega-a","audience":"team"}','{"provider":"email"}')$q$,
 'convite permite signup de garçom sem aceite de termos de dono');
SELECT t.lives($q$INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES('e1100000-0000-0000-0000-000000000012','chef.entrega1@test.local','{"name":"Chef da equipe","team_signup_slug":"adega-a","team_signup_role":"KITCHEN"}','{"provider":"email"}')$q$,
 'convite generalizado permite signup de cozinha');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM public.legal_acceptances WHERE user_id IN('e1100000-0000-0000-0000-000000000011','e1100000-0000-0000-0000-000000000012') AND audience='owner'), 'equipe não é registrada aceitando termos de dono');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM auth.users WHERE email='semconvite.entrega1@test.local'), 'cadastro recusado não deixa identidade Auth órfã');

-- Aceitar por slug também é uma operação restrita à loja e ao papel do convite.
SET ROLE authenticated;
SELECT t.login('e1100000-0000-0000-0000-000000000011');
SELECT t.throws($q$SELECT public.team_accept_invite('adega-b','WAITER')$q$, 'INVITE|convidad|convite', 'aceite por QR A não aceita convite em loja B');
SELECT t.throws($q$SELECT public.team_accept_invite('adega-a','MANAGER')$q$, 'INVITE|convidad|convite', 'aceite não eleva papel do convite');
SELECT t.ok(public.team_accept_invite('adega-a','WAITER') @> '{"tenant_id":"10000000-0000-0000-0000-00000000000a","role":"WAITER"}', 'aceite do QR retorna somente a loja e o papel solicitados');
RESET ROLE;
SELECT t.ok(EXISTS(SELECT 1 FROM public.tenant_users WHERE user_id='e1100000-0000-0000-0000-000000000011' AND tenant_id=:'A' AND role_id='WAITER' AND status='ACTIVE'), 'aceite do convite cria vínculo WAITER ativo');

-- Recuperação de identidade sintética restrita à própria loja e membership reativada.
SET ROLE service_role;
SELECT t.is(public.waiter_reusable_identity(:'A','retorno'),:'ORPHAN'::uuid, 'encontra identidade órfã sintética da própria loja');
SELECT t.is(public.waiter_reusable_identity(:'B','retorno'),NULL::uuid, 'não reutiliza identidade de outra loja');
SELECT t.is(public.waiter_reusable_identity(:'A','privilegiado'),NULL::uuid, 'não reutiliza identidade com papel privilegiado');
SELECT public.waiter_provision(:'A',:'ORPHAN','Garçom Retornado','11999990001','retorno','retorno.adega-a@garcom.deliverychannel.local','retorno.contato@test.local',NULL,:'OWNER');
RESET ROLE;
SELECT t.ok((SELECT count(*)=1 AND bool_and(status='ACTIVE' AND role_id='WAITER') FROM public.tenant_users WHERE user_id=:'ORPHAN' AND tenant_id=:'A'), 'UPSERT reativa membership antiga sem duplicar');
SELECT t.ok(EXISTS(SELECT 1 FROM public.waiter_profiles WHERE user_id=:'ORPHAN' AND tenant_id=:'A' AND username='retorno'), 'provisionamento restaura perfil após reaproveitar Auth');
SET ROLE service_role;
SELECT t.is(public.waiter_reusable_identity(:'A','retorno'),NULL::uuid, 'perfil já provisionado deixa de ser identidade órfã');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.waiter_provision('10000000-0000-0000-0000-00000000000a','e1100000-0000-0000-0000-000000000002','Nome','11999990001','outro','outro.adega-a@garcom.deliverychannel.local',NULL,NULL,'a0000000-0000-0000-0000-000000000001')$q$,
 'permission denied', 'provisionamento continua exclusivo do backend service_role');

-- Cozinha recebe somente a projeção mínima e só transita CONFIRMED -> PREPARING -> READY.
RESET ROLE;
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token) VALUES('e1300000-0000-0000-0000-000000000001',:'A','Mesa Entrega1','entrega1-test-table-token');
INSERT INTO public.dining_tabs(id,tenant_id,table_id,mode,status) VALUES('e1400000-0000-0000-0000-000000000001',:'A','e1300000-0000-0000-0000-000000000001','TABLE','OPEN');
INSERT INTO public.orders(id,tenant_id,status,fulfillment_type,tab_id,round_no,order_number,customer_name,customer_phone,customer_email,delivery_address,subtotal,total_amount,payment_method,payment_status) VALUES
 ('e1500000-0000-0000-0000-000000000001',:'A','CONFIRMED','DELIVERY',NULL,NULL,1101,'SEGREDO_CLIENTE_A','11912345678','segredo.a@test.local','SEGREDO_ENDERECO_A',10,10,'CASH','PENDING'),
 ('e1500000-0000-0000-0000-000000000002',:'A','CONFIRMED','DINE_IN','e1400000-0000-0000-0000-000000000001',2,1102,'SEGREDO_MESA_A','11912345679','segredo.mesa@test.local','SEGREDO_ENDERECO_MESA',20,20,'CASH','PENDING'),
 ('e1500000-0000-0000-0000-000000000003',:'B','CONFIRMED','DELIVERY',NULL,NULL,1103,'SEGREDO_OUTRA_LOJA','11912345670','segredo.b@test.local','SEGREDO_ENDERECO_B',30,30,'CASH','PENDING');
INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price) VALUES
 ('e1500000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-0000000000a1','Item KDS A',1,10,10),
 ('e1500000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-0000000000a1','Item Mesa KDS A',2,10,20),
 ('e1500000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-0000000000b1','Item KDS B',1,30,30);
SET ROLE authenticated;
SELECT t.login(:'KITCHEN'::uuid);
SELECT t.ok(public.has_store_permission(:'A','manage_kitchen') AND NOT public.has_store_permission(:'A','view_orders'), 'cozinha recebe somente permissão de KDS');
SELECT t.ok(NOT public.has_store_permission(:'B','manage_kitchen'), 'cozinha não ganha acesso a outra loja');
SELECT t.ok(public.kitchen_list_orders(:'A') @> '[{"order_id":"e1500000-0000-0000-0000-000000000001"},{"order_id":"e1500000-0000-0000-0000-000000000002"}]', 'KDS lista pedido e rodada DINE_IN CONFIRMED',public.kitchen_list_orders(:'A')::text);
SELECT t.ok(public.kitchen_list_orders(:'A')::text !~ 'customer_phone|delivery_address|customer_email|SEGREDO_CLIENTE_A|SEGREDO_ENDERECO|SEGREDO_OUTRA_LOJA|1191234567', 'LGPD: projeção KDS não inclui contatos, endereço ou dados de outra loja');
SELECT t.ok(t.visible('SELECT * FROM public.orders')<=0, 'cozinha não lê pedidos brutos com contatos');
SELECT t.ok(t.visible('SELECT * FROM public.customers')<=0, 'cozinha não lê cadastro de clientes');
SELECT t.throws($q$SELECT public.kitchen_list_orders('10000000-0000-0000-0000-00000000000b')$q$, 'FORBIDDEN|NOT_FOUND|negad|indispon', 'KDS recusa snapshot de outra loja');
SELECT t.throws($q$SELECT public.kitchen_set_order_status('e1500000-0000-0000-0000-000000000003','PREPARING')$q$, 'FORBIDDEN|NOT_FOUND|negad|indispon', 'cozinha não atualiza pedido B');
SELECT t.throws($q$UPDATE public.orders SET status='READY' WHERE id='e1500000-0000-0000-0000-000000000001'$q$, 'permission denied|FORBIDDEN', 'cozinha não contorna transição por UPDATE direto');
SELECT t.throws($q$SELECT public.kitchen_set_order_status('e1500000-0000-0000-0000-000000000001','READY')$q$, 'FORBIDDEN|TRANSITION|inválid', 'cozinha não pula CONFIRMED para READY');
SELECT public.kitchen_set_order_status('e1500000-0000-0000-0000-000000000001','PREPARING');
SELECT t.is(t.order_status('e1500000-0000-0000-0000-000000000001'),'PREPARING', 'cozinha marca Preparando');
SELECT public.kitchen_set_order_status('e1500000-0000-0000-0000-000000000001','READY');
SELECT t.is(t.order_status('e1500000-0000-0000-0000-000000000001'),'READY', 'cozinha marca Pronto');
SELECT t.ok(NOT(public.kitchen_list_orders(:'A') @> '[{"order_id":"e1500000-0000-0000-0000-000000000001"}]'), 'pedido pronto sai da fila em preparo');
SELECT t.throws($q$SELECT public.kitchen_set_order_status('e1500000-0000-0000-0000-000000000001','DELIVERED')$q$, 'FORBIDDEN|TRANSITION|inválid', 'cozinha nunca marca pedido entregue');
SELECT t.throws($q$SELECT public.update_order_status('e1500000-0000-0000-0000-000000000002','CANCELLED')$q$, 'FORBIDDEN|negad|permiss', 'RPC geral também recusa cancelamento pela cozinha');
SELECT t.throws($q$SELECT public.get_tenant_financial_summary('10000000-0000-0000-0000-00000000000a',now()-interval '1 day',now())$q$, 'FORBIDDEN|negad|financeir', 'cozinha não consulta RPC financeira');

-- Fallback HTTP com service_role valida o ator e aplica a mesma minimização do salão.
RESET ROLE;
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token) VALUES('e1300000-0000-0000-0000-000000000002',:'A','Outra mesa Entrega1','entrega1-test-other-table');
INSERT INTO public.dining_tabs(id,tenant_id,table_id,mode,status) VALUES('e1400000-0000-0000-0000-000000000002',:'A','e1300000-0000-0000-0000-000000000002','TABLE','OPEN');
INSERT INTO public.orders(id,tenant_id,status,fulfillment_type,tab_id,round_no,order_number,customer_name,customer_phone,delivery_address,subtotal,total_amount,payment_method,payment_status) VALUES
 ('e1500000-0000-0000-0000-000000000004',:'A','CONFIRMED','DINE_IN','e1400000-0000-0000-0000-000000000002',1,1104,'SEGREDO_OUTRA_MESA_A','11912345671','ENDERECO_OUTRA_MESA',10,10,'CASH','PENDING');
INSERT INTO public.waiter_table_assignments(tenant_id,table_id,waiter_id,assigned_by) VALUES
 (:'A','e1300000-0000-0000-0000-000000000001',:'ORPHAN',:'OWNER'),
 (:'A','e1300000-0000-0000-0000-000000000002','e1100000-0000-0000-0000-000000000011',:'OWNER');
SET ROLE authenticated;
SELECT t.login(:'ORPHAN'::uuid);
SELECT t.is(t.visible($q$SELECT * FROM public.orders WHERE id='e1500000-0000-0000-0000-000000000002'$q$),1::bigint, 'RLS bruto do garçom permite sua rodada atribuída');
SELECT t.is(t.visible($q$SELECT * FROM public.orders WHERE id='e1500000-0000-0000-0000-000000000004'$q$),0::bigint, 'RLS bruto do garçom esconde mesa atribuída a outro garçom');
SELECT t.is(t.visible($q$SELECT * FROM public.orders WHERE tenant_id='10000000-0000-0000-0000-00000000000b'$q$),0::bigint, 'RLS bruto do garçom esconde pedidos de outra loja');
SET ROLE service_role;
SELECT t.ok(public.salon_rounds_for_staff(:'ORPHAN',:'A') @> '[{"id":"e1500000-0000-0000-0000-000000000002"}]', 'fallback do salão entrega rodada da mesa atribuída ao garçom');
SELECT t.ok(public.salon_rounds_for_staff(:'ORPHAN',:'A')::text !~ 'SEGREDO_OUTRA_MESA_A|SEGREDO_OUTRA_LOJA|customer_phone|delivery_address|customer_email', 'fallback limita garçom às suas mesas e não inclui contatos');
SELECT t.throws($q$SELECT public.salon_rounds_for_staff('a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b')$q$, 'FORBIDDEN|negad|permiss', 'fallback service_role recusa ator de outra loja');
SELECT t.throws($q$SELECT public.salon_rounds_for_staff('a0000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-00000000000a')$q$, 'FORBIDDEN|negad|permiss', 'operador de estoque não recebe mesas por default');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_store_role_permission(:'A','MANAGER','manage_tables',false);
SET ROLE service_role;
SELECT t.throws($q$SELECT public.salon_rounds_for_staff('a0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a')$q$, 'FORBIDDEN|negad|permiss', 'fallback respeita toggle manage_tables removido do gerente');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_store_role_permission(:'A','MANAGER','manage_tables',true);
SELECT t.throws($q$SELECT public.salon_rounds_for_staff('a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a')$q$, 'permission denied', 'cliente autenticado não executa gateway service_role de salão');

-- O modo Central também revoga chamados já atribuídos quando a ferramenta é desligada.
RESET ROLE;
INSERT INTO public.waiter_service_settings(tenant_id,mode) VALUES(:'A','CENTRAL') ON CONFLICT(tenant_id) DO UPDATE SET mode='CENTRAL';
INSERT INTO public.waiter_calls(id,tenant_id,tab_id,type,status) VALUES('e1600000-0000-0000-0000-000000000001',:'A','e1400000-0000-0000-0000-000000000001','CALL','OPEN');
UPDATE public.waiter_calls SET accepted_by=:'ORPHAN',accepted_at=now() WHERE id='e1600000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT t.login(:'ORPHAN'::uuid);
SELECT t.is(t.visible($q$SELECT * FROM public.waiter_calls WHERE id='e1600000-0000-0000-0000-000000000001'$q$),1::bigint, 'Central: garçom vê chamado que já assumiu com ferramenta ativa');

-- Ferramenta desligada bloqueia acesso, convites, pré-checagem e signup no servidor.
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_store_tool(:'A','kitchen',false);
SELECT t.throws($q$SELECT public.create_team_invite('10000000-0000-0000-0000-00000000000a','off.chef@test.local','KITCHEN')$q$, 'TOOL_DISABLED|desligad|ative', 'convite de cozinha recusado com ferramenta off');
SELECT t.login(:'KITCHEN'::uuid);
SELECT t.ok(NOT public.has_store_permission(:'A','manage_kitchen'), 'ferramenta off remove acesso de cozinha');
SELECT t.throws($q$SELECT public.kitchen_list_orders('10000000-0000-0000-0000-00000000000a')$q$, 'KITCHEN_|FORBIDDEN|desligad|indispon', 'KDS bloqueado no servidor quando desligado');
SET ROLE anon;
SELECT t.login(NULL);
SELECT t.is(public.team_invite_check('adega-a','chef.entrega1@test.local','KITCHEN'),'{"invited":false}'::jsonb, 'ferramenta off invalida pré-checagem de convite existente');
RESET ROLE;
SELECT t.throws($q$INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES(gen_random_uuid(),'chef.entrega1@test.local','{"team_signup_slug":"adega-a","team_signup_role":"KITCHEN"}','{"provider":"email"}')$q$, 'INVITE|convidad|convite|desligad', 'trigger não cria Auth com ferramenta cozinha off');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_store_tool(:'A','kitchen',true);
SELECT public.set_store_tool(:'A','waiter',false);
SELECT t.login(:'ORPHAN'::uuid);
SELECT t.is(t.visible('SELECT * FROM public.orders'),0::bigint, 'garçom com ferramenta off não lê pedidos brutos');
SELECT t.is(t.visible('SELECT * FROM public.dining_tabs'),0::bigint, 'garçom com ferramenta off não lê comandas brutas');
SELECT t.is(t.visible('SELECT * FROM public.waiter_calls'),0::bigint, 'Central: ferramenta off revoga até chamado já assumido');
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.create_team_invite('10000000-0000-0000-0000-00000000000a','off.garcom@test.local','WAITER')$q$, 'TOOL_DISABLED|desligad|ative', 'convite de garçom recusado com ferramenta off');
SET ROLE service_role;
SELECT t.throws($q$SELECT public.waiter_set_active('10000000-0000-0000-0000-00000000000a','e1100000-0000-0000-0000-000000000002',true)$q$, 'TOOL_DISABLED|desligad|ative', 'reativação de garçom recusa ferramenta desligada');
SELECT t.is(public.waiter_login_check('adega-a','retorno','fixture-local-ip')->>'allowed','false', 'login simples de garçom bloqueia ferramenta desligada');
SELECT t.throws($q$SELECT public.salon_rounds_for_staff('e1100000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a')$q$, 'FORBIDDEN|TOOL_DISABLED|desligad|permiss', 'gateway do salão recusa garçom com ferramenta off');
SELECT t.throws($q$SELECT public.waiter_provision('10000000-0000-0000-0000-00000000000a','e1100000-0000-0000-0000-000000000002','Nome','11999990001','outro','outro.adega-a@garcom.deliverychannel.local',NULL,NULL,'a0000000-0000-0000-0000-000000000001')$q$, 'TOOL_DISABLED|desligad|ative', 'provisionamento recusa garçom quando ferramenta off');
SET ROLE anon;
SELECT t.is(public.waiter_invite_check('adega-a','ana.entrega1@test.local'),'{"invited":false}'::jsonb, 'garçom off invalida pré-checagem de convite existente');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_store_tool(:'A','waiter',true);

-- Recebimento operacional é permitido ao Caixa, sem reabrir financeiro sensível.
RESET ROLE;
UPDATE public.store_payment_accounts SET status='connected',accepts_pix=true,is_primary=true WHERE tenant_id=:'A' AND provider='manual_pix';
INSERT INTO public.orders(id,tenant_id,customer_id,status,fulfillment_type,order_number,customer_name,customer_phone,delivery_address,subtotal,total_amount,payment_method,payment_status) VALUES
 ('e1500000-0000-0000-0000-000000000005',:'A',NULL,'PENDING','DELIVERY',1105,'Pagamento da equipe','11999990005','Endereço sintético',10,10,'PIX','PENDING'),
 ('e1500000-0000-0000-0000-000000000006',:'A','f0000000-0000-0000-0000-0000000000a7','PENDING','DELIVERY',1106,'Pagamento do próprio cliente','11999990006','Endereço sintético',10,10,'PIX','PENDING');
SET ROLE service_role;
SELECT t.lives($q$SELECT public.reserve_order_payment('e1500000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000004','manual_pix','pix')$q$, 'Caixa pode reservar cobrança da própria loja');
SELECT t.lives($q$SELECT public.reserve_order_payment('e1500000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000007','manual_pix','pix')$q$, 'cliente continua pagando somente seu próprio pedido');
SELECT t.throws($q$SELECT public.reserve_order_payment('e1500000-0000-0000-0000-000000000005','e1100000-0000-0000-0000-000000000001','manual_pix','pix')$q$, 'FORBIDDEN|indispon|permiss', 'Cozinha não reserva cobrança operacional');
SELECT t.throws($q$SELECT public.reserve_order_payment('e1500000-0000-0000-0000-000000000005','b0000000-0000-0000-0000-000000000001','manual_pix','pix')$q$, 'FORBIDDEN|indispon|permiss', 'dono B não reserva cobrança de A');
SELECT public.save_order_charge((SELECT id FROM public.order_payments WHERE order_id='e1500000-0000-0000-0000-000000000005'),'{"manualConfirmation":true,"brcode":"fixture-local-only"}');
SELECT public.confirm_order_payment((SELECT id FROM public.order_payments WHERE order_id='e1500000-0000-0000-0000-000000000005'),'{}','a0000000-0000-0000-0000-000000000004');
SELECT t.is((SELECT status FROM public.order_payments WHERE order_id='e1500000-0000-0000-0000-000000000005'),'paid', 'Caixa confirma recebimento manual autorizado');
SELECT t.throws($q$SELECT public.confirm_order_payment((SELECT id FROM public.order_payments WHERE order_id='e1500000-0000-0000-0000-000000000005'),'{}','e1100000-0000-0000-0000-000000000001')$q$, 'FORBIDDEN|permitid|permiss', 'Cozinha não confirma pagamento nem via repetição idempotente');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_store_role_permission(:'A','MANAGER','manage_orders',false);
SELECT public.set_store_role_permission(:'A','MANAGER','manage_cashier',false);
SET ROLE service_role;
SELECT t.throws($q$SELECT public.reserve_order_payment('e1500000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000002','manual_pix','pix')$q$, 'FORBIDDEN|indispon|permiss', 'reserva por service_role respeita permissões de recebimento removidas do gerente');
SELECT t.throws($q$SELECT public.confirm_order_payment((SELECT id FROM public.order_payments WHERE order_id='e1500000-0000-0000-0000-000000000005'),'{}','a0000000-0000-0000-0000-000000000002')$q$, 'FORBIDDEN|permitid|permiss', 'confirmação por service_role respeita permissões removidas mesmo após pago');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_store_role_permission(:'A','MANAGER','manage_orders',true);

-- ACL mínima e search_path vazio em todos os novos SECURITY DEFINER.
RESET ROLE;
SELECT t.ok((SELECT bool_and(p.prosecdef AND COALESCE(p.proconfig,ARRAY[]::text[]) @> ARRAY['search_path=""'])
 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN('_store_user_permission','_store_waiter_tab_visible','salon_rounds_for_staff','team_accept_invite','_store_role_defaults','_store_tool_enabled','has_store_permission','list_store_tools','get_store_access','list_store_role_permissions','set_store_tool','set_store_role_permission','team_invite_check','waiter_invite_check','_team_signup_invited','waiter_reusable_identity')), 'novos SECURITY DEFINER têm search_path vazio');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.pronamespace='public'::regnamespace AND p.proname IN('_store_user_permission','_store_waiter_tab_visible','salon_rounds_for_staff','team_accept_invite','_store_role_defaults','_store_tool_enabled','has_store_permission','list_store_tools','get_store_access','list_store_role_permissions','set_store_tool','set_store_role_permission','team_invite_check','waiter_invite_check','_team_signup_invited','waiter_reusable_identity') AND a.grantee=0 AND a.privilege_type='EXECUTE'), 'nenhuma função nova mantém EXECUTE de PUBLIC');
SELECT t.ok(has_function_privilege('anon','public.waiter_invite_check(text,text)','EXECUTE') AND has_function_privilege('authenticated','public.waiter_invite_check(text,text)','EXECUTE'), 'pré-checagem só concede execução pública necessária');
SELECT t.ok(NOT has_function_privilege('authenticated','public.waiter_reusable_identity(uuid,text)','EXECUTE') AND has_function_privilege('service_role','public.waiter_reusable_identity(uuid,text)','EXECUTE'), 'recuperação de identidade só é executável por service_role');
SELECT t.ok(NOT has_function_privilege('anon','public._team_signup_invited(text,text,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public._team_signup_invited(text,text,text)','EXECUTE'), 'helper de convite não contorna rate limit');
SELECT t.ok(NOT has_table_privilege('anon','public._entrega1_restore','SELECT') AND NOT has_table_privilege('authenticated','public._entrega1_restore','SELECT'), 'snapshot de rollback não é acessível ao cliente');

SELECT t.ok(NOT has_function_privilege('anon','public.salon_rounds_for_staff(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.salon_rounds_for_staff(uuid,uuid)','EXECUTE') AND has_function_privilege('service_role','public.salon_rounds_for_staff(uuid,uuid)','EXECUTE'), 'fallback de salão tem ACL mínima de service_role');
\ir security_review.sql

