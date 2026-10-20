ALTER TABLE public.waiter_calls
  ADD COLUMN IF NOT EXISTS payment_choice text,
  ADD COLUMN IF NOT EXISTS cash_tendered_cents integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.waiter_calls'::pg_catalog.regclass
      AND conname = 'waiter_calls_payment_choice_check'
  ) THEN
    ALTER TABLE public.waiter_calls
      ADD CONSTRAINT waiter_calls_payment_choice_check
      CHECK (payment_choice IN ('CAIXA', 'CARD', 'CASH', 'PIX'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_bill(
  p_session_id uuid,
  p_choice text DEFAULT NULL,
  p_cash_tendered_cents integer DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant uuid;
  v_tab uuid;
  v_service_fee_percent numeric;
  v_service_fee_removed boolean;
  v_call uuid;
  v_subtotal numeric;
  v_total_cents integer;
BEGIN
  IF p_choice IS NOT NULL AND p_choice NOT IN ('CAIXA', 'CARD', 'CASH', 'PIX') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_CHOICE: forma de pagamento inválida.';
  END IF;

  SELECT ts.tenant_id, ts.tab_id, tb.service_fee_percent, tb.service_fee_removed
  INTO v_tenant, v_tab, v_service_fee_percent, v_service_fee_removed
  FROM public.tab_sessions ts
  JOIN public.dining_tabs tb ON tb.id = ts.tab_id AND tb.tenant_id = ts.tenant_id
  WHERE ts.id = p_session_id AND ts.auth_user_id = auth.uid() AND ts.expires_at > now()
    AND tb.status IN ('OPEN', 'BILL_REQUESTED')
  FOR UPDATE OF tb;
  IF v_tab IS NULL THEN
    RAISE EXCEPTION 'TAB_NOT_FOUND: comanda não encontrada.' USING ERRCODE = '42501';
  END IF;
  IF public._dine_in_config(v_tenant) IS NULL THEN
    RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.';
  END IF;

  SELECT COALESCE(sum(o.subtotal), 0)
  INTO v_subtotal
  FROM public.orders o
  WHERE o.tenant_id = v_tenant AND o.tab_id = v_tab
    AND o.fulfillment_type = 'DINE_IN' AND o.status <> 'CANCELLED';
  v_total_cents := round((
    v_subtotal + CASE WHEN v_service_fee_removed THEN 0
                      ELSE round(v_subtotal * v_service_fee_percent / 100, 2) END
  ) * 100)::integer;

  IF p_choice = 'CASH'
     AND (p_cash_tendered_cents IS NULL OR p_cash_tendered_cents < v_total_cents) THEN
    RAISE EXCEPTION 'CASH_TENDER_TOO_LOW: valor em dinheiro inferior ao total da conta.';
  END IF;

  UPDATE public.dining_tabs SET status = 'BILL_REQUESTED'
  WHERE id = v_tab AND tenant_id = v_tenant AND status = 'OPEN';
  INSERT INTO public.waiter_calls (
    tenant_id, tab_id, type, payment_choice, cash_tendered_cents
  )
  VALUES (v_tenant, v_tab, 'BILL', p_choice, p_cash_tendered_cents)
  RETURNING id INTO v_call;
  RETURN v_call;
END;
$$;
REVOKE ALL ON FUNCTION public.request_bill(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_bill(uuid, text, integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_bill(p_session_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.request_bill(p_session_id, NULL, NULL)
$$;
REVOKE ALL ON FUNCTION public.request_bill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_bill(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_waiter_call(p_call_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant uuid;
  v_status text;
BEGIN
  SELECT wc.tenant_id, wc.status
  INTO v_tenant, v_status
  FROM public.waiter_calls wc
  WHERE wc.id = p_call_id
  FOR UPDATE;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'WAITER_CALL_NOT_FOUND: chamado não encontrado.';
  END IF;
  IF auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_tenant, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para atender este chamado.' USING ERRCODE = '42501';
  END IF;
  IF public._dine_in_config(v_tenant) IS NULL THEN
    RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.';
  END IF;
  IF v_status <> 'OPEN' THEN
    RAISE EXCEPTION 'WAITER_CALL_NOT_OPEN: chamado não está aberto.';
  END IF;

  UPDATE public.waiter_calls
  SET status = 'HANDLED', handled_by = auth.uid(), handled_at = now()
  WHERE id = p_call_id AND tenant_id = v_tenant AND status = 'OPEN';
END;
$$;
REVOKE ALL ON FUNCTION public.handle_waiter_call(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_waiter_call(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.configure_dine_in(
  p_tenant uuid,
  p_config jsonb,
  p_service_fee_enabled boolean,
  p_service_fee_config jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_current_fee_enabled boolean;
  v_fee_percent numeric;
  v_allowed_roles text[] := ARRAY['OWNER', 'MANAGER', 'CASHIER', 'WAITER'];
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(p_tenant, ARRAY['OWNER', 'MANAGER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para configurar o salão.' USING ERRCODE = '42501';
  END IF;
  SELECT tu.role_id INTO v_role
  FROM public.tenant_users tu
  WHERE tu.tenant_id = p_tenant AND tu.user_id = auth.uid() AND tu.status = 'ACTIVE';
  IF p_config IS NULL OR jsonb_typeof(p_config) IS DISTINCT FROM 'object'
     OR COALESCE(p_config ->> 'mode', '') NOT IN ('TABLE', 'INDIVIDUAL')
     OR jsonb_typeof(p_config -> 'release_required') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_config -> 'salon_open') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_config -> 'round_limit') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_config -> 'close_roles') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_DINE_IN_CONFIG: configuração de salão inválida.';
  END IF;
  IF (p_config ->> 'round_limit')::numeric <= 0 OR (p_config ->> 'round_limit')::numeric > 1000000 THEN
    RAISE EXCEPTION 'INVALID_DINE_IN_CONFIG: limite por rodada inválido.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_config -> 'close_roles') AS r(role_name)
    WHERE NOT (r.role_name = ANY(v_allowed_roles))
  ) THEN
    RAISE EXCEPTION 'INVALID_DINE_IN_CONFIG: papel de fechamento inválido.';
  END IF;
  IF p_service_fee_enabled IS NULL OR p_service_fee_config IS NULL
     OR jsonb_typeof(p_service_fee_config) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_service_fee_config -> 'percent') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'INVALID_SERVICE_FEE_CONFIG: configuração da taxa inválida.';
  END IF;
  v_fee_percent := (p_service_fee_config ->> 'percent')::numeric;
  IF v_fee_percent < 0 OR v_fee_percent > 30 THEN
    RAISE EXCEPTION 'INVALID_SERVICE_FEE_CONFIG: taxa deve ficar entre 0 e 30%.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_modules tm
    WHERE tm.tenant_id = p_tenant AND tm.module_key = 'dine_in' AND tm.enabled
  ) THEN
    RAISE EXCEPTION 'MODULE_DISABLED: ative Mesa/Comanda antes de configurar o salão.';
  END IF;
  SELECT tm.enabled INTO v_current_fee_enabled FROM public.tenant_modules tm
  WHERE tm.tenant_id = p_tenant AND tm.module_key = 'service_fee';
  IF v_role = 'MANAGER' AND p_service_fee_enabled IS DISTINCT FROM COALESCE(v_current_fee_enabled, false) THEN
    RAISE EXCEPTION 'MODULE_OWNER_REQUIRED: apenas o proprietário pode ativar ou desativar módulos.';
  END IF;

  UPDATE public.tenant_modules
  SET config = p_config, updated_by = auth.uid(), updated_at = now()
  WHERE tenant_id = p_tenant AND module_key = 'dine_in' AND enabled;

  INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, config, updated_by, updated_at)
  VALUES (p_tenant, 'service_fee', p_service_fee_enabled, p_service_fee_config, auth.uid(), now())
  ON CONFLICT (tenant_id, module_key) DO UPDATE
  SET enabled = EXCLUDED.enabled, config = EXCLUDED.config,
      updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
END;
$$;
REVOKE ALL ON FUNCTION public.configure_dine_in(uuid, jsonb, boolean, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.configure_dine_in(uuid, jsonb, boolean, jsonb) TO authenticated;
