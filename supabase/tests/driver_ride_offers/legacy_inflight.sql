-- Corrida sintética criada ANTES da migração: deve permanecer inalterada no deploy.
INSERT INTO public.drivers(user_id,tenant_id,full_name,status,approval_status) VALUES
 ('a0000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-00000000000a','Motorista legado','ON_DELIVERY','APPROVED');
INSERT INTO public.orders(id,tenant_id,driver_id,driver_accepted_at,customer_name,customer_phone,delivery_address,subtotal,delivery_fee,total_amount,payment_method,payment_status,fulfillment_type,status)
VALUES('45000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000005',now(),'Cliente legado','11999990000','Endereço legado',10,5,15,'CASH','PAYMENT_ON_DELIVERY','DELIVERY','WAITING_FOR_DRIVER');
UPDATE public.order_handoff_codes SET pickup_code='1234' WHERE order_id='45000000-0000-0000-0000-000000000099';
