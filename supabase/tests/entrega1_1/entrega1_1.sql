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
