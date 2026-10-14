-- Fixtures pós-migração (somente teste). Funções auxiliares SECURITY DEFINER do schema t.
INSERT INTO public.drivers (user_id, tenant_id, full_name, phone, status)
VALUES ('a0000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-00000000000a','Motorista A','11900000000','AVAILABLE');

-- Cria um pedido consistente diretamente (como superusuário de teste), com 1 item de A1 (preço 10).
CREATE OR REPLACE FUNCTION t.mk_order(p_tenant UUID, p_status TEXT, p_fulfillment TEXT DEFAULT 'DELIVERY',
                                      p_method TEXT DEFAULT 'CASH', p_pay TEXT DEFAULT 'PAYMENT_ON_DELIVERY',
                                      p_customer UUID DEFAULT NULL, p_qty INT DEFAULT 1)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v UUID; v_prod UUID; v_price NUMERIC;
BEGIN
    SELECT id, price INTO v_prod, v_price FROM public.products WHERE tenant_id = p_tenant AND is_active
      ORDER BY (id IN ('d0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000b1')) DESC, id LIMIT 1;
    INSERT INTO public.orders (tenant_id, customer_id, customer_name, customer_phone, delivery_address, subtotal, delivery_fee,
                               discount, total_amount, payment_method, payment_status, fulfillment_type, status)
    VALUES (p_tenant, p_customer, 'Cliente Teste', '11911112222', 'Rua T', v_price * p_qty, 0, 0, v_price * p_qty,
            p_method, p_pay, p_fulfillment, p_status) RETURNING id INTO v;
    INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price)
    VALUES (v, v_prod, 'Item teste', p_qty, v_price, v_price * p_qty);
    RETURN v;
END $$;

CREATE OR REPLACE FUNCTION t.order_status(p_id UUID) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT status FROM public.orders WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION t.order_row(p_id UUID) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT to_jsonb(o) FROM public.orders o WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION t.stock(p_id UUID) RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT stock_quantity FROM public.products WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION t.sq(p_sql TEXT) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$ DECLARE v TEXT; BEGIN EXECUTE p_sql INTO v; RETURN v; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- Cupons de teste (OWNER/MANAGER criariam pela API; aqui direto para preparar cenários)
INSERT INTO public.coupons (id, tenant_id, code, discount_type, discount_value, usage_limit, status) VALUES
 ('c1000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','DEZ10','PERCENTAGE',10,NULL,'ACTIVE'),
 ('c1000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a','VINTE20','FIXED_AMOUNT',5,20,'ACTIVE'),
 ('c1000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-00000000000b','BSOMENTE','PERCENTAGE',10,NULL,'ACTIVE');
INSERT INTO public.coupons (id, tenant_id, code, discount_type, discount_value, usage_limit_per_customer, first_order_only, status) VALUES
 ('c1000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-00000000000a','UMAVEZ','FIXED_AMOUNT',3,1,false,'ACTIVE'),
 ('c1000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-00000000000a','PRIMEIRA','FIXED_AMOUNT',2,NULL,true,'ACTIVE');
INSERT INTO public.coupons (id, tenant_id, code, discount_type, discount_value, status, end_at) VALUES
 ('c1000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-00000000000a','VENCIDO','FIXED_AMOUNT',2,'ACTIVE', now() - interval '1 day'),
 ('c1000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-00000000000a','PAUSADO','FIXED_AMOUNT',2,'PAUSED', NULL);
-- Cupom de concorrência: limite 20
INSERT INTO public.coupons (id, tenant_id, code, discount_type, discount_value, usage_limit, status) VALUES
 ('c1000000-0000-0000-0000-000000000020','10000000-0000-0000-0000-00000000000a','CONC20','FIXED_AMOUNT',1,20,'ACTIVE');
