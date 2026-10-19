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
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public._is_staff_role(text)'));
  IF v_definition IS NOT NULL THEN
    v_updated := replace(v_definition, $q$'DELIVERY_MANAGER','WAITER');$q$, $q$'DELIVERY_MANAGER');$q$);
    IF v_updated <> v_definition THEN EXECUTE v_updated; END IF;
  END IF;

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

-- 2500 version (with add-on options).
CREATE OR REPLACE FUNCTION public.kitchen_list_orders(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_t uuid := public._kitchen_resolve_tenant(p_tenant_id);
BEGIN
    RETURN COALESCE((
        SELECT jsonb_agg(x ORDER BY (x ->> 'created_at')) FROM (
            SELECT jsonb_build_object(
                'order_id', o.id, 'order_number', o.order_number, 'status', o.status,
                'fulfillment_type', o.fulfillment_type, 'created_at', o.created_at, 'notes', o.notes,
                'customer_first_name', CASE WHEN o.fulfillment_type = 'PICKUP'
                    THEN NULLIF(split_part(btrim(COALESCE(o.customer_name, '')), ' ', 1), '') END,
                'pickup_code', CASE WHEN o.fulfillment_type = 'PICKUP' AND to_regclass('public.pickup_arrivals') IS NOT NULL
                    THEN (SELECT a.pickup_code FROM public.pickup_arrivals a WHERE a.order_id = o.id) END,
                'confirmed_at', (SELECT max(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'CONFIRMED'),
                'preparing_at', (SELECT max(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'PREPARING'),
                'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'order_item_id', i.id, 'product_name', i.product_name, 'quantity', i.quantity, 'unit', i.unit, 'notes', i.notes,
                    'options', COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'group_name', x.group_name_snapshot, 'option_name', x.option_name_snapshot,
                            'qty', x.qty, 'fraction', x.fraction
                        ) ORDER BY x.id)
                        FROM public.order_item_options x
                        WHERE x.tenant_id = o.tenant_id AND x.order_item_id = i.id
                    ), '[]'::jsonb)
                ) ORDER BY i.product_name) FROM public.order_items i WHERE i.order_id = o.id), '[]'::jsonb)
            ) AS x
            FROM public.orders o
            WHERE o.tenant_id = v_t AND o.status IN ('CONFIRMED','PREPARING')
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

-- Restore the 2500 versions (one line per product, no option normalization).
CREATE OR REPLACE FUNCTION public._product_option_snapshot_after_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_items jsonb;
    v_line jsonb;
    v_selection jsonb;
    v_tenant uuid;
BEGIN
    v_items := NULLIF(current_setting('app.product_option_items', true), '')::jsonb;
    IF v_items IS NULL THEN RETURN NEW; END IF;
    SELECT e INTO v_line FROM jsonb_array_elements(v_items) e WHERE e ->> 'productId' = NEW.product_id::text LIMIT 1;
    IF v_line IS NULL OR jsonb_typeof(v_line -> 'options') <> 'array' THEN RETURN NEW; END IF;
    SELECT o.tenant_id INTO v_tenant FROM public.orders o WHERE o.id = NEW.order_id;
    FOR v_selection IN SELECT s FROM jsonb_array_elements(v_line -> 'options') s LOOP
        INSERT INTO public.order_item_options (
            tenant_id, order_item_id, group_id, option_id, group_name_snapshot, option_name_snapshot,
            qty, unit_price_cents, fraction
        )
        SELECT v_tenant, NEW.id, g.id, o.id, g.name, o.name,
               (v_selection ->> 'qty')::integer, o.extra_price_cents, NULLIF(v_selection ->> 'fraction', '')::numeric
        FROM public.product_options o
        JOIN public.product_option_groups g ON g.id = o.group_id AND g.tenant_id = o.tenant_id
        WHERE o.tenant_id = v_tenant AND g.id = (v_selection ->> 'group_id')::uuid
          AND o.id = (v_selection ->> 'option_id')::uuid;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'ADICIONAL_INDISPONIVEL: A opção mudou durante a criação do pedido.';
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._product_option_snapshot_after_order_item() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public._price_items(p_tenant UUID, p_items JSONB, p_lock BOOLEAN)
RETURNS TABLE(r_product_id UUID, r_quantity INT, r_notes TEXT, r_name TEXT, r_unit TEXT, r_stock INT,
              r_unit_price NUMERIC, r_original_price NUMERIC, r_is_promotional BOOLEAN, r_price_source TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_elem jsonb;
    v_key text;
    v_agg record;
    v_prod record;
    v_price record;
    v_addon_cents integer;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'EMPTY_CART: a sacola de compras não pode estar vazia.';
    END IF;
    IF jsonb_array_length(p_items) > 100 THEN
        RAISE EXCEPTION 'TOO_MANY_ITEMS: máximo de 100 linhas por pedido.';
    END IF;
    PERFORM set_config('app.product_option_items', p_items::text, true);
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        IF jsonb_typeof(v_elem) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'INVALID_ITEM: item do pedido inválido.';
        END IF;
        FOR v_key IN SELECT jsonb_object_keys(v_elem) LOOP
            IF v_key NOT IN ('productId','quantity','notes','options') THEN
                RAISE EXCEPTION 'UNEXPECTED_FIELD: campo "%" não é aceito nos itens.', v_key;
            END IF;
        END LOOP;
        IF jsonb_typeof(v_elem -> 'productId') IS DISTINCT FROM 'string'
           OR (v_elem ->> 'productId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'INVALID_ITEM: ID do produto inválido no pedido.';
        END IF;
        IF jsonb_typeof(v_elem -> 'quantity') IS DISTINCT FROM 'number' OR (v_elem ->> 'quantity') !~ '^[0-9]+$'
           OR (v_elem ->> 'quantity')::numeric < 1 OR (v_elem ->> 'quantity')::numeric > 999 THEN
            RAISE EXCEPTION 'INVALID_QUANTITY: a quantidade do item deve ser um inteiro entre 1 e 999.';
        END IF;
        IF v_elem ? 'notes' AND jsonb_typeof(v_elem -> 'notes') NOT IN ('string','null') THEN
            RAISE EXCEPTION 'INVALID_ITEM: observação do item inválida.';
        END IF;
        IF length(COALESCE(v_elem ->> 'notes', '')) > 300 THEN
            RAISE EXCEPTION 'INVALID_ITEM: observação do item com mais de 300 caracteres.';
        END IF;
        IF v_elem ? 'options' AND jsonb_typeof(v_elem -> 'options') IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'ADICIONAIS_INVALIDOS: As opções selecionadas são inválidas.';
        END IF;
    END LOOP;

    FOR v_agg IN
        SELECT (e ->> 'productId')::uuid AS pid,
               sum((e ->> 'quantity')::int)::int AS qty,
               string_agg(NULLIF(btrim(e ->> 'notes'), ''), ' | ') AS notes,
               count(DISTINCT COALESCE(e -> 'options', '[]'::jsonb)::text) AS selection_variants,
               (array_agg(COALESCE(e -> 'options', '[]'::jsonb)))[1] AS selections
        FROM jsonb_array_elements(p_items) e
        GROUP BY (e ->> 'productId')::uuid
        ORDER BY (e ->> 'productId')::uuid
    LOOP
        IF v_agg.qty > 999 THEN RAISE EXCEPTION 'INVALID_QUANTITY: quantidade máxima por produto é 999.'; END IF;
        IF v_agg.selection_variants > 1 THEN
            RAISE EXCEPTION 'ADICIONAIS_INVALIDOS: Separe em itens distintos os produtos com escolhas diferentes.';
        END IF;
        IF p_lock THEN
            SELECT p.* INTO v_prod FROM public.products p WHERE p.id = v_agg.pid AND p.tenant_id = p_tenant FOR UPDATE;
        ELSE
            SELECT p.* INTO v_prod FROM public.products p WHERE p.id = v_agg.pid AND p.tenant_id = p_tenant;
        END IF;
        IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND: produto não encontrado no catálogo deste estabelecimento.'; END IF;
        IF NOT v_prod.is_active THEN RAISE EXCEPTION 'PRODUCT_UNAVAILABLE: o produto "%" está temporariamente indisponível.', v_prod.name; END IF;
        SELECT * INTO v_price FROM public._effective_product_price(p_tenant, v_agg.pid, now());
        v_addon_cents := public._product_option_selection_price(p_tenant, v_agg.pid, v_agg.selections);
        r_product_id := v_agg.pid; r_quantity := v_agg.qty; r_notes := v_agg.notes;
        r_name := v_prod.name; r_unit := v_prod.unit; r_stock := v_prod.stock_quantity;
        r_unit_price := v_price.unit_price + (v_addon_cents::numeric / 100);
        r_original_price := v_price.original_price + (v_addon_cents::numeric / 100);
        r_is_promotional := v_price.is_promotional; r_price_source := v_price.price_source;
        RETURN NEXT;
    END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._price_items(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public._normalize_product_option_selections(jsonb);

DROP FUNCTION IF EXISTS public._dine_in_config(uuid);

DELETE FROM public.roles WHERE id = 'WAITER';
COMMIT;
