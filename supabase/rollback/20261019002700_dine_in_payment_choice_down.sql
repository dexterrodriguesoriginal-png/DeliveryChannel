BEGIN;

DROP FUNCTION IF EXISTS public.handle_waiter_call(uuid);
DROP FUNCTION IF EXISTS public.configure_dine_in(uuid, jsonb, boolean, jsonb);
DROP FUNCTION IF EXISTS public.request_bill(uuid);
DROP FUNCTION IF EXISTS public.request_bill(uuid, text, integer);

CREATE OR REPLACE FUNCTION public.request_bill(p_session_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_tenant uuid; v_tab uuid; v_call uuid;
BEGIN
  SELECT ts.tenant_id, ts.tab_id INTO v_tenant, v_tab FROM public.tab_sessions ts
  JOIN public.dining_tabs tb ON tb.id = ts.tab_id AND tb.tenant_id = ts.tenant_id
  WHERE ts.id = p_session_id AND ts.auth_user_id = auth.uid() AND ts.expires_at > now()
    AND tb.status IN ('OPEN', 'BILL_REQUESTED');
  IF v_tab IS NULL THEN RAISE EXCEPTION 'TAB_NOT_FOUND: comanda não encontrada.' USING ERRCODE = '42501'; END IF;
  IF public._dine_in_config(v_tenant) IS NULL THEN
    RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.';
  END IF;
  UPDATE public.dining_tabs SET status = 'BILL_REQUESTED'
  WHERE id = v_tab AND tenant_id = v_tenant AND status = 'OPEN';
  INSERT INTO public.waiter_calls (tenant_id, tab_id, type)
  VALUES (v_tenant, v_tab, 'BILL') RETURNING id INTO v_call;
  RETURN v_call;
END;
$$;
REVOKE ALL ON FUNCTION public.request_bill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_bill(uuid) TO anon, authenticated;

ALTER TABLE public.waiter_calls
  DROP CONSTRAINT IF EXISTS waiter_calls_payment_choice_check;
ALTER TABLE public.waiter_calls
  DROP COLUMN IF EXISTS cash_tendered_cents,
  DROP COLUMN IF EXISTS payment_choice;

-- Restore the 2600 close_tab.
CREATE OR REPLACE FUNCTION public.close_tab(p_tab_id uuid, p_payments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant uuid;
  v_role text;
  v_config jsonb;
  v_tab public.dining_tabs;
  v_subtotal numeric;
  v_fee numeric;
  v_total_cents integer;
  v_paid integer;
  v_payment jsonb;
  v_method text;
  v_amount integer;
  v_change integer;
BEGIN
  SELECT tb.* INTO v_tab FROM public.dining_tabs tb WHERE tb.id = p_tab_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TAB_NOT_FOUND: comanda não encontrada.'; END IF;
  v_tenant := v_tab.tenant_id;
  v_role := public._tenant_role_of_caller(v_tenant);
  IF auth.uid() IS NULL OR COALESCE(v_role, '') NOT IN ('OWNER', 'MANAGER', 'CASHIER', 'WAITER') THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para encerrar a conta.' USING ERRCODE = '42501';
  END IF;
  v_config := public._dine_in_config(v_tenant);
  IF v_config IS NULL THEN RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.'; END IF;
  IF v_role = 'WAITER' AND NOT COALESCE((v_config -> 'close_roles') ? 'WAITER', false) THEN
    RAISE EXCEPTION 'FORBIDDEN: garçom não está autorizado a encerrar contas.' USING ERRCODE = '42501';
  END IF;
  IF v_tab.status NOT IN ('OPEN', 'BILL_REQUESTED') THEN
    RAISE EXCEPTION 'TAB_CLOSED: esta conta já foi encerrada.';
  END IF;
  IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'PAYMENT_REQUIRED: informe ao menos um pagamento.';
  END IF;
  SELECT COALESCE(sum(o.subtotal), 0) INTO v_subtotal FROM public.orders o
  WHERE o.tenant_id = v_tenant AND o.tab_id = p_tab_id AND o.fulfillment_type = 'DINE_IN' AND o.status <> 'CANCELLED';
  v_fee := CASE WHEN v_tab.service_fee_removed THEN 0 ELSE round(v_subtotal * v_tab.service_fee_percent / 100, 2) END;
  v_total_cents := round((v_subtotal + v_fee) * 100)::integer;
  SELECT sum((p.value ->> 'amount_cents')::integer) INTO v_paid FROM jsonb_array_elements(p_payments) p;
  IF v_paid IS DISTINCT FROM v_total_cents THEN
    RAISE EXCEPTION 'PAYMENT_TOTAL_MISMATCH: pagamentos devem totalizar R$ %.', (v_total_cents::numeric / 100);
  END IF;
  FOR v_payment IN SELECT value FROM jsonb_array_elements(p_payments) LOOP
    v_method := v_payment ->> 'method';
    v_amount := (v_payment ->> 'amount_cents')::integer;
    v_change := COALESCE((v_payment ->> 'change_given_cents')::integer, 0);
    IF v_method NOT IN ('CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'PIX', 'CAIXA') OR v_amount <= 0
       OR v_change < 0 OR (v_method <> 'CASH' AND v_change <> 0) OR v_change > v_amount THEN
      RAISE EXCEPTION 'INVALID_PAYMENT: forma ou valor de pagamento inválido.';
    END IF;
    INSERT INTO public.tab_payments (tenant_id, tab_id, method, amount_cents, change_given_cents, received_by)
    VALUES (v_tenant, p_tab_id, v_method, v_amount, v_change, auth.uid());
  END LOOP;
  UPDATE public.dining_tabs SET status = 'CLOSED', closed_at = now()
  WHERE id = p_tab_id AND tenant_id = v_tenant;
  UPDATE public.waiter_calls SET status = 'HANDLED', handled_by = auth.uid(), handled_at = now()
  WHERE tenant_id = v_tenant AND tab_id = p_tab_id AND status = 'OPEN';
  INSERT INTO public.tab_events (tenant_id, tab_id, event_type, actor_id, details)
  VALUES (v_tenant, p_tab_id, 'TAB_CLOSED', auth.uid(), jsonb_build_object('total_cents', v_total_cents, 'service_fee', v_fee));
END;
$$;
REVOKE ALL ON FUNCTION public.close_tab(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_tab(uuid, jsonb) TO authenticated;

COMMIT;
