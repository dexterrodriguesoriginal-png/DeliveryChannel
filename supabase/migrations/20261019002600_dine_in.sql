BEGIN;

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS description text;

INSERT INTO public.roles (id, name, description, level)
VALUES ('WAITER', 'Garçom', 'Atendimento de salão e comandas', 25)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.team_invites DROP CONSTRAINT IF EXISTS chk_team_invites_role;
ALTER TABLE public.team_invites ADD CONSTRAINT chk_team_invites_role
  CHECK (role_id IN ('MANAGER', 'CASHIER', 'OPERATOR', 'DELIVERY_MANAGER', 'DRIVER', 'WAITER')) NOT VALID;

DO $do$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  -- _is_staff_role comes from 0700; skip only where it does not exist (local test harness).
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public._is_staff_role(text)'));
  IF v_definition IS NOT NULL AND position('WAITER' IN v_definition) = 0 THEN
    v_updated := replace(v_definition, $q$'DELIVERY_MANAGER');$q$, $q$'DELIVERY_MANAGER','WAITER');$q$);
    IF v_updated = v_definition THEN
      RAISE EXCEPTION 'PRECHECK 2600: definição inesperada para _is_staff_role.';
    END IF;
    EXECUTE v_updated;
  END IF;

  IF pg_catalog.to_regprocedure('public._is_staff_role(text)') IS NOT NULL THEN
  FOREACH v_definition IN ARRAY ARRAY[
    pg_catalog.pg_get_functiondef('public.accept_team_invite(uuid)'::regprocedure),
    pg_catalog.pg_get_functiondef('public.create_team_invite(uuid,character varying,character varying)'::regprocedure)
  ] LOOP
    IF position('WAITER' IN v_definition) = 0 THEN
      v_updated := replace(v_definition, $q$'DRIVER')$q$, $q$'DRIVER','WAITER')$q$);
      IF v_updated = v_definition THEN
        RAISE EXCEPTION 'PRECHECK 2600: definição inesperada nas RPCs de convite.';
      END IF;
      EXECUTE v_updated;
    END IF;
  END LOOP;
  END IF;
END;
$do$;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS station text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.categories'::pg_catalog.regclass
      AND conname = 'categories_station_check'
  ) THEN
    ALTER TABLE public.categories ADD CONSTRAINT categories_station_check
      CHECK (station IS NULL OR station IN ('KITCHEN', 'BAR'));
  END IF;
END;
$$;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_fulfillment_type_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_fulfillment_type_check
  CHECK (fulfillment_type IN ('DELIVERY', 'PICKUP', 'DINE_IN'));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tab_id uuid,
  ADD COLUMN IF NOT EXISTS round_no integer,
  ADD COLUMN IF NOT EXISTS ordered_by_session_id uuid;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS station text,
  ADD COLUMN IF NOT EXISTS fired_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.order_items'::pg_catalog.regclass
      AND conname = 'order_items_station_check'
  ) THEN
    ALTER TABLE public.order_items ADD CONSTRAINT order_items_station_check
      CHECK (station IS NULL OR station IN ('KITCHEN', 'BAR'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.dining_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  area text CHECK (area IS NULL OR length(area) <= 80),
  seats integer NOT NULL DEFAULT 2 CHECK (seats BETWEEN 1 AND 100),
  qr_token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, label)
);

CREATE TABLE IF NOT EXISTS public.dining_tabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('TABLE', 'INDIVIDUAL')),
  table_id uuid NOT NULL,
  card_number integer,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'BILL_REQUESTED', 'CLOSED', 'CANCELLED')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  waiter_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  guests integer NOT NULL DEFAULT 1 CHECK (guests BETWEEN 1 AND 100),
  service_fee_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (service_fee_percent BETWEEN 0 AND 30),
  service_fee_removed boolean NOT NULL DEFAULT false,
  merged_into_tab_id uuid,
  CONSTRAINT dining_tabs_table_tenant_fk
    FOREIGN KEY (tenant_id, table_id) REFERENCES public.dining_tables(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT dining_tabs_merge_tenant_fk
    FOREIGN KEY (tenant_id, merged_into_tab_id) REFERENCES public.dining_tabs(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT dining_tabs_tenant_id_id_key UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS public.tab_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tab_id uuid NOT NULL,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
  device_id text NOT NULL CHECK (length(device_id) BETWEEN 1 AND 120),
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '6 hours'),
  CONSTRAINT tab_sessions_tab_tenant_fk
    FOREIGN KEY (tenant_id, tab_id) REFERENCES public.dining_tabs(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT tab_sessions_approval_expiry_check CHECK (approved_at IS NULL OR approved_at <= expires_at),
  CONSTRAINT tab_sessions_tenant_user_device_key UNIQUE (tenant_id, auth_user_id, device_id, tab_id),
  CONSTRAINT tab_sessions_tenant_id_id_key UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS public.waiter_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tab_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('CALL', 'BILL', 'HELP')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'HANDLED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  CONSTRAINT waiter_calls_tab_tenant_fk
    FOREIGN KEY (tenant_id, tab_id) REFERENCES public.dining_tabs(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.tab_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tab_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'PIX', 'CAIXA')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  change_given_cents integer NOT NULL DEFAULT 0 CHECK (change_given_cents >= 0),
  received_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tab_payments_tab_tenant_fk
    FOREIGN KEY (tenant_id, tab_id) REFERENCES public.dining_tabs(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT tab_payments_change_method_check CHECK (method = 'CASH' OR change_given_cents = 0)
);

CREATE TABLE IF NOT EXISTS public.tab_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tab_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'SESSION_APPROVED', 'SERVICE_FEE_REMOVED', 'ITEM_CANCELLED', 'DISCOUNT', 'TAB_CLOSED'
  )),
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tab_events_tab_tenant_fk
    FOREIGN KEY (tenant_id, tab_id) REFERENCES public.dining_tabs(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS dining_tables_tenant_active_idx ON public.dining_tables (tenant_id, active, label);
CREATE INDEX IF NOT EXISTS dining_tabs_tenant_status_idx ON public.dining_tabs (tenant_id, status, opened_at);
CREATE INDEX IF NOT EXISTS tab_sessions_auth_user_idx ON public.tab_sessions (auth_user_id, expires_at);
CREATE INDEX IF NOT EXISTS waiter_calls_tenant_open_idx ON public.waiter_calls (tenant_id, created_at) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS tab_payments_tenant_tab_idx ON public.tab_payments (tenant_id, tab_id);
CREATE INDEX IF NOT EXISTS tab_events_tenant_tab_idx ON public.tab_events (tenant_id, tab_id, created_at);
CREATE INDEX IF NOT EXISTS orders_dine_in_tab_round_idx ON public.orders (tenant_id, tab_id, round_no)
  WHERE fulfillment_type = 'DINE_IN';
CREATE UNIQUE INDEX IF NOT EXISTS orders_dine_in_idempotency_uidx ON public.orders (tenant_id, idempotency_key)
  WHERE fulfillment_type = 'DINE_IN' AND idempotency_key IS NOT NULL;

ALTER TABLE public.dining_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dining_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tab_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiter_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tab_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tab_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.dining_tables, public.dining_tabs, public.tab_sessions,
  public.waiter_calls, public.tab_payments, public.tab_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dining_tables TO authenticated;
GRANT SELECT ON public.dining_tabs, public.tab_sessions, public.waiter_calls,
  public.tab_payments, public.tab_events TO authenticated;

DROP POLICY IF EXISTS dining_tables_staff ON public.dining_tables;
DROP POLICY IF EXISTS dining_tables_staff_read ON public.dining_tables;
DROP POLICY IF EXISTS dining_tables_owner_manage ON public.dining_tables;
CREATE POLICY dining_tables_staff_read ON public.dining_tables
  FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']))
;
CREATE POLICY dining_tables_owner_manage ON public.dining_tables
  FOR ALL TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER', 'MANAGER']))
  WITH CHECK (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER', 'MANAGER']));
DROP POLICY IF EXISTS dining_tabs_staff_read ON public.dining_tabs;
CREATE POLICY dining_tabs_staff_read ON public.dining_tabs
  FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']));
DROP POLICY IF EXISTS tab_sessions_staff_read ON public.tab_sessions;
CREATE POLICY tab_sessions_staff_read ON public.tab_sessions
  FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']));
DROP POLICY IF EXISTS waiter_calls_staff_read ON public.waiter_calls;
CREATE POLICY waiter_calls_staff_read ON public.waiter_calls
  FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']));
DROP POLICY IF EXISTS tab_payments_staff_read ON public.tab_payments;
CREATE POLICY tab_payments_staff_read ON public.tab_payments
  FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']));
DROP POLICY IF EXISTS tab_events_staff_read ON public.tab_events;
CREATE POLICY tab_events_staff_read ON public.tab_events
  FOR SELECT TO authenticated
  USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.orders'::pg_catalog.regclass
                 AND conname = 'orders_dine_in_tab_tenant_fk') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_dine_in_tab_tenant_fk
      FOREIGN KEY (tenant_id, tab_id) REFERENCES public.dining_tabs(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.orders'::pg_catalog.regclass
                 AND conname = 'orders_dine_in_details_check') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_dine_in_details_check
      CHECK (
        (fulfillment_type = 'DINE_IN' AND tab_id IS NOT NULL AND round_no > 0)
        OR (fulfillment_type <> 'DINE_IN' AND tab_id IS NULL AND round_no IS NULL AND ordered_by_session_id IS NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.orders'::pg_catalog.regclass
                 AND conname = 'orders_dine_in_session_tenant_fk') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_dine_in_session_tenant_fk
      FOREIGN KEY (tenant_id, ordered_by_session_id) REFERENCES public.tab_sessions(tenant_id, id)
      ON DELETE SET NULL (ordered_by_session_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._dine_in_config(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(tm.config, '{}'::jsonb)
  FROM public.tenant_modules tm
  WHERE tm.tenant_id = p_tenant AND tm.module_key = 'dine_in' AND tm.enabled
$$;

CREATE OR REPLACE FUNCTION public._tenant_module_disable_blockers(p_tenant uuid, p_key text)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN p_key = 'dine_in' THEN COALESCE((
    SELECT array_agg(dt.label || ' (' || tb.status || ')' ORDER BY tb.opened_at)
    FROM public.dining_tabs tb
    JOIN public.dining_tables dt ON dt.id = tb.table_id AND dt.tenant_id = tb.tenant_id
    WHERE tb.tenant_id = p_tenant AND tb.status IN ('OPEN', 'BILL_REQUESTED')
  ), ARRAY[]::text[]) ELSE ARRAY[]::text[] END
$$;

CREATE OR REPLACE FUNCTION public._normalize_product_option_selections(p_selections jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'group_id', e.value -> 'group_id',
        'option_id', e.value -> 'option_id',
        'qty', e.value -> 'qty',
        'fraction', e.value -> 'fraction'
      )
      ORDER BY e.value ->> 'group_id', e.value ->> 'option_id',
               e.value ->> 'qty', e.value ->> 'fraction'
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(COALESCE(p_selections, '[]'::jsonb)) AS e(value)
$$;

REVOKE ALL ON FUNCTION public._tenant_module_disable_blockers(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._dine_in_config(uuid),
  public._normalize_product_option_selections(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._product_option_snapshot_after_order_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_items jsonb;
  v_line jsonb;
  v_selection jsonb;
  v_tenant uuid;
  v_used jsonb := '[]'::jsonb;
  v_signature text;
BEGIN
  v_items := NULLIF(current_setting('app.product_option_items', true), '')::jsonb;
  IF v_items IS NULL THEN RETURN NEW; END IF;
  v_used := COALESCE(NULLIF(current_setting('app.product_option_used', true), '')::jsonb, '[]'::jsonb);
  SELECT e.value,
         NEW.product_id::text || ':' || public._normalize_product_option_selections(e.value -> 'options')::text
  INTO v_line, v_signature
  FROM jsonb_array_elements(v_items) AS e(value)
  WHERE e.value ->> 'productId' = NEW.product_id::text
    AND jsonb_array_length(COALESCE(e.value -> 'options', '[]'::jsonb)) > 0
    AND NOT (v_used @> jsonb_build_array(
      NEW.product_id::text || ':' || public._normalize_product_option_selections(e.value -> 'options')::text
    ))
    AND NEW.unit_price = (
      SELECT price.unit_price + public._product_option_selection_price(
        (SELECT o.tenant_id FROM public.orders o WHERE o.id = NEW.order_id),
        NEW.product_id, e.value -> 'options'
      )::numeric / 100
      FROM public._effective_product_price(
        (SELECT o.tenant_id FROM public.orders o WHERE o.id = NEW.order_id),
        NEW.product_id, now()
      ) price
    )
  ORDER BY public._normalize_product_option_selections(e.value -> 'options')::text
  LIMIT 1;
  IF v_line IS NULL OR jsonb_typeof(v_line -> 'options') <> 'array' THEN RETURN NEW; END IF;
  SELECT o.tenant_id INTO v_tenant FROM public.orders o WHERE o.id = NEW.order_id;
  FOR v_selection IN SELECT s FROM jsonb_array_elements(v_line -> 'options') s LOOP
    INSERT INTO public.order_item_options (
      tenant_id, order_item_id, group_id, option_id, group_name_snapshot, option_name_snapshot,
      qty, unit_price_cents, fraction
    )
    SELECT v_tenant, NEW.id, g.id, o.id, g.name, o.name,
           (v_selection ->> 'qty')::integer, o.extra_price_cents,
           NULLIF(v_selection ->> 'fraction', '')::numeric
    FROM public.product_options o
    JOIN public.product_option_groups g ON g.id = o.group_id AND g.tenant_id = o.tenant_id
    WHERE o.tenant_id = v_tenant AND g.id = (v_selection ->> 'group_id')::uuid
      AND o.id = (v_selection ->> 'option_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ADICIONAL_INDISPONIVEL: A opção mudou durante a criação do pedido.';
    END IF;
  END LOOP;
  PERFORM set_config('app.product_option_used', (v_used || jsonb_build_array(v_signature))::text, true);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._product_option_snapshot_after_order_item() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._price_items(p_tenant uuid, p_items jsonb, p_lock boolean)
RETURNS TABLE(r_product_id uuid, r_quantity int, r_notes text, r_name text, r_unit text, r_stock int,
              r_unit_price numeric, r_original_price numeric, r_is_promotional boolean, r_price_source text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
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
  PERFORM set_config('app.product_option_used', '[]', true);
  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_elem) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'INVALID_ITEM: item do pedido inválido.';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_elem) LOOP
      IF v_key NOT IN ('productId', 'quantity', 'notes', 'options') THEN
        RAISE EXCEPTION 'UNEXPECTED_FIELD: campo "%" não é aceito nos itens.', v_key;
      END IF;
    END LOOP;
    IF jsonb_typeof(v_elem -> 'productId') IS DISTINCT FROM 'string'
       OR (v_elem ->> 'productId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'INVALID_ITEM: ID do produto inválido no pedido.';
    END IF;
    IF jsonb_typeof(v_elem -> 'quantity') IS DISTINCT FROM 'number'
       OR (v_elem ->> 'quantity') !~ '^[0-9]+$'
       OR (v_elem ->> 'quantity')::numeric NOT BETWEEN 1 AND 999 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY: a quantidade do item deve ser um inteiro entre 1 e 999.';
    END IF;
    IF v_elem ? 'notes' AND jsonb_typeof(v_elem -> 'notes') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'INVALID_ITEM: observação do item inválida.';
    END IF;
    IF length(COALESCE(v_elem ->> 'notes', '')) > 300 THEN
      RAISE EXCEPTION 'INVALID_ITEM: observação do item com mais de 300 caracteres.';
    END IF;
    IF v_elem ? 'options' AND jsonb_typeof(v_elem -> 'options') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'ADICIONAIS_INVALIDOS: As opções selecionadas são inválidas.';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e
    GROUP BY e.value ->> 'productId'
    HAVING sum((e.value ->> 'quantity')::integer) > 999
  ) THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: quantidade máxima por produto é 999.';
  END IF;

  FOR v_agg IN
    SELECT (line.value ->> 'productId')::uuid AS pid,
           sum((line.value ->> 'quantity')::integer)::integer AS qty,
           string_agg(NULLIF(btrim(line.value ->> 'notes'), ''), ' | ') AS notes,
           line.normalized_options AS selections
    FROM (
      SELECT e.value, public._normalize_product_option_selections(e.value -> 'options') AS normalized_options
      FROM jsonb_array_elements(p_items) e
    ) line
    GROUP BY (line.value ->> 'productId')::uuid, line.normalized_options
    ORDER BY (line.value ->> 'productId')::uuid, line.normalized_options::text
  LOOP
    IF p_lock THEN
      SELECT p.* INTO v_prod FROM public.products p
      WHERE p.id = v_agg.pid AND p.tenant_id = p_tenant FOR UPDATE;
    ELSE
      SELECT p.* INTO v_prod FROM public.products p
      WHERE p.id = v_agg.pid AND p.tenant_id = p_tenant;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: produto não encontrado no catálogo deste estabelecimento.';
    END IF;
    IF NOT v_prod.is_active THEN
      RAISE EXCEPTION 'PRODUCT_UNAVAILABLE: o produto "%" está temporariamente indisponível.', v_prod.name;
    END IF;
    SELECT * INTO v_price FROM public._effective_product_price(p_tenant, v_agg.pid, now());
    v_addon_cents := public._product_option_selection_price(p_tenant, v_agg.pid, v_agg.selections);
    r_product_id := v_agg.pid;
    r_quantity := v_agg.qty;
    r_notes := v_agg.notes;
    r_name := v_prod.name;
    r_unit := v_prod.unit;
    r_stock := v_prod.stock_quantity;
    r_unit_price := v_price.unit_price + (v_addon_cents::numeric / 100);
    r_original_price := v_price.original_price + (v_addon_cents::numeric / 100);
    r_is_promotional := v_price.is_promotional;
    r_price_source := v_price.price_source;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._price_items(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._dine_in_config(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._normalize_product_option_selections(jsonb) FROM PUBLIC, anon, authenticated;

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
  ELSIF NEW.fulfillment_type = 'DELIVERY' THEN
    PERFORM public.assert_tenant_module_enabled(NEW.tenant_id, 'delivery');
  ELSIF NEW.fulfillment_type = 'PICKUP' THEN
    PERFORM public.assert_tenant_module_enabled(NEW.tenant_id, 'pickup');
  ELSIF NEW.fulfillment_type = 'DINE_IN' THEN
    PERFORM public.assert_tenant_module_enabled(NEW.tenant_id, 'dine_in');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_order_module_enabled() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._dine_in_station_before_order_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  SELECT c.station INTO NEW.station
  FROM public.products p
  LEFT JOIN public.categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id
  WHERE p.id = NEW.product_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._dine_in_station_before_order_item() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS order_item_dine_in_station ON public.order_items;
CREATE TRIGGER order_item_dine_in_station
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public._dine_in_station_before_order_item();

CREATE OR REPLACE FUNCTION public.resolve_table_qr(p_qr_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.resolve_table_qr(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_table_qr(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.open_or_join_tab(p_qr_token text, p_display_name text, p_device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.open_or_join_tab(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_or_join_tab(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_session(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.approve_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_session(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_round(
  p_items jsonb, p_idempotency_key uuid, p_session_id uuid DEFAULT NULL, p_tab_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.submit_round(jsonb, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_round(jsonb, uuid, uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_tab(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.get_my_tab(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_tab(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.call_waiter(p_session_id uuid, p_type text DEFAULT 'CALL')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_tenant uuid; v_tab uuid; v_call uuid;
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('CALL', 'HELP') THEN
    RAISE EXCEPTION 'INVALID_CALL: chamado inválido.';
  END IF;
  SELECT ts.tenant_id, ts.tab_id INTO v_tenant, v_tab FROM public.tab_sessions ts
  JOIN public.dining_tabs tb ON tb.id = ts.tab_id AND tb.tenant_id = ts.tenant_id
  WHERE ts.id = p_session_id AND ts.auth_user_id = auth.uid() AND ts.expires_at > now()
    AND tb.status IN ('OPEN', 'BILL_REQUESTED');
  IF v_tab IS NULL THEN RAISE EXCEPTION 'TAB_NOT_FOUND: comanda não encontrada.' USING ERRCODE = '42501'; END IF;
  IF public._dine_in_config(v_tenant) IS NULL THEN
    RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.';
  END IF;
  INSERT INTO public.waiter_calls (tenant_id, tab_id, type)
  VALUES (v_tenant, v_tab, p_type) RETURNING id INTO v_call;
  RETURN v_call;
END;
$$;
REVOKE ALL ON FUNCTION public.call_waiter(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.call_waiter(uuid, text) TO anon, authenticated;

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

CREATE OR REPLACE FUNCTION public.remove_service_fee(p_tab_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tb.tenant_id INTO v_tenant FROM public.dining_tabs tb
  WHERE tb.id = p_tab_id AND tb.status IN ('OPEN', 'BILL_REQUESTED') FOR UPDATE;
  IF v_tenant IS NULL OR auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_tenant, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para alterar a taxa.' USING ERRCODE = '42501';
  END IF;
  IF public._dine_in_config(v_tenant) IS NULL THEN
    RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: informe o motivo da remoção da taxa.';
  END IF;
  UPDATE public.dining_tabs SET service_fee_removed = true WHERE id = p_tab_id AND tenant_id = v_tenant;
  INSERT INTO public.tab_events (tenant_id, tab_id, event_type, actor_id, details)
  VALUES (v_tenant, p_tab_id, 'SERVICE_FEE_REMOVED', auth.uid(), jsonb_build_object('reason', btrim(p_reason)));
END;
$$;
REVOKE ALL ON FUNCTION public.remove_service_fee(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_service_fee(uuid, text) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.regenerate_dining_table_qr(p_table_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_tenant uuid; v_token text;
BEGIN
  SELECT dt.tenant_id INTO v_tenant FROM public.dining_tables dt WHERE dt.id = p_table_id FOR UPDATE;
  IF v_tenant IS NULL OR auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_tenant, ARRAY['OWNER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: somente o proprietário pode renovar o QR.' USING ERRCODE = '42501';
  END IF;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  UPDATE public.dining_tables SET qr_token = v_token WHERE id = p_table_id AND tenant_id = v_tenant;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.regenerate_dining_table_qr(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_dining_table_qr(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.kitchen_list_orders(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := public._kitchen_resolve_tenant(p_tenant_id);
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(q.item ORDER BY q.item ->> 'created_at')
    FROM (
      SELECT jsonb_build_object(
        'order_id', o.id, 'order_number', o.order_number, 'status', o.status,
        'fulfillment_type', o.fulfillment_type, 'created_at', o.created_at, 'notes', o.notes,
        'round_no', o.round_no,
        'table_label', CASE WHEN o.fulfillment_type = 'DINE_IN' THEN (
          SELECT dt.label FROM public.dining_tabs tb
          JOIN public.dining_tables dt ON dt.id = tb.table_id AND dt.tenant_id = tb.tenant_id
          WHERE tb.id = o.tab_id AND tb.tenant_id = o.tenant_id
        ) END,
        'customer_first_name', CASE WHEN o.fulfillment_type IN ('PICKUP', 'DINE_IN')
          THEN NULLIF(split_part(btrim(COALESCE(o.customer_name, '')), ' ', 1), '') END,
        'pickup_code', CASE WHEN o.fulfillment_type = 'PICKUP' AND pg_catalog.to_regclass('public.pickup_arrivals') IS NOT NULL
          THEN (SELECT a.pickup_code FROM public.pickup_arrivals a WHERE a.order_id = o.id) END,
        'confirmed_at', (SELECT max(h.created_at) FROM public.order_status_history h
          WHERE h.order_id = o.id AND h.status = 'CONFIRMED'),
        'preparing_at', (SELECT max(h.created_at) FROM public.order_status_history h
          WHERE h.order_id = o.id AND h.status = 'PREPARING'),
        'items', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'order_item_id', i.id, 'product_name', i.product_name, 'quantity', i.quantity,
            'unit', i.unit, 'notes', i.notes, 'station', i.station,
            'options', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'group_name', x.group_name_snapshot, 'option_name', x.option_name_snapshot,
                'qty', x.qty, 'fraction', x.fraction
              ) ORDER BY x.id)
              FROM public.order_item_options x
              WHERE x.tenant_id = o.tenant_id AND x.order_item_id = i.id
            ), '[]'::jsonb)
          ) ORDER BY i.product_name)
          FROM public.order_items i WHERE i.order_id = o.id
        ), '[]'::jsonb)
      ) AS item
      FROM public.orders o
      WHERE o.tenant_id = v_tenant AND o.status IN ('CONFIRMED', 'PREPARING')
      ORDER BY o.created_at LIMIT 100
    ) q
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.kitchen_list_orders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kitchen_list_orders(uuid) TO authenticated;

COMMIT;
