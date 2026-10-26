\set ON_ERROR_STOP 1
BEGIN;
-- Inteiramente sintético e transacional; também executável no staging com a base de fixtures.
-- IDs exclusivos deste teste: não pressupõe usuários nem pedidos reais do staging.
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a4500000-0000-0000-0000-000000000001','ride.owner.a@example.test','{}'),
 ('a4500000-0000-0000-0000-000000000002','ride.manager.a@example.test','{}'),
 ('a4500000-0000-0000-0000-000000000005','ride.driver.a@example.test','{}'),
 ('a4500000-0000-0000-0000-000000000006','ride.dm.a@example.test','{}'),
 ('a4500000-0000-0000-0000-000000000007','ride.customer.a@example.test','{}'),
 ('b4500000-0000-0000-0000-000000000001','ride.owner.b@example.test','{}');
INSERT INTO public.tenants(id,slug,name,document,phone,email,status) VALUES
 ('14500000-0000-0000-0000-00000000000a','teste-oferta-corrida-a-4500','Loja sintética A','11222333000181','11999990000','ride.a@example.test','ACTIVE'),
 ('14500000-0000-0000-0000-00000000000b','teste-oferta-corrida-b-4500','Loja sintética B','11444777000161','11999990001','ride.b@example.test','ACTIVE');
INSERT INTO public.tenant_settings(tenant_id,is_open,min_order_value,delivery_fee,address,city,phone_whatsapp) VALUES
 ('14500000-0000-0000-0000-00000000000a',true,0,5,'Endereço sintético A','São Paulo','11999990000'),('14500000-0000-0000-0000-00000000000b',true,0,5,'Endereço sintético B','São Paulo','11999990001');
INSERT INTO public.tenant_users(user_id,tenant_id,role_id,status) VALUES
 ('a4500000-0000-0000-0000-000000000001','14500000-0000-0000-0000-00000000000a','OWNER','ACTIVE'),
 ('a4500000-0000-0000-0000-000000000002','14500000-0000-0000-0000-00000000000a','MANAGER','ACTIVE'),
 ('a4500000-0000-0000-0000-000000000005','14500000-0000-0000-0000-00000000000a','DRIVER','ACTIVE'),
 ('a4500000-0000-0000-0000-000000000006','14500000-0000-0000-0000-00000000000a','DELIVERY_MANAGER','ACTIVE'),
 ('b4500000-0000-0000-0000-000000000001','14500000-0000-0000-0000-00000000000b','OWNER','ACTIVE');
INSERT INTO public.customers(id,tenant_id,user_id,name,phone) VALUES
 ('f4500000-0000-0000-0000-0000000000a7','14500000-0000-0000-0000-00000000000a','a4500000-0000-0000-0000-000000000007','Cliente sintético','11999990000');
INSERT INTO public.drivers(user_id,tenant_id,full_name,status,approval_status) VALUES
 ('a4500000-0000-0000-0000-000000000005','14500000-0000-0000-0000-00000000000a','Primeiro entregador','AVAILABLE','APPROVED');
CREATE FUNCTION pg_temp.denied(command text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE command; RAISE EXCEPTION 'Permissão indevida: %',command;
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
CREATE FUNCTION pg_temp.fails(command text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE command; RAISE EXCEPTION 'Erro esperado: %',expected;
EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE expected||'%' THEN RAISE; END IF; END $$;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a4500000-0000-0000-0000-000000000015','oferta2@test.local','{}'),
 ('b4500000-0000-0000-0000-000000000015','ofertab@test.local','{}');
INSERT INTO public.tenant_users(user_id,tenant_id,role_id,status) VALUES
 ('a4500000-0000-0000-0000-000000000015','14500000-0000-0000-0000-00000000000a','DRIVER','ACTIVE'),
 ('b4500000-0000-0000-0000-000000000015','14500000-0000-0000-0000-00000000000b','DRIVER','ACTIVE');
INSERT INTO public.drivers(id,user_id,tenant_id,full_name,status,approval_status) VALUES
 ('45000000-0000-0000-0000-000000000012','a4500000-0000-0000-0000-000000000015','14500000-0000-0000-0000-00000000000a','Segundo entregador','AVAILABLE','APPROVED'),
 ('45000000-0000-0000-0000-000000000013','b4500000-0000-0000-0000-000000000015','14500000-0000-0000-0000-00000000000b','Outra loja','AVAILABLE','APPROVED');
INSERT INTO public.orders(id,tenant_id,customer_id,customer_name,customer_phone,delivery_address,address_details,subtotal,delivery_fee,total_amount,payment_method,payment_status,fulfillment_type,status)
SELECT ('45000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'14500000-0000-0000-0000-00000000000a','f4500000-0000-0000-0000-0000000000a7','PII Cliente','11987654321','Rua sigilosa, 123','{"neighborhood":"Centro","street":"Rua sigilosa","number":"123"}',10,5,15,'CASH','PAYMENT_ON_DELIVERY','DELIVERY','READY'
FROM generate_series(1,8) i;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT oid::regprocedure sig,prosecdef,proconfig,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY[
 'offer_order_to_driver','driver_respond_offer','get_my_driver_offers','expire_driver_offers','cancel_driver_offer','set_driver_offer_timeout',
 '_driver_offer_queue','_create_driver_offer','_advance_driver_offer','_orders_cancel_driver_offers']) LOOP
  ASSERT r.prosecdef AND r.proconfig @> ARRAY['search_path=""'];
  ASSERT NOT has_function_privilege('anon',r.sig,'EXECUTE');
  ASSERT has_function_privilege('authenticated',r.sig,'EXECUTE')=(left(r.proname,1)<>'_');
  IF left(r.proname,1)='_' THEN ASSERT NOT has_function_privilege('service_role',r.sig,'EXECUTE'); END IF;
 END LOOP;
 ASSERT NOT has_table_privilege('authenticated','public.order_driver_offers','INSERT');
 ASSERT NOT has_table_privilege('authenticated','public.order_driver_offers','UPDATE');
 ASSERT NOT has_table_privilege('authenticated','public.order_driver_offers','DELETE');
 ASSERT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='order_driver_offers');
END $$;
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000001',true);
UPDATE public.order_handoff_codes SET pickup_attempts=4,pickup_confirmed_at=clock_timestamp() WHERE order_id='45000000-0000-0000-0000-000000000001';
SELECT set_config('test.previous',(SELECT pickup_code FROM public.order_handoff_codes WHERE order_id='45000000-0000-0000-0000-000000000001'),true);
SET LOCAL ROLE authenticated;
SELECT public.set_dispatch_mode('14500000-0000-0000-0000-00000000000a','OWNER_PICKS');
SELECT public.set_driver_offer_timeout('14500000-0000-0000-0000-00000000000a',60);
SELECT set_config('test.offer',(public.assign_order_to_driver('45000000-0000-0000-0000-000000000001','a4500000-0000-0000-0000-000000000005')->>'offerId'),true);
DO $$ BEGIN
 ASSERT (public.offer_order_to_driver('45000000-0000-0000-0000-000000000001','a4500000-0000-0000-0000-000000000015')->>'error')='OFFER_ALREADY_EXISTS';
 ASSERT (public.offer_order_to_driver('45000000-0000-0000-0000-000000000002','a4500000-0000-0000-0000-000000000005')->>'error')='DRIVER_BUSY';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT status='READY' AND driver_id IS NULL AND driver_accepted_at IS NULL FROM public.orders WHERE id='45000000-0000-0000-0000-000000000001');
 ASSERT (SELECT status='AVAILABLE' FROM public.drivers WHERE tenant_id='14500000-0000-0000-0000-00000000000a' AND user_id='a4500000-0000-0000-0000-000000000005');
 BEGIN
  INSERT INTO public.order_driver_offers(tenant_id,order_id,driver_user_id,expires_at) VALUES('14500000-0000-0000-0000-00000000000a','45000000-0000-0000-0000-000000000001','a4500000-0000-0000-0000-000000000015',now()+interval '1 minute');
  RAISE EXCEPTION 'Índice único ausente';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','b4500000-0000-0000-0000-000000000015',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT (SELECT count(*)=0 FROM public.order_driver_offers);
 ASSERT public.get_my_driver_offers()='[]'::jsonb;
 PERFORM pg_temp.denied(format('SELECT public.driver_respond_offer(%L,true)',current_setting('test.offer')));
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000015',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.denied(format('SELECT public.driver_respond_offer(%L,true)',current_setting('test.offer'))); END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000005',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE offers jsonb; BEGIN
 offers:=public.get_my_driver_offers();
 ASSERT jsonb_array_length(offers)=1;
 ASSERT offers->0->>'neighborhood'='Centro';
 ASSERT NOT offers::text ~ 'PII Cliente|11987654321|Rua sigilosa|customer_name|delivery_address|pickup_code';
 ASSERT NOT EXISTS(SELECT 1 FROM public.orders WHERE id='45000000-0000-0000-0000-000000000001');
 ASSERT public.get_order_pickup_code('45000000-0000-0000-0000-000000000001') IS NULL;
 ASSERT (public.driver_accept_order('45000000-0000-0000-0000-000000000001')->>'accepted')::boolean;
 ASSERT public.get_order_pickup_code('45000000-0000-0000-0000-000000000001')->>'code'<>current_setting('test.previous');
 ASSERT EXISTS(SELECT 1 FROM public.orders WHERE id='45000000-0000-0000-0000-000000000001');
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT status='WAITING_FOR_DRIVER' AND driver_accepted_at IS NOT NULL AND driver_id='a4500000-0000-0000-0000-000000000005' FROM public.orders WHERE id='45000000-0000-0000-0000-000000000001');
 ASSERT (SELECT pickup_attempts=0 AND pickup_confirmed_at IS NULL FROM public.order_handoff_codes WHERE order_id='45000000-0000-0000-0000-000000000001');
 ASSERT (SELECT status='ON_DELIVERY' FROM public.drivers WHERE tenant_id='14500000-0000-0000-0000-00000000000a' AND user_id='a4500000-0000-0000-0000-000000000005');
END $$;
-- Um mesmo usuário com vínculo em duas lojas não recebe nova corrida enquanto está ocupado.
INSERT INTO public.tenant_users(user_id,tenant_id,role_id,status) VALUES ('a4500000-0000-0000-0000-000000000005','14500000-0000-0000-0000-00000000000b','DRIVER','ACTIVE');
INSERT INTO public.drivers(user_id,tenant_id,full_name,status,approval_status) VALUES ('a4500000-0000-0000-0000-000000000005','14500000-0000-0000-0000-00000000000b','Mesmo entregador na loja B','AVAILABLE','APPROVED');
INSERT INTO public.orders(id,tenant_id,customer_name,customer_phone,delivery_address,subtotal,delivery_fee,total_amount,payment_method,payment_status,fulfillment_type,status)
VALUES('45000000-0000-0000-0000-000000000021','14500000-0000-0000-0000-00000000000b','Cliente B','11999990000','Endereço B',10,5,15,'CASH','PAYMENT_ON_DELIVERY','DELIVERY','READY');
SELECT set_config('request.jwt.claim.sub','b4500000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT public.offer_order_to_driver('45000000-0000-0000-0000-000000000021','a4500000-0000-0000-0000-000000000005')->>'error'='DRIVER_BUSY'; END $$;
RESET ROLE;
SELECT set_config('test.code',(SELECT pickup_code FROM public.order_handoff_codes WHERE order_id='45000000-0000-0000-0000-000000000001'),true);
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.fails($q$SELECT public.update_order_status('45000000-0000-0000-0000-000000000001','OUT_FOR_DELIVERY')$q$,'PICKUP_CODE_REQUIRED');
SELECT public.confirm_order_pickup('45000000-0000-0000-0000-000000000001',current_setting('test.code'));
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT status='OUT_FOR_DELIVERY' FROM public.orders WHERE id='45000000-0000-0000-0000-000000000001'); END $$;
SELECT set_config('test.delivery',(SELECT delivery_code FROM public.order_handoff_codes WHERE order_id='45000000-0000-0000-0000-000000000001'),true);
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000005',true);
SET LOCAL ROLE authenticated;
SELECT public.confirm_order_delivery('45000000-0000-0000-0000-000000000001',current_setting('test.delivery'));
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT status='AVAILABLE' FROM public.drivers WHERE tenant_id='14500000-0000-0000-0000-00000000000a' AND user_id='a4500000-0000-0000-0000-000000000005'); END $$;
-- Recusa manual mantém READY e não atribui.
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.offer',(public.offer_order_to_driver('45000000-0000-0000-0000-000000000002','a4500000-0000-0000-0000-000000000005')->>'offerId'),true);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000005',true);
SET LOCAL ROLE authenticated;
SELECT public.driver_respond_offer(current_setting('test.offer')::uuid,false);
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT status='DECLINED' FROM public.order_driver_offers WHERE id=current_setting('test.offer')::uuid);
 ASSERT (SELECT status='READY' AND driver_id IS NULL FROM public.orders WHERE id='45000000-0000-0000-0000-000000000002');
 ASSERT EXISTS(SELECT 1 FROM public.owner_notifications WHERE ref_id='45000000-0000-0000-0000-000000000002' AND title='Entregador recusou');
END $$;
-- Expiração e fila automática: ignora p_driver e não repete quem expirou/recusou.
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.set_dispatch_mode('14500000-0000-0000-0000-00000000000a','AUTO_QUEUE');
SELECT set_config('test.offer',(public.offer_order_to_driver('45000000-0000-0000-0000-000000000003','b4500000-0000-0000-0000-000000000015')->>'offerId'),true);
RESET ROLE;
SELECT set_config('test.expired_driver',(SELECT driver_user_id::text FROM public.order_driver_offers WHERE id=current_setting('test.offer')::uuid),true);
UPDATE public.order_driver_offers SET expires_at=now()-interval '1 second' WHERE id=current_setting('test.offer')::uuid;
SELECT public.expire_driver_offers();
DO $$ BEGIN
 ASSERT (SELECT status='EXPIRED' FROM public.order_driver_offers WHERE id=current_setting('test.offer')::uuid);
 ASSERT (SELECT count(*)=1 FROM public.order_driver_offers WHERE order_id='45000000-0000-0000-0000-000000000003' AND status='OFFERED' AND driver_user_id<>current_setting('test.expired_driver')::uuid);
 ASSERT public.expire_driver_offers()=0;
END $$;
SELECT set_config('request.jwt.claim.sub',current_setting('test.expired_driver'),true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT public.driver_respond_offer(current_setting('test.offer')::uuid,true)->>'error'='OFFER_EXPIRED'; END $$;
RESET ROLE;
SELECT set_config('test.next',(SELECT id::text FROM public.order_driver_offers WHERE order_id='45000000-0000-0000-0000-000000000003' AND status='OFFERED'),true);
SELECT set_config('request.jwt.claim.sub',(SELECT driver_user_id::text FROM public.order_driver_offers WHERE id=current_setting('test.next')::uuid),true);
SET LOCAL ROLE authenticated;
SELECT public.driver_respond_offer(current_setting('test.next')::uuid,false);
RESET ROLE;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.order_driver_offers WHERE order_id='45000000-0000-0000-0000-000000000003' AND status='OFFERED');
 ASSERT EXISTS(SELECT 1 FROM public.owner_notifications WHERE ref_id='45000000-0000-0000-0000-000000000003' AND title='Nenhum entregador aceitou');
END $$;
-- Cancelamento de oferta e pedido; aceite obsoleto nunca atribui.
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.set_dispatch_mode('14500000-0000-0000-0000-00000000000a','OWNER_PICKS');
SELECT set_config('test.offer',(public.offer_order_to_driver('45000000-0000-0000-0000-000000000004','a4500000-0000-0000-0000-000000000005')->>'offerId'),true);
SELECT public.update_order_status('45000000-0000-0000-0000-000000000004','CANCELLED','Teste da oferta');
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT status='CANCELLED' FROM public.order_driver_offers WHERE id=current_setting('test.offer')::uuid); END $$;
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000005',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT public.driver_respond_offer(current_setting('test.offer')::uuid,true)->>'success'='false'; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.offer',(public.offer_order_to_driver('45000000-0000-0000-0000-000000000005','a4500000-0000-0000-0000-000000000005')->>'offerId'),true);
SELECT public.cancel_driver_offer(current_setting('test.offer')::uuid);
SELECT public.cancel_driver_offer(current_setting('test.offer')::uuid);
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT status='CANCELLED' FROM public.order_driver_offers WHERE id=current_setting('test.offer')::uuid);
 ASSERT (SELECT status='READY' AND driver_id IS NULL FROM public.orders WHERE id='45000000-0000-0000-0000-000000000005');
END $$;
-- Expiração lazy no getter e no próprio aceite, sem lançar erro que desfaça EXPIRED.
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.offer',(public.offer_order_to_driver('45000000-0000-0000-0000-000000000006','a4500000-0000-0000-0000-000000000005')->>'offerId'),true);
RESET ROLE;
UPDATE public.order_driver_offers SET expires_at=clock_timestamp()-interval '1 second' WHERE id=current_setting('test.offer')::uuid;
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000005',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT public.driver_respond_offer(current_setting('test.offer')::uuid,true)->>'error'='OFFER_EXPIRED'; END $$;
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT status='EXPIRED' FROM public.order_driver_offers WHERE id=current_setting('test.offer')::uuid); END $$;
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.offer',(public.offer_order_to_driver('45000000-0000-0000-0000-000000000007','a4500000-0000-0000-0000-000000000005')->>'offerId'),true);
RESET ROLE;
UPDATE public.order_driver_offers SET expires_at=clock_timestamp()-interval '1 second' WHERE id=current_setting('test.offer')::uuid;
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000005',true);
SET LOCAL ROLE authenticated;
SELECT public.get_my_driver_offers();
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT status='EXPIRED' FROM public.order_driver_offers WHERE id=current_setting('test.offer')::uuid); END $$;
-- Revalidar disponibilidade no aceite, inclusive se mudou depois da oferta.
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT public.offer_order_to_driver('45000000-0000-0000-0000-000000000007','b4500000-0000-0000-0000-000000000015')->>'error'='DRIVER_NOT_FOUND';
END $$;
SELECT set_config('test.offer',(public.offer_order_to_driver('45000000-0000-0000-0000-000000000007','a4500000-0000-0000-0000-000000000005')->>'offerId'),true);
RESET ROLE;
UPDATE public.drivers SET status='UNAVAILABLE' WHERE tenant_id='14500000-0000-0000-0000-00000000000a' AND user_id='a4500000-0000-0000-0000-000000000005';
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000005',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT public.driver_respond_offer(current_setting('test.offer')::uuid,true)->>'error'='DRIVER_BUSY'; END $$;
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT status='READY' AND driver_id IS NULL FROM public.orders WHERE id='45000000-0000-0000-0000-000000000007'); END $$;
UPDATE public.drivers SET status='AVAILABLE' WHERE tenant_id='14500000-0000-0000-0000-00000000000a' AND user_id='a4500000-0000-0000-0000-000000000005';
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.cancel_driver_offer(current_setting('test.offer')::uuid);
RESET ROLE;
-- Pagamento online pendente também bloqueia a RPC de compatibilidade.
INSERT INTO public.orders(id,tenant_id,customer_name,customer_phone,delivery_address,subtotal,delivery_fee,total_amount,payment_method,payment_status,fulfillment_type,status,awaiting_online_payment)
VALUES('45000000-0000-0000-0000-000000000010','14500000-0000-0000-0000-00000000000a','Cliente online','11999990000','Endereço sintético',10,5,15,'CREDIT_CARD','PENDING','DELIVERY','READY',true);
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT public.assign_order_to_driver('45000000-0000-0000-0000-000000000010','a4500000-0000-0000-0000-000000000005')->>'error'='PAYMENT_REQUIRED'; END $$;
RESET ROLE;
-- Papel de logística pode chamar e consultar fila, mas não alterar o prazo.
SELECT set_config('request.jwt.claim.sub','a4500000-0000-0000-0000-000000000006',true);
SET LOCAL ROLE authenticated;
SELECT public.get_dispatch_queue('14500000-0000-0000-0000-00000000000a');
SELECT pg_temp.denied($q$SELECT public.set_driver_offer_timeout('14500000-0000-0000-0000-00000000000a',40)$q$);
SELECT set_config('test.offer',(public.offer_order_to_driver('45000000-0000-0000-0000-000000000008','a4500000-0000-0000-0000-000000000005')->>'offerId'),true);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','b4500000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied($q$SELECT public.offer_order_to_driver('45000000-0000-0000-0000-000000000008',NULL)$q$);
DO $$ BEGIN PERFORM pg_temp.denied(format('SELECT public.cancel_driver_offer(%L)',current_setting('test.offer'))); END $$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.denied($q$SELECT public.get_my_driver_offers()$q$);
SELECT pg_temp.denied($q$SELECT public.expire_driver_offers()$q$);
SELECT pg_temp.denied($q$SELECT public.offer_order_to_driver('45000000-0000-0000-0000-000000000008',NULL)$q$);
RESET ROLE;
ROLLBACK;
