-- Teste local da migração 2300 (harness n1n6). Uso: psql -v ON_ERROR_STOP=1 -d <db> -f kitchen_2300_test.sql
\set QUIET on
BEGIN;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-0000000000a1','ownA@t.t'),('00000000-0000-0000-0000-0000000000b1','ownB@t.t');
-- usuário sem e-mail (anônimo) não pode quebrar o trigger
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000dd01',NULL),('00000000-0000-0000-0000-00000000dd02',NULL);
INSERT INTO public.tenants(id,name,slug,phone,email,document) VALUES
 ('00000000-0000-0000-0000-00000000aaaa','A','kit-a','1','a@a','1'),('00000000-0000-0000-0000-00000000bbbb','B','kit-b','2','b@b','2');
INSERT INTO public.tenant_users(user_id,tenant_id,role_id,status) VALUES
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000aaaa','OWNER','ACTIVE'),
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000bbbb','OWNER','ACTIVE');
INSERT INTO public.orders(id,tenant_id,customer_name,customer_phone,delivery_address,subtotal,total_amount,payment_method,status,fulfillment_type) VALUES
 ('00000000-0000-0000-0000-0000000001a1','00000000-0000-0000-0000-00000000aaaa','Maria Silva','119','Rua X',10,10,'PIX','CONFIRMED','PICKUP'),
 ('00000000-0000-0000-0000-0000000001a2','00000000-0000-0000-0000-00000000aaaa','João Souza','118','Rua Y',10,10,'PIX','PENDING','DELIVERY'),
 ('00000000-0000-0000-0000-0000000001b1','00000000-0000-0000-0000-00000000bbbb','Zé','117','Rua Z',10,10,'PIX','CONFIRMED','DELIVERY');
CREATE TEMP TABLE r(k text, v jsonb); GRANT ALL ON r TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.who(sub text, anon bool) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims', json_build_object('sub',sub,'role','authenticated','is_anonymous',anon)::text, false)$$;
CREATE OR REPLACE FUNCTION pg_temp.expect_err(q text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RAISE EXCEPTION 'ESPERAVA ERRO % em: %', pat, q;
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%'||pat||'%' THEN RAISE EXCEPTION 'erro errado (%): %', pat, SQLERRM; END IF; END $$;
SET ROLE authenticated;
-- dono A: desligado por padrão, liga, PIN
SELECT pg_temp.who('00000000-0000-0000-0000-0000000000a1',false);
DO $$ BEGIN IF (public.get_kitchen_settings('00000000-0000-0000-0000-00000000aaaa')->>'enabled')::bool THEN RAISE EXCEPTION 'deveria vir desligado'; END IF; END $$;
SELECT pg_temp.expect_err($q$SELECT public.create_kitchen_pairing_code('00000000-0000-0000-0000-00000000aaaa')$q$, '');
SELECT public.set_kitchen_settings('00000000-0000-0000-0000-00000000aaaa', true, '4321', false);
INSERT INTO r SELECT 'code', public.create_kitchen_pairing_code('00000000-0000-0000-0000-00000000aaaa','Tablet');
-- dono B não gerencia A
SELECT pg_temp.who('00000000-0000-0000-0000-0000000000b1',false);
SELECT pg_temp.expect_err($q$SELECT public.create_kitchen_pairing_code('00000000-0000-0000-0000-00000000aaaa')$q$, 'FORBIDDEN');
SELECT pg_temp.expect_err($q$SELECT public.redeem_kitchen_pairing_code((SELECT v->>'code' FROM r WHERE k='code'),'x')$q$, 'USE_STAFF_LOGIN');
-- isolamento com a cozinha LIGADA em A (papel NULL não pode liberar)
SELECT pg_temp.expect_err($q$SELECT public.kitchen_list_orders('00000000-0000-0000-0000-00000000aaaa')$q$, 'FORBIDDEN');
SELECT pg_temp.expect_err($q$SELECT public.kitchen_set_order_status('00000000-0000-0000-0000-0000000001a1','PREPARING')$q$, 'ORDER_NOT_FOUND');
SELECT pg_temp.expect_err($q$SELECT public.kitchen_get_context('00000000-0000-0000-0000-00000000aaaa')$q$, 'FORBIDDEN');
DO $$ BEGIN IF (SELECT count(*) FROM public.kitchen_order_signals) > 0 THEN RAISE EXCEPTION 'B vê sinais de A'; END IF; END $$;
-- anônimo 1: código inválido, depois pareia
SELECT pg_temp.who('00000000-0000-0000-0000-00000000dd01',true);
SELECT pg_temp.expect_err($q$SELECT public.redeem_kitchen_pairing_code('ZZZZZZZZ','x')$q$, 'PAIRING_CODE_INVALID');
INSERT INTO r SELECT 'dev', public.redeem_kitchen_pairing_code((SELECT v->>'code' FROM r WHERE k='code'),'Tablet','ua');
-- anônimo bloqueado de criar clientes/pedidos
SELECT pg_temp.expect_err($q$INSERT INTO public.customers(tenant_id,name,phone) VALUES ('00000000-0000-0000-0000-00000000aaaa','x','1')$q$, '');
-- PIN: travado até desbloquear
SELECT pg_temp.expect_err($q$SELECT public.kitchen_list_orders()$q$, 'LOCK');
SELECT pg_temp.expect_err($q$SELECT public.kitchen_unlock('0000')$q$, 'PIN_INVALID');
SELECT public.kitchen_unlock('4321');
INSERT INTO r SELECT 'list', public.kitchen_list_orders();
-- transições
SELECT pg_temp.expect_err($q$SELECT public.kitchen_set_order_status('00000000-0000-0000-0000-0000000001a2','PREPARING')$q$, 'TRANSITION_FORBIDDEN');
SELECT pg_temp.expect_err($q$SELECT public.kitchen_set_order_status('00000000-0000-0000-0000-0000000001a1','READY')$q$, 'TRANSITION_FORBIDDEN');
SELECT public.kitchen_set_order_status('00000000-0000-0000-0000-0000000001a1','PREPARING');
SELECT pg_temp.expect_err($q$SELECT public.kitchen_set_order_status('00000000-0000-0000-0000-0000000001a1','DELIVERED')$q$, 'TRANSITION_FORBIDDEN');
SELECT public.kitchen_set_order_status('00000000-0000-0000-0000-0000000001a1','READY');
SELECT pg_temp.expect_err($q$SELECT public.kitchen_set_order_status('00000000-0000-0000-0000-0000000001b1','PREPARING')$q$, 'ORDER_NOT_FOUND');
-- tabelas não acessíveis diretamente
SELECT pg_temp.expect_err($q$SELECT 1/count(*) FROM public.orders$q$, '');
SELECT pg_temp.expect_err($q$SELECT public.redeem_kitchen_pairing_code((SELECT v->>'code' FROM r WHERE k='code'),'x')$q$, '');
-- anônimo 2: código já usado
SELECT pg_temp.who('00000000-0000-0000-0000-00000000dd02',true);
SELECT pg_temp.expect_err($q$SELECT public.redeem_kitchen_pairing_code((SELECT v->>'code' FROM r WHERE k='code'),'x')$q$, 'PAIRING_CODE_INVALID');
SELECT pg_temp.expect_err($q$SELECT public.kitchen_list_orders()$q$, '');
-- dono revoga
SELECT pg_temp.who('00000000-0000-0000-0000-0000000000a1',false);
SELECT public.revoke_kitchen_device((SELECT (v->>'device_id')::uuid FROM r WHERE k='dev'));
SELECT pg_temp.who('00000000-0000-0000-0000-00000000dd01',true);
SELECT pg_temp.expect_err($q$SELECT public.kitchen_list_orders()$q$, '');
RESET ROLE;
DO $$ DECLARE l jsonb := (SELECT v FROM r WHERE k='list'); s text := l::text; BEGIN
 IF s LIKE '%total_amount%' OR s LIKE '%subtotal%' OR s LIKE '%119%' OR s LIKE '%Rua%' OR s LIKE '%Silva%' OR s LIKE '%Souza%' OR s LIKE '%João%' OR s LIKE '%Zé%' THEN RAISE EXCEPTION 'vazou dado: %', s; END IF;
 IF s NOT LIKE '%Maria%' THEN RAISE EXCEPTION 'faltou primeiro nome na retirada: %', s; END IF;
 IF (SELECT status FROM public.orders WHERE id='00000000-0000-0000-0000-0000000001a1')<>'READY' THEN RAISE EXCEPTION 'status'; END IF;
 IF EXISTS (SELECT 1 FROM public.users WHERE id IN ('00000000-0000-0000-0000-00000000dd01','00000000-0000-0000-0000-00000000dd02')) THEN RAISE EXCEPTION 'perfil criado p/ anônimo'; END IF;
 RAISE NOTICE 'KITCHEN 2300 OK: %', s; END $$;
ROLLBACK;
