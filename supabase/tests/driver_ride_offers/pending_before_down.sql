-- Somente harness local: oferta durável para provar que o down não altera pedidos/códigos/histórico.
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ('a0000000-0000-0000-0000-000000000035','rollback.driver@example.test','{}');
INSERT INTO public.tenant_users(user_id,tenant_id,role_id,status) VALUES ('a0000000-0000-0000-0000-000000000035','10000000-0000-0000-0000-00000000000a','DRIVER','ACTIVE');
INSERT INTO public.drivers(user_id,tenant_id,full_name,status,approval_status) VALUES ('a0000000-0000-0000-0000-000000000035','10000000-0000-0000-0000-00000000000a','Entregador rollback','AVAILABLE','APPROVED');
INSERT INTO public.orders(id,tenant_id,customer_name,customer_phone,delivery_address,subtotal,delivery_fee,total_amount,payment_method,payment_status,fulfillment_type,status)
VALUES('45000000-0000-0000-0000-000000000088','10000000-0000-0000-0000-00000000000a','Cliente rollback','11999990000','Endereço sintético',10,5,15,'CASH','PAYMENT_ON_DELIVERY','DELIVERY','READY');
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
SELECT public.offer_order_to_driver('45000000-0000-0000-0000-000000000088','a0000000-0000-0000-0000-000000000035');
RESET ROLE;
DO $$ BEGIN ASSERT EXISTS(SELECT 1 FROM public.order_driver_offers WHERE order_id='45000000-0000-0000-0000-000000000088' AND status='OFFERED'); END $$;
-- resync
