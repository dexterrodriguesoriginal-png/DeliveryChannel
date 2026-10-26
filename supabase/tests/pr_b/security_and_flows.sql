\set ON_ERROR_STOP 1
BEGIN;
-- All records below are synthetic. Tests run twice, before/after rollback and reapplication.
CREATE FUNCTION pg_temp.denied(command text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE command;
 RAISE EXCEPTION 'Expected permission denial: %',command;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
CREATE FUNCTION pg_temp.fails(command text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE command;
 RAISE EXCEPTION 'Expected error: %',expected;
EXCEPTION WHEN raise_exception THEN
 IF SQLERRM NOT LIKE expected||'%' THEN RAISE; END IF;
END $$;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ('b0000000-0000-0000-0000-000000000005','driver.b@test.local','{}');
INSERT INTO public.tenant_users(user_id,tenant_id,role_id,status) VALUES ('b0000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-00000000000b','DRIVER','PENDING');
INSERT INTO public.drivers(user_id,tenant_id,full_name,status,approval_status) VALUES
 ('a0000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-00000000000a','Motorista Teste','AVAILABLE','APPROVED'),
 ('b0000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-00000000000b','Pedido de Cadastro','UNAVAILABLE','PENDING');
INSERT INTO public.orders(id,tenant_id,customer_id,customer_name,customer_phone,delivery_address,subtotal,delivery_fee,discount,total_amount,payment_method,payment_status,fulfillment_type,status) VALUES
 ('42000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-0000000000a7','Cliente Sintético','11999990000','Rua de Teste',10,0,0,10,'CASH','PAYMENT_ON_DELIVERY','DELIVERY','READY'),
 ('42000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000b',NULL,'Cliente Sintético','11999990000','Rua de Teste',10,0,0,10,'CASH','PAYMENT_ON_DELIVERY','DELIVERY','READY');
DO $$ BEGIN
 ASSERT (SELECT count(*)=2 FROM public.owner_notifications WHERE kind='ORDER_NEW');
 ASSERT (SELECT count(*)=1 FROM public.owner_notifications WHERE kind='DRIVER_JOIN_REQUEST');
 ASSERT NOT EXISTS(SELECT 1 FROM public.owner_notifications WHERE title LIKE '%Sintético%' OR title LIKE '%Cadastro%'), 'notification contains PII';
 ASSERT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='order_messages');
 ASSERT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='owner_notifications');
END $$;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT (SELECT count(*)=1 FROM public.owner_notifications), 'owner A sees only A';
 ASSERT (public.get_dispatch_queue('10000000-0000-0000-0000-00000000000a')->>'mode')='OWNER_PICKS';
 ASSERT jsonb_array_length(public.get_dispatch_queue('10000000-0000-0000-0000-00000000000a')->'drivers')=1;
 PERFORM public.set_dispatch_mode('10000000-0000-0000-0000-00000000000a','AUTO_QUEUE');
 ASSERT (public.get_dispatch_queue('10000000-0000-0000-0000-00000000000a')->>'mode')='AUTO_QUEUE';
 PERFORM pg_temp.fails($q$SELECT public.set_dispatch_mode('10000000-0000-0000-0000-00000000000a','OPEN')$q$,'INVALID_MODE');
 PERFORM pg_temp.denied($q$SELECT public.get_dispatch_queue('10000000-0000-0000-0000-00000000000b')$q$);
 PERFORM pg_temp.denied($q$SELECT public.set_dispatch_mode('10000000-0000-0000-0000-00000000000b','AUTO_QUEUE')$q$);
 PERFORM pg_temp.denied($q$INSERT INTO public.owner_notifications(tenant_id,kind,ref_id,title) VALUES ('10000000-0000-0000-0000-00000000000a','ORDER_NEW',gen_random_uuid(),'fake')$q$);
 PERFORM pg_temp.denied($q$UPDATE public.owner_notifications SET title='fake'$q$);
 UPDATE public.owner_notifications SET read_at=now() WHERE tenant_id='10000000-0000-0000-0000-00000000000b';
 ASSERT NOT FOUND, 'owner A updated B notification';
 UPDATE public.owner_notifications SET read_at=now();
 ASSERT FOUND;
 ASSERT public.get_order_pickup_code('42000000-0000-0000-0000-000000000001') IS NULL, 'store must not see pickup code';
 PERFORM pg_temp.denied($q$SELECT public.reset_handoff_code('42000000-0000-0000-0000-000000000002','pickup')$q$);
 PERFORM pg_temp.denied($q$SELECT public.confirm_order_pickup('42000000-0000-0000-0000-000000000002','0000')$q$);
 PERFORM pg_temp.denied($q$SELECT public.send_order_message('42000000-0000-0000-0000-000000000002','forged B')$q$);
 PERFORM pg_temp.denied($q$SELECT public.assign_order_to_driver('42000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000005')$q$);
 PERFORM public.assign_order_to_driver('42000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005');
 ASSERT jsonb_array_length(public.get_dispatch_queue('10000000-0000-0000-0000-00000000000a')->'drivers')=0, 'busy driver remains in queue';
END $$;
RESET ROLE;
-- Capture a wrong value guaranteed not to match the random code.
SELECT set_config('test.wrong_pickup',(SELECT CASE WHEN pickup_code='0000' THEN '9999' ELSE '0000' END FROM public.order_handoff_codes WHERE order_id='42000000-0000-0000-0000-000000000001'),true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; i int; BEGIN
 FOR i IN 1..5 LOOP
 r:=public.confirm_order_pickup('42000000-0000-0000-0000-000000000001',current_setting('test.wrong_pickup'));
 ASSERT (r->>'success')::boolean=false;
 ASSERT (r->>'attemptsLeft')::int=5-i;
 END LOOP;
 ASSERT (public.get_handoff_status('42000000-0000-0000-0000-000000000001')->>'pickupLocked')::boolean;
 PERFORM pg_temp.fails($q$SELECT public.confirm_order_pickup('42000000-0000-0000-0000-000000000001','0000')$q$,'CODE_LOCKED');
 PERFORM public.reset_handoff_code('42000000-0000-0000-0000-000000000001','pickup');
 ASSERT NOT (public.get_handoff_status('42000000-0000-0000-0000-000000000001')->>'pickupLocked')::boolean;
 PERFORM pg_temp.fails($q$SELECT public.update_order_status('42000000-0000-0000-0000-000000000001','OUT_FOR_DELIVERY')$q$,'PICKUP_CODE_REQUIRED');
END $$;
RESET ROLE;
SELECT set_config('test.pickup',(SELECT pickup_code FROM public.order_handoff_codes WHERE order_id='42000000-0000-0000-0000-000000000001'),true);
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000005',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT public.get_order_pickup_code('42000000-0000-0000-0000-000000000002') IS NULL;
 ASSERT public.get_order_pickup_code('42000000-0000-0000-0000-000000000001')->>'code'=current_setting('test.pickup');
 PERFORM pg_temp.denied($q$SELECT public.confirm_order_pickup('42000000-0000-0000-0000-000000000001','0000')$q$);
 PERFORM pg_temp.denied($q$SELECT public.reset_handoff_code('42000000-0000-0000-0000-000000000001','pickup')$q$);
 PERFORM pg_temp.denied($q$SELECT public.driver_accept_order('42000000-0000-0000-0000-000000000002')$q$);
 ASSERT public.list_available_driver_orders()='[]'::jsonb;
 PERFORM public.send_order_message('42000000-0000-0000-0000-000000000001','Já cheguei.');
 ASSERT (SELECT count(*)=1 FROM public.order_messages);
 PERFORM pg_temp.denied($q$INSERT INTO public.order_messages(tenant_id,order_id,sender_role,sender_user,body) VALUES ('10000000-0000-0000-0000-00000000000b','42000000-0000-0000-0000-000000000002','STORE',auth.uid(),'spoof')$q$);
 PERFORM pg_temp.fails($q$SELECT public.send_order_message('42000000-0000-0000-0000-000000000001',repeat('x',501))$q$,'INVALID_MESSAGE');
 PERFORM pg_temp.fails($q$SELECT public.send_order_message('42000000-0000-0000-0000-000000000001','   ')$q$,'INVALID_MESSAGE');
 ASSERT (SELECT count(*)=0 FROM public.owner_notifications);
END $$;
RESET ROLE;
-- Owner B cannot read A's conversation or manipulate A's handoff.
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT (SELECT count(*)=0 FROM public.order_messages);
 ASSERT (SELECT count(*)=2 FROM public.owner_notifications), 'owner B sees A notifications';
 PERFORM pg_temp.denied($q$SELECT public.send_order_message('42000000-0000-0000-0000-000000000001','wrong store')$q$);
 PERFORM pg_temp.denied($q$SELECT public.reset_handoff_code('42000000-0000-0000-0000-000000000001','delivery')$q$);
 ASSERT public.get_handoff_status('42000000-0000-0000-0000-000000000001') IS NULL;
END $$;
RESET ROLE;
-- Operator may chat and validate pickup, but cannot reset or change dispatch settings.
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT (SELECT count(*)=0 FROM public.owner_notifications);
 PERFORM public.send_order_message('42000000-0000-0000-0000-000000000001','Pode retirar.');
 PERFORM pg_temp.denied($q$SELECT public.reset_handoff_code('42000000-0000-0000-0000-000000000001','pickup')$q$);
 PERFORM pg_temp.denied($q$SELECT public.set_dispatch_mode('10000000-0000-0000-0000-00000000000a','OWNER_PICKS')$q$);
 ASSERT (public.confirm_order_pickup('42000000-0000-0000-0000-000000000001',current_setting('test.pickup'))->>'success')::boolean;
END $$;
RESET ROLE;
SELECT set_config('test.old_delivery',(SELECT delivery_code FROM public.order_handoff_codes WHERE order_id='42000000-0000-0000-0000-000000000001'),true);
-- Manager regenerates delivery code. Customer RPC returns the new value.
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT public.reset_handoff_code('42000000-0000-0000-0000-000000000001','delivery');
RESET ROLE;
SELECT set_config('test.delivery',(SELECT delivery_code FROM public.order_handoff_codes WHERE order_id='42000000-0000-0000-0000-000000000001'),true);
DO $$ BEGIN
 ASSERT current_setting('test.delivery')<>current_setting('test.old_delivery'), 'reset reused old code';
 ASSERT (SELECT count(*)=2 FROM public.audit_logs WHERE action='HANDOFF_CODE_RESET');
 ASSERT NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE action IN ('HANDOFF_CODE_RESET','ORDER_PICKUP_CONFIRMED','ORDER_ASSIGNED_DRIVER') AND user_name LIKE '% %'), 'audit actor includes more than first name';
 ASSERT (SELECT status='OUT_FOR_DELIVERY' FROM public.orders WHERE id='42000000-0000-0000-0000-000000000001');
 ASSERT (SELECT count(*)=1 FROM public.owner_notifications WHERE kind='ORDER_MESSAGE'), 'store reply must not notify itself';
END $$;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000007',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT public.get_my_order_delivery_code('42000000-0000-0000-0000-000000000001')->>'code'=current_setting('test.delivery');
 ASSERT public.get_order_pickup_code('42000000-0000-0000-0000-000000000001') IS NULL;
 ASSERT (SELECT count(*)=0 FROM public.order_messages), 'customer can read driver/store chat';
 PERFORM pg_temp.denied($q$SELECT public.send_order_message('42000000-0000-0000-0000-000000000001','customer intrusion')$q$);
END $$;
RESET ROLE;
-- Driver approval/membership revocation removes chat and pickup access immediately.
UPDATE public.drivers SET approval_status='SUSPENDED',status='SUSPENDED' WHERE user_id='a0000000-0000-0000-0000-000000000005';
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000005',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT (SELECT count(*)=0 FROM public.order_messages);
 ASSERT public.get_order_pickup_code('42000000-0000-0000-0000-000000000001') IS NULL;
 PERFORM pg_temp.denied($q$SELECT public.confirm_order_delivery('42000000-0000-0000-0000-000000000001','0000')$q$);
END $$;
RESET ROLE;
UPDATE public.drivers SET approval_status='APPROVED',status='ON_DELIVERY' WHERE user_id='a0000000-0000-0000-0000-000000000005';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; i int; wrong text; BEGIN
 wrong:=CASE WHEN current_setting('test.delivery')='0000' THEN '9999' ELSE '0000' END;
 FOR i IN 1..5 LOOP
 r:=public.confirm_order_delivery('42000000-0000-0000-0000-000000000001',wrong);
 ASSERT (r->>'attemptsLeft')::int=5-i;
 END LOOP;
 PERFORM pg_temp.fails($q$SELECT public.confirm_order_delivery('42000000-0000-0000-0000-000000000001','0000')$q$,'CODE_LOCKED');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.reset_handoff_code('42000000-0000-0000-0000-000000000001','delivery');
RESET ROLE;
SELECT set_config('test.delivery',(SELECT delivery_code FROM public.order_handoff_codes WHERE order_id='42000000-0000-0000-0000-000000000001'),true);
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000005',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT (public.confirm_order_delivery('42000000-0000-0000-0000-000000000001',current_setting('test.delivery'))->>'success')::boolean;
 PERFORM pg_temp.fails($q$SELECT public.send_order_message('42000000-0000-0000-0000-000000000001','too late')$q$,'ORDER_CLOSED');
END $$;
RESET ROLE;
-- Queue rotates by last ride, not presence or last profile update; never-run drivers come first.
INSERT INTO public.tenant_users(user_id,tenant_id,role_id,status) VALUES ('a0000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-00000000000a','DRIVER','ACTIVE');
INSERT INTO public.drivers(user_id,tenant_id,full_name,status,approval_status) VALUES ('a0000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-00000000000a','Próximo da Fila','AVAILABLE','APPROVED');
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT public.get_dispatch_queue('10000000-0000-0000-0000-00000000000a')->'drivers'->0->>'user_id'='a0000000-0000-0000-0000-000000000008';
 ASSERT jsonb_array_length(public.get_dispatch_queue('10000000-0000-0000-0000-00000000000a')->'drivers')=2;
END $$;
RESET ROLE;
-- CEO is not an implicit member of every tenant for new PR B APIs.
SELECT set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT (SELECT count(*)=0 FROM public.owner_notifications);
 ASSERT (SELECT count(*)=0 FROM public.order_messages);
 PERFORM pg_temp.denied($q$SELECT public.get_dispatch_queue('10000000-0000-0000-0000-00000000000a')$q$);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE anon;
DO $$ BEGIN
 PERFORM pg_temp.denied('SELECT * FROM public.owner_notifications');
 PERFORM pg_temp.denied('SELECT * FROM public.order_messages');
 PERFORM pg_temp.denied($q$SELECT public.get_dispatch_queue('10000000-0000-0000-0000-00000000000a')$q$);
 PERFORM pg_temp.denied($q$SELECT public.send_order_message('42000000-0000-0000-0000-000000000001','anonymous')$q$);
 PERFORM pg_temp.denied($q$SELECT public.reset_handoff_code('42000000-0000-0000-0000-000000000001','delivery')$q$);
 PERFORM pg_temp.denied('SELECT public.purge_dispatch_data()');
END $$;
RESET ROLE;
-- Inactive owners lose access, even if the role itself still says OWNER.
UPDATE public.tenant_users SET status='INACTIVE' WHERE tenant_id='10000000-0000-0000-0000-00000000000a' AND user_id='a0000000-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT (SELECT count(*)=0 FROM public.owner_notifications);
 PERFORM pg_temp.denied($q$SELECT public.get_dispatch_queue('10000000-0000-0000-0000-00000000000a')$q$);
END $$;
RESET ROLE;
-- Retention uses completion time, not message age. Open conversations are preserved.
INSERT INTO public.order_messages(tenant_id,order_id,sender_role,sender_user,body,created_at) VALUES ('10000000-0000-0000-0000-00000000000b','42000000-0000-0000-0000-000000000002','STORE','b0000000-0000-0000-0000-000000000001','Conversa aberta',now()-interval '100 days');
UPDATE public.owner_notifications SET created_at=now()-interval '91 days';
UPDATE public.orders SET delivered_at=now()-interval '91 days' WHERE id='42000000-0000-0000-0000-000000000001';
SELECT public.purge_dispatch_data();
DO $$ BEGIN
 ASSERT (SELECT count(*)=0 FROM public.owner_notifications);
 ASSERT (SELECT count(*)=0 FROM public.order_messages WHERE order_id='42000000-0000-0000-0000-000000000001');
 ASSERT (SELECT count(*)=1 FROM public.order_messages WHERE order_id='42000000-0000-0000-0000-000000000002'), 'purged open conversation';
 RAISE NOTICE 'PASS: notifications, queue, tenant isolation, role checks, inverted pickup, lock/reset, customer refresh, chat, retention, anon';
END $$;
ROLLBACK;
