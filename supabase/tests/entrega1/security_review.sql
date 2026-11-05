-- PR #18: regressões de identidade explícita, enumeração sem IP e Auth gerenciado.
-- Apenas fixtures locais sintéticas; pode rodar sobre o predecessor + Entrega 1.
RESET ROLE;
SELECT t.login(NULL);
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
SET ROLE service_role;
SELECT t.ok(auth.uid() IS NULL AND auth.role()='service_role', 'revisão: fixture representa serviço sem usuário logado');
SELECT t.ok(public.has_tenant_permission('a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','view_finances'), 'serviço avalia permissão do ator explícito sem auth.uid');
SELECT t.ok(NOT public.has_tenant_permission('a0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a','view_finances'), 'serviço não amplia financeiro do gerente');
SELECT t.ok(NOT public.has_tenant_permission('b0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','view_orders'), 'serviço não ignora a loja do ator explícito');
SELECT t.ok(NOT public.has_tenant_permission(NULL,'10000000-0000-0000-0000-00000000000a','view_orders'), 'serviço sem ator explícito não recebe permissão');
RESET ROLE;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT t.login('a0000000-0000-0000-0000-000000000002');
SET ROLE authenticated;
SELECT t.ok(public.has_tenant_permission(auth.uid(),'10000000-0000-0000-0000-00000000000a','manage_inventory'), 'chamada autenticada conserva permissão própria');
SELECT t.ok(NOT public.has_tenant_permission('a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','view_finances'), 'cliente autenticado não usa ator dono para se passar por serviço');

-- Sem IP, consultar outros e-mails continua na mesma cota da loja.
RESET ROLE;
SELECT t.login(NULL);
SELECT set_config('request.jwt.claim.role','',false);
SELECT set_config('request.headers','{}',false);
DELETE FROM public.security_rate_limits WHERE scope IN('waiter_invite_check','team_invite_check');
UPDATE public.store_tools SET enabled=true WHERE tenant_id IN('10000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000b') AND tool='waiter';
INSERT INTO public.store_tools(tenant_id,tool,enabled) VALUES
 ('10000000-0000-0000-0000-00000000000a','waiter',true),
 ('10000000-0000-0000-0000-00000000000b','waiter',true)
ON CONFLICT(tenant_id,tool) DO UPDATE SET enabled=true;
INSERT INTO public.team_invites(tenant_id,email,role_id,invited_by,status,expires_at) VALUES
 ('10000000-0000-0000-0000-00000000000a','rate-review@test.local','WAITER','a0000000-0000-0000-0000-000000000001','PENDING',now()+interval '1 day'),
 ('10000000-0000-0000-0000-00000000000b','rate-review@test.local','WAITER','b0000000-0000-0000-0000-000000000001','PENDING',now()+interval '1 day');
SET ROLE anon;
DO $$
DECLARE n integer; v jsonb;
BEGIN
 FOR n IN 1..10 LOOP
  v:=public.waiter_invite_check('adega-a','different-'||n||'@test.local');
  PERFORM t.is(v,'{"invited":false}'::jsonb,'sem IP permite consulta '||n||'/10 mesmo com e-mail diferente');
 END LOOP;
 PERFORM t.is(public.waiter_invite_check('adega-a','rate-review@test.local'),'{"invited":false,"rate_limited":true}'::jsonb,'sem IP não enumera convite válido após dez outros e-mails');
 PERFORM t.is(public.waiter_invite_check('ADEGA-A','another@test.local'),'{"invited":false,"rate_limited":true}'::jsonb,'variação de caixa do slug não reinicia cota sem IP');
 PERFORM t.is(public.waiter_invite_check('adega-b','rate-review@test.local'),'{"invited":true}'::jsonb,'cota sem IP de outra loja permanece independente');
END $$;
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.security_rate_limits WHERE scope='waiter_invite_check' AND tenant_id='10000000-0000-0000-0000-00000000000a'),1::bigint,'consultas sem IP a vários e-mails geram um único bucket na loja');
DELETE FROM public.security_rate_limits WHERE scope IN('waiter_invite_check','team_invite_check');
SET ROLE anon;
DO $$
DECLARE n integer; v jsonb;
BEGIN
 FOR n IN 1..10 LOOP
  v:=public.team_invite_check('adega-a','team-'||n||'@test.local',CASE WHEN n%2=0 THEN 'MANAGER' ELSE 'CASHIER' END);
 END LOOP;
 PERFORM t.is(v,'{"invited":false}'::jsonb,'pré-checagem generalizada também usa dez consultas sem IP');
 PERFORM t.is(public.team_invite_check('adega-a','another-team@test.local','DRIVER'),'{"invited":false,"rate_limited":true}'::jsonb,'trocar e-mail e papel não reinicia a cota generalizada sem IP');
END $$;

-- Existência de waiter_profiles, por si só, nunca autoriza reset/unban global.
RESET ROLE;
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('e1800000-0000-0000-0000-000000000001','guardvalid.adega-a@garcom.deliverychannel.local','{"waiter_tenant_id":"10000000-0000-0000-0000-00000000000a"}'),
 ('e1800000-0000-0000-0000-000000000002','guardpromoted.adega-a@garcom.deliverychannel.local','{"waiter_tenant_id":"10000000-0000-0000-0000-00000000000a"}'),
 ('e1800000-0000-0000-0000-000000000003','guardshared.adega-a@garcom.deliverychannel.local','{"waiter_tenant_id":"10000000-0000-0000-0000-00000000000a"}'),
 ('e1800000-0000-0000-0000-000000000004','personal-review@test.local','{}');
SET ROLE service_role;
SELECT public.waiter_provision('10000000-0000-0000-0000-00000000000a','e1800000-0000-0000-0000-000000000001','Garçom válido','11900000000','guardvalid','guardvalid.adega-a@garcom.deliverychannel.local',NULL,NULL,'a0000000-0000-0000-0000-000000000001');
SELECT public.waiter_provision('10000000-0000-0000-0000-00000000000a','e1800000-0000-0000-0000-000000000002','Garçom promovido','11900000000','guardpromoted','guardpromoted.adega-a@garcom.deliverychannel.local',NULL,NULL,'a0000000-0000-0000-0000-000000000001');
SELECT public.waiter_provision('10000000-0000-0000-0000-00000000000a','e1800000-0000-0000-0000-000000000003','Garçom compartilhado','11900000000','guardshared','guardshared.adega-a@garcom.deliverychannel.local',NULL,NULL,'a0000000-0000-0000-0000-000000000001');
RESET ROLE;
UPDATE public.tenant_users SET role_id='OWNER' WHERE tenant_id='10000000-0000-0000-0000-00000000000a' AND user_id='e1800000-0000-0000-0000-000000000002';
INSERT INTO public.tenant_users(user_id,tenant_id,role_id,status) VALUES
 ('e1800000-0000-0000-0000-000000000003','10000000-0000-0000-0000-00000000000b','MANAGER','ACTIVE'),
 ('e1800000-0000-0000-0000-000000000004','10000000-0000-0000-0000-00000000000a','WAITER','ACTIVE');
INSERT INTO public.waiter_profiles(user_id,tenant_id,username,phone,created_by) VALUES
 ('e1800000-0000-0000-0000-000000000004','10000000-0000-0000-0000-00000000000a','guardpersonal','11900000000','a0000000-0000-0000-0000-000000000001');
SET ROLE service_role;
SELECT t.ok(public.waiter_assert_member('10000000-0000-0000-0000-00000000000a','e1800000-0000-0000-0000-000000000001'),'conta sintética exclusiva de garçom continua gerenciável');
SELECT public.waiter_set_active('10000000-0000-0000-0000-00000000000a','e1800000-0000-0000-0000-000000000001',false);
SELECT t.ok(public.waiter_assert_member('10000000-0000-0000-0000-00000000000a','e1800000-0000-0000-0000-000000000001'),'garçom suspenso legítimo continua elegível para reativação');
SELECT public.waiter_set_active('10000000-0000-0000-0000-00000000000a','e1800000-0000-0000-0000-000000000001',true);
SELECT t.ok(NOT public.waiter_assert_member('10000000-0000-0000-0000-00000000000a','e1800000-0000-0000-0000-000000000002'),'perfil antigo de usuário promovido a dono não autoriza mutação de Auth');
SELECT t.ok(NOT public.waiter_assert_member('10000000-0000-0000-0000-00000000000a','e1800000-0000-0000-0000-000000000003'),'conta com outro vínculo não autoriza mutação global de Auth');
SELECT t.ok(NOT public.waiter_assert_member('10000000-0000-0000-0000-00000000000a','e1800000-0000-0000-0000-000000000004'),'conta pessoal não autoriza reset ou unban de Auth');
SELECT t.ok(NOT public.waiter_assert_member('10000000-0000-0000-0000-00000000000b','e1800000-0000-0000-0000-000000000001'),'garçom de outra loja não é gerenciável');
SELECT t.throws($q$SELECT public.waiter_set_active('10000000-0000-0000-0000-00000000000a','e1800000-0000-0000-0000-000000000002',true)$q$,'IDENTITY_NOT_MANAGED','RPC não reativa perfil antigo de conta promovida');
SELECT t.throws($q$SELECT public.waiter_update_profile('10000000-0000-0000-0000-00000000000a','e1800000-0000-0000-0000-000000000003','Alteração recusada','11900000000',NULL,false)$q$,'IDENTITY_NOT_MANAGED','RPC não altera perfil global de conta compartilhada');
RESET ROLE;
SELECT t.is((SELECT role_id FROM public.tenant_users WHERE tenant_id='10000000-0000-0000-0000-00000000000a' AND user_id='e1800000-0000-0000-0000-000000000002'),'OWNER'::varchar,'recusa de reativação preserva papel privilegiado');
SELECT t.ok(NOT has_function_privilege('anon','public.waiter_assert_member(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.waiter_assert_member(uuid,uuid)','EXECUTE') AND has_function_privilege('service_role','public.waiter_assert_member(uuid,uuid)','EXECUTE'),'assert de identidade gerenciada conserva ACL mínima service_role');
SELECT set_config('request.jwt.claim.role','',false);
SELECT t.login(NULL);

