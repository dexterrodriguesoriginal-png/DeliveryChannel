-- G: hardening de get_customer_order_by_id (020)
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000007');
SELECT set_config('t.co', public.get_customer_order_by_id('0d000000-0000-0000-0000-0000000000a2')::text, false);
SELECT t.ok(NOT (current_setting('t.co')::jsonb ? 'customerId') AND NOT (current_setting('t.co')::jsonb ? 'tenantId'), 'G: sem customerId/tenantId');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(current_setting('t.co')::jsonb -> 'statusHistory') h WHERE h ? 'changedBy' OR h ? 'note'), 'G: histórico sem changedBy/note');
SELECT t.ok(current_setting('t.co') NOT LIKE '%Funcionário Fulano%' AND current_setting('t.co') NOT LIKE '%nota interna%', 'G: nome de funcionário e nota interna não vazam');
SELECT t.ok(current_setting('t.co')::jsonb ? 'prepTimeMinutes', 'G: inclui prepTimeMinutes');
SELECT t.is((current_setting('t.co')::jsonb ->> 'totalAmount')::numeric, 40.00, 'G: valores oficiais do banco');
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT t.throws($$SELECT public.get_customer_order_by_id('0d000000-0000-0000-0000-0000000000a2')$$, 'não encontrado', 'G: outro cliente recebe erro genérico');
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.throws($$SELECT public.get_customer_order_by_id('0d000000-0000-0000-0000-0000000000a2')$$, 'não encontrado', 'G: staff não usa a RPC de cliente');
SELECT t.throws($$SELECT public.get_customer_order_by_id(gen_random_uuid())$$, 'não encontrado', 'G: pedido inexistente = mesma mensagem');
RESET ROLE;
SET ROLE anon;
SELECT t.login(NULL);
SELECT t.throws($$SELECT public.get_customer_order_by_id('0d000000-0000-0000-0000-0000000000a2')$$, 'permission denied', 'G: anon sem EXECUTE');
RESET ROLE;
