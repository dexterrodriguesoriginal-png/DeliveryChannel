-- PIX: CRC16 (vetor oficial do BCB), validação de chave, tenant_payment_settings, payload por pedido.
SELECT t.is(public._crc16_ccitt('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304'), '1D3D', 'CRC16-CCITT: vetor do Manual BR Code (BCB) = 1D3D');
SELECT t.is(public._pix_brcode('123e4567-e12b-12d1-a456-426655440000','Fulano de Tal','BRASILIA',NULL,'***'),
    '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D', 'BR Code idêntico ao exemplo do BCB');
SELECT t.is(public._crc16_ccitt('123456789'), '29B1', 'CRC16-CCITT-FALSE: vetor de verificação "123456789" = 29B1');
SELECT t.ok(public._pix_brcode('52998224725','Adega','SP',25.5,'PED12') LIKE '%540525.50%', 'BR Code inclui campo 54 com valor 25.50');
SELECT t.ok(public._validate_pix_key('CPF','52998224725') AND NOT public._validate_pix_key('CPF','52998224724') AND NOT public._validate_pix_key('CPF','11111111111'), 'validação CPF (dígitos verificadores)');
SELECT t.ok(public._validate_pix_key('CNPJ','11222333000181') AND NOT public._validate_pix_key('CNPJ','11222333000182'), 'validação CNPJ');
SELECT t.ok(public._validate_pix_key('PHONE','+5511987654321') AND NOT public._validate_pix_key('PHONE','11987654321'), 'validação telefone E.164 +55');
SELECT t.ok(public._validate_pix_key('EMAIL','loja@exemplo.com.br') AND NOT public._validate_pix_key('EMAIL','loja@'), 'validação e-mail');
SELECT t.ok(public._validate_pix_key('EVP','123e4567-e12b-12d1-a456-426655440000') AND NOT public._validate_pix_key('EVP','123'), 'validação EVP');

SET ROLE authenticated;
-- leitura da tabela: só OWNER/MANAGER do tenant
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible('SELECT * FROM public.tenant_payment_settings'), 1::bigint, 'OWNER A lê só a config do próprio tenant');
SELECT t.throws($$SELECT pix_key FROM public.tenant_settings$$, 'permission denied', 'tenant_settings.pix_key não é mais legível pela API');
SELECT t.lives($$SELECT id, tenant_id, is_open, delivery_fee, default_prep_time_minutes FROM public.tenant_settings$$, 'tenant_settings: colunas explícitas continuam legíveis');
SELECT t.throws($$UPDATE public.tenant_settings SET pix_key = 'x'$$, 'permission denied', 'tenant_settings.pix_key não é gravável');
SELECT t.lives($$UPDATE public.tenant_settings SET default_prep_time_minutes = 25 WHERE tenant_id = '10000000-0000-0000-0000-00000000000a'$$, 'OWNER configura default_prep_time_minutes');
SELECT t.throws($$UPDATE public.tenant_payment_settings SET pix_enabled = false$$, 'permission denied', 'tenant_payment_settings: escrita direta negada (só RPC)');
SELECT t.throws($$SELECT public.upsert_tenant_payment_settings('10000000-0000-0000-0000-00000000000a', true, 'CPF', '123', 'Adega', 'SP')$$, 'PIX_KEY_INVALID', 'upsert recusa chave inválida');
SELECT t.lives($$SELECT public.upsert_tenant_payment_settings('10000000-0000-0000-0000-00000000000a', true, 'PHONE', '(11) 98765-4321', 'Adega A', 'São Paulo')$$, 'OWNER atualiza PIX via RPC (telefone normalizado)');
SELECT t.is(t.sq($$SELECT pix_key FROM public.tenant_payment_settings WHERE tenant_id='10000000-0000-0000-0000-00000000000a'$$), '+5511987654321', 'telefone normalizado para +55');
SELECT t.ok(t.sq($$SELECT new_value FROM public.audit_logs WHERE action='PAYMENT_SETTINGS_UPDATED' ORDER BY created_at DESC LIMIT 1$$) NOT LIKE '%987654321%', 'auditoria do PIX com chave mascarada');
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.is(t.visible('SELECT * FROM public.tenant_payment_settings'), 0::bigint, 'CASHIER não lê tenant_payment_settings');
SELECT t.throws($$SELECT public.upsert_tenant_payment_settings('10000000-0000-0000-0000-00000000000a', false, NULL, NULL, NULL, NULL)$$, 'PAYMENT_SETTINGS_FORBIDDEN', 'CASHIER não altera PIX');
SELECT t.login('c0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible('SELECT * FROM public.tenant_payment_settings'), 0::bigint, 'F2: CEO não lê tenant_payment_settings');
SELECT t.login('c0000000-0000-0000-0000-000000000002');
SELECT t.is(t.visible('SELECT * FROM public.tenant_payment_settings'), 0::bigint, 'F2: SUPER_ADMIN não lê tenant_payment_settings');
SELECT t.login('b0000000-0000-0000-0000-000000000001');
SELECT t.throws($$SELECT public.upsert_tenant_payment_settings('10000000-0000-0000-0000-00000000000a', false, NULL, NULL, NULL, NULL)$$, 'PAYMENT_SETTINGS_FORBIDDEN', 'OWNER de B não altera PIX de A');
RESET ROLE;
SET ROLE anon;
SELECT t.login(NULL);
SELECT t.is(t.visible('SELECT * FROM public.tenant_payment_settings'), -1::bigint, 'anon sem privilégio em tenant_payment_settings');
SELECT t.throws($$SELECT public.get_order_pix_payload('0d000000-0000-0000-0000-0000000000a1')$$, 'permission denied', 'anon não chama get_order_pix_payload');
RESET ROLE;

-- Payload PIX por pedido (pedido legado a1: PIX/PENDING, cliente 1)
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000007');
SELECT t.ok((SELECT (public.get_order_pix_payload('0d000000-0000-0000-0000-0000000000a1') ->> 'brcode') LIKE '%br.gov.bcb.pix%+5511987654321%5303986540525.00%PED%'),
    'cliente dono recebe BR Code com valor do servidor (25.00) e txid do pedido');
SELECT set_config('t.brcode', public.get_order_pix_payload('0d000000-0000-0000-0000-0000000000a1') ->> 'brcode', false);
RESET ROLE;
SELECT t.ok((SELECT public._crc16_ccitt(left(b, length(b) - 4)) = right(b, 4) FROM (SELECT current_setting('t.brcode') AS b) x), 'CRC do payload gerado confere');
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000008');
SELECT t.throws($$SELECT public.get_order_pix_payload('0d000000-0000-0000-0000-0000000000a1')$$, 'ORDER_NOT_FOUND', 'outro cliente não obtém o PIX do pedido');
SELECT t.login('a0000000-0000-0000-0000-000000000003');
SELECT t.throws($$SELECT public.get_order_pix_payload('0d000000-0000-0000-0000-0000000000a1')$$, 'ORDER_NOT_FOUND', 'OPERATOR não obtém PIX');
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.lives($$SELECT public.get_order_pix_payload('0d000000-0000-0000-0000-0000000000a1')$$, 'CASHIER obtém PIX (balcão)');
SELECT t.login('a0000000-0000-0000-0000-000000000007');
SELECT t.throws($$SELECT public.get_order_pix_payload('0d000000-0000-0000-0000-0000000000a2')$$, 'PIX_NOT_APPLICABLE', 'pedido em dinheiro não gera PIX');
RESET ROLE;
