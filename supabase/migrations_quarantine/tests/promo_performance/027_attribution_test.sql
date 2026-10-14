-- Teste LOCAL (Postgres com stubs do Supabase). Nunca rodar em produção.
-- Pré-requisito: 001–027 aplicadas num banco descartável.
\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE _r(n serial, test text, ok boolean, detail text);
GRANT ALL ON _r TO authenticated; GRANT USAGE ON SEQUENCE _r_n_seq TO authenticated;

INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-0000-0000-0000000000a1','owner-a@t.local'),
 ('00000000-0000-0000-0000-0000000000b1','owner-b@t.local'),
 ('00000000-0000-0000-0000-0000000000c1','cliente@t.local') ON CONFLICT DO NOTHING;
INSERT INTO public.tenants(id,slug,name,document,phone,email) VALUES
 ('10000000-0000-0000-0000-00000000000a','loja-a','Loja A','1','11999999999','a@t.local'),
 ('10000000-0000-0000-0000-00000000000b','loja-b','Loja B','2','11999999998','b@t.local');
INSERT INTO public.tenant_users(user_id,tenant_id,role_id,status) VALUES
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','OWNER','ACTIVE'),
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','OWNER','ACTIVE');
INSERT INTO public.offers(id,tenant_id,title,image_url,destination_type,has_promo_checkout,promo_price,promo_original_price,promo_usage_limit) VALUES
 ('20000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','Combo A','x','CUSTOM_OFFER',true,40,50,10),
 ('20000000-0000-0000-0000-00000000000b','10000000-0000-0000-0000-00000000000b','Combo B','x','CUSTOM_OFFER',true,30,30,NULL);

-- 1) Checkout promocional como cliente autenticado grava a origem no servidor
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
CREATE TEMP TABLE _o AS SELECT public.process_promotional_checkout_atomic('loja-a','20000000-0000-0000-0000-00000000000a',2,'Cli','11988887777','c@t.local','Rua 1',NULL,'PIX','PICKUP') AS r;
INSERT INTO _r(test,ok,detail) SELECT 'checkout grava offer_id + redemption', o.offer_id='20000000-0000-0000-0000-00000000000a' AND (o.campaign_metadata->>'redemption_number')='1' AND i.offer_id=o.offer_id AND i.discount_amount=20, format('total=%s desc_item=%s', o.total_amount, i.discount_amount)
  FROM _o JOIN public.orders o ON o.id=(_o.r->>'order_id')::uuid JOIN public.order_items i ON i.order_id=o.id;
-- 2) card de outra loja pelo slug da loja A é rejeitado pela RPC
DO $$ BEGIN
  PERFORM public.process_promotional_checkout_atomic('loja-a','20000000-0000-0000-0000-00000000000b',1,'Cli','11988887777','c@t.local','Rua',NULL,'PIX','PICKUP');
  INSERT INTO _r(test,ok,detail) VALUES ('RPC rejeita card de outra loja',false,'aceitou');
EXCEPTION WHEN others THEN INSERT INTO _r(test,ok,detail) VALUES ('RPC rejeita card de outra loja',true,SQLERRM); END $$;
RESET ROLE;

-- 3) INSERT direto com card de outra loja é bloqueado pelo trigger (mesmo como superusuário)
DO $$ BEGIN
  INSERT INTO public.orders(tenant_id,customer_name,customer_phone,delivery_address,subtotal,delivery_fee,total_amount,payment_method,offer_id)
  VALUES ('10000000-0000-0000-0000-00000000000a','X','11999990000','R',1,0,1,'PIX','20000000-0000-0000-0000-00000000000b');
  INSERT INTO _r(test,ok,detail) VALUES ('trigger bloqueia offer de outra loja',false,'aceitou');
EXCEPTION WHEN others THEN INSERT INTO _r(test,ok,detail) VALUES ('trigger bloqueia offer de outra loja',true,SQLERRM); END $$;

-- 4) OWNER da loja A: pode cancelar, mas não trocar a origem nem o resgate
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
DO $$ DECLARE v uuid := (SELECT id FROM public.orders WHERE offer_id='20000000-0000-0000-0000-00000000000a' LIMIT 1); BEGIN
  BEGIN UPDATE public.orders SET offer_id=NULL::uuid WHERE id=v;
    INSERT INTO _r(test,ok,detail) VALUES ('staff não remove a origem',false,'aceitou');
  EXCEPTION WHEN others THEN INSERT INTO _r(test,ok,detail) VALUES ('staff não remove a origem',true,SQLERRM); END;
  BEGIN UPDATE public.order_items SET offer_id=NULL::uuid WHERE order_id=v;
    INSERT INTO _r(test,ok,detail) VALUES ('staff não remove origem do item',false,'aceitou');
  EXCEPTION WHEN others THEN INSERT INTO _r(test,ok,detail) VALUES ('staff não remove origem do item',true,SQLERRM); END;
  BEGIN UPDATE public.orders SET campaign_metadata = campaign_metadata || '{"redemption_number":99}' WHERE id=v;
    INSERT INTO _r(test,ok,detail) VALUES ('resgate imutável',false,'aceitou');
  EXCEPTION WHEN others THEN INSERT INTO _r(test,ok,detail) VALUES ('resgate imutável',true,SQLERRM); END;
  BEGIN UPDATE public.order_items SET discount_amount=0 WHERE order_id=v;
    INSERT INTO _r(test,ok,detail) VALUES ('desconto do item imutável',false,'aceitou');
  EXCEPTION WHEN others THEN INSERT INTO _r(test,ok,detail) VALUES ('desconto do item imutável',true,SQLERRM); END;
  UPDATE public.orders SET status='CANCELLED' WHERE id=v;
  INSERT INTO _r(test,ok,detail) SELECT 'cancelamento continua permitido e mantém origem', status='CANCELLED' AND offer_id IS NOT NULL, status FROM public.orders WHERE id=v;
END $$;
-- 5) Isolamento: OWNER A não enxerga pedidos/itens da loja B
INSERT INTO _r(test,ok,detail) SELECT 'OWNER A vê só a loja A', count(*) FILTER (WHERE tenant_id<>'10000000-0000-0000-0000-00000000000a')=0 AND count(*)>=1, count(*)::text FROM public.orders;
RESET ROLE;
-- pedido na loja B por outro cliente
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
SELECT public.process_promotional_checkout_atomic('loja-b','20000000-0000-0000-0000-00000000000b',1,'Cli','11988887777','c@t.local','Rua',NULL,'PIX','PICKUP');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
INSERT INTO _r(test,ok,detail) SELECT 'OWNER A não vê pedido da loja B', count(*)=0, count(*)::text FROM public.orders WHERE tenant_id='10000000-0000-0000-0000-00000000000b';
INSERT INTO _r(test,ok,detail) SELECT 'OWNER A filtrando loja B via tenant_id não vê itens', count(*)=0, count(*)::text FROM public.order_items i WHERE i.offer_id='20000000-0000-0000-0000-00000000000b';
RESET ROLE;
-- 5b) Dedup: um pedido promocional = 1 linha em orders com 1 offer_id; contagem por card
INSERT INTO _r(test,ok,detail) SELECT 'cada pedido atribuído a um único card', bool_and(c=1), count(*)::text FROM (SELECT o.id, count(DISTINCT o.offer_id) c FROM public.orders o WHERE o.offer_id IS NOT NULL GROUP BY o.id) x;
-- 6) ON DELETE SET NULL do card continua funcionando (offer_id -> NULL permitido)
DELETE FROM public.offers WHERE id='20000000-0000-0000-0000-00000000000b';
INSERT INTO _r(test,ok,detail) SELECT 'exclusão do card zera offer_id (FK SET NULL)', count(*)=1, count(*)::text FROM public.orders WHERE tenant_id='10000000-0000-0000-0000-00000000000b' AND offer_id IS NULL;

SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS r, test, left(detail,80) FROM _r ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE NOT ok) AS fail FROM _r;
ROLLBACK;
