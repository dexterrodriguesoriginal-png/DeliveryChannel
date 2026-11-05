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

-- B4: entrega, prazo da contestação, isolamento e resolução de rodadas.
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token)
SELECT ('e1220000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n=13 THEN :'B'::uuid ELSE :'A'::uuid END,
 'Mesa B4 '||n,'entrega1-1-b4-token-'||n FROM generate_series(7,13) n;
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,status,service_fee_percent,responsible_user_id)
SELECT ('e1230000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n=13 THEN :'B'::uuid ELSE :'A'::uuid END,'TABLE',
 ('e1220000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'OPEN',10,:'CLIENT' FROM generate_series(7,13) n;
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at)
SELECT ('e1240000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n=13 THEN :'B'::uuid ELSE :'A'::uuid END,
 ('e1230000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,:'CLIENT','Cliente sintético','fixture-b4-'||n,now() FROM generate_series(7,13) n;
INSERT INTO public.tab_sessions(id,tenant_id,tab_id,auth_user_id,display_name,device_id,approved_at,expires_at,ended_at,ended_reason) VALUES
 ('e1240000-0000-0000-0000-000000000070',:'A','e1230000-0000-0000-0000-000000000007',:'OTHER','Pendente','pending-b4',NULL,now()+interval '1 hour',NULL,NULL),
 ('e1240000-0000-0000-0000-000000000071',:'A','e1230000-0000-0000-0000-000000000007',:'CLIENT','Expirado','expired-b4',now()-interval '2 hours',now()-interval '1 hour',NULL,NULL),
 ('e1240000-0000-0000-0000-000000000072',:'A','e1230000-0000-0000-0000-000000000007',:'CLIENT','Removido','removed-b4',now()-interval '2 hours',now()+interval '1 hour',now(),'REMOVED');
INSERT INTO public.orders(id,tenant_id,tab_id,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address)
SELECT ('e1250000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n=13 THEN :'B'::uuid ELSE :'A'::uuid END,
 ('e1230000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'DINE_IN',CASE WHEN n=9 THEN 'CONFIRMED' ELSE 'READY' END,50,50,'CASH','PENDING','DINE_IN_QR',1200+n,'Cliente sintético','11900000000','Mesa sintética'
FROM generate_series(7,13) n;
INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,total_price)
SELECT ('e1250000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 CASE WHEN n=13 THEN 'd0000000-0000-0000-0000-0000000000b1'::uuid ELSE 'd0000000-0000-0000-0000-0000000000a1'::uuid END,
 'Item sintético',5,10,50 FROM generate_series(7,13) n;

SET ROLE authenticated;
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.throws($q$SELECT public.waiter_mark_delivered('e1250000-0000-0000-0000-000000000007')$q$,'ORDER_NOT_FOUND','B4 equipe de outra loja não entrega rodada A');
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws($q$UPDATE public.orders SET delivered_by='a0000000-0000-0000-0000-000000000001' WHERE id='e1250000-0000-0000-0000-000000000007'$q$,'permission denied','B4 garçom não falsifica autoria por UPDATE REST');
SELECT t.throws($q$SELECT public.waiter_mark_delivered('e1250000-0000-0000-0000-000000000009')$q$,'INVALID_STATE','B4 rodada não pronta não pode ser entregue');
SELECT public.waiter_mark_delivered('e1250000-0000-0000-0000-000000000007') AS delivered \gset
SELECT t.ok(:'delivered'::jsonb @> jsonb_build_object('status','DELIVERED','delivered_by',:'WAITER'),'B4 garçom marca rodada pronta como entregue com autoria');
SELECT t.ok(:'delivered'::jsonb->>'delivered_at' IS NOT NULL,'B4 horário da entrega gravado');
SELECT t.is(public.waiter_mark_delivered('e1250000-0000-0000-0000-000000000007'),:'delivered'::jsonb,'B4 marcar Entregue repetidamente é idempotente');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.order_status_history WHERE order_id='e1250000-0000-0000-0000-000000000007' AND status='DELIVERED'),1::bigint,'B4 entrega idempotente não duplica histórico');
UPDATE public.orders SET status='OUT_FOR_DELIVERY' WHERE id='e1250000-0000-0000-0000-000000000008';
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT public.waiter_mark_delivered('e1250000-0000-0000-0000-000000000008');
SELECT t.is(t.order_status('e1250000-0000-0000-0000-000000000008'),'DELIVERED','B4 rodada saiu/pronto também pode ser entregue');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.ok((public.get_my_tab('e1240000-0000-0000-0000-000000000007')->'rounds'->0->>'canDisputeDelivery')::boolean,'B4 servidor oferece Não recebi durante cinco minutos');
SELECT t.ok(public.get_my_tab('e1240000-0000-0000-0000-000000000007')->'rounds'->0->'items'->0->>'deliveredAt' IS NOT NULL,'B4 cada item tem horário de entrega');
SELECT t.throws($q$SELECT public.customer_dispute_delivery('e1240000-0000-0000-0000-000000000008','e1250000-0000-0000-0000-000000000007')$q$,'FORBIDDEN','B4 sessão de outra mesa da mesma loja não contesta');
SELECT t.throws($q$SELECT public.customer_dispute_delivery('e1240000-0000-0000-0000-000000000013','e1250000-0000-0000-0000-000000000007')$q$,'FORBIDDEN','B4 sessão de outra loja não contesta');
SELECT t.throws($q$SELECT public.customer_dispute_delivery('e1240000-0000-0000-0000-000000000071','e1250000-0000-0000-0000-000000000007')$q$,'FORBIDDEN','B4 sessão expirada não contesta');
SELECT t.throws($q$SELECT public.customer_dispute_delivery('e1240000-0000-0000-0000-000000000072','e1250000-0000-0000-0000-000000000007')$q$,'FORBIDDEN','B4 sessão removida não contesta');
SELECT t.login(:'OTHER'::uuid);
SELECT t.throws($q$SELECT public.customer_dispute_delivery('e1240000-0000-0000-0000-000000000007','e1250000-0000-0000-0000-000000000007')$q$,'FORBIDDEN','B4 sessão de outro usuário não contesta');
SELECT t.throws($q$SELECT public.customer_dispute_delivery('e1240000-0000-0000-0000-000000000070','e1250000-0000-0000-0000-000000000007')$q$,'FORBIDDEN','B4 convidado sem aprovação não contesta');
SELECT t.login(:'CLIENT'::uuid);
SELECT public.customer_dispute_delivery('e1240000-0000-0000-0000-000000000007','e1250000-0000-0000-0000-000000000007') AS dispute \gset
SELECT t.is(public.customer_dispute_delivery('e1240000-0000-0000-0000-000000000007','e1250000-0000-0000-0000-000000000007'),:'dispute'::jsonb,'B4 Não recebi repetido devolve uma só contestação');
SELECT t.is(public.get_my_tab('e1240000-0000-0000-0000-000000000007')->'rounds'->0->'deliveryDispute'->>'status','OPEN','B4 cliente vê contestação aberta');
SELECT t.ok(NOT (public.get_my_tab('e1240000-0000-0000-0000-000000000007')->'rounds'->0->>'canDisputeDelivery')::boolean,'B4 uma contestação por rodada desativa novo aviso');
SELECT t.is(t.visible('SELECT * FROM public.order_delivery_disputes'),0::bigint,'B4 cliente não enumera contestações da loja');
RESET ROLE;
SELECT t.is((SELECT count(*) FROM public.order_delivery_disputes WHERE order_id='e1250000-0000-0000-0000-000000000007'),1::bigint,'B4 duplicidade protegida por pedido');
SELECT t.is((SELECT count(*) FROM public.owner_notifications WHERE kind='ORDER_DELIVERY_DISPUTE' AND ref_id='e1250000-0000-0000-0000-000000000007'),1::bigint,'B4 dono recebe um alerta sem dados pessoais');
SELECT t.ok(EXISTS(SELECT 1 FROM public.order_delivery_disputes d JOIN public.waiter_calls c ON c.id=d.call_id WHERE d.order_id='e1250000-0000-0000-0000-000000000007' AND c.type='HELP' AND c.status='OPEN'),'B4 contestação abre chamado do garçom');
UPDATE public.orders SET delivered_at=now()-interval '5 minutes 1 second' WHERE id='e1250000-0000-0000-0000-000000000008';
SET ROLE authenticated;
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$SELECT public.customer_dispute_delivery('e1240000-0000-0000-0000-000000000008','e1250000-0000-0000-0000-000000000008')$q$,'DELIVERY_DISPUTE_EXPIRED','B4 prazo de cinco minutos validado no servidor');
SELECT t.ok(NOT (public.get_my_tab('e1240000-0000-0000-0000-000000000008')->'rounds'->0->>'canDisputeDelivery')::boolean,'B4 sem contestação após cinco minutos entrega permanece recebida');
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.is(t.visible('SELECT * FROM public.order_delivery_disputes'),0::bigint,'B4 RLS oculta contestação da outra loja');
SELECT t.throws(format('SELECT public.resolve_delivery_dispute(%L,%L)',:'dispute'::jsonb->>'id','RESENT'),'FORBIDDEN','B4 outra loja não resolve contestação');
SELECT t.throws($q$SELECT public.list_open_delivery_disputes('10000000-0000-0000-0000-00000000000a')$q$,'FORBIDDEN','B4 outra loja não lista fila');
SELECT t.login(:'WAITER'::uuid);
SELECT t.is(t.visible('SELECT * FROM public.order_delivery_disputes'),1::bigint,'B4 garçom da mesa lê contestação por RLS');
SELECT t.is(jsonb_array_length(public.list_open_delivery_disputes(:'A')),1,'B4 fila retorna contestação aberta ao garçom');
SELECT t.throws($q$UPDATE public.order_delivery_disputes SET status='RESENT'$q$,'permission denied','B4 equipe não contorna RPC de resolução');
SELECT t.throws($q$INSERT INTO public.order_delivery_disputes(tenant_id,order_id) VALUES('10000000-0000-0000-0000-00000000000a','e1250000-0000-0000-0000-000000000012')$q$,'permission denied','B4 equipe não cria contestação sem sessão do cliente');
SELECT t.throws(format('SELECT public.resolve_delivery_dispute(%L,%L)',:'dispute'::jsonb->>'id','QUALQUER'),'INVALID_RESOLUTION','B4 resolução inválida recusada');
SELECT public.resolve_delivery_dispute((:'dispute'::jsonb->>'id')::uuid,'RESENT');
SELECT t.is(t.order_status('e1250000-0000-0000-0000-000000000007'),'PREPARING','B4 Reenviar retorna rodada à produção');
SELECT t.ok((t.order_row('e1250000-0000-0000-0000-000000000007')->>'delivered_at') IS NULL AND (t.order_row('e1250000-0000-0000-0000-000000000007')->>'delivered_by') IS NULL,'B4 Reenviar limpa horário/autoria da tentativa anterior');
SELECT public.resolve_delivery_dispute((:'dispute'::jsonb->>'id')::uuid,'RESENT');
SELECT t.throws(format('SELECT public.resolve_delivery_dispute(%L,%L)',:'dispute'::jsonb->>'id','CONFIRMED_DELIVERED'),'DISPUTE_RESOLVED','B4 resolução concluída não pode mudar para outra ação');
SELECT t.is(public.list_open_delivery_disputes(:'A')->0->>'order_status','PREPARING','B4 reenvio permanece na fila enquanto volta à produção');
RESET ROLE;
SELECT t.ok(EXISTS(SELECT 1 FROM public.order_delivery_disputes d JOIN public.waiter_calls c ON c.id=d.call_id WHERE d.order_id='e1250000-0000-0000-0000-000000000007' AND c.status='HANDLED' AND d.status='RESENT' AND d.resolved_by=:'WAITER' AND d.resolved_at IS NOT NULL),'B4 resolução audita ator/horário e atende chamado exato');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM public.order_status_history WHERE order_id='e1250000-0000-0000-0000-000000000007' AND changed_by LIKE '%@%'),'B4 histórico da entrega sem e-mail da equipe');
UPDATE public.orders SET status='READY' WHERE id='e1250000-0000-0000-0000-000000000007';
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT public.waiter_mark_delivered('e1250000-0000-0000-0000-000000000007');
SELECT t.is(jsonb_array_length(public.list_open_delivery_disputes(:'A')),0,'B4 reentrega concluída remove rodada reenviada da fila');
RESET ROLE;

-- Um pagamento que encerra a sessão não elimina os cinco minutos de contestação.
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT public.waiter_mark_delivered('e1250000-0000-0000-0000-000000000010');
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$UPDATE public.orders SET delivered_by='e1110000-0000-0000-0000-000000000003' WHERE id='e1250000-0000-0000-0000-000000000010'$q$,'permission denied','B4 dono também não falsifica autoria por UPDATE REST');
SELECT public.close_tab('e1230000-0000-0000-0000-000000000010','[{"method":"CASH","amount_cents":5500}]');
SELECT t.login(:'CLIENT'::uuid);
SELECT public.customer_dispute_delivery('e1240000-0000-0000-0000-000000000010','e1250000-0000-0000-0000-000000000010') AS closed_dispute \gset
SELECT t.is(:'closed_dispute'::jsonb->>'status','OPEN','B4 sessão encerrada por pagamento mantém prazo legítimo');
SELECT t.login(:'WAITER'::uuid);
SELECT t.is(public.list_open_delivery_disputes(:'A')->0->>'order_id','e1250000-0000-0000-0000-000000000010','B4 garçom vê disputa mesmo após mesa ficar livre');
SELECT public.resolve_delivery_dispute((:'closed_dispute'::jsonb->>'id')::uuid,'CONFIRMED_DELIVERED');
SELECT t.is(t.order_status('e1250000-0000-0000-0000-000000000010'),'DELIVERED','B4 Confirmar entrega conserva estado entregue');
RESET ROLE;
SELECT t.ok(EXISTS(SELECT 1 FROM public.order_delivery_disputes WHERE order_id='e1250000-0000-0000-0000-000000000010' AND status='CONFIRMED_DELIVERED' AND resolved_by=:'WAITER'),'B4 confirmação de entrega auditada');
SELECT t.ok(EXISTS(SELECT 1 FROM public.dining_tracking_revisions WHERE tab_id='e1230000-0000-0000-0000-000000000010'),'B4 alterações de contestação sinalizam a comanda encerrada');

-- Reenvio após pagamento continua acessível até a nova entrega, sem reabrir a mesa.
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT public.waiter_mark_delivered('e1250000-0000-0000-0000-000000000012');
SELECT t.login(:'OWNER'::uuid);
SELECT public.close_tab('e1230000-0000-0000-0000-000000000012','[{"method":"CASH","amount_cents":5500}]');
SELECT t.login(:'CLIENT'::uuid);
SELECT public.customer_dispute_delivery('e1240000-0000-0000-0000-000000000012','e1250000-0000-0000-0000-000000000012') AS resent_closed \gset
SELECT t.login(:'WAITER'::uuid);
SELECT public.resolve_delivery_dispute((:'resent_closed'::jsonb->>'id')::uuid,'RESENT');
SELECT t.ok(public.list_open_delivery_disputes(:'A')->0 @> '{"order_id":"e1250000-0000-0000-0000-000000000012","status":"RESENT","order_status":"PREPARING"}','B4 reenvio de mesa fechada continua na fila');
RESET ROLE;
UPDATE public.orders SET status='READY' WHERE id='e1250000-0000-0000-0000-000000000012';
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT t.is(public.list_open_delivery_disputes(:'A')->0->>'order_status','READY','B4 fila sinaliza reenvio pronto da mesa fechada');
SELECT public.waiter_mark_delivered('e1250000-0000-0000-0000-000000000012');
SELECT t.is(jsonb_array_length(public.list_open_delivery_disputes(:'A')),0,'B4 Entregue encerra acompanhamento do reenvio da mesa fechada');
SELECT t.is(t.sq($q$SELECT status FROM public.dining_tabs WHERE id='e1230000-0000-0000-0000-000000000012'$q$),'CLOSED','B4 reenvio e reentrega não reabrem mesa paga');
RESET ROLE;

-- Atribuição de mesa também restringe o garçom, mesmo com a mesma loja.
INSERT INTO public.waiter_table_assignments(tenant_id,table_id,waiter_id)
VALUES(:'A','e1220000-0000-0000-0000-000000000011',:'OWNER');
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws($q$SELECT public.waiter_mark_delivered('e1250000-0000-0000-0000-000000000011')$q$,'ORDER_NOT_FOUND','B4 garçom não entrega mesa atribuída a outro colaborador');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$SELECT public.waiter_mark_delivered('e1250000-0000-0000-0000-000000000012')$q$,'ORDER_NOT_FOUND','B4 cliente não marca própria rodada como entregue');
SET ROLE anon;
SELECT t.login(NULL);
SELECT t.throws($q$SELECT public.customer_dispute_delivery('e1240000-0000-0000-0000-000000000012','e1250000-0000-0000-0000-000000000012')$q$,'permission denied','B4 anon não contesta sem sessão autenticada');
SELECT t.throws($q$SELECT * FROM public.order_delivery_disputes$q$,'permission denied','B4 anon não lê contestações');
RESET ROLE;
SELECT t.ok(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN('_can_manage_delivery_dispute','waiter_mark_delivered','customer_dispute_delivery','resolve_delivery_dispute','list_open_delivery_disputes','_delivery_dispute_tracking_signal')
 AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[])),'B segurança: SECURITY DEFINER com search_path vazio');
SELECT t.ok(EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='order_delivery_disputes'),'B4 contestações participam do realtime com RLS');

-- C1: o caminho de aceite já suporta todos os papéis. O diretório autorizado
-- deve retornar também colaboradores sem waiter_profiles, após o aceite real.
RESET ROLE;
SELECT t.login(NULL);
INSERT INTO auth.users(id,email)
SELECT ('e1310000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'c1-role-'||n||'@test.example' FROM generate_series(1,7) n;
INSERT INTO public.store_tools(tenant_id,tool,enabled) VALUES(:'A','kitchen',true)
ON CONFLICT(tenant_id,tool) DO UPDATE SET enabled=true;
INSERT INTO public.team_invites(id,tenant_id,email,role_id,invited_by,status,expires_at)
SELECT ('e1320000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,:'A','c1-role-'||n||'@test.example',
 (ARRAY['MANAGER','CASHIER','KITCHEN','WAITER','OPERATOR','DELIVERY_MANAGER','DRIVER'])[n],:'OWNER','PENDING',now()+interval '1 day'
FROM generate_series(1,7) n;
SELECT t.ok(has_function_privilege('authenticated','public.resend_team_invite(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.resend_team_invite(uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.resend_team_invite(uuid)','EXECUTE'),'C1 renovação concedida somente a authenticated');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.is((SELECT email FROM public.list_team_invites(:'A') WHERE id='e1320000-0000-0000-0000-000000000001'),'c1***@te***.example','C1 listagem retorna somente máscara');
SELECT t.ok((SELECT jsonb_agg(to_jsonb(i))::text NOT LIKE '%c1-role-%' FROM public.list_team_invites(:'A') i),'C1 endereço completo ausente dos retornos de listagem');
SELECT t.throws($q$SELECT * FROM public.team_invites$q$,'permission denied','C1 equipe não lê endereços por tabela direta');
SELECT public.resend_team_invite('e1320000-0000-0000-0000-000000000001') AS c1_renewed \gset
SELECT t.ok(:'c1_renewed'::jsonb->>'status'='PENDING' AND (:'c1_renewed'::jsonb->>'expires_at')::timestamptz>now()+interval '6 days'
 AND :'c1_renewed' NOT LIKE '%@%' AND :'c1_renewed' NOT LIKE '%email%','C1 renovação estende validade sem devolver endereço');
SELECT t.throws($q$SELECT public.resend_team_invite('e1320000-0000-0000-0000-000000000001')$q$,'RATE_LIMITED','C1 repetição imediata tem cooldown');
RESET ROLE;
DELETE FROM public.security_rate_limits WHERE scope='team_invite_resend_cooldown';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.resend_team_invite('e1320000-0000-0000-0000-000000000001');
RESET ROLE;
DELETE FROM public.security_rate_limits WHERE scope='team_invite_resend_cooldown';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.resend_team_invite('e1320000-0000-0000-0000-000000000001');
RESET ROLE;
DELETE FROM public.security_rate_limits WHERE scope='team_invite_resend_cooldown';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.resend_team_invite('e1320000-0000-0000-0000-000000000001')$q$,'RATE_LIMITED','C1 quarta renovação na janela recusada');
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.throws($q$SELECT public.resend_team_invite('e1320000-0000-0000-0000-000000000002')$q$,'INVITE_UNAVAILABLE','C1 outra loja não renova convite');
SELECT t.throws($q$SELECT * FROM public.list_team_invites('10000000-0000-0000-0000-00000000000a')$q$,'Sem permissão','C1 outra loja não lê máscaras de convites');
SELECT t.throws($q$SELECT * FROM public.list_team_directory('10000000-0000-0000-0000-00000000000a')$q$,'FORBIDDEN','C1 outra loja não lê diretório');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$SELECT public.resend_team_invite('e1320000-0000-0000-0000-000000000002')$q$,'INVITE_UNAVAILABLE','C1 cliente não renova convite');
SELECT t.throws($q$SELECT public.accept_team_invite('e1320000-0000-0000-0000-000000000002')$q$,'outra conta','C1 máscara não concede aceite a outra identidade');
SELECT t.login(NULL);
SELECT t.throws($q$SELECT public.resend_team_invite('e1320000-0000-0000-0000-000000000002')$q$,'AUTH_REQUIRED','C1 renovação exige identidade');
SET ROLE anon;
SELECT t.throws($q$SELECT public.resend_team_invite('e1320000-0000-0000-0000-000000000002')$q$,'permission denied','C1 anon sem EXECUTE para renovação');
RESET ROLE;
SELECT t.ok((SELECT count(*)=3 AND bool_and(details NOT LIKE '%@%' AND COALESCE(new_value,'') NOT LIKE '%@%') FROM public.audit_logs
 WHERE action='TEAM_INVITE_RENEWED' AND resource_id='e1320000-0000-0000-0000-000000000001'),'C1 auditoria registra três renovações sem endereço');

-- Exercita a mesma RPC usada pelo link de primeiro acesso, para os sete papéis.
SET ROLE authenticated;
DO $$
DECLARE n integer; v_roles text[]:=ARRAY['MANAGER','CASHIER','KITCHEN','WAITER','OPERATOR','DELIVERY_MANAGER','DRIVER']; v_slug text;
BEGIN
 v_slug:=t.sq($q$SELECT slug FROM public.tenants WHERE id='10000000-0000-0000-0000-00000000000a'$q$);
 FOR n IN 1..7 LOOP
  PERFORM t.login(('e1310000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid);
  PERFORM public.team_accept_invite(v_slug,v_roles[n]);
 END LOOP;
END $$;
SELECT t.login(:'OWNER'::uuid);
SELECT t.is((SELECT count(*) FROM public.list_team_directory(:'A') WHERE user_id::text LIKE 'e1310000-%' AND status='ACTIVE'),7::bigint,'C1 diretório inclui todos os sete convidados aceitos');
SELECT t.ok((SELECT array_agg(role_id ORDER BY role_id)=ARRAY['CASHIER','DELIVERY_MANAGER','DRIVER','KITCHEN','MANAGER','OPERATOR','WAITER']::text[]
 FROM public.list_team_directory(:'A') WHERE user_id::text LIKE 'e1310000-%'),'C1 diretório conserva o papel real sem exigir waiter_profiles');
SELECT t.is((SELECT count(*) FROM public.list_team_invites(:'A') WHERE id::text LIKE 'e1320000-%'),0::bigint,'C1 aceitos deixam de aparecer entre pendências');
SELECT t.throws($q$SELECT public.resend_team_invite('e1320000-0000-0000-0000-000000000002')$q$,'INVITE_UNAVAILABLE','C1 convite aceito não pode ser renovado');
RESET ROLE;
SELECT t.ok((SELECT count(*)=7 AND bool_and(status='ACCEPTED' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL)
 FROM public.team_invites WHERE id::text LIKE 'e1320000-%'),'C1 aceite marca os sete convites ACCEPTED com identidade e horário');
SELECT t.ok((SELECT count(*)=7 AND bool_and(status='ACTIVE') FROM public.tenant_users
 WHERE tenant_id=:'A' AND user_id::text LIKE 'e1310000-%'),'C1 aceite cria os sete vínculos ACTIVE na loja certa');

-- Ferramenta desligada, convite expirado, permissão personalizada e cancelamento.
INSERT INTO public.team_invites(id,tenant_id,email,role_id,invited_by,status,expires_at) VALUES
 ('e1320000-0000-0000-0000-000000000008',:'A','c1-waiter-disabled@test.example','WAITER',:'OWNER','PENDING',now()+interval '1 day'),
 ('e1320000-0000-0000-0000-000000000009',:'A','c1-expired@test.example','CASHIER',:'OWNER','PENDING',now()-interval '1 day'),
 ('e1320000-0000-0000-0000-000000000010',:'A','c1-cancel@test.example','CASHIER',:'OWNER','PENDING',now()+interval '1 day');
UPDATE public.store_tools SET enabled=false WHERE tenant_id=:'A' AND tool='waiter';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.resend_team_invite('e1320000-0000-0000-0000-000000000008')$q$,'TOOL_DISABLED','C1 Garçom desligado não renova convite');
SELECT t.throws($q$SELECT public.resend_team_invite('e1320000-0000-0000-0000-000000000009')$q$,'INVITE_UNAVAILABLE','C1 convite expirado não pode ser renovado');
SELECT public.set_store_role_permission(:'A','MANAGER','manage_team',false);
SELECT t.login('e1310000-0000-0000-0000-000000000001');
SELECT t.throws($q$SELECT public.resend_team_invite('e1320000-0000-0000-0000-000000000010')$q$,'INVITE_UNAVAILABLE','C1 gerente sem permissão de equipe não renova');
SELECT t.login(:'OWNER'::uuid);
SELECT public.set_store_role_permission(:'A','MANAGER','manage_team',true);
SELECT public.revoke_team_invite('e1320000-0000-0000-0000-000000000010');
SELECT t.throws($q$SELECT public.resend_team_invite('e1320000-0000-0000-0000-000000000010')$q$,'INVITE_UNAVAILABLE','C1 convite cancelado não pode ser renovado');
SELECT t.is((SELECT count(*) FROM public.list_team_invites(:'A') WHERE id='e1320000-0000-0000-0000-000000000010'),0::bigint,'C1 cancelamento remove convite da listagem');
RESET ROLE;
UPDATE public.store_tools SET enabled=true WHERE tenant_id=:'A' AND tool='waiter';
SELECT t.ok((SELECT prosecdef AND proconfig=ARRAY['search_path=""']::text[] FROM pg_proc WHERE oid='public.resend_team_invite(uuid)'::regprocedure),'C1 renovação usa SECURITY DEFINER com search_path vazio');

-- C2: estatísticas agregadas. Fixtures próprias não dependem das comandas de A/B.
\set C2_T 'e1390000-0000-0000-0000-000000000001'
\set C2_X 'e1390000-0000-0000-0000-000000000002'
\set C2_E 'e1390000-0000-0000-0000-000000000003'
RESET ROLE;
SELECT t.login(NULL);
SELECT t.ok((SELECT salon_opened_at IS NULL FROM public.tenant_settings WHERE tenant_id=:'A'),
 'C2 implantação não inventa abertura para configuração preexistente');
INSERT INTO public.tenants(id,slug,name,document,phone,email,status) VALUES
 (:'C2_T','c2-salon-fixture','Salão sintético C2','11222333000181','11987654321','c2-private@example.test','ACTIVE'),
 (:'C2_X','c2-other-fixture','Outra loja C2','11444777000161','11987654322','c2-other@example.test','ACTIVE'),
 (:'C2_E','c2-empty-fixture','Salão vazio C2','11222333000181','11987654323','c2-empty@example.test','ACTIVE');
INSERT INTO public.tenant_users(tenant_id,user_id,role_id,status) VALUES
 (:'C2_T',:'OWNER','OWNER','ACTIVE'),(:'C2_T',:'WAITER','WAITER','ACTIVE'),
 (:'C2_X',:'OWNER_B','OWNER','ACTIVE'),(:'C2_E',:'OWNER','OWNER','ACTIVE');
INSERT INTO public.store_tools(tenant_id,tool,enabled) VALUES(:'C2_T','waiter',true);
INSERT INTO public.tenant_modules(tenant_id,module_key,enabled,config) VALUES
 (:'C2_T','dine_in',true,'{"mode":"TABLE","salon_open":true}'),
 (:'C2_T','delivery',true,'{}'),(:'C2_T','pickup',true,'{}'),
 (:'C2_X','dine_in',true,'{"mode":"TABLE","salon_open":true}'),
 (:'C2_E','dine_in',true,'{"mode":"TABLE","salon_open":true}');
INSERT INTO public.tenant_settings(tenant_id,is_open,address,phone_whatsapp,salon_opened_at) VALUES
 (:'C2_T',false,'Endereço sintético C2','11987654321',now()-interval '1 day'),
 (:'C2_E',true,'Endereço vazio C2','11987654323',now()-interval '1 day');
SELECT t.ok((SELECT salon_opened_at IS NULL FROM public.tenant_settings WHERE tenant_id=:'C2_T'),
 'C2 insert fechado descarta abertura enviada pelo cliente');
SELECT t.ok((SELECT salon_opened_at BETWEEN now()-interval '1 minute' AND now() FROM public.tenant_settings WHERE tenant_id=:'C2_E'),
 'C2 primeira configuração aberta registra horário do banco');

INSERT INTO public.dining_tables(id,tenant_id,label,qr_token)
SELECT ('e1391000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,:'C2_T','Mesa sintética C2 '||n,'c2-fixture-qr-'||n
FROM generate_series(1,6) n;
INSERT INTO public.dining_tables(id,tenant_id,label,qr_token)
VALUES('e1391000-0000-0000-0000-000000000010',:'C2_X','Mesa outra loja','c2-other-qr');
-- Duas visitas encerradas na mesma mesa, uma visita antiga com recebimento tardio,
-- quatro estados ativos antigos e uma visita cancelada.
INSERT INTO public.dining_tabs(id,tenant_id,mode,table_id,status,opened_at,closed_at) VALUES
 ('e1392000-0000-0000-0000-000000000001',:'C2_T','TABLE','e1391000-0000-0000-0000-000000000001','CLOSED',now()-interval '100 minutes',now()-interval '40 minutes'),
 ('e1392000-0000-0000-0000-000000000002',:'C2_T','TABLE','e1391000-0000-0000-0000-000000000001','CLOSED',now()-interval '70 minutes',now()-interval '10 minutes'),
 ('e1392000-0000-0000-0000-000000000003',:'C2_T','TABLE','e1391000-0000-0000-0000-000000000002','CLOSED',now()-interval '2 days',now()-interval '1 day'),
 ('e1392000-0000-0000-0000-000000000004',:'C2_T','TABLE','e1391000-0000-0000-0000-000000000002','CLOSED',now()-interval '15 hours',now()-interval '13 hours'),
 ('e1392000-0000-0000-0000-000000000005',:'C2_T','TABLE','e1391000-0000-0000-0000-000000000002','OPEN',now()-interval '2 days',NULL),
 ('e1392000-0000-0000-0000-000000000006',:'C2_T','TABLE','e1391000-0000-0000-0000-000000000003','BILL_REQUESTED',now()-interval '2 days',NULL),
 ('e1392000-0000-0000-0000-000000000007',:'C2_T','TABLE','e1391000-0000-0000-0000-000000000004','WAITER_AUTHORIZED',now()-interval '2 days',NULL),
 ('e1392000-0000-0000-0000-000000000008',:'C2_T','TABLE','e1391000-0000-0000-0000-000000000005','AWAITING_PAYMENT',now()-interval '2 days',NULL),
 ('e1392000-0000-0000-0000-000000000009',:'C2_T','TABLE','e1391000-0000-0000-0000-000000000006','CANCELLED',now()-interval '40 minutes',now()-interval '10 minutes'),
 ('e1392000-0000-0000-0000-000000000010',:'C2_X','TABLE','e1391000-0000-0000-0000-000000000010','OPEN',now()-interval '30 minutes',NULL),
 ('e1392000-0000-0000-0000-000000000011',:'C2_X','TABLE','e1391000-0000-0000-0000-000000000010','CLOSED',now()-interval '90 minutes',now()-interval '30 minutes');
INSERT INTO public.orders(id,tenant_id,tab_id,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address,created_at)
SELECT ('e1393000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 CASE WHEN n=7 THEN :'C2_X'::uuid ELSE :'C2_T'::uuid END,
 CASE WHEN n IN (5,8) THEN NULL WHEN n=7 THEN 'e1392000-0000-0000-0000-000000000010'::uuid ELSE 'e1392000-0000-0000-0000-000000000005'::uuid END,
 CASE WHEN n=5 THEN 'DELIVERY' WHEN n=8 THEN 'PICKUP' ELSE 'DINE_IN' END,
 CASE WHEN n=2 THEN 'DELIVERED' WHEN n=3 THEN 'CANCELLED' ELSE 'CONFIRMED' END,
 10,10,'CASH','PENDING','DINE_IN_QR',13900+n,'C2 cliente sintético','11987654321','Endereço sintético C2',
 CASE WHEN n=4 THEN now()-interval '13 hours' WHEN n=6 THEN now()+interval '1 day' ELSE now()-interval '20 minutes' END
FROM generate_series(1,8) n;
INSERT INTO public.tab_payments(tenant_id,tab_id,method,amount_cents,change_given_cents,created_at) VALUES
 (:'C2_T','e1392000-0000-0000-0000-000000000001','CASH',1000,500,now()-interval '40 minutes'),
 (:'C2_T','e1392000-0000-0000-0000-000000000001','CREDIT_CARD',2000,0,now()-interval '40 minutes'),
 (:'C2_T','e1392000-0000-0000-0000-000000000002','PIX',5000,0,now()-interval '10 minutes'),
 (:'C2_T','e1392000-0000-0000-0000-000000000003','CASH',4000,0,now()-interval '10 minutes'),
 (:'C2_T','e1392000-0000-0000-0000-000000000004','CASH',7777,0,now()-interval '13 hours'),
 (:'C2_T','e1392000-0000-0000-0000-000000000005','CASH',8888,0,now()-interval '10 minutes'),
 (:'C2_T','e1392000-0000-0000-0000-000000000001','CASH',9999,0,now()+interval '1 day'),
 (:'C2_X','e1392000-0000-0000-0000-000000000011','CASH',90000,0,now()-interval '10 minutes');
INSERT INTO public.tab_pix_charges(tenant_id,tab_id,amount_cents,status)
VALUES(:'C2_T','e1392000-0000-0000-0000-000000000008',9900,'pending');
INSERT INTO public.waiter_calls(id,tenant_id,tab_id,type,status,created_at,handled_at) VALUES
 ('e1394000-0000-0000-0000-000000000001',:'C2_T','e1392000-0000-0000-0000-000000000005','CALL','HANDLED',now()-interval '10 minutes',now()-interval '5 minutes'),
 ('e1394000-0000-0000-0000-000000000002',:'C2_T','e1392000-0000-0000-0000-000000000005','HELP','HANDLED',now()-interval '20 minutes',now()-interval '18 minutes'),
 ('e1394000-0000-0000-0000-000000000003',:'C2_T','e1392000-0000-0000-0000-000000000005','CALL','HANDLED',now()-interval '14 hours',now()-interval '13 hours'),
 ('e1394000-0000-0000-0000-000000000004',:'C2_T','e1392000-0000-0000-0000-000000000005','CALL','OPEN',now()-interval '10 minutes',NULL),
 ('e1394000-0000-0000-0000-000000000005',:'C2_T','e1392000-0000-0000-0000-000000000005','CALL','CANCELLED',now()-interval '10 minutes',now()-interval '5 minutes'),
 ('e1394000-0000-0000-0000-000000000006',:'C2_X','e1392000-0000-0000-0000-000000000010','CALL','HANDLED',now()-interval '10 minutes',now()-interval '5 minutes');
-- O trigger de roteamento limpa accepted_at no INSERT; o aceite real é um UPDATE.
UPDATE public.waiter_calls SET accepted_at=created_at+interval '1 minute',accepted_by=:'WAITER'
WHERE id IN ('e1394000-0000-0000-0000-000000000001','e1394000-0000-0000-0000-000000000004');

SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT public.salon_night_stats(:'C2_T') AS c2_stats \gset
SELECT t.is(:'c2_stats'::jsonb->>'window_source','LAST_12_HOURS','C2 sem abertura conhecida usa últimas doze horas');
SELECT t.is(:'c2_stats'::jsonb->>'timezone','America/Sao_Paulo','C2 período usa fuso explícito da operação');
SELECT t.ok(abs(extract(epoch FROM ((:'c2_stats'::jsonb->>'window_end')::timestamptz-(:'c2_stats'::jsonb->>'window_start')::timestamptz))-43200)<0.001,
 'C2 fallback contém exatamente doze horas');
SELECT t.is((:'c2_stats'::jsonb->>'orders_count')::int,2,'C2 pedidos excluem cancelados delivery pickup antigos futuros e outra loja');
SELECT t.is((:'c2_stats'::jsonb->>'tables_served')::int,2,'C2 mesma mesa com dois grupos conta duas visitas encerradas');
SELECT t.is((:'c2_stats'::jsonb->>'revenue_cents')::bigint,12000::bigint,'C2 receita soma recebimentos confirmados sem descontar troco e inclui recebimento tardio');
SELECT t.is((:'c2_stats'::jsonb->>'paid_visits')::int,3,'C2 vários meios de pagamento contam uma visita paga');
SELECT t.is((:'c2_stats'::jsonb->>'average_ticket_cents')::numeric,4000::numeric,'C2 ticket divide receita por visitas com recebimento na janela');
SELECT t.ok(abs((:'c2_stats'::jsonb->>'average_stay_seconds')::numeric-3600)<1,'C2 permanência usa visitas encerradas na janela');
SELECT t.is((:'c2_stats'::jsonb->>'calls_handled')::int,2,'C2 chamados atendidos excluem abertos cancelados antigos e outra loja');
SELECT t.ok(abs((:'c2_stats'::jsonb->>'average_response_seconds')::numeric-90)<1,'C2 resposta usa aceite quando existe senão horário de atendimento');
SELECT t.is((:'c2_stats'::jsonb->>'open_tabs')::int,4,'C2 todos estados ativos contam mesmo abertos antes da janela');
SELECT t.ok(:'c2_stats'::jsonb ?& ARRAY['window_start','window_end','window_source','timezone','orders_count','tables_served','revenue_cents','paid_visits','average_ticket_cents','average_stay_seconds','calls_handled','average_response_seconds','open_tabs']
 AND (SELECT count(*) FROM jsonb_object_keys(:'c2_stats'::jsonb))=13,
 'C2 resposta contém apenas contrato agregado sem campos pessoais');
SELECT t.ok(:'c2_stats' NOT LIKE '%C2 cliente%' AND :'c2_stats' NOT LIKE '%11987654321%' AND :'c2_stats' NOT LIKE '%c2-private%' AND :'c2_stats' NOT LIKE '%Mesa sintética%',
 'C2 nomes telefones e-mails e identificação da mesa ausentes');
SELECT public.salon_night_stats(:'C2_E') AS c2_empty \gset
SELECT t.ok(:'c2_empty'::jsonb @> '{"orders_count":0,"tables_served":0,"revenue_cents":0,"paid_visits":0,"calls_handled":0,"open_tabs":0,"average_ticket_cents":null,"average_stay_seconds":null,"average_response_seconds":null}',
 'C2 salão sem amostras retorna contagens zero e médias NULL');
SELECT t.login(:'WAITER'::uuid);
SELECT t.is((public.salon_night_stats(:'C2_T')->>'open_tabs')::int,4,'C2 garçom ativo da loja recebe somente estatísticas agregadas');
SELECT t.login(:'OWNER_B'::uuid);
SELECT t.throws($q$SELECT public.salon_night_stats('e1390000-0000-0000-0000-000000000001')$q$,'FORBIDDEN','C2 proprietário de outra loja não lê estatísticas');
SELECT t.is((public.salon_night_stats(:'C2_X')->>'revenue_cents')::bigint,90000::bigint,'C2 outra loja recebe somente sua própria receita');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws($q$SELECT public.salon_night_stats('e1390000-0000-0000-0000-000000000001')$q$,'FORBIDDEN','C2 cliente não lê estatísticas financeiras');
SELECT t.login(NULL);
SELECT t.throws($q$SELECT public.salon_night_stats('e1390000-0000-0000-0000-000000000001')$q$,'FORBIDDEN','C2 JWT sem usuário não lê estatísticas');
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws('SELECT public.salon_night_stats(NULL)','FORBIDDEN','C2 loja NULL não contorna autorização');
SELECT t.throws($q$SELECT salon_opened_at FROM public.tenant_settings LIMIT 1$q$,'permission denied','C2 coluna de abertura não ganha leitura REST');
SELECT t.throws($q$UPDATE public.tenant_settings SET salon_opened_at=now() WHERE tenant_id='e1390000-0000-0000-0000-000000000001'$q$,'permission denied','C2 equipe não falsifica horário por UPDATE REST');
SET ROLE anon;
SELECT t.throws($q$SELECT public.salon_night_stats('e1390000-0000-0000-0000-000000000001')$q$,'permission denied','C2 anon não executa RPC');
SET ROLE service_role;
SELECT t.throws($q$SELECT public.salon_night_stats('e1390000-0000-0000-0000-000000000001')$q$,'permission denied','C2 service_role não recebe EXECUTE por privilégio padrão');
RESET ROLE;
SELECT t.ok((SELECT prosecdef AND proconfig=ARRAY['search_path=""']::text[] FROM pg_proc WHERE oid='public.salon_night_stats(uuid)'::regprocedure),
 'C2 RPC usa SECURITY DEFINER e search_path vazio');
SELECT t.ok(NOT has_function_privilege('anon','public.salon_night_stats(uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.salon_night_stats(uuid)','EXECUTE')
 AND has_function_privilege('authenticated','public.salon_night_stats(uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public._salon_track_opening()','EXECUTE')
 AND NOT has_function_privilege('anon','public._salon_track_opening()','EXECUTE')
 AND NOT has_function_privilege('service_role','public._salon_track_opening()','EXECUTE'),
 'C2 ACL mínima vale também com privilégios padrão legados');
SELECT t.ok(NOT has_column_privilege('authenticated','public.tenant_settings','salon_opened_at','UPDATE')
 AND NOT has_column_privilege('authenticated','public.tenant_settings','salon_opened_at','SELECT'),
 'C2 coluna nova permanece fora das permissões de API');
UPDATE public.tenant_users SET status='SUSPENDED' WHERE tenant_id=:'C2_T' AND user_id=:'WAITER';
SET ROLE authenticated;
SELECT t.login(:'WAITER'::uuid);
SELECT t.throws($q$SELECT public.salon_night_stats('e1390000-0000-0000-0000-000000000001')$q$,'FORBIDDEN','C2 vínculo suspenso perde estatísticas');
RESET ROLE;
UPDATE public.tenant_users SET status='ACTIVE' WHERE tenant_id=:'C2_T' AND user_id=:'WAITER';
UPDATE public.tenants SET status='SUSPENDED' WHERE id=:'C2_T';
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws($q$SELECT public.salon_night_stats('e1390000-0000-0000-0000-000000000001')$q$,'FORBIDDEN','C2 loja suspensa não expõe estatísticas');
RESET ROLE;
UPDATE public.tenants SET status='ACTIVE' WHERE id=:'C2_T';
UPDATE public.tenant_modules SET enabled=false WHERE tenant_id=:'C2_E' AND module_key='dine_in';
SET ROLE authenticated;
SELECT t.throws($q$SELECT public.salon_night_stats('e1390000-0000-0000-0000-000000000003')$q$,'MODULE_DISABLED','C2 ferramenta desligada não carrega estatísticas');
RESET ROLE;
UPDATE public.tenant_modules SET enabled=true WHERE tenant_id=:'C2_E' AND module_key='dine_in';

-- A abertura legítima funciona com os privilégios atuais de UPDATE(is_open).
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
UPDATE public.tenant_settings SET is_open=true WHERE tenant_id=:'C2_T';
SELECT public.salon_night_stats(:'C2_T') AS c2_opened \gset
SELECT t.is(:'c2_opened'::jsonb->>'window_source','OPENED_TODAY','C2 false para true inicia período de hoje');
SELECT t.ok(:'c2_opened'::jsonb @> '{"orders_count":0,"tables_served":0,"revenue_cents":0,"paid_visits":0,"calls_handled":0,"open_tabs":4,"average_ticket_cents":null,"average_stay_seconds":null,"average_response_seconds":null}',
 'C2 abertura recente não reutiliza amostras anteriores mas conserva contas antigas');
RESET ROLE;
SELECT salon_opened_at::text AS c2_opening FROM public.tenant_settings WHERE tenant_id=:'C2_T' \gset
SELECT t.is((:'c2_opened'::jsonb->>'window_start')::timestamptz,:'c2_opening'::timestamptz,'C2 janela começa no horário mantido pelo banco');
UPDATE public.tenant_settings SET city='Cidade sintética',salon_opened_at=now()-interval '1 day' WHERE tenant_id=:'C2_T';
SELECT t.is((SELECT salon_opened_at FROM public.tenant_settings WHERE tenant_id=:'C2_T'),:'c2_opening'::timestamptz,
 'C2 atualização de configuração ignora tentativa de forjar abertura');
UPDATE public.tenant_settings SET is_open=false WHERE tenant_id=:'C2_T';
SELECT t.is((SELECT salon_opened_at FROM public.tenant_settings WHERE tenant_id=:'C2_T'),:'c2_opening'::timestamptz,
 'C2 fechar a loja conserva última abertura para o resumo da noite');
UPDATE public.tenant_settings SET is_open=true,salon_opened_at=now()-interval '1 day' WHERE tenant_id=:'C2_T';
SELECT t.ok((SELECT salon_opened_at>=:'c2_opening'::timestamptz AND salon_opened_at<=now() FROM public.tenant_settings WHERE tenant_id=:'C2_T'),
 'C2 reabertura usa relógio do banco mesmo com timestamp forjado');

-- Apenas fixtures locais podem desativar o trigger para simular estados históricos.
ALTER TABLE public.tenant_settings DISABLE TRIGGER salon_track_opening;
UPDATE public.tenant_settings SET salon_opened_at=date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
WHERE tenant_id=:'C2_T';
ALTER TABLE public.tenant_settings ENABLE TRIGGER salon_track_opening;
SET TIME ZONE 'Pacific/Auckland';
SET ROLE authenticated;
SELECT public.salon_night_stats(:'C2_T') AS c2_timezone \gset
SELECT t.is(:'c2_timezone'::jsonb->>'window_source','OPENED_TODAY','C2 hoje usa data de São Paulo independente do fuso da sessão');
SELECT t.is((:'c2_timezone'::jsonb->>'window_start')::timestamptz,
 date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo','C2 abertura de hoje não é truncada pela janela de doze horas');
RESET ROLE;
SET TIME ZONE 'UTC';
ALTER TABLE public.tenant_settings DISABLE TRIGGER salon_track_opening;
UPDATE public.tenant_settings SET salon_opened_at=(date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')-interval '1 second'
WHERE tenant_id=:'C2_T';
ALTER TABLE public.tenant_settings ENABLE TRIGGER salon_track_opening;
SET ROLE authenticated;
SELECT t.is(public.salon_night_stats(:'C2_T')->>'window_source','LAST_12_HOURS','C2 abertura de ontem usa fallback mesmo perto da meia-noite');
RESET ROLE;
ALTER TABLE public.tenant_settings DISABLE TRIGGER salon_track_opening;
UPDATE public.tenant_settings SET salon_opened_at=now()+interval '1 day' WHERE tenant_id=:'C2_T';
ALTER TABLE public.tenant_settings ENABLE TRIGGER salon_track_opening;
SET ROLE authenticated;
SELECT t.is(public.salon_night_stats(:'C2_T')->>'window_source','LAST_12_HOURS','C2 abertura futura inválida usa fallback');
RESET ROLE;
SELECT t.login(NULL);

-- Revisão PR #19: exclusão do ator preserva a auditoria; manutenção de pedido
-- remove sua contestação, sem alterar as proteções de exclusão do aplicativo.
RESET ROLE;
SELECT t.login(NULL);
\set FK_ACTOR 'e1410000-0000-0000-0000-000000000001'
\set FK_RECEIPT 'e1420000-0000-0000-0000-000000000001'
\set FK_ORDER_A 'e1430000-0000-0000-0000-000000000001'
\set FK_ORDER_B 'e1430000-0000-0000-0000-000000000002'
\set FK_DISPUTE_A 'e1440000-0000-0000-0000-000000000001'
\set FK_DISPUTE_B 'e1440000-0000-0000-0000-000000000002'
INSERT INTO auth.users(id,email) VALUES(:'FK_ACTOR','receipt-actor-fk@test.example');
INSERT INTO public.tab_receipt_sends(id,tenant_id,tab_id,actor_id,charge_id,status,completed_at)
SELECT :'FK_RECEIPT',tenant_id,tab_id,:'FK_ACTOR',charge_id,'SENT',now()
FROM public.tab_receipt_sends WHERE id=(:'receipt2'::jsonb->>'attempt_id')::uuid;
SELECT t.ok(EXISTS(SELECT 1 FROM public.tab_receipt_sends WHERE id=:'FK_RECEIPT' AND actor_id=:'FK_ACTOR'),
 'Revisão A2 auditoria referencia ator descartável antes da exclusão');
DELETE FROM auth.users WHERE id=:'FK_ACTOR';
SELECT t.ok(NOT EXISTS(SELECT 1 FROM auth.users WHERE id=:'FK_ACTOR') AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=:'FK_ACTOR'),
 'Revisão A2 exclusão da identidade também remove o perfil sem bloquear em comprovantes');
SELECT t.ok(EXISTS(SELECT 1 FROM public.tab_receipt_sends WHERE id=:'FK_RECEIPT' AND actor_id IS NULL AND status='SENT' AND completed_at IS NOT NULL AND charge_id IS NOT NULL),
 'Revisão A2 ON DELETE SET NULL preserva histórico e cobrança após excluir ator');
SELECT t.ok(EXISTS(SELECT 1 FROM public.tab_receipt_sends WHERE id=(:'receipt2'::jsonb->>'attempt_id')::uuid AND actor_id=:'OWNER'),
 'Revisão A2 exclusão de um ator não altera a autoria dos outros comprovantes');

INSERT INTO public.orders(id,tenant_id,tab_id,fulfillment_type,status,subtotal,total_amount,payment_method,payment_status,origin,order_number,customer_name,customer_phone,delivery_address)
SELECT CASE WHEN o.tenant_id=:'A' THEN :'FK_ORDER_A'::uuid ELSE :'FK_ORDER_B'::uuid END,
 o.tenant_id,o.tab_id,'DINE_IN','READY',o.subtotal,o.total_amount,o.payment_method,o.payment_status,o.origin,
 CASE WHEN o.tenant_id=:'A' THEN 1401 ELSE 1402 END,'Fixture FK','11900000000','Mesa de teste'
FROM public.orders o WHERE o.id IN('e1250000-0000-0000-0000-000000000007','e1250000-0000-0000-0000-000000000013');
SELECT t.throws($q$INSERT INTO public.order_delivery_disputes(tenant_id,order_id)
 VALUES('10000000-0000-0000-0000-00000000000a','e1430000-0000-0000-0000-000000000002')$q$,
 'foreign key constraint','Revisão B4 FK composta continua recusando pedido de outra loja');
INSERT INTO public.order_delivery_disputes(id,tenant_id,order_id) VALUES
 (:'FK_DISPUTE_A',:'A',:'FK_ORDER_A'),(:'FK_DISPUTE_B',:'B',:'FK_ORDER_B');
SELECT t.throws($q$DELETE FROM public.orders WHERE id='e1430000-0000-0000-0000-000000000001'$q$,
 'ORDER_DELETE_FORBIDDEN','Revisão B4 exclusão normal de pedido continua bloqueada antes da cascata');
SELECT t.ok(EXISTS(SELECT 1 FROM public.order_delivery_disputes WHERE id=:'FK_DISPUTE_A'),
 'Revisão B4 tentativa de exclusão bloqueada preserva a contestação');
-- Somente o superusuário deste banco local descartável suspende o guard para
-- exercitar a FK de uma operação de manutenção; nenhum bypass é criado na aplicação.
ALTER TABLE public.orders DISABLE TRIGGER trg_orders_before_delete_guard;
DELETE FROM public.orders WHERE tenant_id=:'A' AND id=:'FK_ORDER_A';
ALTER TABLE public.orders ENABLE TRIGGER trg_orders_before_delete_guard;
SELECT t.ok(NOT EXISTS(SELECT 1 FROM public.orders WHERE id=:'FK_ORDER_A'),
 'Revisão B4 manutenção autorizada consegue excluir pedido com contestação');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM public.order_delivery_disputes WHERE id=:'FK_DISPUTE_A'),
 'Revisão B4 ON DELETE CASCADE remove a contestação do pedido excluído');
SELECT t.ok(EXISTS(SELECT 1 FROM public.orders WHERE id=:'FK_ORDER_B' AND tenant_id=:'B')
 AND EXISTS(SELECT 1 FROM public.order_delivery_disputes WHERE id=:'FK_DISPUTE_B' AND order_id=:'FK_ORDER_B' AND tenant_id=:'B'),
 'Revisão B4 cascata preserva pedido e contestação de outra loja');
SELECT t.ok(EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.orders'::regclass
 AND tgname='trg_orders_before_delete_guard' AND tgenabled='O'),
 'Revisão B4 guard de exclusão reativado ao terminar a manutenção local');

