-- Parte B: recibo por e-mail em qualquer fechamento pago, outro e-mail validado, rate limit e LGPD.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set OWNER_B 'b0000000-0000-0000-0000-000000000001'
\set CLIENT 'e1310000-0000-0000-0000-000000000001'
\set WAITER 'e1310000-0000-0000-0000-000000000002'
\set WAITER_OTHER 'e1310000-0000-0000-0000-000000000003'
\set TAB_CASH 'e1330000-0000-0000-0000-000000000011'
\set TAB_NO_EMAIL 'e1330000-0000-0000-0000-000000000012'
RESET ROLE;
SELECT t.login(NULL);

INSERT INTO public.dining_tables(id,tenant_id,label,qr_token) VALUES
 ('e1320000-0000-0000-0000-000000000011',:'A','Mesa B 11','entrega1-3-b-token-11'),
 ('e1320000-0000-0000-0000-000000000012',:'A','Mesa B 12','entrega1-3-b-token-12');
INSERT INTO public.waiter_table_assignments(tenant_id,table_id,waiter_id,assigned_by) VALUES
 (:'A','e1320000-0000-0000-0000-000000000011',:'WAITER',:'OWNER'),
 (:'A','e1320000-0000-0000-0000-000000000012',:'WAITER',:'OWNER');
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,status,service_fee_percent,responsible_user_id) VALUES
 (:'TAB_CASH',:'A','TABLE','e1320000-0000-0000-0000-000000000011','OPEN',10,:'CLIENT'),
 (:'TAB_NO_EMAIL',:'A','TABLE','e1320000-0000-0000-0000-000000000012','OPEN',0,NULL);
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at) VALUES
 ('e1340000-0000-0000-0000-000000000011',:'A',:'TAB_CASH',:'CLIENT','Cliente B','entrega1-3-b-11',now());
INSERT INTO public.orders(id,tenant_id,tab_id,round_no,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address) VALUES
 ('e1350000-0000-0000-0000-000000000011',:'A',:'TAB_CASH',1,'DINE_IN','DELIVERED',40,40,'CASH','PENDING','DINE_IN_QR',1311,'Cliente B','11900000000','Mesa B 11'),
 ('e1350000-0000-0000-0000-000000000012',:'A',:'TAB_NO_EMAIL',1,'DINE_IN','DELIVERED',25,25,'CASH','PENDING','DINE_IN_QR',1312,'Mesa Avulsa','11900000000','Mesa B 12');
INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price) VALUES
 ('e1350000-0000-0000-0000-000000000011','d0000000-0000-0000-0000-0000000000a1','Prato B',2,20,40),
 ('e1350000-0000-0000-0000-000000000012','d0000000-0000-0000-0000-0000000000a1','Lanche B',1,25,25);

-- Item 8 + 11: dono autoriza garçom; garçom fecha a conta e envia recibo.
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.staff_request_bill(:'TAB_CASH');
SELECT public.staff_request_bill(:'TAB_NO_EMAIL');
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws($q$SELECT public.close_tab('e1330000-0000-0000-0000-000000000011','[{"method":"CASH","amount_cents":4400}]')$q$,'WAITER_NOT_AUTHORIZED','B8 garçom sem autorização não fecha conta');
SELECT t.login(:'OWNER'::uuid);
SELECT public.authorize_waiter_to_close(:'TAB_CASH');
SELECT t.login(:'WAITER_OTHER'::uuid);
SELECT t.throws($q$SELECT public.close_tab('e1330000-0000-0000-0000-000000000011','[{"method":"CASH","amount_cents":4400}]')$q$,'WAITER_NOT_AUTHORIZED','B8 outro garçom não fecha mesa alheia');
SELECT t.login(:'WAITER'::uuid);
SELECT public.close_tab(:'TAB_CASH','[{"method":"CASH","amount_cents":4400,"change_given_cents":600}]');
SELECT t.is(public.tab_receipt_target(:'TAB_CASH')->>'email_masked','cl***@te***.example','B11 máscara exibida ao garçom após fechamento');
SELECT t.throws($q$SELECT public.reserve_tab_receipt('e1330000-0000-0000-0000-000000000011','e1310000-0000-0000-0000-000000000002','outro@exemplo.com')$q$,'permission denied','B11 navegador não chama reserve_tab_receipt direto');

SET ROLE service_role;
SELECT t.throws($q$SELECT public.reserve_tab_receipt('e1330000-0000-0000-0000-000000000011','e1310000-0000-0000-0000-000000000003',NULL)$q$,'FORBIDDEN','B11 garçom de outra mesa não envia recibo');
SELECT t.throws($q$SELECT public.reserve_tab_receipt('e1330000-0000-0000-0000-000000000011','b0000000-0000-0000-0000-000000000001',NULL)$q$,'FORBIDDEN','B11 dono de outra loja não envia recibo');
SELECT t.throws($q$SELECT public.reserve_tab_receipt('e1330000-0000-0000-0000-000000000011','e1310000-0000-0000-0000-000000000002','email-invalido')$q$,'INVALID_EMAIL','B11 e-mail alternativo inválido recusado');
SELECT public.reserve_tab_receipt(:'TAB_CASH',:'WAITER') AS receipt_cash \gset
SELECT t.ok(:'receipt_cash'::jsonb @> '{"recipient_email":"cliente@test.example","total_cents":4400,"service_fee_cents":400,"method":"CASH"}','B11 recibo de fechamento em dinheiro usa e-mail cadastrado');
SELECT public.finish_tab_receipt((:'receipt_cash'::jsonb->>'attempt_id')::uuid,true,NULL);

-- Enviar para outro e-mail validado (na mesma conta e em conta sem e-mail cadastrado).
SELECT public.reserve_tab_receipt(:'TAB_CASH',:'OWNER','  Cliente.Extra@Dominio.com.br ') AS receipt_alt \gset
SELECT t.is(:'receipt_alt'::jsonb->>'recipient_email','cliente.extra@dominio.com.br','B11 recibo enviado para outro e-mail validado');
SELECT public.finish_tab_receipt((:'receipt_alt'::jsonb->>'attempt_id')::uuid,false,'EMAIL_PROVIDER_NOT_CONFIGURED');

SELECT public.reserve_tab_receipt(:'TAB_CASH',:'OWNER','terceiro@dominio.com.br') AS receipt_third \gset
SELECT public.finish_tab_receipt((:'receipt_third'::jsonb->>'attempt_id')::uuid,true,NULL);
SELECT t.throws($q$SELECT public.reserve_tab_receipt('e1330000-0000-0000-0000-000000000011','a0000000-0000-0000-0000-000000000001','quarto@dominio.com.br')$q$,'Muitos envios','B11 rate limit de 3 envios por conta inclui e-mails alternativos');

-- Conta fechada sem titular autenticado exige e-mail alternativo válido.
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.close_tab(:'TAB_NO_EMAIL','[{"method":"CASH","amount_cents":1000},{"method":"CREDIT_CARD","amount_cents":1500}]');
SELECT t.ok(NOT (public.tab_receipt_target(:'TAB_NO_EMAIL')->>'exists')::boolean,'B11 conta avulsa informa ausência de e-mail cadastrado');
SET ROLE service_role;
SELECT t.throws($q$SELECT public.reserve_tab_receipt('e1330000-0000-0000-0000-000000000012','a0000000-0000-0000-0000-000000000001',NULL)$q$,'Cliente sem e-mail','B11 sem e-mail cadastrado e sem alternativo recusa envio');
SELECT public.reserve_tab_receipt(:'TAB_NO_EMAIL',:'OWNER','avulso@cliente.com') AS receipt_no_holder \gset
SELECT t.ok(:'receipt_no_holder'::jsonb @> '{"recipient_email":"avulso@cliente.com","total_cents":2500,"method":"CASH + CREDIT_CARD"}','B11 recibo misto preserva formas e permite email alternativo sem email cadastrado');
SELECT public.finish_tab_receipt((:'receipt_no_holder'::jsonb->>'attempt_id')::uuid,true,NULL);

RESET ROLE;
SELECT t.ok(NOT EXISTS(SELECT 1 FROM public.tab_receipt_sends s WHERE to_jsonb(s)::text LIKE '%@%'),'B11 LGPD nenhum e-mail persistido em tab_receipt_sends');
SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public._entrega1_3_b_restore'::regclass),'B segurança RLS no snapshot de B');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname='reserve_tab_receipt' AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[])),'B segurança reserve_tab_receipt com search_path vazio');

-- Review: a single-address field cannot become a display-name/address list or header.
SET ROLE service_role;
SELECT t.throws($q$SELECT public.reserve_tab_receipt('e1330000-0000-0000-0000-000000000012','a0000000-0000-0000-0000-000000000001','nome<alvo@example.com>')$q$,'INVALID_EMAIL','B revisão recusa display name no destinatário');
SELECT t.throws($q$SELECT public.reserve_tab_receipt('e1330000-0000-0000-0000-000000000012','a0000000-0000-0000-0000-000000000001','alvo,lista@example.com')$q$,'INVALID_EMAIL','B revisão recusa pontuação de lista no destinatário');
SELECT t.throws($q$SELECT public.reserve_tab_receipt('e1330000-0000-0000-0000-000000000012','a0000000-0000-0000-0000-000000000001',E'alvo@example.com\r\n')$q$,'INVALID_EMAIL','B revisão recusa CRLF no destinatário');
SELECT t.throws($q$SELECT public.reserve_tab_receipt('e1330000-0000-0000-0000-000000000012','a0000000-0000-0000-0000-000000000001','a@example..com')$q$,'INVALID_EMAIL','B revisão recusa domínio inválido');
SELECT t.throws($q$SELECT public.authorize_tab_receipt('e1330000-0000-0000-0000-000000000011','b0000000-0000-0000-0000-000000000001')$q$,'FORBIDDEN','B revisão configuração ausente não ignora outra loja');
SELECT t.throws($q$SELECT public.authorize_tab_receipt('e1330000-0000-0000-0000-000000000011','e1310000-0000-0000-0000-000000000003')$q$,'FORBIDDEN','B revisão configuração ausente não ignora mesa de outro garçom');
SELECT public.authorize_tab_receipt(:'TAB_CASH',:'WAITER');
SELECT public.authorize_tab_receipt(:'TAB_CASH',:'OWNER');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.tab_receipt_sends WHERE tab_id=:'TAB_CASH'),3::bigint,'B revisão checagem de configuração não consome cota de envios');
SET ROLE authenticated;
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$SELECT public.tab_receipt_target('e1330000-0000-0000-0000-000000000011')$q$,'FORBIDDEN','B revisão cliente não lê nem máscara de comprovante');
SELECT t.throws($q$SELECT public.authorize_tab_receipt('e1330000-0000-0000-0000-000000000011','a0000000-0000-0000-0000-000000000001')$q$,'permission denied','B revisão navegador não escolhe ator na autorização');
SELECT t.throws('SELECT * FROM public.tab_receipt_sends','permission denied','B revisão cliente não enumera auditoria privada de recibos');
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.throws($q$SELECT public.tab_receipt_target('e1330000-0000-0000-0000-000000000011')$q$,'FORBIDDEN','B revisão equipe de outra loja não lê máscara de email');
RESET ROLE;

-- A joined secondary waiter loses live table links at closure. Closing identity
-- must retain this account's receipt, without granting other accounts or quota.
RESET ROLE;
SELECT t.login(NULL);
UPDATE public.waiter_table_assignments SET waiter_id=:'WAITER_OTHER'
 WHERE tenant_id=:'A' AND table_id='e1320000-0000-0000-0000-000000000011';
SELECT t.is((SELECT closed_by FROM public.dining_tabs WHERE id=:'TAB_CASH'),:'WAITER'::uuid,'B revisão fechamento registra ator original');
SELECT t.ok(NOT public._waiter_serves_tab(:'TAB_CASH',:'WAITER'),'B revisão reproduz perda do vínculo de mesa após fechamento');
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT t.is(public.tab_receipt_target(:'TAB_CASH')->>'email_masked','cl***@te***.example','B revisão garçom que fechou mantém somente máscara da conta encerrada');
SET ROLE service_role;
SELECT public.authorize_tab_receipt(:'TAB_CASH',:'WAITER');
SELECT t.throws($q$SELECT public.reserve_tab_receipt('e1330000-0000-0000-0000-000000000011','e1310000-0000-0000-0000-000000000002','recibo@example.com')$q$,'Muitos envios','B revisão identidade de fechamento mantém rate limit da mesma conta');
SELECT t.throws($q$SELECT public.authorize_tab_receipt('e1330000-0000-0000-0000-000000000012','e1310000-0000-0000-0000-000000000003')$q$,'FORBIDDEN','B revisão outro garçom não herda recibo de conta que não fechou');
RESET ROLE;
SELECT t.login(NULL);
UPDATE public.waiter_table_assignments SET waiter_id=:'WAITER'
 WHERE tenant_id=:'A' AND table_id='e1320000-0000-0000-0000-000000000011';

-- Webhook PIX has no authenticated closer; only its trusted paid-charge requester
-- gets the fallback entitlement, scoped to the same account and store.
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token) VALUES
 ('e1320000-0000-0000-0000-000000000013',:'A','Mesa B 13','entrega1-3-b-token-13');
INSERT INTO public.waiter_table_assignments(tenant_id,table_id,waiter_id,assigned_by) VALUES
 (:'A','e1320000-0000-0000-0000-000000000013',:'WAITER_OTHER',:'OWNER');
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,status,service_fee_percent,responsible_user_id) VALUES
 ('e1330000-0000-0000-0000-000000000013',:'A','TABLE','e1320000-0000-0000-0000-000000000013','OPEN',0,:'CLIENT');
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at) VALUES
 ('e1340000-0000-0000-0000-000000000013',:'A','e1330000-0000-0000-0000-000000000013',:'CLIENT','Cliente PIX B','entrega1-3-b-13',now());
INSERT INTO public.orders(id,tenant_id,tab_id,round_no,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address) VALUES
 ('e1350000-0000-0000-0000-000000000013',:'A','e1330000-0000-0000-0000-000000000013',1,'DINE_IN','DELIVERED',10,10,'PIX','PAID','DINE_IN_QR',1313,'Cliente PIX B','11900000000','Mesa B 13');
INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price) VALUES
 ('e1350000-0000-0000-0000-000000000013','d0000000-0000-0000-0000-0000000000a1','Prato PIX B',1,10,10);
INSERT INTO public.tab_pix_charges(id,tenant_id,tab_id,amount_cents,status,paid_at,created_by) VALUES
 ('e1360000-0000-0000-0000-000000000013',:'A','e1330000-0000-0000-0000-000000000013',1000,'paid',now(),:'WAITER');
INSERT INTO public.tab_payments(tenant_id,tab_id,method,amount_cents) VALUES
 (:'A','e1330000-0000-0000-0000-000000000013','PIX',1000);
UPDATE public.dining_tabs SET status='CLOSED',closed_at=now() WHERE id='e1330000-0000-0000-0000-000000000013';
SELECT t.ok((SELECT closed_by IS NULL FROM public.dining_tabs WHERE id='e1330000-0000-0000-0000-000000000013'),'B revisão webhook PIX não depende de closed_by autenticado');
SELECT t.ok(NOT public._waiter_serves_tab('e1330000-0000-0000-0000-000000000013',:'WAITER'),'B revisão solicitante PIX não tem mais vínculo da mesa');
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT t.is(public.tab_receipt_target('e1330000-0000-0000-0000-000000000013')->>'email_masked','cl***@te***.example','B revisão solicitante da cobrança PIX paga mantém máscara após liberação');
SET ROLE service_role;
SELECT public.reserve_tab_receipt('e1330000-0000-0000-0000-000000000013',:'WAITER') AS receipt_pix_after_group \gset
SELECT t.is(:'receipt_pix_after_group'::jsonb->>'method','PIX','B revisão solicitante PIX envia recibo após perda do vínculo');
RESET ROLE;
SELECT t.login(NULL);
