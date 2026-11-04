-- Somente fixtures sintéticas em PostgreSQL LOCAL descartável.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set OWNER_B 'b0000000-0000-0000-0000-000000000001'
\set CLIENT 'e1110000-0000-0000-0000-000000000001'
\set OTHER 'e1110000-0000-0000-0000-000000000002'
\set WAITER 'e1110000-0000-0000-0000-000000000003'
RESET ROLE;
SELECT t.login(NULL);
INSERT INTO auth.users(id,email) VALUES(:'CLIENT','joao@test.example'),(:'OTHER','outro@test.example'),(:'WAITER','waiter@test.example');
INSERT INTO public.tenant_users(tenant_id,user_id,role_id,status) VALUES(:'A',:'WAITER','WAITER','ACTIVE');
INSERT INTO public.tenant_modules(tenant_id,module_key,enabled,config) VALUES
 (:'A','dine_in',true,'{"mode":"TABLE","salon_open":true}'),(:'B','dine_in',true,'{"mode":"TABLE","salon_open":true}')
ON CONFLICT(tenant_id,module_key) DO UPDATE SET enabled=true,config=EXCLUDED.config;
INSERT INTO public.store_tools(tenant_id,tool,enabled) VALUES(:'A','waiter',true),(:'B','waiter',true)
ON CONFLICT(tenant_id,tool) DO UPDATE SET enabled=true;
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token)
SELECT ('e1120000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,:'A','Mesa A'||n,'entrega1-1-token-'||n FROM generate_series(1,6) n;
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,status,service_fee_percent,responsible_user_id)
SELECT ('e1130000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,:'A','TABLE',
 ('e1120000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'OPEN',10,:'CLIENT' FROM generate_series(1,6) n;
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at)
SELECT ('e1140000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,:'A',
 ('e1130000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,:'CLIENT','Cliente sintético','fixture-'||n,now() FROM generate_series(1,6) n;
INSERT INTO public.orders(id,tenant_id,tab_id,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address)
SELECT ('e1150000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,:'A',
 ('e1130000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'DINE_IN','CONFIRMED',50,50,'CASH','PENDING','DINE_IN_QR',1100+n,'Cliente sintético','11900000000','Mesa sintética'
FROM generate_series(1,6) n;
INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price)
SELECT ('e1150000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'d0000000-0000-0000-0000-0000000000a1','Item sintético',5,10,50 FROM generate_series(1,6) n;
UPDATE public.dining_tabs SET status='BILL_REQUESTED' WHERE id::text LIKE 'e1130000-%';

-- A1: reprodução do fluxo real, incluindo a sessão que mantém a mesa ocupada.
SELECT public.reserve_tab_pix('e1130000-0000-0000-0000-000000000001',:'OWNER');
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id='e1130000-0000-0000-0000-000000000001'),'AWAITING_PAYMENT','A1 reserve mantém mesa aguardando PIX');
SELECT t.ok((SELECT ended_at IS NULL FROM public.tab_sessions WHERE id='e1140000-0000-0000-0000-000000000001'),'A1 gerar PIX não encerra sessão da mesa');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.close_tab('e1130000-0000-0000-0000-000000000001','[{"method":"CASH","amount_cents":5500}]')$q$,'PIX_NOT_CONFIRMED','A1 fechamento manual recusa PIX pendente');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.is(public.get_my_tab('e1140000-0000-0000-0000-000000000001')->>'pixStatus','creating','A1 cliente vê PIX em criação sem liberar comanda');
SELECT t.throws($q$SELECT public.reopen_tab_from_bill('e1140000-0000-0000-0000-000000000001')$q$,'INVALID_STATE|PAYMENT_IN_PROGRESS','A4 cliente não reabre durante PIX');
RESET ROLE;
UPDATE public.tab_pix_charges SET status='pending',provider_payment_id='entrega1-1-paid',expires_at=now()+interval '5 minutes'
 WHERE tab_id='e1130000-0000-0000-0000-000000000001';
SELECT public.confirm_tab_pix(id,jsonb_build_object('paid',true,'rawStatus','approved','providerPaymentId','entrega1-1-paid','orderId','tab:'||tab_id,'currency','BRL','amountCents',5500))
FROM public.tab_pix_charges WHERE tab_id='e1130000-0000-0000-0000-000000000001';
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id='e1130000-0000-0000-0000-000000000001'),'CLOSED','A1 somente confirmação paga fecha a comanda');
SELECT t.ok((SELECT ended_at IS NOT NULL AND ended_reason='TAB_CLOSED' FROM public.tab_sessions WHERE id='e1140000-0000-0000-0000-000000000001'),'A1 pagamento encerra a sessão da mesa');
SELECT t.is((SELECT count(*) FROM public.tab_payments WHERE tab_id='e1130000-0000-0000-0000-000000000001'),1::bigint,'A1 pagamento PIX lançado uma vez');
SELECT public.confirm_tab_pix(id,'{"paid":true}'::jsonb) FROM public.tab_pix_charges WHERE tab_id='e1130000-0000-0000-0000-000000000001';
SELECT t.is((SELECT count(*) FROM public.tab_payments WHERE tab_id='e1130000-0000-0000-0000-000000000001'),1::bigint,'A1 confirmação repetida é idempotente');

SELECT public.reserve_tab_pix('e1130000-0000-0000-0000-000000000002',:'OWNER');
UPDATE public.tab_pix_charges SET status='pending' WHERE tab_id='e1130000-0000-0000-0000-000000000002';
SELECT public.confirm_tab_pix(id,'{"paid":false,"rawStatus":"expired"}') FROM public.tab_pix_charges WHERE tab_id='e1130000-0000-0000-0000-000000000002';
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id='e1130000-0000-0000-0000-000000000002'),'BILL_REQUESTED','A1 PIX expirado restaura conta pedida');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.authorize_waiter_to_close('e1130000-0000-0000-0000-000000000003');
RESET ROLE;
SELECT public.reserve_tab_pix('e1130000-0000-0000-0000-000000000003',:'OWNER');
UPDATE public.tab_pix_charges SET status='pending' WHERE tab_id='e1130000-0000-0000-0000-000000000003';
SELECT public.confirm_tab_pix(id,'{"paid":false,"rawStatus":"cancelled"}') FROM public.tab_pix_charges WHERE tab_id='e1130000-0000-0000-0000-000000000003';
SELECT t.is((SELECT status FROM public.dining_tabs WHERE id='e1130000-0000-0000-0000-000000000003'),'WAITER_AUTHORIZED','A1 PIX cancelado conserva autorização anterior');

-- A4: autorização da sessão, mudança de estado, autorização limpa e alertas.
SET ROLE authenticated;
SELECT t.login(:'OTHER'::uuid);
SELECT t.throws($q$SELECT public.reopen_tab_from_bill('e1140000-0000-0000-0000-000000000003')$q$,'FORBIDDEN','A4 sessão de outro cliente recusada');
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.throws($q$SELECT public.staff_reopen_tab('e1130000-0000-0000-0000-000000000003')$q$,'FORBIDDEN','A4 equipe de outra loja recusada');
SELECT t.login(:'CLIENT'::uuid);
SELECT public.reopen_tab_from_bill('e1140000-0000-0000-0000-000000000003');
SELECT t.is(t.sq($q$SELECT status FROM public.dining_tabs WHERE id='e1130000-0000-0000-0000-000000000003'$q$),'OPEN','A4 Pedir mais reabre comanda');
RESET ROLE;
SELECT t.ok((SELECT waiter_authorized_by IS NULL AND waiter_authorized_at IS NULL FROM public.dining_tabs WHERE id='e1130000-0000-0000-0000-000000000003'),'A4 autorização antiga é limpa');
SELECT t.ok(EXISTS(SELECT 1 FROM public.owner_notifications WHERE kind='TAB_REOPENED' AND ref_id='e1130000-0000-0000-0000-000000000003' AND tenant_id=:'A'),'A4 dono recebe notificação na própria loja');
SELECT t.ok(EXISTS(SELECT 1 FROM public.waiter_calls WHERE type='CALL' AND status='OPEN' AND tab_id='e1130000-0000-0000-0000-000000000003'),'A4 garçom recebe chamado');
INSERT INTO public.waiter_calls(tenant_id,tab_id,type) VALUES(:'A','e1130000-0000-0000-0000-000000000004','BILL');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.staff_reopen_tab('e1130000-0000-0000-0000-000000000004');
RESET ROLE;
SELECT t.ok(NOT EXISTS(SELECT 1 FROM public.waiter_calls WHERE type='BILL' AND status='OPEN' AND tab_id='e1130000-0000-0000-0000-000000000004'),'A4 solicitação antiga da conta cancelada');
DO $$ DECLARE n integer; BEGIN
 FOR n IN 1..3 LOOP
  UPDATE public.dining_tabs SET status='BILL_REQUESTED' WHERE id='e1130000-0000-0000-0000-000000000005';
  PERFORM public._reopen_tab_from_bill('e1130000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000001','STAFF');
 END LOOP;
END $$;
UPDATE public.dining_tabs SET status='BILL_REQUESTED' WHERE id='e1130000-0000-0000-0000-000000000005';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.staff_reopen_tab('e1130000-0000-0000-0000-000000000005')$q$,'RATE_LIMITED','A4 quarta reabertura em dez minutos recusada');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$SELECT public.reopen_tab_from_bill('e1140000-0000-0000-0000-000000000001')$q$,'FORBIDDEN|INVALID_STATE','A4 cliente não reabre comanda paga');
RESET ROLE;
INSERT INTO public.tab_pix_charges(tenant_id,tab_id,amount_cents,status,paid_at,needs_review) VALUES(:'A','e1130000-0000-0000-0000-000000000006',5500,'paid',now(),true);
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.staff_reopen_tab('e1130000-0000-0000-0000-000000000006')$q$,'PAYMENT_IN_PROGRESS','A4 PIX pago em revisão também bloqueia reabertura');

-- A2: só máscara no navegador; e-mail completo em RPC restrita ao servidor.
SELECT t.is(public.tab_receipt_target('e1130000-0000-0000-0000-000000000001')->>'email_masked','jo***@te***.example','A2 máscara de e-mail no retorno da equipe');
SELECT t.ok((public.tab_receipt_target('e1130000-0000-0000-0000-000000000001')->>'exists')::boolean,'A2 destinatário existente');
SELECT t.ok(public.tab_receipt_target('e1130000-0000-0000-0000-000000000001')::text NOT LIKE '%joao@test.example%','A2 e-mail completo ausente da resposta da equipe');
SELECT t.throws($q$SELECT public._tab_receipt_email('e1130000-0000-0000-0000-000000000001')$q$,'permission denied','A2 helper de e-mail não é RPC pública');
SELECT t.throws($q$SELECT public.reserve_tab_receipt('e1130000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001')$q$,'permission denied','A2 equipe não pode chamar RPC que contém e-mail');
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.throws($q$SELECT public.tab_receipt_target('e1130000-0000-0000-0000-000000000001')$q$,'FORBIDDEN','A2 máscara de outra loja recusada');
SELECT t.login(:'WAITER'::uuid);
SELECT t.is(public.tab_receipt_target('e1130000-0000-0000-0000-000000000001')->>'email_masked','jo***@te***.example','A2 garçom conserva acesso ao comprovante após fechamento pago');
SET ROLE service_role;
SELECT t.throws($q$SELECT public.reserve_tab_receipt('e1130000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001')$q$,'FORBIDDEN','A2 servidor verifica loja do ator');
SELECT public.reserve_tab_receipt('e1130000-0000-0000-0000-000000000001',:'WAITER') AS receipt \gset
SELECT t.ok(:'receipt'::jsonb @> '{"recipient_email":"joao@test.example","total_cents":5500,"service_fee_cents":500,"method":"PIX"}','A2 servidor recebe comprovante e destinatário conferidos');
SELECT t.ok(jsonb_array_length(:'receipt'::jsonb->'items')=1 AND :'receipt'::jsonb->>'charge_id' IS NOT NULL AND :'receipt'::jsonb->>'paid_at' IS NOT NULL,'A2 comprovante tem itens, cobrança e horário');
SELECT public.finish_tab_receipt((:'receipt'::jsonb->>'attempt_id')::uuid,false,'EMAIL_PROVIDER_NOT_CONFIGURED');
SELECT public.reserve_tab_receipt('e1130000-0000-0000-0000-000000000001',:'OWNER') AS receipt2 \gset
SELECT public.finish_tab_receipt((:'receipt2'::jsonb->>'attempt_id')::uuid,true,NULL);
SELECT public.reserve_tab_receipt('e1130000-0000-0000-0000-000000000001',:'OWNER') AS receipt3 \gset
SELECT public.finish_tab_receipt((:'receipt3'::jsonb->>'attempt_id')::uuid,false,'raw-provider-error-with-sensitive-content');
SELECT t.throws($q$SELECT public.reserve_tab_receipt('e1130000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001')$q$,'Muitos envios','A2 quarto envio em dez minutos recusado');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.tab_receipt_sends WHERE tab_id='e1130000-0000-0000-0000-000000000001'),3::bigint,'A2 limite registra somente três tentativas');
SELECT t.ok(EXISTS(SELECT 1 FROM public.tab_receipt_sends WHERE actor_id=:'WAITER' AND status='FAILED' AND reason='EMAIL_PROVIDER_NOT_CONFIGURED' AND completed_at IS NOT NULL),'A2 provedor ausente auditado sem e-mail para garçom após fechar');
SELECT t.ok(EXISTS(SELECT 1 FROM public.tab_receipt_sends WHERE status='SENT' AND reason IS NULL AND completed_at IS NOT NULL),'A2 envio registra ator e horário');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM public.tab_receipt_sends s WHERE to_jsonb(s)::text LIKE '%@%' OR to_jsonb(s)::text LIKE '%sensitive%'),'A2 auditoria não persiste endereço nem erro bruto');
SELECT t.is(public._receipt_mask_email('a@b.co'),'a***@b***.co','A2 máscara cobre endereço curto');
SELECT t.ok(public._receipt_mask_email('inválido') IS NULL,'A2 endereço inválido não é exibido');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT * FROM public.tab_receipt_sends$q$,'permission denied','A2 auditoria de envio sem acesso direto da equipe');
SET ROLE anon;
SELECT t.login(NULL);
SELECT t.throws($q$SELECT public.tab_receipt_target('e1130000-0000-0000-0000-000000000001')$q$,'permission denied','A2 anon não descobre destinatário');
SELECT t.throws($q$SELECT public.reopen_tab_from_bill('e1140000-0000-0000-0000-000000000003')$q$,'permission denied','A4 anon sem sessão autenticada não reabre');
RESET ROLE;
SELECT t.ok(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN('_reopen_tab_from_bill','reopen_tab_from_bill','staff_reopen_tab','_tab_receipt_email','tab_receipt_target','reserve_tab_receipt','finish_tab_receipt')
 AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[])),'A segurança: SECURITY DEFINER com search_path vazio');
