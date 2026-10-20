SELECT t.ok(EXISTS (
    SELECT 1 FROM public.stock_locations
    WHERE tenant_id = '10000000-0000-0000-0000-00000000000a' AND is_default
), 'estoque: loja A recebe local padrão');
SELECT t.ok(NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE NOT EXISTS (SELECT 1 FROM public.inventory_movements m
                      WHERE m.tenant_id = p.tenant_id AND m.product_id = p.id
                        AND m.type = 'OPENING_BALANCE')
), 'estoque: produto legado tem movimento de saldo inicial');
SELECT t.is((SELECT data_type FROM information_schema.columns
             WHERE table_schema='public' AND table_name='products' AND column_name='stock_quantity'),
            'numeric', 'estoque: quantidade usa tipo decimal');
SELECT t.is((SELECT numeric_precision FROM information_schema.columns
             WHERE table_schema='public' AND table_name='products' AND column_name='stock_quantity')::int,
            14, 'estoque: quantidade tem precisão 14');
SELECT t.is((SELECT numeric_scale FROM information_schema.columns
             WHERE table_schema='public' AND table_name='products' AND column_name='stock_quantity')::int,
            3, 'estoque: quantidade tem escala 3');
SELECT t.ok(NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname LIKE '\_stock%'
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
), 'estoque: helpers internos não executáveis por anon/authenticated');
SELECT t.ok(NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('stock_dashboard','stock_record_movement','stock_submit_count',
                        'stock_approve_count','stock_transfer','stock_correct_weight')
      AND (p.proconfig IS NULL OR NOT ('search_path=""' = ANY(p.proconfig)))
), 'estoque: RPCs SECURITY DEFINER fixam search_path vazio');

CREATE OR REPLACE FUNCTION t.mk_stock_order(p_product uuid, p_quantity integer DEFAULT 1)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_order uuid; v_tenant uuid := '10000000-0000-0000-0000-00000000000a'; v_price numeric;
BEGIN
    SELECT price INTO v_price FROM public.products WHERE id = p_product AND tenant_id = v_tenant;
    INSERT INTO public.orders (tenant_id, customer_name, customer_phone, delivery_address, subtotal,
                               delivery_fee, discount, total_amount, payment_method, payment_status,
                               fulfillment_type, status)
    VALUES (v_tenant, 'Cliente de teste de estoque', '11911110000', 'Rua de teste', v_price * p_quantity,
            0, 0, v_price * p_quantity, 'CASH', 'PAYMENT_ON_DELIVERY', 'PICKUP', 'PENDING')
    RETURNING id INTO v_order;
    INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, unit)
    SELECT v_order, p.id, p.name, p_quantity, p.price, p.price * p_quantity, p.stock_unit
    FROM public.products p WHERE p.id = p_product AND p.tenant_id = v_tenant;
    RETURN v_order;
END
$$;
GRANT EXECUTE ON FUNCTION t.mk_stock_order(uuid, integer) TO PUBLIC;

SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000003');
SELECT t.ok(jsonb_array_length(public.stock_dashboard('10000000-0000-0000-0000-00000000000a')->'products') > 0,
            'estoque: operador vê saldos do próprio tenant');
SELECT t.throws($$SELECT public.stock_dashboard('10000000-0000-0000-0000-00000000000b')$$,
                'STOCK_FORBIDDEN', 'estoque: RPC nega tenant cruzado');
SELECT t.is(t.visible($$SELECT id FROM public.stock_locations WHERE tenant_id='10000000-0000-0000-0000-00000000000b'$$),
            0::bigint, 'estoque: RLS oculta locais de outro tenant');
SELECT t.throws($$UPDATE public.inventory_movements SET reason = reason WHERE false$$,
                'permission|append_only', 'estoque: ledger não permite UPDATE');
SELECT t.throws($$DELETE FROM public.inventory_movements WHERE false$$,
                'permission|append_only', 'estoque: ledger não permite DELETE');

SELECT set_config('t.stock_product', 'd0000000-0000-0000-0000-0000000000a5', false);
SELECT set_config('t.stock_incoming', public.stock_create_incoming(
    '10000000-0000-0000-0000-00000000000a', current_setting('t.stock_product')::uuid,
    2, 'Fornecedor teste', 4.25, current_date + 2
)::text, false);
SELECT t.ok(EXISTS (SELECT 1 FROM public.stock_incoming
                    WHERE id = current_setting('t.stock_incoming')::uuid AND status = 'CONFIRMED'),
            'estoque: compra confirmada fica separada do saldo físico');
SELECT t.ok((SELECT COALESCE(sum((row->>'incoming_quantity')::numeric),0) = 2
             FROM jsonb_array_elements(public.stock_dashboard('10000000-0000-0000-0000-00000000000a')->'products') row
             WHERE row->>'product_id' = current_setting('t.stock_product')),
            'estoque: compras confirmadas aparecem como entrada futura');
SELECT t.lives($$SELECT public.stock_receive_incoming(current_setting('t.stock_incoming')::uuid)$$,
               'estoque: recebimento converte compra em saldo físico');
SELECT t.ok(EXISTS (SELECT 1 FROM public.inventory_movements
                    WHERE supplier_reference = 'Fornecedor teste' AND type = 'RECEIPT'),
            'estoque: recebimento registra movimento com fornecedor');

SELECT set_config('t.stock_count', public.stock_submit_count(
    '10000000-0000-0000-0000-00000000000a',
    (SELECT id FROM public.stock_locations WHERE tenant_id='10000000-0000-0000-0000-00000000000a' AND is_default),
    jsonb_build_array(jsonb_build_object('product_id', current_setting('t.stock_product')::uuid, 'counted_quantity',
        (SELECT physical_quantity - 1 FROM public.stock_location_balances
         WHERE product_id = current_setting('t.stock_product')::uuid AND tenant_id='10000000-0000-0000-0000-00000000000a'
           AND location_id = (SELECT id FROM public.stock_locations WHERE tenant_id='10000000-0000-0000-0000-00000000000a' AND is_default))))
)::text, false);
RESET ROLE;

SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000002');
SELECT t.lives($$SELECT public.stock_approve_count(current_setting('t.stock_count')::uuid, true, 'Conferência aprovada')$$,
               'estoque: gerente aprova contagem');
SELECT t.ok(EXISTS (SELECT 1 FROM public.inventory_movements
                    WHERE reference_id = current_setting('t.stock_count') AND type = 'COUNT_ADJUSTMENT'),
            'estoque: aprovação cria ajuste auditável');
SELECT t.lives($$SELECT public.stock_add_location('10000000-0000-0000-0000-00000000000a','Depósito teste')$$,
               'estoque: gerente pode adicionar local');
SELECT set_config('t.stock_location', (
    SELECT id::text FROM public.stock_locations
    WHERE tenant_id='10000000-0000-0000-0000-00000000000a' AND name='Depósito teste'
), false);
SELECT t.lives(format(
    $$SELECT public.stock_transfer('10000000-0000-0000-0000-00000000000a', %L,
       (SELECT id FROM public.stock_locations WHERE tenant_id='10000000-0000-0000-0000-00000000000a' AND is_default),
       %L, 1, 'Reposição entre locais')$$,
    current_setting('t.stock_product'), current_setting('t.stock_location')
), 'estoque: transferência cria movimentos pareados');
SELECT t.is((SELECT count(*) FROM public.inventory_movements
             WHERE type IN ('TRANSFER_IN','TRANSFER_OUT') AND reference_id =
                 (SELECT reference_id FROM public.inventory_movements WHERE type='TRANSFER_OUT'
                  ORDER BY created_at DESC LIMIT 1)), 2::bigint, 'estoque: transferência registra saída e entrada');
SELECT set_config('t.stock_order', t.mk_stock_order(current_setting('t.stock_product')::uuid)::text, false);
SELECT t.lives(format($$SELECT public.update_order_status(%L,'CONFIRMED',NULL)$$,
                      current_setting('t.stock_order')),
               'estoque: aceitação reserva atomicamente os itens');
SELECT t.is((SELECT count(*) FROM public.stock_reservations
             WHERE order_id=current_setting('t.stock_order')::uuid AND status='ACTIVE'),
            1::bigint, 'estoque: reserva ativa associada ao item do pedido');
SELECT t.lives(format($$SELECT public.update_order_status(%L,'CANCELLED','Cancelamento de teste')$$,
                      current_setting('t.stock_order')),
               'estoque: cancelamento libera reserva e estorna saldo');
SELECT t.is((SELECT status FROM public.stock_reservations
             WHERE order_id=current_setting('t.stock_order')::uuid),
            'RELEASED', 'estoque: reserva cancelada marcada como liberada');
SELECT set_config('t.stock_expired_order', t.mk_stock_order(current_setting('t.stock_product')::uuid)::text, false);
RESET ROLE;
-- simula a baixa legada do checkout (VENDA) que cria a reserva enquanto o pedido está PENDING
UPDATE public.products SET stock_quantity = stock_quantity - 1 WHERE id = current_setting('t.stock_product')::uuid;
INSERT INTO public.inventory_movements (tenant_id, product_id, product_name, quantity, type, reference_id, reason, previous_stock, new_stock, created_by_name)
SELECT tenant_id, id, name, -1, 'VENDA', current_setting('t.stock_expired_order'), 'teste', stock_quantity + 1, stock_quantity, 'teste'
FROM public.products WHERE id = current_setting('t.stock_product')::uuid;
SELECT t.is((SELECT count(*) FROM public.stock_reservations
             WHERE order_id=current_setting('t.stock_expired_order')::uuid AND status='ACTIVE'),
            1::bigint, 'estoque: pedido pendente recebe reserva');
SET session_replication_role = replica;
UPDATE public.orders SET created_at = now() - interval '31 minutes'
WHERE id = current_setting('t.stock_expired_order')::uuid;
SET session_replication_role = origin;
SELECT set_config('t.stock_before_expire', (SELECT stock_quantity::text FROM public.products WHERE id = current_setting('t.stock_product')::uuid), false);
SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000002');
SELECT t.lives(format($$SELECT public.stock_expire_pending_reservations(
    '10000000-0000-0000-0000-00000000000a', %L)$$, current_setting('t.stock_expired_order')),
    'estoque: expiração libera reserva pendente');
SELECT t.is((SELECT status FROM public.stock_reservations
             WHERE order_id=current_setting('t.stock_expired_order')::uuid)::text,
            'RELEASED', 'estoque: reserva expirada liberada');
SELECT t.lives(format($$SELECT public.update_order_status(%L,'CANCELLED','Expirado')$$,
                      current_setting('t.stock_expired_order')), 'estoque: pedido expirado pode ser cancelado');
SELECT t.is((SELECT stock_quantity FROM public.products WHERE id = current_setting('t.stock_product')::uuid),
            current_setting('t.stock_before_expire')::numeric + 1, 'estoque: expiração + cancelamento não devolve em dobro');
RESET ROLE;

SET ROLE authenticated;
SELECT t.login('b0000000-0000-0000-0000-000000000004');
SELECT t.throws($$SELECT public.stock_create_incoming(
    '10000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000a5',1,'Fornecedor cruzado',1,NULL
)$$, 'STOCK_FORBIDDEN', 'estoque: escrita também nega tenant cruzado');
RESET ROLE;
