-- Reverts 20261027004700_mesas_access.sql: restores the audited functions and removes the objects it created.
-- Data kept: orders, tabs, sessions, payments, events. The new COLUMNS (dining_tabs.responsible_user_id/holder_claimable/responsible_since,
--   tab_sessions.created_at/ended_at/ended_reason/approval_requested_at/joined_via) are left in place (additive, harmless, no data destroyed).
-- Data removed: invite codes (ephemeral). The access trail (tab_access_events) is RENAMED to tab_access_events_archived when it has rows (never dropped with data).
BEGIN;
CREATE OR REPLACE FUNCTION public.open_or_join_tab(p_qr_token text, p_display_name text, p_device_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_table public.dining_tables;
  v_config jsonb;
  v_mode text;
  v_tab uuid;
  v_session uuid;
  v_fee numeric := 0;
  v_approved boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: entre ou continue como visitante para abrir uma comanda.' USING ERRCODE = '42501';
  END IF;
  IF p_display_name IS NULL OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 80
     OR p_device_id IS NULL OR length(p_device_id) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'INVALID_INPUT: informe seu nome e dispositivo.';
  END IF;
  SELECT dt.* INTO v_table
  FROM public.dining_tables dt
  JOIN public.tenants t ON t.id = dt.tenant_id AND t.status = 'ACTIVE'
  WHERE dt.qr_token = p_qr_token AND dt.active
  FOR UPDATE OF dt;
  IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_UNAVAILABLE: salão indisponível.'; END IF;
  v_config := public._dine_in_config(v_table.tenant_id);
  IF v_config IS NULL THEN RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_settings s WHERE s.tenant_id = v_table.tenant_id AND s.is_open
  ) AND COALESCE((SELECT (tm.config ->> 'salon_open')::boolean FROM public.tenant_modules tm
                 WHERE tm.tenant_id = v_table.tenant_id AND tm.module_key = 'dine_in'), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'STORE_CLOSED: o salão está fechado no momento.';
  END IF;
  v_mode := CASE WHEN v_config ->> 'mode' = 'INDIVIDUAL' THEN 'INDIVIDUAL' ELSE 'TABLE' END;
  IF EXISTS (SELECT 1 FROM public.tenant_modules tm WHERE tm.tenant_id = v_table.tenant_id
             AND tm.module_key = 'service_fee' AND tm.enabled) THEN
    v_fee := COALESCE((SELECT NULLIF(tm.config ->> 'percent', '')::numeric
      FROM public.tenant_modules tm WHERE tm.tenant_id = v_table.tenant_id AND tm.module_key = 'service_fee'), 10);
  END IF;

  SELECT ts.id, ts.tab_id INTO v_session, v_tab
  FROM public.tab_sessions ts
  JOIN public.dining_tabs tb ON tb.id = ts.tab_id AND tb.tenant_id = ts.tenant_id
  WHERE ts.tenant_id = v_table.tenant_id AND ts.auth_user_id = v_user
    AND ts.device_id = p_device_id AND ts.expires_at > now()
    AND tb.status IN ('OPEN', 'BILL_REQUESTED')
    AND tb.table_id = v_table.id
  ORDER BY ts.expires_at DESC LIMIT 1;
  IF v_session IS NULL THEN
    IF v_mode = 'TABLE' THEN
      SELECT tb.id INTO v_tab FROM public.dining_tabs tb
      WHERE tb.tenant_id = v_table.tenant_id AND tb.table_id = v_table.id AND tb.status IN ('OPEN', 'BILL_REQUESTED')
      ORDER BY tb.opened_at DESC LIMIT 1 FOR UPDATE;
    END IF;
    IF v_tab IS NULL THEN
      INSERT INTO public.dining_tabs (tenant_id, mode, table_id, service_fee_percent)
      VALUES (v_table.tenant_id, v_mode, v_table.id, v_fee) RETURNING id INTO v_tab;
    END IF;
    v_approved := NOT COALESCE((v_config ->> 'release_required')::boolean, true);
    INSERT INTO public.tab_sessions (
      tenant_id, tab_id, auth_user_id, display_name, device_id, approved_by, approved_at, expires_at
    ) VALUES (
      v_table.tenant_id, v_tab, v_user, btrim(p_display_name), p_device_id,
      NULL, CASE WHEN v_approved THEN now() END, now() + interval '6 hours'
    ) RETURNING id INTO v_session;
  END IF;
  RETURN jsonb_build_object('tabId', v_tab, 'sessionId', v_session, 'tableLabel', v_table.label,
    'storeName', (SELECT COALESCE(th.store_name, t.name) FROM public.tenants t
                  LEFT JOIN public.tenant_themes th ON th.tenant_id = t.id WHERE t.id = v_table.tenant_id));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_round(p_items jsonb, p_idempotency_key uuid, p_session_id uuid DEFAULT NULL::uuid, p_tab_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_tab uuid := p_tab_id;
  v_session uuid := p_session_id;
  v_table uuid;
  v_name text;
  v_role text;
  v_config jsonb;
  v_round integer;
  v_subtotal numeric;
  v_limit numeric;
  v_order uuid;
  v_number integer;
  v_lines jsonb;
  v_existing record;
BEGIN
  IF v_user IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sessão e chave de envio são obrigatórias.' USING ERRCODE = '42501';
  END IF;
  IF v_session IS NOT NULL THEN
    SELECT ts.tenant_id, ts.tab_id, ts.display_name INTO v_tenant, v_tab, v_name
    FROM public.tab_sessions ts WHERE ts.id = v_session AND ts.auth_user_id = v_user AND ts.expires_at > now();
    IF v_tenant IS NULL THEN RAISE EXCEPTION 'SESSION_INVALID: sessão da mesa inválida ou expirada.'; END IF;
  ELSE
    SELECT tb.tenant_id, ts.id, ts.display_name INTO v_tenant, v_session, v_name
    FROM public.dining_tabs tb
    LEFT JOIN LATERAL (
      SELECT x.id, x.display_name FROM public.tab_sessions x
      WHERE x.tab_id = tb.id AND x.tenant_id = tb.tenant_id ORDER BY x.expires_at DESC LIMIT 1
    ) ts ON true
    WHERE tb.id = v_tab;
    v_role := public._tenant_role_of_caller(v_tenant);
    IF v_tenant IS NULL OR COALESCE(v_role, '') NOT IN ('OWNER', 'MANAGER', 'WAITER', 'CASHIER') THEN
      RAISE EXCEPTION 'FORBIDDEN: acesso à comanda negado.' USING ERRCODE = '42501';
    END IF;
  END IF;
  v_config := public._dine_in_config(v_tenant);
  IF v_config IS NULL THEN RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.'; END IF;
  IF v_role IS NULL AND COALESCE((v_config ->> 'release_required')::boolean, true) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tab_sessions ts WHERE ts.id = v_session AND ts.approved_at > now() - interval '6 hours'
        AND ts.expires_at > now()
    ) THEN
      RAISE EXCEPTION 'SESSION_NOT_APPROVED: aguardando o garçom liberar sua mesa.';
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || p_idempotency_key::text, 0));
  SELECT o.id, o.order_number INTO v_existing FROM public.orders o
  WHERE o.tenant_id = v_tenant AND o.fulfillment_type = 'DINE_IN' AND o.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = v_existing.id AND o.tab_id = v_tab)
       OR (v_role IS NULL AND NOT EXISTS (SELECT 1 FROM public.tab_sessions ts
            WHERE ts.id = v_session AND ts.auth_user_id = v_user AND ts.tab_id = v_tab)) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: chave de envio já utilizada.';
    END IF;
    RETURN jsonb_build_object('orderId', v_existing.id, 'orderNumber', v_existing.order_number, 'replayed', true);
  END IF;
  SELECT tb.table_id INTO v_table FROM public.dining_tabs tb
  WHERE tb.id = v_tab AND tb.tenant_id = v_tenant AND tb.status = 'OPEN' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TAB_CLOSED: conta encerrada. Para pedir de novo, chame o garçom.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dining_tables dt WHERE dt.id = v_table AND dt.active) THEN
    RAISE EXCEPTION 'TABLE_UNAVAILABLE: mesa indisponível.';
  END IF;
  IF NOT public._rate_limit_hit('dine_in_submit', public._sha256_hex(v_user::text), v_tenant, 30, 60) THEN
    RAISE EXCEPTION 'RATE_LIMITED: aguarde antes de enviar outra rodada.';
  END IF;
  SELECT COALESCE(max(o.round_no), 0) + 1 INTO v_round
  FROM public.orders o WHERE o.tenant_id = v_tenant AND o.tab_id = v_tab AND o.fulfillment_type = 'DINE_IN';
  SELECT COALESCE((v_config ->> 'round_limit')::numeric, 300) INTO v_limit;
  SELECT jsonb_agg(jsonb_build_object(
           'product_id', x.r_product_id, 'quantity', x.r_quantity, 'notes', x.r_notes, 'name', x.r_name,
           'unit', x.r_unit, 'unit_price', x.r_unit_price, 'original_price', x.r_original_price,
           'is_promotional', x.r_is_promotional, 'item_kind', 'PRODUCT'
         )),
         round(sum(x.r_unit_price * x.r_quantity), 2)
  INTO v_lines, v_subtotal FROM public._price_items(v_tenant, p_items, true) x;
  IF v_subtotal > v_limit THEN
    RAISE EXCEPTION 'ROUND_LIMIT: limite por rodada é R$ %.', v_limit;
  END IF;
  INSERT INTO public.orders (
    tenant_id, customer_name, customer_phone, delivery_address, subtotal, delivery_fee, discount, total_amount,
    payment_method, payment_status, fulfillment_type, status, origin, tab_id, round_no, ordered_by_session_id,
    idempotency_key
  ) VALUES (
    v_tenant, COALESCE(NULLIF(v_name, ''), 'Atendimento'), '', '', v_subtotal, 0, 0, v_subtotal,
    'CASH', 'PENDING', 'DINE_IN', 'CONFIRMED', 'qr_code', v_tab, v_round, v_session,
    p_idempotency_key
  ) RETURNING id, order_number INTO v_order, v_number;
  PERFORM public._insert_order_lines(v_order, v_tenant, v_lines, 0, v_subtotal, 'Salão');
  INSERT INTO public.order_status_history (order_id, status, note, changed_by)
  VALUES (v_order, 'CONFIRMED', 'Rodada enviada pelo salão.', COALESCE(v_name, 'Salão'));
  RETURN jsonb_build_object('orderId', v_order, 'orderNumber', v_number, 'roundNo', v_round,
    'subtotal', v_subtotal, 'replayed', false);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_session(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_tenant uuid;
BEGIN
  SELECT ts.tenant_id INTO v_tenant FROM public.tab_sessions ts WHERE ts.id = p_session_id;
  IF v_tenant IS NULL OR auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_tenant, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para liberar esta sessão.' USING ERRCODE = '42501';
  END IF;
  IF public._dine_in_config(v_tenant) IS NULL THEN
    RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.';
  END IF;
  UPDATE public.tab_sessions SET approved_by = auth.uid(), approved_at = now(), expires_at = now() + interval '6 hours'
  WHERE id = p_session_id AND tenant_id = v_tenant AND expires_at > now()
    AND EXISTS (SELECT 1 FROM public.dining_tabs tb WHERE tb.id = tab_sessions.tab_id AND tb.status = 'OPEN');
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_EXPIRED: sessão inválida ou comanda encerrada.'; END IF;
  INSERT INTO public.tab_events (tenant_id, tab_id, event_type, actor_id, details)
  SELECT v_tenant, ts.tab_id, 'SESSION_APPROVED', auth.uid(), jsonb_build_object('session_id', p_session_id)
  FROM public.tab_sessions ts WHERE ts.id = p_session_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_tab(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_tab uuid; v_tenant uuid;
BEGIN
  SELECT ts.tab_id, ts.tenant_id INTO v_tab, v_tenant FROM public.tab_sessions ts
  WHERE ts.id = p_session_id AND ts.auth_user_id = auth.uid() AND ts.expires_at > now();
  IF v_tab IS NULL THEN RAISE EXCEPTION 'TAB_NOT_FOUND: comanda não encontrada.' USING ERRCODE = '42501'; END IF;
  IF public._dine_in_config(v_tenant) IS NULL THEN
    RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'tabId', tb.id, 'status', tb.status, 'mode', tb.mode, 'tableLabel', dt.label,
      'serviceFeePercent', tb.service_fee_percent, 'serviceFeeRemoved', tb.service_fee_removed,
      'rounds', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'orderId', o.id, 'orderNumber', o.order_number, 'roundNo', o.round_no, 'status', o.status,
          'customerName', o.customer_name, 'subtotal', o.subtotal, 'createdAt', o.created_at,
          'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'name', oi.product_name, 'quantity', oi.quantity, 'unitPrice', oi.unit_price,
            'totalPrice', oi.total_price, 'station', oi.station
          ) ORDER BY oi.id) FROM public.order_items oi WHERE oi.order_id = o.id), '[]'::jsonb)
        ) ORDER BY o.round_no) FROM public.orders o
        WHERE o.tab_id = tb.id AND o.tenant_id = tb.tenant_id AND o.fulfillment_type = 'DINE_IN'
      ), '[]'::jsonb),
      'subtotal', COALESCE((SELECT sum(o.subtotal) FROM public.orders o
        WHERE o.tab_id = tb.id AND o.tenant_id = tb.tenant_id AND o.fulfillment_type = 'DINE_IN'
          AND o.status <> 'CANCELLED'), 0)
    ) FROM public.dining_tabs tb JOIN public.dining_tables dt ON dt.id = tb.table_id
    WHERE tb.id = v_tab AND tb.tenant_id = v_tenant
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_table_qr(p_qr_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'available', true,
    'tenantSlug', t.slug,
    'storeName', COALESCE(th.store_name, t.name),
    'tableLabel', dt.label
  ) INTO v_result
  FROM public.dining_tables dt
  JOIN public.tenants t ON t.id = dt.tenant_id AND t.status = 'ACTIVE'
  LEFT JOIN public.tenant_themes th ON th.tenant_id = t.id
  WHERE dt.qr_token = p_qr_token AND dt.active
    AND public._dine_in_config(dt.tenant_id) IS NOT NULL;
  RETURN COALESCE(v_result, jsonb_build_object('available', false));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.anonymize_old_tab_sessions(p_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_count integer;
BEGIN
  IF p_days IS NULL OR p_days < 7 THEN RAISE EXCEPTION 'p_days deve ser >= 7'; END IF;
  UPDATE public.tab_sessions ts SET display_name = 'Cliente', device_id = 'anon-' || replace(ts.id::text, '-', '')
  WHERE ts.expires_at < now() - make_interval(days => p_days)
    AND (ts.display_name <> 'Cliente' OR ts.device_id NOT LIKE 'anon-%')
    AND ts.tab_id IN (SELECT tb.id FROM public.dining_tabs tb WHERE tb.status IN ('CLOSED','CANCELLED'));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mesas_qr_capabilities()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT jsonb_build_object('version', 1, 'qr_pause', true, 'tab_pix', true, 'table_name_rule', true); $function$
;

DROP FUNCTION IF EXISTS public.ping_pending_approval(uuid);
DROP FUNCTION IF EXISTS public.staff_request_bill(uuid);
DROP FUNCTION IF EXISTS public.staff_open_tab(uuid);
DROP FUNCTION IF EXISTS public.staff_transfer_tab_holder(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.staff_reset_tab_holder(uuid);
DROP FUNCTION IF EXISTS public.reject_session(uuid);
DROP FUNCTION IF EXISTS public.transfer_tab_responsibility(uuid, uuid);
DROP FUNCTION IF EXISTS public.remove_tab_guest(uuid, uuid);
DROP FUNCTION IF EXISTS public.revoke_tab_invite(uuid);
DROP FUNCTION IF EXISTS public.get_tab_invite(uuid);
DROP FUNCTION IF EXISTS public.create_tab_invite(uuid, integer);
DROP FUNCTION IF EXISTS public.join_with_code(text, text, text, text);
DROP FUNCTION IF EXISTS public.enter_table(text, text, text);
DROP TRIGGER IF EXISTS dining_tabs_close_sessions ON public.dining_tabs;
DROP FUNCTION IF EXISTS public._dining_tabs_close_sessions();
DROP FUNCTION IF EXISTS public._responsible_session(uuid);
DROP FUNCTION IF EXISTS public._table_access_payload(uuid);
DROP FUNCTION IF EXISTS public._end_session(uuid, text);
DROP FUNCTION IF EXISTS public._tab_access_log(uuid, uuid, text, text, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public._release_required(uuid);
DROP FUNCTION IF EXISTS public._customer_identified();
DROP TABLE IF EXISTS public.dining_tab_invites;
DO $d$
BEGIN
  IF to_regclass('public.tab_access_events') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.tab_access_events) THEN
      IF to_regclass('public.tab_access_events_archived') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.tab_access_events_archived RENAME TO tab_access_events_archived_' || to_char(now(), 'YYYYMMDDHH24MISS');
        EXECUTE 'ALTER INDEX public.tab_access_events_archived_pkey RENAME TO tab_access_events_arch_' || to_char(now(), 'YYYYMMDDHH24MISS') || '_pkey';
        EXECUTE 'ALTER INDEX public.tab_access_events_archived_tab RENAME TO tab_access_events_arch_' || to_char(now(), 'YYYYMMDDHH24MISS') || '_tab';
      END IF;
      ALTER TABLE public.tab_access_events RENAME TO tab_access_events_archived;
      ALTER INDEX public.tab_access_events_pkey RENAME TO tab_access_events_archived_pkey;
      ALTER INDEX public.tab_access_events_tab RENAME TO tab_access_events_archived_tab;
    ELSE
      DROP TABLE public.tab_access_events;
    END IF;
  END IF;
END
$d$;
DROP INDEX IF EXISTS public.tab_sessions_pending_idx;
COMMIT;
