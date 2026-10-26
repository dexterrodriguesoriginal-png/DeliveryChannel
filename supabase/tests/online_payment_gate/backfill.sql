-- Five production-shaped synthetic rows: four PIX without a charge, one CONFIRMED online card.
INSERT INTO public.orders(id,tenant_id,customer_id,customer_name,customer_phone,delivery_address,subtotal,delivery_fee,total_amount,payment_method,payment_status,fulfillment_type,status,origin)
 SELECT ('43000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 '10000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-0000000000a7','Cliente Backfill','11999990000','Rua de teste',10,0,10,
 CASE WHEN n=5 THEN 'CREDIT_CARD' ELSE 'PIX' END,'PENDING','DELIVERY',CASE WHEN n=5 THEN 'CONFIRMED' ELSE 'PENDING' END,'storefront'
 FROM generate_series(1,5) n;
INSERT INTO public.order_payments(order_id,tenant_id,provider,method,amount,status)
 VALUES('43000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-00000000000a','mercadopago','card',10,'pending');
-- Preserve exact status, stock, timestamps and notification IDs across backfill and rollback.
CREATE TABLE public.gate_backfill_before AS SELECT id,status,created_at,updated_at FROM public.orders WHERE id::text LIKE '43000000-%';
CREATE TABLE public.gate_stock_before AS SELECT id,stock_quantity FROM public.products;
