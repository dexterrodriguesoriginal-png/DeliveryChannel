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

COMMIT;
