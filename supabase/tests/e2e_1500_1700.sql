-- E2E de banco 1500–1700 (etapas do despacho, códigos de retirada/entrega, divisão da taxa).
-- Roda inteiro dentro de BEGIN … ROLLBACK: cria dados sintéticos, nada persiste. Requer sessão postgres.
\set ON_ERROR_STOP 1
BEGIN;
DO $e2e$
DECLARE
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid();
  u_owner uuid := gen_random_uuid(); u_drv uuid := gen_random_uuid(); u_drv2 uuid := gen_random_uuid();
  u_cust uuid := gen_random_uuid(); u_cashier uuid := gen_random_uuid(); u_other uuid := gen_random_uuid();
  v_prod uuid := gen_random_uuid(); v_slug text := 'e2e-1500-' || substr(md5(random()::text),1,8);
  r jsonb; v_order uuid; v_pick text; v_deliv text; v_ok boolean; v_err text; i int; o record; n int;
  PROCEDURE_DUMMY int;
BEGIN
  -- ---------- dados sintéticos ----------
  INSERT INTO auth.users (id, email) SELECT x, x::text || '@e2e.invalid' FROM unnest(ARRAY[u_owner,u_drv,u_drv2,u_cust,u_cashier,u_other]) x;
  INSERT INTO public.users (id, name, email) SELECT x, 'E2E ' || left(x::text,4), x::text || '@e2e.invalid'
    FROM unnest(ARRAY[u_owner,u_drv,u_drv2,u_cust,u_cashier,u_other]) x ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.tenants (id, slug, name, document, phone, email, status) VALUES
    (t1, v_slug, 'E2E Loja', '00000000000000', '11900000000', 'loja@e2e.invalid', 'ACTIVE'),
    (t2, v_slug || '-b', 'E2E Outra', '00000000000001', '11900000001', 'outra@e2e.invalid', 'ACTIVE');
  INSERT INTO public.tenant_settings (tenant_id, address, phone_whatsapp, is_open, delivery_fee, min_order_value)
    VALUES (t1, 'Rua E2E, 1', '11900000000', true, 7.00, 0) ON CONFLICT (tenant_id) DO UPDATE SET is_open = true, delivery_fee = 7.00, min_order_value = 0, free_delivery_threshold = NULL;
  INSERT INTO public.tenant_users (tenant_id, user_id, role_id, status) VALUES
    (t1, u_owner, 'OWNER', 'ACTIVE'), (t1, u_drv, 'DRIVER', 'ACTIVE'), (t1, u_drv2, 'DRIVER', 'ACTIVE'),
    (t1, u_cashier, 'CASHIER', 'ACTIVE'), (t2, u_other, 'OWNER', 'ACTIVE');
  INSERT INTO public.drivers (user_id, tenant_id, full_name, phone, status, approval_status) VALUES
    (u_drv, t1, 'Entregador E2E', '11911111111', 'AVAILABLE', 'APPROVED'), (u_drv2, t1, 'Entregador2 E2E', '11922222222', 'AVAILABLE', 'APPROVED');
  INSERT INTO public.products (id, tenant_id, name, image_url, price, is_active, stock_quantity)
    VALUES (v_prod, t1, 'Produto E2E', '', 20.00, true, 100);

  -- ---------- 1) cliente compra (checkout v2, DELIVERY) → taxa 3,50 cliente / 3,50 loja / 7,00 entregador ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_cust, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.process_checkout_atomic_v2(v_slug, 'Cliente E2E', '11933333333', 'Rua do Cliente, 10', '{}'::jsonb, 'CASH', 'DELIVERY', NULL,
        jsonb_build_array(jsonb_build_object('productId', v_prod, 'quantity', 1)));
  RESET ROLE;
  v_order := COALESCE((r ->> 'order_id'), (r ->> 'orderId'), (r -> 'order' ->> 'id'))::uuid;
  ASSERT v_order IS NOT NULL, 'checkout sem order_id: ' || r::text;
  SELECT * INTO o FROM public.orders WHERE id = v_order;
  ASSERT o.delivery_fee = 3.50, 'cliente deveria pagar 3,50, pagou ' || o.delivery_fee;
  ASSERT o.total_amount = 23.50, 'total deveria ser 23,50: ' || o.total_amount;
  ASSERT o.store_delivery_share = 3.50 AND o.driver_payout = 7.00, 'divisão errada';
  RAISE NOTICE 'OK 1 taxa: cliente 3,50 | loja 3,50 | entregador 7,00 | total 23,50';

  -- vitrine mostra a parte do cliente
  ASSERT (public.get_public_store(v_slug) -> 'settings' ->> 'delivery_fee')::numeric = 3.50, 'vitrine deveria mostrar 3,50';
  RAISE NOTICE 'OK 1b vitrine settings.delivery_fee = 3,50';

  -- ---------- 2) código de retirada nasceu; só a loja vê ----------
  ASSERT EXISTS (SELECT 1 FROM public.order_handoff_codes WHERE order_id = v_order AND delivery_code IS NULL), 'sem código de retirada';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_pick := public.get_order_pickup_code(v_order) ->> 'code';
  RESET ROLE;
  ASSERT v_pick ~ '^\d{4}$', 'dono não viu o código de retirada';
  FOREACH i IN ARRAY ARRAY[1,2,3] LOOP  -- 1 cliente, 2 entregador, 3 outra loja
    PERFORM set_config('request.jwt.claims', json_build_object('sub', (ARRAY[u_cust,u_drv,u_other])[i], 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    r := public.get_order_pickup_code(v_order);
    BEGIN PERFORM 1 FROM public.order_handoff_codes LIMIT 1; v_ok := true; EXCEPTION WHEN insufficient_privilege THEN v_ok := false; END;
    RESET ROLE;
    ASSERT r IS NULL, 'vazou código de retirada para perfil ' || i;
    ASSERT NOT v_ok, 'SELECT direto em order_handoff_codes permitido para perfil ' || i;
  END LOOP;
  RAISE NOTICE 'OK 2 código de retirada visível só para a loja (cliente/entregador/outra loja: nada; SELECT direto negado)';

  -- ---------- 3) loja chama o motoboy; entregador vê a corrida e aceita; segundo entregador perde ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.update_order_status(v_order, 'CONFIRMED'); PERFORM public.update_order_status(v_order, 'PREPARING');
  PERFORM public.update_order_status(v_order, 'READY'); PERFORM public.update_order_status(v_order, 'WAITING_FOR_DRIVER', 'Chamando motoboy');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_drv, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.list_available_driver_orders();
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE (e ->> 'id')::uuid = v_order AND (e ->> 'driverPayout')::numeric = 7.00),
         'corrida não listada para o entregador (ou ganho ≠ 7,00): ' || r::text;
  r := public.driver_accept_order(v_order);
  RESET ROLE;
  SELECT * INTO o FROM public.orders WHERE id = v_order;
  ASSERT o.driver_id = u_drv AND o.status = 'WAITING_FOR_DRIVER' AND o.driver_accepted_at IS NOT NULL, 'aceite não gravado';
  ASSERT EXISTS (SELECT 1 FROM public.order_status_history WHERE order_id = v_order AND status = 'DRIVER_ACCEPTED'), 'sem histórico DRIVER_ACCEPTED';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_drv2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.driver_accept_order(v_order); v_err := 'aceitou'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  RESET ROLE;
  ASSERT v_err LIKE 'ORDER_NOT_AVAILABLE%', 'segundo entregador deveria perder: ' || v_err;
  RAISE NOTICE 'OK 3 loja chamou → entregador viu (ganho 7,00) e aceitou; 2º entregador recebeu ORDER_NOT_AVAILABLE';

  -- ---------- 4) atalhos sem código bloqueados ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_drv, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.update_driver_order_status(v_order, 'OUT_FOR_DELIVERY'); v_err := 'passou'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  ASSERT v_err LIKE 'PICKUP_CODE_REQUIRED%', 'saída sem código deveria falhar: ' || v_err;
  -- ---------- 5) retirada: código errado conta tentativa; certo → OUT_FOR_DELIVERY ----------
  r := public.confirm_order_pickup(v_order, CASE WHEN v_pick = '0000' THEN '1111' ELSE '0000' END);
  ASSERT (r ->> 'success')::boolean = false AND (r ->> 'attemptsLeft')::int = 4, 'tentativa errada mal tratada: ' || r::text;
  r := public.confirm_order_pickup(v_order, v_pick);
  RESET ROLE;
  ASSERT (r ->> 'success')::boolean, 'retirada com código certo falhou: ' || r::text;
  SELECT * INTO o FROM public.orders WHERE id = v_order;
  ASSERT o.status = 'OUT_FOR_DELIVERY' AND o.picked_up_at IS NOT NULL, 'retirada não gravada';
  RAISE NOTICE 'OK 4/5 sem código negado; retirada validada pelo código da loja (1 erro contado)';

  -- ---------- 6) código de entrega: só o cliente vê ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_cust, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_deliv := public.get_my_order_delivery_code(v_order) ->> 'code';
  RESET ROLE;
  ASSERT v_deliv ~ '^\d{4}$', 'cliente não viu o código de entrega';
  FOREACH i IN ARRAY ARRAY[1,2,3] LOOP -- 1 dono, 2 entregador, 3 caixa
    PERFORM set_config('request.jwt.claims', json_build_object('sub', (ARRAY[u_owner,u_drv,u_cashier])[i], 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    r := public.get_my_order_delivery_code(v_order);
    RESET ROLE;
    ASSERT r IS NULL, 'vazou código de entrega para perfil ' || i;
  END LOOP;
  RAISE NOTICE 'OK 6 código de entrega visível só para o cliente (dono/entregador/caixa: nada)';

  -- ---------- 7) 5 tentativas erradas bloqueiam ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_drv, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.update_driver_order_status(v_order, 'DELIVERED'); v_err := 'passou'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  ASSERT v_err LIKE 'DELIVERY_CODE_REQUIRED%', 'entrega sem código deveria falhar: ' || v_err;
  FOR i IN 1..5 LOOP
    r := public.confirm_order_delivery(v_order, CASE WHEN v_deliv = '9999' THEN '8888' ELSE '9999' END);
    ASSERT (r ->> 'success')::boolean = false, 'erro ' || i || ' aceito';
  END LOOP;
  BEGIN PERFORM public.confirm_order_delivery(v_order, v_deliv); v_err := 'passou'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  RESET ROLE;
  ASSERT v_err LIKE 'CODE_LOCKED%', 'deveria bloquear após 5 erros: ' || v_err;
  RAISE NOTICE 'OK 7 após 5 erros o código certo também é recusado (CODE_LOCKED)';

  -- desbloqueio (somente para seguir o teste): zera tentativas como a loja faria no suporte
  UPDATE public.order_handoff_codes SET delivery_attempts = 0 WHERE order_id = v_order;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_drv, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.confirm_order_delivery(v_order, v_deliv);
  RESET ROLE;
  SELECT * INTO o FROM public.orders WHERE id = v_order;
  ASSERT (r ->> 'success')::boolean AND o.status = 'DELIVERED' AND o.delivered_at IS NOT NULL, 'entrega com código falhou';
  ASSERT (SELECT status FROM public.drivers WHERE user_id = u_drv AND tenant_id = t1) = 'AVAILABLE', 'entregador não voltou a AVAILABLE';

  -- ---------- 8) ganho do entregador visível para ele ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_drv, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.orders WHERE id = v_order AND driver_payout = 7.00;
  RESET ROLE;
  ASSERT n = 1, 'entregador não lê driver_payout do pedido entregue';
  RAISE NOTICE 'OK 8 entregue com código; entregador AVAILABLE e lê o ganho 7,00 do pedido';

  -- ---------- 9) loja: DELIVERED sem código exige motivo; designação manual não pula etapa ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_cust, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.process_checkout_atomic_v2(v_slug, 'Cliente E2E', '11933333333', 'Rua do Cliente, 10', '{}'::jsonb, 'CASH', 'DELIVERY', NULL,
        jsonb_build_array(jsonb_build_object('productId', v_prod, 'quantity', 1)), NULL, gen_random_uuid());
  RESET ROLE;
  v_order := COALESCE((r ->> 'order_id'), (r ->> 'orderId'), (r -> 'order' ->> 'id'))::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.update_order_status(v_order, 'READY');
  r := public.assign_order_to_driver(v_order, u_drv);
  ASSERT r ->> 'orderStatus' = 'WAITING_FOR_DRIVER', 'designação manual pulou etapa: ' || r::text;
  BEGIN PERFORM public.update_order_status(v_order, 'DELIVERED'); v_err := 'passou'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  ASSERT v_err LIKE 'NOTE_REQUIRED%', 'DELIVERED sem motivo deveria falhar: ' || v_err;
  PERFORM public.update_order_status(v_order, 'DELIVERED', 'Cliente sem celular (teste)');
  RESET ROLE;
  ASSERT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'DELIVERY_OVERRIDE_NO_CODE' AND resource_id = v_order::text), 'override sem auditoria';
  RAISE NOTICE 'OK 9 designação manual fica em WAITING_FOR_DRIVER; DELIVERED pela loja exige motivo e é auditado';

  -- ---------- 10) retirada no balcão: sem código e sem taxa ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_cust, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.process_checkout_atomic_v2(v_slug, 'Cliente E2E', '11933333333', '', '{}'::jsonb, 'CASH', 'PICKUP', NULL,
        jsonb_build_array(jsonb_build_object('productId', v_prod, 'quantity', 1)), NULL, gen_random_uuid());
  RESET ROLE;
  v_order := COALESCE((r ->> 'order_id'), (r ->> 'orderId'), (r -> 'order' ->> 'id'))::uuid;
  SELECT * INTO o FROM public.orders WHERE id = v_order;
  ASSERT o.delivery_fee = 0 AND o.driver_payout = 0 AND o.store_delivery_share = 0, 'PICKUP com taxa';
  ASSERT NOT EXISTS (SELECT 1 FROM public.order_handoff_codes WHERE order_id = v_order), 'PICKUP com código';
  RAISE NOTICE 'OK 10 retirada no balcão: taxa 0 e sem código';
  RAISE NOTICE 'E2E 1500–1700: TODOS OS CENÁRIOS PASSARAM';
END
$e2e$;
ROLLBACK;
