BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.orders WHERE fulfillment_type = 'DINE_IN') THEN
    RAISE EXCEPTION 'Rollback 2600 bloqueado: encerre ou migre os pedidos de salão antes.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_users WHERE role_id = 'WAITER') THEN
    RAISE EXCEPTION 'Rollback 2600 bloqueado: reatribua os membros WAITER antes.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.team_invites WHERE role_id = 'WAITER') THEN
    RAISE EXCEPTION 'Rollback 2600 bloqueado: resolva os convites WAITER antes.';
  END IF;
END;
$$;

ALTER TABLE public.team_invites DROP CONSTRAINT IF EXISTS chk_team_invites_role;
ALTER TABLE public.team_invites ADD CONSTRAINT chk_team_invites_role
  CHECK (role_id IN ('MANAGER', 'CASHIER', 'OPERATOR', 'DELIVERY_MANAGER', 'DRIVER')) NOT VALID;

DO $do$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef('public._is_staff_role(text)'::regprocedure);
  v_updated := replace(v_definition, $q$'DELIVERY_MANAGER','WAITER');$q$, $q$'DELIVERY_MANAGER');$q$);
  IF v_updated <> v_definition THEN EXECUTE v_updated; END IF;

  FOREACH v_definition IN ARRAY ARRAY[
    pg_catalog.pg_get_functiondef('public.accept_team_invite(uuid)'::regprocedure),
    pg_catalog.pg_get_functiondef('public.create_team_invite(uuid,character varying,character varying)'::regprocedure)
  ] LOOP
    v_updated := replace(v_definition, $q$'DRIVER','WAITER')$q$, $q$'DRIVER')$q$);
    IF v_updated <> v_definition THEN EXECUTE v_updated; END IF;
  END LOOP;
END;
$do$;

CREATE OR REPLACE FUNCTION public._tenant_module_disable_blockers(p_tenant uuid, p_key text)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT ARRAY[]::text[] $$;
REVOKE ALL ON FUNCTION public._tenant_module_disable_blockers(uuid, text) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.regenerate_dining_table_qr(uuid);
DROP FUNCTION IF EXISTS public.close_tab(uuid, jsonb);
DROP FUNCTION IF EXISTS public.remove_service_fee(uuid, text);
DROP FUNCTION IF EXISTS public.request_bill(uuid);
DROP FUNCTION IF EXISTS public.call_waiter(uuid, text);
DROP FUNCTION IF EXISTS public.get_my_tab(uuid);
DROP FUNCTION IF EXISTS public.submit_round(jsonb, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.approve_session(uuid);
DROP FUNCTION IF EXISTS public.open_or_join_tab(text, text, text);
DROP FUNCTION IF EXISTS public.resolve_table_qr(text);

DROP TRIGGER IF EXISTS order_item_dine_in_station ON public.order_items;
DROP FUNCTION IF EXISTS public._dine_in_station_before_order_item();

CREATE OR REPLACE FUNCTION public.kitchen_list_orders(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_t uuid := public._kitchen_resolve_tenant(p_tenant_id);
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY (x ->> 'created_at'))
    FROM (
      SELECT jsonb_build_object(
        'order_id', o.id, 'order_number', o.order_number, 'status', o.status,
        'fulfillment_type', o.fulfillment_type, 'created_at', o.created_at, 'notes', o.notes,
        'customer_first_name', CASE WHEN o.fulfillment_type = 'PICKUP'
          THEN NULLIF(split_part(btrim(COALESCE(o.customer_name, '')), ' ', 1), '') END,
        'pickup_code', CASE WHEN o.fulfillment_type = 'PICKUP' AND to_regclass('public.pickup_arrivals') IS NOT NULL
          THEN (SELECT a.pickup_code FROM public.pickup_arrivals a WHERE a.order_id = o.id) END,
        'confirmed_at', (SELECT max(h.created_at) FROM public.order_status_history h
          WHERE h.order_id = o.id AND h.status = 'CONFIRMED'),
        'preparing_at', (SELECT max(h.created_at) FROM public.order_status_history h
          WHERE h.order_id = o.id AND h.status = 'PREPARING'),
        'items', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'order_item_id', i.id, 'product_name', i.product_name, 'quantity', i.quantity,
            'unit', i.unit, 'notes', i.notes
          ) ORDER BY i.product_name)
          FROM public.order_items i WHERE i.order_id = o.id
        ), '[]'::jsonb)
      ) AS item
      FROM public.orders o
      WHERE o.tenant_id = v_t AND o.status IN ('CONFIRMED', 'PREPARING')
      ORDER BY o.created_at LIMIT 100
    ) q
  ), '[]'::jsonb);
END;
$$;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_dine_in_session_tenant_fk;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_dine_in_details_check;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_dine_in_tab_tenant_fk;
DROP INDEX IF EXISTS public.orders_dine_in_tab_round_idx;
DROP INDEX IF EXISTS public.orders_dine_in_idempotency_uidx;
ALTER TABLE public.orders DROP COLUMN IF EXISTS ordered_by_session_id;
ALTER TABLE public.orders DROP COLUMN IF EXISTS round_no;
ALTER TABLE public.orders DROP COLUMN IF EXISTS tab_id;

DROP TABLE IF EXISTS public.tab_events;
DROP TABLE IF EXISTS public.tab_payments;
DROP TABLE IF EXISTS public.waiter_calls;
DROP TABLE IF EXISTS public.tab_sessions;
DROP TABLE IF EXISTS public.dining_tabs;
DROP TABLE IF EXISTS public.dining_tables;

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_station_check;
ALTER TABLE public.order_items DROP COLUMN IF EXISTS fired_at;
ALTER TABLE public.order_items DROP COLUMN IF EXISTS station;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_station_check;
ALTER TABLE public.categories DROP COLUMN IF EXISTS station;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_fulfillment_type_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_fulfillment_type_check
  CHECK (fulfillment_type IN ('DELIVERY', 'PICKUP'));

CREATE OR REPLACE FUNCTION public.guard_order_module_enabled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.fulfillment_type IS NOT DISTINCT FROM OLD.fulfillment_type
     AND NEW.origin IS NOT DISTINCT FROM OLD.origin THEN
    RETURN NEW;
  END IF;
  IF NEW.origin = 'pos' THEN
    PERFORM public.assert_tenant_module_enabled(NEW.tenant_id, 'pos');
  ELSE
    IF NEW.fulfillment_type = 'DELIVERY' THEN
      PERFORM public.assert_tenant_module_enabled(NEW.tenant_id, 'delivery');
    ELSIF NEW.fulfillment_type = 'PICKUP' THEN
      PERFORM public.assert_tenant_module_enabled(NEW.tenant_id, 'pickup');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_order_module_enabled() FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public._dine_in_config(uuid);

DELETE FROM public.roles WHERE id = 'WAITER';
COMMIT;
