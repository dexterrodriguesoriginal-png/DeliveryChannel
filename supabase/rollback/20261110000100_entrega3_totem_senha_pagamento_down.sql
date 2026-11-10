-- Desfaz apenas os objetos da Entrega 3; não remove dados comerciais.
BEGIN;
DROP TRIGGER IF EXISTS trg_totem_arrival_payment_approved ON public.orders;
DROP TRIGGER IF EXISTS zz_totem_payment_transition_guard ON public.orders;
DROP FUNCTION IF EXISTS public._totem_payment_transition_guard();
DROP FUNCTION IF EXISTS public.confirm_manual_totem_payment(uuid,text);
DROP FUNCTION IF EXISTS public.get_totem_payment_status(text,uuid);
DROP FUNCTION IF EXISTS public.cancel_totem_payment(text,uuid);
DROP FUNCTION IF EXISTS public.get_totem_payment_settings(uuid);
DROP FUNCTION IF EXISTS public.set_totem_payment_settings(uuid,text,integer,boolean,boolean);
DROP FUNCTION IF EXISTS public._totem_approve_payment(uuid,uuid);
DROP FUNCTION IF EXISTS public._totem_payment_response(uuid,uuid,uuid);
-- Restaura o contrato da sincronização anterior da retirada.
CREATE OR REPLACE FUNCTION public._orders_pickup_arrival_sync() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF NEW.fulfillment_type = 'PICKUP' AND NEW.status NOT IN ('DELIVERED','CANCELLED') THEN
   INSERT INTO public.pickup_arrivals (order_id, tenant_id, pickup_code)
   VALUES (NEW.id, NEW.tenant_id, public._new_pickup_code(NEW.tenant_id))
   ON CONFLICT (order_id) DO NOTHING;
  END IF;
 ELSIF NEW.status IN ('DELIVERED','CANCELLED') AND OLD.status IS DISTINCT FROM NEW.status THEN
  UPDATE public.pickup_arrivals SET closed_at=COALESCE(closed_at,now()) WHERE order_id=NEW.id;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._orders_pickup_arrival_sync() FROM PUBLIC,anon,authenticated,service_role;
-- Não apagamos tentativas/configurações existentes: rollback não destrutivo.
-- A remoção física das tabelas só pode acontecer após política de retenção e conferência de dados.
CREATE OR REPLACE FUNCTION public.create_totem_order(p_token text, p_items jsonb, p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $
DECLARE
  v_device uuid; v_tenant uuid; v_label text;
  v_item jsonb;
  v_pid uuid;
  v_qty int;
  v_price numeric(10,2);
  v_name text;
  v_subtotal numeric(10,2) := 0;
  v_order uuid;
  v_existing uuid;
  v_notes text;
BEGIN
  SELECT d.o_device, d.o_tenant, d.o_label INTO v_device, v_tenant, v_label
  FROM public._totem_device_ok(p_token) AS d;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_TOTEM_ORDER: informe a chave de idempotência.' USING ERRCODE='22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' AND column_name='idempotency_key'
  ) THEN
    EXECUTE 'SELECT id FROM public.orders WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1'
      INTO v_existing USING v_tenant, p_idempotency_key;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'orderId', v_existing, 'idempotent', true);
    END IF;
  END IF;

  IF NOT public._rate_limit_hit('totem_order_device', v_device::text, v_tenant, 12, 300) THEN
    RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas de pedido neste totem. Aguarde um pouco.' USING ERRCODE='P0001';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'INVALID_TOTEM_ORDER: envie de 1 a 50 itens.' USING ERRCODE='22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _totem_order_lines (
    product_id uuid,
    product_name text,
    quantity int,
    unit_price numeric(10,2),
    total_price numeric(10,2),
    notes text
  ) ON COMMIT DROP;
  DELETE FROM _totem_order_lines;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'INVALID_TOTEM_ORDER: item inválido.' USING ERRCODE='22023';
    END IF;
    BEGIN
      v_pid := (v_item->>'productId')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'INVALID_TOTEM_ORDER: produto inválido.' USING ERRCODE='22023';
    END;
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty < 1 OR v_qty > 99 THEN
      RAISE EXCEPTION 'INVALID_TOTEM_ORDER: quantidade deve ser entre 1 e 99.' USING ERRCODE='22023';
    END IF;
    v_notes := NULLIF(pg_catalog.btrim(COALESCE(v_item->>'notes', '')), '');
    IF v_notes IS NOT NULL AND char_length(v_notes) > 200 THEN
      RAISE EXCEPTION 'INVALID_TOTEM_ORDER: observação longa demais.' USING ERRCODE='22023';
    END IF;
    SELECT p.name, p.price INTO v_name, v_price
    FROM public.products p
    WHERE p.id = v_pid AND p.tenant_id = v_tenant AND p.is_active
    LIMIT 1;
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'INVALID_TOTEM_ORDER: um dos produtos não está disponível.' USING ERRCODE='22023';
    END IF;
    INSERT INTO _totem_order_lines VALUES (v_pid, v_name, v_qty, v_price, v_price * v_qty, v_notes);
    v_subtotal := v_subtotal + (v_price * v_qty);
  END LOOP;

  -- idempotency_key is immutable after insert (_orders_protect_columns). Set it here, never UPDATE.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' AND column_name='idempotency_key'
  ) THEN
    INSERT INTO public.orders (
      tenant_id, customer_name, customer_phone, delivery_address,
      subtotal, delivery_fee, discount, total_amount,
      payment_method, payment_status, fulfillment_type, status, notes, origin, totem_device_id, idempotency_key
    ) VALUES (
      v_tenant, v_label, '-', 'Totem do salão',
      v_subtotal, 0, 0, v_subtotal,
      'CASH', 'PAYMENT_ON_DELIVERY', 'PICKUP', 'CONFIRMED', 'Pedido do totem do salão', 'direct', v_device, p_idempotency_key
    ) RETURNING id INTO v_order;
  ELSE
    INSERT INTO public.orders (
      tenant_id, customer_name, customer_phone, delivery_address,
      subtotal, delivery_fee, discount, total_amount,
      payment_method, payment_status, fulfillment_type, status, notes, origin, totem_device_id
    ) VALUES (
      v_tenant, v_label, '-', 'Totem do salão',
      v_subtotal, 0, 0, v_subtotal,
      'CASH', 'PAYMENT_ON_DELIVERY', 'PICKUP', 'CONFIRMED', 'Pedido do totem do salão', 'direct', v_device
    ) RETURNING id INTO v_order;
  END IF;

  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, notes)
  SELECT v_order, product_id, product_name, quantity, unit_price, total_price, notes FROM _totem_order_lines;

  IF to_regclass('public.order_status_history') IS NOT NULL THEN
    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (v_order, 'CONFIRMED', 'Pedido criado no totem do salão', 'totem');
  END IF;

  RETURN jsonb_build_object('ok', true, 'orderId', v_order, 'total', v_subtotal, 'idempotent', false);
END $;
REVOKE ALL ON FUNCTION public.create_totem_order(text,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_totem_order(text,jsonb,uuid) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
