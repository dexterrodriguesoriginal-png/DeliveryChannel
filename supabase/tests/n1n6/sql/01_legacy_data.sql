-- Dados SINTÉTICOS de teste no estado 001–020 (antes de N1–N6), como se fossem "produção".
-- Somente para o banco local de teste. Nenhum dado real.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('a0000000-0000-0000-0000-000000000001','owner.a@test.local','{"name":"Dona A"}'),
 ('a0000000-0000-0000-0000-000000000002','manager.a@test.local','{"name":"Gerente A"}'),
 ('a0000000-0000-0000-0000-000000000003','operator.a@test.local','{"name":"Operador A"}'),
 ('a0000000-0000-0000-0000-000000000004','cashier.a@test.local','{"name":"Caixa A"}'),
 ('a0000000-0000-0000-0000-000000000005','driver.a@test.local','{"name":"Motorista A"}'),
 ('a0000000-0000-0000-0000-000000000006','dm.a@test.local','{"name":"Logistica A"}'),
 ('a0000000-0000-0000-0000-000000000007','cliente1@test.local','{"name":"Cliente Um"}'),
 ('a0000000-0000-0000-0000-000000000008','cliente2@test.local','{"name":"Cliente Dois"}'),
 ('b0000000-0000-0000-0000-000000000001','owner.b@test.local','{"name":"Dono B"}'),
 ('b0000000-0000-0000-0000-000000000004','cashier.b@test.local','{"name":"Caixa B"}'),
 ('c0000000-0000-0000-0000-000000000001','ceo@test.local','{"name":"CEO"}'),
 ('c0000000-0000-0000-0000-000000000002','superadmin@test.local','{"name":"Super Admin"}');

INSERT INTO public.tenants (id, slug, name, document, phone, email, status) VALUES
 ('10000000-0000-0000-0000-00000000000a','adega-a','Adega A','11222333000181','11999990000','contato@adega-a.test','ACTIVE'),
 ('10000000-0000-0000-0000-00000000000b','adega-b','Adega B','11444777000161','11999990001','contato@adega-b.test','ACTIVE');

INSERT INTO public.tenant_settings (tenant_id, is_open, min_order_value, delivery_fee, free_delivery_threshold, address, city, phone_whatsapp, pix_key) VALUES
 ('10000000-0000-0000-0000-00000000000a', true, 0, 5.00, 200.00, 'Rua A, 1', 'São Paulo', '11999990000', '529.982.247-25'),
 ('10000000-0000-0000-0000-00000000000b', true, 0, 7.00, NULL, 'Rua B, 2', 'Campinas', '11999990001', 'chave-invalida');

INSERT INTO public.tenant_themes (tenant_id, store_name) VALUES
 ('10000000-0000-0000-0000-00000000000a','Adega Ácida Teste'),
 ('10000000-0000-0000-0000-00000000000b','Adega B');

INSERT INTO public.tenant_users (user_id, tenant_id, role_id, status) VALUES
 ('a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','OWNER','ACTIVE'),
 ('a0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a','MANAGER','ACTIVE'),
 ('a0000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-00000000000a','OPERATOR','ACTIVE'),
 ('a0000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-00000000000a','CASHIER','ACTIVE'),
 ('a0000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-00000000000a','DRIVER','ACTIVE'),
 ('a0000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-00000000000a','DELIVERY_MANAGER','ACTIVE'),
 ('b0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','OWNER','ACTIVE'),
 ('b0000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-00000000000b','CASHIER','ACTIVE'),
 ('c0000000-0000-0000-0000-000000000001', NULL, 'CEO','ACTIVE'),
 ('c0000000-0000-0000-0000-000000000002', NULL, 'SUPER_ADMIN','ACTIVE');

INSERT INTO public.products (id, tenant_id, name, image_url, price, promotional_price, cost_price, stock_quantity, is_active) VALUES
 ('d0000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','Cerveja A1','https://img.test/a1.jpg',10.00,NULL,4.00,1000,true),
 ('d0000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-00000000000a','Vinho A2','https://img.test/a2.jpg',20.00,15.00,9.00,1000,true),
 ('d0000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-00000000000a','Inativo A3','https://img.test/a3.jpg',30.00,NULL,NULL,50,false),
 ('d0000000-0000-0000-0000-0000000000a4','10000000-0000-0000-0000-00000000000a','Raro A4','https://img.test/a4.jpg',100.00,NULL,NULL,1,true),
 ('d0000000-0000-0000-0000-0000000000a5','10000000-0000-0000-0000-00000000000a','Destilado A5','https://img.test/a5.jpg',50.00,NULL,20.00,1000,true),
 ('d0000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','Produto B1','https://img.test/b1.jpg',50.00,NULL,30.00,1000,true);

-- Ofertas legadas, incluindo UM vínculo inválido entre tenants (oferta de A apontando produto de B), como as ~34 de produção.
INSERT INTO public.offers (id, tenant_id, product_id, title, image_url, original_price, promotional_price, is_active, display_order) VALUES
 ('e0000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000a1','Oferta A1','https://img.test/oa1.jpg',10.00,8.00,true,1),
 ('e0000000-0000-0000-0000-0000000000a9','10000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000b1','Oferta cruzada inválida','https://img.test/oax.jpg',50.00,40.00,true,2),
 ('e0000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','d0000000-0000-0000-0000-0000000000b1','Oferta B1','https://img.test/ob1.jpg',50.00,45.00,true,1);

INSERT INTO public.customers (id, tenant_id, user_id, name, phone, email, total_orders, ltv_amount) VALUES
 ('f0000000-0000-0000-0000-0000000000a7','10000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000007','Cliente Um','11988887777','cliente1@test.local',2,65.00);

INSERT INTO public.orders (id, tenant_id, customer_id, customer_name, customer_phone, customer_email, delivery_address,
                           subtotal, delivery_fee, discount, total_amount, payment_method, payment_status, fulfillment_type, status) VALUES
 ('0d000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-0000000000a7','Cliente Um','11988887777','cliente1@test.local','Rua X, 10',
  20.00, 5.00, 0, 25.00, 'PIX', 'PENDING', 'DELIVERY', 'PENDING'),
 -- legado com total inconsistente (PC5): deve continuar podendo mudar de status
 ('0d000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-0000000000a7','Cliente Um','11988887777','cliente1@test.local','Rua X, 10',
  30.00, 5.00, 0, 40.00, 'CASH', 'PAYMENT_ON_DELIVERY', 'DELIVERY', 'CONFIRMED');
INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price) VALUES
 ('0d000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1','Cerveja A1',2,10.00,20.00),
 ('0d000000-0000-0000-0000-0000000000a2','d0000000-0000-0000-0000-0000000000a1','Cerveja A1',3,10.00,30.00);
INSERT INTO public.order_status_history (order_id, status, note, changed_by) VALUES
 ('0d000000-0000-0000-0000-0000000000a1','PENDING','Pedido confirmado','Checkout Público'),
 ('0d000000-0000-0000-0000-0000000000a2','CONFIRMED','nota interna: cliente chato','Funcionário Fulano');
