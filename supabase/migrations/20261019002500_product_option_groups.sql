BEGIN;

CREATE TABLE IF NOT EXISTS public.product_option_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    type text NOT NULL DEFAULT 'STANDARD' CHECK (type IN ('STANDARD', 'FLAVOR_SPLIT')),
    min_select integer NOT NULL DEFAULT 0 CHECK (min_select >= 0),
    max_select integer NOT NULL DEFAULT 1 CHECK (max_select >= 0),
    allow_repeat boolean NOT NULL DEFAULT false,
    pricing_rule text NOT NULL DEFAULT 'SUM' CHECK (pricing_rule IN ('SUM', 'HIGHEST', 'AVERAGE')),
    active boolean NOT NULL DEFAULT true,
    sort integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT product_option_groups_select_range CHECK (min_select <= max_select),
    CONSTRAINT product_option_groups_flavor_rule CHECK (
        (type = 'STANDARD' AND pricing_rule = 'SUM')
        OR (type = 'FLAVOR_SPLIT' AND pricing_rule IN ('HIGHEST', 'AVERAGE'))
    ),
    UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS public.product_options (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    group_id uuid NOT NULL,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    extra_price_cents integer NOT NULL DEFAULT 0 CHECK (extra_price_cents >= 0),
    active boolean NOT NULL DEFAULT true,
    sold_out boolean NOT NULL DEFAULT false,
    sort integer NOT NULL DEFAULT 0,
    CONSTRAINT product_options_group_tenant_fk
      FOREIGN KEY (tenant_id, group_id) REFERENCES public.product_option_groups(tenant_id, id) ON DELETE CASCADE,
    UNIQUE (tenant_id, group_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_id_id_uidx
    ON public.products (tenant_id, id);

CREATE TABLE IF NOT EXISTS public.product_option_group_links (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    group_id uuid NOT NULL,
    sort integer NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, group_id),
    CONSTRAINT product_option_group_links_product_tenant_fk
      FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT product_option_group_links_group_tenant_fk
      FOREIGN KEY (tenant_id, group_id) REFERENCES public.product_option_groups(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.order_item_options (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
    group_id uuid NOT NULL,
    option_id uuid NOT NULL,
    group_name_snapshot text NOT NULL,
    option_name_snapshot text NOT NULL,
    qty integer NOT NULL CHECK (qty > 0),
    unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
    fraction numeric CHECK (fraction IS NULL OR (fraction > 0 AND fraction <= 1)),
    CONSTRAINT order_item_options_option_tenant_fk
      FOREIGN KEY (tenant_id, group_id, option_id)
      REFERENCES public.product_options(tenant_id, group_id, id) ON DELETE RESTRICT,
    UNIQUE (order_item_id, option_id)
);

CREATE INDEX IF NOT EXISTS product_option_groups_tenant_sort_idx
    ON public.product_option_groups (tenant_id, active, sort);
CREATE INDEX IF NOT EXISTS product_options_tenant_group_sort_idx
    ON public.product_options (tenant_id, group_id, active, sort);
CREATE INDEX IF NOT EXISTS product_option_group_links_tenant_product_sort_idx
    ON public.product_option_group_links (tenant_id, product_id, sort);
CREATE INDEX IF NOT EXISTS order_item_options_tenant_item_idx
    ON public.order_item_options (tenant_id, order_item_id);

CREATE OR REPLACE FUNCTION public.product_options_public_enabled(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((
        SELECT tm.enabled FROM public.tenant_modules tm
        WHERE tm.tenant_id = p_tenant AND tm.module_key = 'addons'
    ), false);
$$;

CREATE OR REPLACE FUNCTION public.product_options_can_read_order_item(p_tenant uuid, p_item uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id AND o.tenant_id = p_tenant
        WHERE oi.id = p_item
          AND (
            public.is_ceo(auth.uid())
            OR public.has_tenant_scoped_role(p_tenant, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER','DELIVERY_MANAGER'])
            OR (o.driver_id = auth.uid() AND public.has_tenant_scoped_role(p_tenant, ARRAY['DRIVER']))
            OR EXISTS (
                SELECT 1 FROM public.customers c
                WHERE c.id = o.customer_id AND c.tenant_id = p_tenant AND c.user_id = auth.uid()
            )
          )
    );
$$;

REVOKE ALL ON FUNCTION public.product_options_public_enabled(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.product_options_can_read_order_item(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_options_public_enabled(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_options_can_read_order_item(uuid, uuid) TO authenticated;

-- Public visibility checks run as definer so the policies below do not query each
-- other's tables under RLS (groups <-> links would recurse).
CREATE OR REPLACE FUNCTION public.product_option_link_is_public(p_tenant uuid, p_product uuid, p_group uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.product_options_public_enabled(p_tenant)
      AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = p_product AND p.tenant_id = p_tenant AND p.is_active)
      AND EXISTS (SELECT 1 FROM public.product_option_groups g WHERE g.id = p_group AND g.tenant_id = p_tenant AND g.active);
$$;

CREATE OR REPLACE FUNCTION public.product_option_group_is_public(p_tenant uuid, p_group uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.product_option_group_links l
        WHERE l.tenant_id = p_tenant AND l.group_id = p_group
          AND public.product_option_link_is_public(l.tenant_id, l.product_id, l.group_id)
    );
$$;

REVOKE ALL ON FUNCTION public.product_option_link_is_public(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.product_option_group_is_public(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_option_link_is_public(uuid, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_option_group_is_public(uuid, uuid) TO anon, authenticated;

ALTER TABLE public.product_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_group_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_option_groups_public_read ON public.product_option_groups;
CREATE POLICY product_option_groups_public_read ON public.product_option_groups
    FOR SELECT TO anon, authenticated
    USING (public.product_option_group_is_public(tenant_id, id));
DROP POLICY IF EXISTS product_option_groups_staff_read ON public.product_option_groups;
CREATE POLICY product_option_groups_staff_read ON public.product_option_groups
    FOR SELECT TO authenticated
    USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER']));
DROP POLICY IF EXISTS product_option_groups_staff_write ON public.product_option_groups;
CREATE POLICY product_option_groups_staff_write ON public.product_option_groups
    FOR ALL TO authenticated
    USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER']))
    WITH CHECK (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER']));

DROP POLICY IF EXISTS product_options_public_read ON public.product_options;
CREATE POLICY product_options_public_read ON public.product_options
    FOR SELECT TO anon, authenticated
    USING (active AND public.product_option_group_is_public(tenant_id, group_id));
DROP POLICY IF EXISTS product_options_staff_read ON public.product_options;
CREATE POLICY product_options_staff_read ON public.product_options
    FOR SELECT TO authenticated
    USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER']));
DROP POLICY IF EXISTS product_options_staff_write ON public.product_options;
CREATE POLICY product_options_staff_write ON public.product_options
    FOR ALL TO authenticated
    USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER']))
    WITH CHECK (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER']));

DROP POLICY IF EXISTS product_option_group_links_public_read ON public.product_option_group_links;
CREATE POLICY product_option_group_links_public_read ON public.product_option_group_links
    FOR SELECT TO anon, authenticated
    USING (public.product_option_link_is_public(tenant_id, product_id, group_id));
DROP POLICY IF EXISTS product_option_group_links_staff_read ON public.product_option_group_links;
CREATE POLICY product_option_group_links_staff_read ON public.product_option_group_links
    FOR SELECT TO authenticated
    USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER']));
DROP POLICY IF EXISTS product_option_group_links_staff_write ON public.product_option_group_links;
CREATE POLICY product_option_group_links_staff_write ON public.product_option_group_links
    FOR ALL TO authenticated
    USING (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER']))
    WITH CHECK (public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER']));

DROP POLICY IF EXISTS order_item_options_order_read ON public.order_item_options;
CREATE POLICY order_item_options_order_read ON public.order_item_options
    FOR SELECT TO authenticated
    USING (public.product_options_can_read_order_item(tenant_id, order_item_id));

REVOKE ALL ON TABLE public.product_option_groups, public.product_options, public.product_option_group_links,
    public.order_item_options FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.product_option_groups, public.product_options, public.product_option_group_links
    TO anon, authenticated;
GRANT SELECT ON TABLE public.order_item_options TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.product_option_groups, public.product_options,
    public.product_option_group_links TO authenticated;

CREATE OR REPLACE FUNCTION public._product_option_selection_price(p_tenant uuid, p_product uuid, p_selections jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_enabled boolean;
    v_group record;
    v_selection jsonb;
    v_option record;
    v_selected_count integer;
    v_selected_ids uuid[] := ARRAY[]::uuid[];
    v_group_cents integer;
    v_total integer := 0;
    v_count integer;
    v_sum bigint;
    v_max integer;
    v_prices integer[];
    v_i integer;
BEGIN
    IF p_selections IS NULL OR jsonb_typeof(p_selections) <> 'array' THEN
        RAISE EXCEPTION 'ADICIONAIS_INVALIDOS: As opções selecionadas são inválidas.';
    END IF;
    SELECT COALESCE((
        SELECT tm.enabled FROM public.tenant_modules tm
        WHERE tm.tenant_id = p_tenant AND tm.module_key = 'addons'
    ), false) INTO v_enabled;
    IF NOT v_enabled THEN
        IF jsonb_array_length(p_selections) > 0 THEN
            RAISE EXCEPTION 'ADICIONAIS_DESATIVADOS: Os adicionais estão desativados para esta loja.';
        END IF;
        RETURN 0;
    END IF;
    IF jsonb_array_length(p_selections) > 0 THEN
        PERFORM public.assert_tenant_module_enabled(p_tenant, 'addons');
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_selections) s
        WHERE jsonb_typeof(s) <> 'object'
           OR COALESCE(s ->> 'group_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR COALESCE(s ->> 'option_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR CASE
                WHEN jsonb_typeof(s -> 'qty') = 'number' AND COALESCE(s ->> 'qty', '') ~ '^[0-9]+$'
                  THEN (s ->> 'qty')::numeric < 1 OR (s ->> 'qty')::numeric > 999
                ELSE true
              END
           OR CASE
                WHEN NOT (s ? 'fraction') OR jsonb_typeof(s -> 'fraction') = 'null' THEN false
                WHEN jsonb_typeof(s -> 'fraction') = 'number'
                  THEN (s ->> 'fraction')::numeric <= 0 OR (s ->> 'fraction')::numeric > 1
                ELSE true
              END
    ) THEN
        RAISE EXCEPTION 'ADICIONAIS_INVALIDOS: Confira as opções selecionadas.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_selections) s
        GROUP BY (s ->> 'option_id')::uuid HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'ADICIONAIS_INVALIDOS: A mesma opção foi enviada mais de uma vez.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_selections) s
        WHERE NOT EXISTS (
          SELECT 1 FROM public.product_option_group_links l
          JOIN public.product_option_groups g ON g.id = l.group_id AND g.tenant_id = l.tenant_id AND g.active
          WHERE l.tenant_id = p_tenant AND l.product_id = p_product AND l.group_id = (s ->> 'group_id')::uuid
        )
    ) THEN
        RAISE EXCEPTION 'ADICIONAIS_INVALIDOS: Uma opção selecionada não pertence a este produto.';
    END IF;

    FOR v_group IN
        SELECT g.* FROM public.product_option_group_links l
        JOIN public.product_option_groups g ON g.id = l.group_id AND g.tenant_id = l.tenant_id
        WHERE l.tenant_id = p_tenant AND l.product_id = p_product AND g.active
        ORDER BY l.sort, g.sort, g.id
    LOOP
        SELECT COALESCE(sum((s ->> 'qty')::integer), 0)::integer
        INTO v_selected_count
        FROM jsonb_array_elements(p_selections) s
        WHERE (s ->> 'group_id')::uuid = v_group.id;
        IF v_selected_count < v_group.min_select THEN
            RAISE EXCEPTION 'ADICIONAIS_MINIMO: Escolha pelo menos % opção(ões) em "%".', v_group.min_select, v_group.name;
        END IF;
        IF v_selected_count > v_group.max_select THEN
            RAISE EXCEPTION 'ADICIONAIS_MAXIMO: Escolha até % opção(ões) em "%".', v_group.max_select, v_group.name;
        END IF;
        v_group_cents := 0;
        v_sum := 0;
        v_count := 0;
        v_max := 0;
        v_prices := ARRAY[]::integer[];
        FOR v_selection IN
            SELECT s FROM jsonb_array_elements(p_selections) s
            WHERE (s ->> 'group_id')::uuid = v_group.id
        LOOP
            IF NOT v_group.allow_repeat AND (v_selection ->> 'qty')::integer > 1 THEN
                RAISE EXCEPTION 'ADICIONAIS_REPETICAO: "%": não é permitido repetir a mesma opção.', v_group.name;
            END IF;
            SELECT o.* INTO v_option FROM public.product_options o
            WHERE o.tenant_id = p_tenant AND o.group_id = v_group.id
              AND o.id = (v_selection ->> 'option_id')::uuid
            FOR UPDATE;
            IF NOT FOUND OR NOT v_option.active THEN
                RAISE EXCEPTION 'ADICIONAL_INDISPONIVEL: Uma opção selecionada não está mais disponível.';
            END IF;
            IF v_option.sold_out THEN
                RAISE EXCEPTION 'ADICIONAL_ESGOTADO: "%" está esgotado. Remova-o para continuar.', v_option.name;
            END IF;
            v_selected_ids := array_append(v_selected_ids, v_option.id);
            FOR v_i IN 1..(v_selection ->> 'qty')::integer LOOP
                v_prices := array_append(v_prices, v_option.extra_price_cents);
                v_sum := v_sum + v_option.extra_price_cents;
                v_count := v_count + 1;
                v_max := GREATEST(v_max, v_option.extra_price_cents);
            END LOOP;
        END LOOP;
        IF v_group.type = 'FLAVOR_SPLIT' AND v_group.pricing_rule = 'HIGHEST' THEN
            v_group_cents := v_max;
        ELSIF v_group.type = 'FLAVOR_SPLIT' AND v_group.pricing_rule = 'AVERAGE' AND v_count > 0 THEN
            v_group_cents := round(v_sum::numeric / v_count)::integer;
        ELSE
            v_group_cents := v_sum::integer;
        END IF;
        v_total := v_total + v_group_cents;
    END LOOP;
    RETURN v_total;
END;
$$;

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

REVOKE ALL ON FUNCTION public._product_option_selection_price(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._product_option_snapshot_after_order_item() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS order_item_product_options_snapshot ON public.order_items;
CREATE TRIGGER order_item_product_options_snapshot
    AFTER INSERT ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION public._product_option_snapshot_after_order_item();

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

CREATE OR REPLACE FUNCTION public.set_product_option_group_links(p_tenant_id uuid, p_product_id uuid, p_group_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_group uuid;
    v_sort integer := 0;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_tenant_scoped_role(p_tenant_id, ARRAY['OWNER','MANAGER']) THEN
        RAISE EXCEPTION 'FORBIDDEN: somente OWNER ou MANAGER pode editar o cardápio.' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = p_product_id AND p.tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND: produto não encontrado nesta loja.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM unnest(COALESCE(p_group_ids, ARRAY[]::uuid[])) ids(group_id)
        WHERE NOT EXISTS (SELECT 1 FROM public.product_option_groups g WHERE g.id = ids.group_id AND g.tenant_id = p_tenant_id)
    ) THEN RAISE EXCEPTION 'GROUP_TENANT_MISMATCH: grupo inválido para esta loja.'; END IF;
    DELETE FROM public.product_option_group_links WHERE tenant_id = p_tenant_id AND product_id = p_product_id;
    FOREACH v_group IN ARRAY COALESCE(p_group_ids, ARRAY[]::uuid[]) LOOP
        INSERT INTO public.product_option_group_links (tenant_id, product_id, group_id, sort)
        VALUES (p_tenant_id, p_product_id, v_group, v_sort);
        v_sort := v_sort + 1;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.change_product_option_price(p_tenant_id uuid, p_option_id uuid, p_delta_cents integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_tenant_scoped_role(p_tenant_id, ARRAY['OWNER','MANAGER']) THEN
        RAISE EXCEPTION 'FORBIDDEN: somente OWNER ou MANAGER pode editar o cardápio.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.product_options SET extra_price_cents = extra_price_cents + p_delta_cents
    WHERE tenant_id = p_tenant_id AND id = p_option_id AND extra_price_cents + p_delta_cents >= 0;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.change_product_options_price(p_tenant_id uuid, p_option_ids uuid[], p_delta_cents integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count integer;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_tenant_scoped_role(p_tenant_id, ARRAY['OWNER','MANAGER']) THEN
        RAISE EXCEPTION 'FORBIDDEN: somente OWNER ou MANAGER pode editar o cardápio.' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(array_length(p_option_ids, 1), 0) = 0 OR p_delta_cents IS NULL THEN
        RAISE EXCEPTION 'OPTION_PRICE_INVALID: selecione opções e informe a alteração em centavos.';
    END IF;
    UPDATE public.product_options
    SET extra_price_cents = extra_price_cents + p_delta_cents
    WHERE tenant_id = p_tenant_id AND id = ANY(p_option_ids)
      AND extra_price_cents + p_delta_cents >= 0;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> (SELECT count(DISTINCT selected.option_id) FROM unnest(p_option_ids) AS selected(option_id)) THEN
        RAISE EXCEPTION 'OPTION_PRICE_INVALID: o preço não pode ficar negativo ou há opção inválida.';
    END IF;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_product_option_group_links(uuid, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_option_group_links(uuid, uuid, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.change_product_option_price(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_product_option_price(uuid, uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.change_product_options_price(uuid, uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_product_options_price(uuid, uuid[], integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_checkout_atomic_v3(
    p_tenant_slug text, p_customer_name text, p_customer_phone text, p_delivery_address text, p_address_details jsonb,
    p_payment_method text, p_fulfillment_type text, p_notes text, p_items jsonb,
    p_coupon_code text DEFAULT NULL, p_idempotency_key uuid DEFAULT NULL, p_card_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN public._checkout_core(
      p_tenant_slug, p_customer_name, p_customer_phone, p_delivery_address, p_address_details,
      p_payment_method, p_fulfillment_type, p_notes, 'storefront', p_items,
      p_coupon_code, p_idempotency_key, p_card_id, NULL
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_pos_sale_atomic_v2(
    p_tenant_id uuid, p_items jsonb, p_payment_method text, p_customer_name text DEFAULT NULL,
    p_customer_phone text DEFAULT NULL, p_customer_id uuid DEFAULT NULL, p_coupon_code text DEFAULT NULL,
    p_idempotency_key uuid DEFAULT NULL, p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN public.process_pos_sale_atomic(
      p_tenant_id, p_items, p_payment_method, p_customer_name, p_customer_phone,
      p_customer_id, p_coupon_code, p_idempotency_key, p_notes
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_order_by_id(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_order record;
    v_items jsonb;
    v_history jsonb;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.' USING ERRCODE = '42501';
    END IF;
    IF NOT public._rate_limit_hit('customer_order_read', public._sha256_hex(v_user_id::text), NULL, 120, 60) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas consultas; tente novamente em instantes.';
    END IF;
    SELECT o.id, o.order_number, o.customer_name, o.customer_phone, o.customer_email, o.delivery_address,
           o.address_details, o.subtotal, o.delivery_fee, o.discount, o.total_amount, o.payment_method,
           o.payment_status, o.fulfillment_type, o.status, o.notes, o.prep_time_minutes, o.created_at, o.updated_at,
           o.tenant_id
    INTO v_order
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
    WHERE o.id = p_order_id AND c.user_id = v_user_id;
    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado ou acesso não autorizado.' USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'productId', oi.product_id, 'productName', oi.product_name, 'quantity', oi.quantity,
        'unitPrice', oi.unit_price, 'totalPrice', oi.total_price, 'notes', oi.notes, 'unit', oi.unit,
        'options', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'groupId', oio.group_id, 'optionId', oio.option_id,
                'groupName', oio.group_name_snapshot, 'optionName', oio.option_name_snapshot,
                'qty', oio.qty, 'unitPriceCents', oio.unit_price_cents, 'fraction', oio.fraction
            ) ORDER BY oio.id)
            FROM public.order_item_options oio
            WHERE oio.tenant_id = v_order.tenant_id AND oio.order_item_id = oi.id
        ), '[]'::jsonb)
    ) ORDER BY oi.id), '[]'::jsonb)
    INTO v_items FROM public.order_items oi WHERE oi.order_id = v_order.id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('status', osh.status, 'timestamp', osh.created_at)
        ORDER BY osh.created_at ASC), '[]'::jsonb)
    INTO v_history FROM public.order_status_history osh WHERE osh.order_id = v_order.id;
    RETURN jsonb_build_object(
        'id', v_order.id, 'orderNumber', v_order.order_number,
        'customerName', v_order.customer_name, 'customerPhone', v_order.customer_phone,
        'customerEmail', v_order.customer_email, 'deliveryAddress', v_order.delivery_address,
        'addressDetails', v_order.address_details, 'subtotal', v_order.subtotal, 'deliveryFee', v_order.delivery_fee,
        'discount', v_order.discount, 'totalAmount', v_order.total_amount, 'paymentMethod', v_order.payment_method,
        'paymentStatus', v_order.payment_status, 'fulfillmentType', v_order.fulfillment_type,
        'status', v_order.status, 'notes', v_order.notes, 'prepTimeMinutes', v_order.prep_time_minutes,
        'items', v_items, 'statusHistory', v_history, 'createdAt', v_order.created_at, 'updatedAt', v_order.updated_at
    );
END;
$$;

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

REVOKE ALL ON FUNCTION public.get_customer_order_by_id(uuid), public.kitchen_list_orders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_order_by_id(uuid), public.kitchen_list_orders(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.process_checkout_atomic_v3(text,text,text,text,jsonb,text,text,text,jsonb,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_checkout_atomic_v3(text,text,text,text,jsonb,text,text,text,jsonb,text,uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.process_pos_sale_atomic_v2(uuid,jsonb,text,text,text,uuid,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_pos_sale_atomic_v2(uuid,jsonb,text,text,text,uuid,text,uuid,text) TO authenticated;

COMMIT;
