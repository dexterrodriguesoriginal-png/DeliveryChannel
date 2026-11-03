-- Assertions introduced by later migrations stay exercised in their own window.
-- The core N1 tests separately verify the earlier allowed-delete/automatic-seed behavior.
SELECT set_config('t.later_order', t.mk_order('10000000-0000-0000-0000-00000000000a','CANCELLED')::text, false);
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.throws(format($$DELETE FROM public.orders WHERE id=%L$$,current_setting('t.later_order')), 'permission denied', '4300: OWNER não exclui cancelado; usa arquivamento');
SELECT t.is(t.order_status(current_setting('t.later_order')::uuid),'CANCELLED','4300: pedido cancelado preservado');
RESET ROLE;
SELECT t.throws(format($$DELETE FROM public.orders WHERE id=%L$$,current_setting('t.later_order')), 'ORDER_DELETE_FORBIDDEN', '4300: trigger bloqueia exclusão por operação de sistema');
INSERT INTO public.coupon_redemptions(tenant_id,coupon_id,order_id,channel,discount_amount)
VALUES('10000000-0000-0000-0000-00000000000a','c1000000-0000-0000-0000-000000000001',current_setting('t.later_order')::uuid,'ONLINE',1);
SELECT t.throws(format($$DELETE FROM public.orders WHERE id=%L$$,current_setting('t.later_order')), 'ORDER_DELETE_FORBIDDEN', '4300: pedido com histórico de cupom não é apagado');
SELECT t.login(NULL);
INSERT INTO public.tenants(id,slug,name,document,phone,email,status)
VALUES('10000000-0000-0000-0000-00000000000c','late-guards-c','Loja sintética C','00000000000191','1100','later-guards@example.invalid','ACTIVE');
SELECT t.is((SELECT count(*) FROM public.products WHERE tenant_id='10000000-0000-0000-0000-00000000000c' AND is_demo),0::bigint,'3500: inserção direta de loja não semeia; seed ocorre no onboarding');
