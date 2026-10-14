-- Prévia de cupom (validate_coupon) e regras (decisão 8: não acumula com promoção).
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT t.is((public.validate_coupon('adega-a','dez10','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":3}]') ->> 'discount')::numeric, 3.00, 'percentual 10% sobre 30 = 3');
SELECT t.is((public.validate_coupon('adega-a','DEZ10','[{"productId":"d0000000-0000-0000-0000-0000000000a2","quantity":2}]') ->> 'reason'), 'COUPON_NOT_APPLICABLE_PROMO', 'decisão 8: item promocional não é base de cupom');
SELECT t.is((public.validate_coupon('adega-a','DEZ10','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1},{"productId":"d0000000-0000-0000-0000-0000000000a2","quantity":1}]') ->> 'eligible_base')::numeric, 10.00, 'base elegível exclui o item promocional');
SELECT t.is((public.validate_coupon('adega-a','BSOMENTE','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]') ->> 'reason'), 'COUPON_INVALID', 'cupom de outro tenant = resposta genérica');
SELECT t.is((public.validate_coupon('adega-a','NAOEXISTE','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]') ->> 'reason'), 'COUPON_INVALID', 'cupom inexistente = mesma resposta');
SELECT t.is((public.validate_coupon('adega-a','VENCIDO','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]') ->> 'reason'), 'COUPON_EXPIRED', 'cupom expirado');
SELECT t.is((public.validate_coupon('adega-a','PAUSADO','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]') ->> 'reason'), 'COUPON_INVALID', 'cupom pausado');
SELECT t.throws($$SELECT public.validate_coupon('adega-a','DEZ10','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1,"price":0.01}]')$$, 'UNEXPECTED_FIELD', 'preço vindo do cliente é rejeitado (UNEXPECTED_FIELD)');
SELECT t.throws($$SELECT public.validate_coupon('adega-a','DEZ10','[{"productId":"d0000000-0000-0000-0000-0000000000b1","quantity":1}]')$$, 'PRODUCT_NOT_FOUND', 'produto de outro tenant recusado');
SELECT t.throws($$SELECT public.validate_coupon('adega-a','DEZ10','[{"productId":"d0000000-0000-0000-0000-0000000000a1"}]')$$, 'INVALID_QUANTITY', 'quantidade ausente recusada');
SELECT t.throws($$SELECT public.validate_coupon('adega-a','DEZ10','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1.5}]')$$, 'INVALID_QUANTITY', 'quantidade fracionária recusada');
RESET ROLE;
SELECT t.is(t.sq($$SELECT times_used FROM public.coupons WHERE code='DEZ10'$$), '0', 'validate_coupon nunca consome');
-- rate limit 10/min
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000006');
DO $$ BEGIN FOR i IN 1..10 LOOP PERFORM public.validate_coupon('adega-a','X','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]'); END LOOP; END $$;
SELECT t.throws($$SELECT public.validate_coupon('adega-a','X','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]')$$, 'RATE_LIMITED', 'validate_coupon: 11ª tentativa no minuto bloqueada');
-- PDV
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.is((public.validate_coupon_pos('10000000-0000-0000-0000-00000000000a','UMAVEZ','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]') ->> 'reason'), 'COUPON_REQUIRES_IDENTIFIED_CUSTOMER', 'PDV: cupom com limite por cliente exige cliente identificado');
SELECT t.is((public.validate_coupon_pos('10000000-0000-0000-0000-00000000000a','DEZ10','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":2}]') ->> 'valid')::boolean, true, 'CASHIER valida cupom no PDV');
SELECT t.login('b0000000-0000-0000-0000-000000000004');
SELECT t.throws($$SELECT public.validate_coupon_pos('10000000-0000-0000-0000-00000000000a','DEZ10','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]')$$, 'POS_FORBIDDEN', 'CASHIER de B não valida no PDV de A');
SELECT t.login('a0000000-0000-0000-0000-000000000003');
SELECT t.throws($$SELECT public.validate_coupon_pos('10000000-0000-0000-0000-00000000000a','DEZ10','[{"productId":"d0000000-0000-0000-0000-0000000000a1","quantity":1}]')$$, 'POS_FORBIDDEN', 'F4: OPERATOR não usa PDV');
RESET ROLE;
