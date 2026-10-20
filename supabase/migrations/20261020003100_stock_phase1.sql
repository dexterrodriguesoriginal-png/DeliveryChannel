BEGIN;

ALTER TABLE public.products
    ALTER COLUMN stock_quantity TYPE numeric(14,3) USING stock_quantity::numeric(14,3),
    ADD COLUMN stock_unit varchar(2) NOT NULL DEFAULT 'un'
        CHECK (stock_unit IN ('un', 'kg', 'g', 'l', 'ml')),
    ADD COLUMN     min_stock numeric(14,3) NOT NULL DEFAULT 5 CHECK (min_stock >= 0),
    ADD COLUMN safety_stock numeric(14,3) NOT NULL DEFAULT 0 CHECK (safety_stock >= 0),
    ADD COLUMN track_lots boolean NOT NULL DEFAULT false,
    ADD COLUMN stock_is_resale boolean NOT NULL DEFAULT false;

UPDATE public.products
SET stock_unit = CASE WHEN lower(unit) IN ('un', 'kg', 'g', 'l', 'ml') THEN lower(unit) ELSE 'un' END,
    min_stock = GREATEST(COALESCE(min_stock_alert, 0), 0);

ALTER TABLE public.products
    ADD CONSTRAINT products_tenant_id_id_stock_key UNIQUE (tenant_id, id);

CREATE OR REPLACE FUNCTION public._stock_product_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' AND lower(NEW.unit) IN ('un', 'kg', 'g', 'l', 'ml')
       AND NEW.stock_unit = 'un' THEN
        NEW.stock_unit := lower(NEW.unit);
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.min_stock := GREATEST(COALESCE(NEW.min_stock_alert, 5), 0);
    ELSIF NEW.min_stock_alert IS DISTINCT FROM OLD.min_stock_alert
          AND NEW.min_stock IS NOT DISTINCT FROM OLD.min_stock THEN
        NEW.min_stock := GREATEST(COALESCE(NEW.min_stock_alert, 5), 0);
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER stock_product_defaults
    BEFORE INSERT OR UPDATE OF unit, min_stock_alert ON public.products
    FOR EACH ROW EXECUTE FUNCTION public._stock_product_defaults();

CREATE TABLE public.stock_locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name varchar(120) NOT NULL,
    is_default boolean NOT NULL DEFAULT false,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stock_locations_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT stock_locations_tenant_name_key UNIQUE (tenant_id, name)
);
CREATE UNIQUE INDEX stock_locations_one_default_per_tenant
    ON public.stock_locations (tenant_id) WHERE is_default;

CREATE TABLE public.stock_lots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    product_id uuid NOT NULL,
    lot_code varchar(100) NOT NULL,
    expires_on date,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stock_lots_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT stock_lots_product_fk FOREIGN KEY (tenant_id, product_id)
        REFERENCES public.products (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT stock_lots_product_code_key UNIQUE (tenant_id, product_id, lot_code)
);

INSERT INTO public.stock_locations (tenant_id, name, is_default)
SELECT id, 'Estoque principal', true FROM public.tenants
ON CONFLICT (tenant_id, name) DO NOTHING;

ALTER TABLE public.inventory_movements
    ALTER COLUMN quantity TYPE numeric(14,3) USING quantity::numeric(14,3),
    ALTER COLUMN previous_stock TYPE numeric(14,3) USING previous_stock::numeric(14,3),
    ALTER COLUMN new_stock TYPE numeric(14,3) USING new_stock::numeric(14,3),
    DROP CONSTRAINT inventory_movements_type_check,
    ADD CONSTRAINT inventory_movements_type_check CHECK (type IN (
        'ENTRADA', 'SAIDA', 'VENDA', 'ESTORNO', 'AJUSTE', 'PERDA',
        'OPENING_BALANCE', 'RECEIPT', 'RESERVATION', 'SALE', 'CONSUMPTION',
        'CANCEL_RELEASE', 'CUSTOMER_RETURN', 'LOSS', 'DAMAGE', 'EXPIRY',
        'COUNT_ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'WEIGHT_CORRECTION'
    )),
    ADD COLUMN location_id uuid,
    ADD COLUMN unit varchar(2) NOT NULL DEFAULT 'un' CHECK (unit IN ('un', 'kg', 'g', 'l', 'ml')),
    ADD COLUMN actor_user_id uuid,
    ADD COLUMN supplier_reference text,
    ADD COLUMN lot_id uuid,
    ADD COLUMN order_id uuid,
    ADD CONSTRAINT inventory_movements_location_fk FOREIGN KEY (tenant_id, location_id)
        REFERENCES public.stock_locations (tenant_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT inventory_movements_lot_fk FOREIGN KEY (tenant_id, lot_id)
        REFERENCES public.stock_lots (tenant_id, id) ON DELETE RESTRICT;
-- order_id is a soft reference (like reference_id): the ledger is append-only and must
-- survive the owner's existing "delete CANCELLED order" flow, so no FK to orders here.

CREATE INDEX inventory_movements_location_time_idx
    ON public.inventory_movements (tenant_id, location_id, created_at DESC);
CREATE INDEX inventory_movements_order_idx
    ON public.inventory_movements (tenant_id, order_id) WHERE order_id IS NOT NULL;
CREATE INDEX inventory_movements_lot_idx
    ON public.inventory_movements (tenant_id, lot_id) WHERE lot_id IS NOT NULL;

CREATE TABLE public.stock_phase1_acl_snapshot (
    grantee text NOT NULL,
    privilege_type text NOT NULL,
    is_grantable boolean NOT NULL,
    PRIMARY KEY (grantee, privilege_type)
);
INSERT INTO public.stock_phase1_acl_snapshot (grantee, privilege_type, is_grantable)
SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
       acl.privilege_type, acl.is_grantable
FROM pg_class relation
CROSS JOIN LATERAL aclexplode(relation.relacl) acl
WHERE relation.oid = 'public.inventory_movements'::regclass
  AND acl.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid);
REVOKE ALL ON public.stock_phase1_acl_snapshot FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.stock_phase1_acl_snapshot ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.stock_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    order_id uuid NOT NULL,
    order_item_id uuid NOT NULL UNIQUE,
    product_id uuid NOT NULL,
    location_id uuid NOT NULL,
    quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
    unit varchar(2) NOT NULL CHECK (unit IN ('un', 'kg', 'g', 'l', 'ml')),
    status varchar(12) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED', 'CONVERTED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    CONSTRAINT stock_reservations_order_fk FOREIGN KEY (tenant_id, order_id)
        REFERENCES public.orders (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT stock_reservations_item_fk FOREIGN KEY (order_item_id)
        REFERENCES public.order_items (id) ON DELETE CASCADE,
    CONSTRAINT stock_reservations_product_fk FOREIGN KEY (tenant_id, product_id)
        REFERENCES public.products (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT stock_reservations_location_fk FOREIGN KEY (tenant_id, location_id)
        REFERENCES public.stock_locations (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX stock_reservations_active_product_idx
    ON public.stock_reservations (tenant_id, product_id, location_id)
    WHERE status = 'ACTIVE';

CREATE TABLE public.stock_incoming (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    product_id uuid NOT NULL,
    quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
    unit varchar(2) NOT NULL CHECK (unit IN ('un', 'kg', 'g', 'l', 'ml')),
    unit_cost numeric(10,2) NOT NULL CHECK (unit_cost >= 0),
    supplier_reference text NOT NULL,
    expected_at date,
    status varchar(12) NOT NULL DEFAULT 'CONFIRMED'
        CHECK (status IN ('CONFIRMED', 'RECEIVED', 'CANCELLED')),
    created_by uuid NOT NULL REFERENCES public.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    received_at timestamptz,
    CONSTRAINT stock_incoming_product_fk FOREIGN KEY (tenant_id, product_id)
        REFERENCES public.products (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX stock_incoming_confirmed_idx
    ON public.stock_incoming (tenant_id, product_id) WHERE status = 'CONFIRMED';

CREATE TABLE public.stock_counts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    location_id uuid NOT NULL,
    status varchar(12) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    submitted_by uuid NOT NULL REFERENCES public.users(id),
    approved_by uuid REFERENCES public.users(id),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    approved_at timestamptz,
    CONSTRAINT stock_counts_location_fk FOREIGN KEY (tenant_id, location_id)
        REFERENCES public.stock_locations (tenant_id, id) ON DELETE RESTRICT
);
CREATE TABLE public.stock_count_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    count_id uuid NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
    product_id uuid NOT NULL,
    expected_quantity numeric(14,3) NOT NULL,
    counted_quantity numeric(14,3) NOT NULL CHECK (counted_quantity >= 0),
    unit varchar(2) NOT NULL CHECK (unit IN ('un', 'kg', 'g', 'l', 'ml')),
    CONSTRAINT stock_count_items_product_fk FOREIGN KEY (tenant_id, product_id)
        REFERENCES public.products (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT stock_count_items_count_product_key UNIQUE (count_id, product_id)
);

CREATE TABLE public.stock_blocks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    product_id uuid NOT NULL,
    location_id uuid NOT NULL,
    quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
    reason text NOT NULL CHECK (length(btrim(reason)) > 0),
    status varchar(8) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED')),
    created_by uuid NOT NULL REFERENCES public.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    released_at timestamptz,
    CONSTRAINT stock_blocks_product_fk FOREIGN KEY (tenant_id, product_id)
        REFERENCES public.products (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT stock_blocks_location_fk FOREIGN KEY (tenant_id, location_id)
        REFERENCES public.stock_locations (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX stock_blocks_active_idx ON public.stock_blocks (tenant_id, product_id, location_id)
    WHERE status = 'ACTIVE';

CREATE OR REPLACE FUNCTION public._stock_default_location(p_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT id FROM public.stock_locations
    WHERE tenant_id = p_tenant_id AND is_default AND active
    LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public._stock_create_default_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.stock_locations (tenant_id, name, is_default)
    VALUES (NEW.id, 'Estoque principal', true);
    RETURN NEW;
END
$$;
CREATE TRIGGER stock_tenant_default_location
    AFTER INSERT ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public._stock_create_default_location();

CREATE OR REPLACE FUNCTION public._stock_prepare_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_product public.products%ROWTYPE;
BEGIN
    SELECT * INTO v_product FROM public.products
    WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'STOCK_PRODUCT_NOT_FOUND';
    END IF;
    NEW.location_id := COALESCE(NEW.location_id, public._stock_default_location(NEW.tenant_id));
    NEW.unit := COALESCE(NULLIF(NEW.unit, 'un'), v_product.stock_unit);
    NEW.actor_user_id := COALESCE(NEW.actor_user_id, auth.uid());
    IF NEW.order_id IS NULL AND NEW.type IN ('VENDA', 'ESTORNO', 'SALE', 'CANCEL_RELEASE') THEN
        SELECT o.id INTO NEW.order_id FROM public.orders o
        WHERE o.tenant_id = NEW.tenant_id AND o.id::text = NEW.reference_id;
    END IF;
    IF NEW.type IN ('LOSS', 'DAMAGE', 'EXPIRY', 'PERDA') AND length(btrim(COALESCE(NEW.reason, ''))) = 0 THEN
        RAISE EXCEPTION 'STOCK_REASON_REQUIRED';
    END IF;
    IF v_product.track_lots AND NEW.type IN ('RECEIPT', 'LOSS', 'DAMAGE', 'EXPIRY', 'PERDA')
       AND NEW.lot_id IS NULL THEN
        RAISE EXCEPTION 'STOCK_LOT_REQUIRED';
    END IF;
    IF NEW.location_id IS NULL THEN
        RAISE EXCEPTION 'STOCK_DEFAULT_LOCATION_NOT_FOUND';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER stock_movement_prepare
    BEFORE INSERT ON public.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION public._stock_prepare_movement();

CREATE OR REPLACE FUNCTION public._stock_open_product_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.inventory_movements
        (tenant_id, product_id, product_name, quantity, type, reason, previous_stock, new_stock,
         created_by_name, location_id, unit, actor_user_id)
    VALUES (NEW.tenant_id, NEW.id, NEW.name, NEW.stock_quantity, 'OPENING_BALANCE',
            'Saldo inicial do produto', NEW.stock_quantity, NEW.stock_quantity,
            'Cadastro de produto', public._stock_default_location(NEW.tenant_id), NEW.stock_unit, auth.uid());
    RETURN NEW;
END
$$;
CREATE TRIGGER stock_product_opening_balance
    AFTER INSERT ON public.products
    FOR EACH ROW EXECUTE FUNCTION public._stock_open_product_balance();

CREATE OR REPLACE FUNCTION public._stock_reject_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'STOCK_LEDGER_APPEND_ONLY: corrections require a reversal movement';
END
$$;
CREATE TRIGGER stock_movement_append_only
    BEFORE UPDATE OR DELETE ON public.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION public._stock_reject_movement_mutation();

CREATE OR REPLACE FUNCTION public._stock_reserve_legacy_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_order_id uuid;
    v_order_status text;
    v_default_location uuid;
BEGIN
    IF NEW.type NOT IN ('VENDA', 'SALE') THEN
        RETURN NEW;
    END IF;
    BEGIN
        v_order_id := COALESCE(NEW.order_id, NULLIF(NEW.reference_id, '')::uuid);
    EXCEPTION WHEN invalid_text_representation THEN
        RETURN NEW;
    END;
    SELECT status INTO v_order_status FROM public.orders
    WHERE id = v_order_id AND tenant_id = NEW.tenant_id;
    IF v_order_status IS NULL OR v_order_status IN ('DELIVERED', 'CANCELLED') THEN
        RETURN NEW;
    END IF;
    v_default_location := COALESCE(NEW.location_id, public._stock_default_location(NEW.tenant_id));
    INSERT INTO public.stock_reservations
        (tenant_id, order_id, order_item_id, product_id, location_id, quantity, unit)
    SELECT NEW.tenant_id, v_order_id, oi.id, oi.product_id, v_default_location, oi.quantity, p.stock_unit
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id AND p.tenant_id = NEW.tenant_id
    WHERE oi.order_id = v_order_id AND oi.product_id = NEW.product_id
    ON CONFLICT (order_item_id) DO NOTHING;
    RETURN NEW;
END
$$;
CREATE TRIGGER stock_reserve_legacy_sale
    AFTER INSERT ON public.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION public._stock_reserve_legacy_sale();

CREATE OR REPLACE FUNCTION public._stock_order_reservation_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_item record;
    v_product public.products%ROWTYPE;
    v_reservation public.stock_reservations%ROWTYPE;
    v_location uuid;
    v_actor text;
    v_restore numeric(14,3);
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'CONFIRMED' AND OLD.status = 'PENDING' THEN
        v_location := public._stock_default_location(NEW.tenant_id);
        SELECT COALESCE(NULLIF(name, ''), email, 'Equipe') INTO v_actor
        FROM public.users WHERE id = auth.uid();
        FOR v_item IN SELECT oi.id, oi.product_id, oi.quantity, p.name, p.stock_unit
            FROM public.order_items oi
            JOIN public.products p ON p.id = oi.product_id AND p.tenant_id = NEW.tenant_id
            WHERE oi.order_id = NEW.id
            ORDER BY oi.product_id
        LOOP
            IF EXISTS (SELECT 1 FROM public.stock_reservations
                       WHERE order_item_id = v_item.id AND status = 'ACTIVE') THEN
                CONTINUE;
            END IF;
            SELECT * INTO v_product FROM public.products
            WHERE id = v_item.product_id AND tenant_id = NEW.tenant_id FOR UPDATE;
            IF v_product.stock_quantity < v_item.quantity THEN
                RAISE EXCEPTION 'OUT_OF_STOCK: produto "%"; disponível %, solicitado %',
                    v_product.name, v_product.stock_quantity, v_item.quantity;
            END IF;
            UPDATE public.products
            SET stock_quantity = stock_quantity - v_item.quantity, updated_at = now()
            WHERE id = v_item.product_id AND tenant_id = NEW.tenant_id;
            INSERT INTO public.inventory_movements
                (tenant_id, product_id, product_name, quantity, type, reference_id, order_id, reason,
                 previous_stock, new_stock, created_by_name, location_id, unit, actor_user_id)
            VALUES (NEW.tenant_id, v_item.product_id, v_product.name, -v_item.quantity,
                    'RESERVATION', NEW.id::text, NEW.id, 'Reserva atômica na aceitação do pedido',
                    v_product.stock_quantity, v_product.stock_quantity - v_item.quantity,
                    COALESCE(v_actor, 'Sistema'), v_location, v_product.stock_unit, auth.uid());
            INSERT INTO public.stock_reservations
                (tenant_id, order_id, order_item_id, product_id, location_id, quantity, unit, status, closed_at)
            VALUES (NEW.tenant_id, NEW.id, v_item.id, v_item.product_id, v_location,
                    v_item.quantity, v_product.stock_unit, 'ACTIVE', NULL)
            ON CONFLICT (order_item_id) DO UPDATE
                SET status = 'ACTIVE', quantity = EXCLUDED.quantity, closed_at = NULL,
                    location_id = EXCLUDED.location_id, created_at = now()
                WHERE public.stock_reservations.status = 'RELEASED';
        END LOOP;
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'CANCELLED' THEN
        FOR v_reservation IN SELECT * FROM public.stock_reservations
            WHERE tenant_id = NEW.tenant_id AND order_id = NEW.id AND status = 'ACTIVE'
            FOR UPDATE
        LOOP
            SELECT * INTO v_product FROM public.products
            WHERE id = v_reservation.product_id AND tenant_id = NEW.tenant_id FOR UPDATE;
            v_restore := CASE WHEN EXISTS (
                SELECT 1 FROM public.inventory_movements e
                WHERE e.tenant_id = NEW.tenant_id AND e.reference_id = NEW.id::text
                  AND e.type = 'ESTORNO' AND e.created_at < v_reservation.created_at
            ) THEN v_reservation.quantity ELSE 0 END;
            IF v_restore > 0 THEN
                UPDATE public.products SET stock_quantity = stock_quantity + v_restore, updated_at = now()
                WHERE id = v_reservation.product_id AND tenant_id = NEW.tenant_id;
            END IF;
            INSERT INTO public.inventory_movements
                (tenant_id, product_id, product_name, quantity, type, reference_id, order_id, reason,
                 previous_stock, new_stock, created_by_name, location_id, unit, actor_user_id)
            VALUES (NEW.tenant_id, v_reservation.product_id, v_product.name, v_restore,
                    'CANCEL_RELEASE', NEW.id::text, NEW.id, 'Reserva liberada pelo cancelamento do pedido',
                    v_product.stock_quantity, v_product.stock_quantity + v_restore, 'Sistema',
                    v_reservation.location_id, v_reservation.unit, auth.uid());
            UPDATE public.stock_reservations SET status = 'RELEASED', closed_at = now()
            WHERE id = v_reservation.id;
        END LOOP;
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'DELIVERED' THEN
        FOR v_reservation IN SELECT * FROM public.stock_reservations
            WHERE tenant_id = NEW.tenant_id AND order_id = NEW.id AND status = 'ACTIVE'
            FOR UPDATE
        LOOP
            SELECT * INTO v_product FROM public.products
            WHERE id = v_reservation.product_id AND tenant_id = NEW.tenant_id;
            INSERT INTO public.inventory_movements
                (tenant_id, product_id, product_name, quantity, type, reference_id, order_id, reason,
                 previous_stock, new_stock, created_by_name, location_id, unit, actor_user_id)
            VALUES (NEW.tenant_id, v_reservation.product_id, v_product.name, 0,
                    'SALE', NEW.id::text, NEW.id, 'Reserva convertida em venda na conclusão do pedido',
                    v_product.stock_quantity, v_product.stock_quantity, 'Sistema',
                    v_reservation.location_id, v_reservation.unit, auth.uid());
            UPDATE public.stock_reservations SET status = 'CONVERTED', closed_at = now()
            WHERE id = v_reservation.id;
        END LOOP;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER stock_order_reservation_lifecycle
    AFTER UPDATE OF status ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public._stock_order_reservation_lifecycle();

CREATE OR REPLACE FUNCTION public.stock_expire_pending_reservations(p_tenant_id uuid, p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_reservation record;
    v_product public.products%ROWTYPE;
    v_actor text;
    v_released integer := 0;
BEGIN
    IF NOT public._stock_manager(p_tenant_id) THEN
        RAISE EXCEPTION 'STOCK_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_order FROM public.orders
    WHERE tenant_id = p_tenant_id AND id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.status <> 'PENDING' OR v_order.created_at > now() - interval '30 minutes' THEN
        RAISE EXCEPTION 'STOCK_ORDER_NOT_EXPIRED';
    END IF;
    SELECT COALESCE(NULLIF(name, ''), email, 'Equipe') INTO v_actor
    FROM public.users WHERE id = auth.uid();
    FOR v_reservation IN SELECT * FROM public.stock_reservations
        WHERE tenant_id = p_tenant_id AND order_id = p_order_id AND status = 'ACTIVE'
        ORDER BY product_id FOR UPDATE
    LOOP
        SELECT * INTO v_product FROM public.products
        WHERE id = v_reservation.product_id AND tenant_id = p_tenant_id FOR UPDATE;
        UPDATE public.products SET stock_quantity = stock_quantity + v_reservation.quantity, updated_at = now()
        WHERE id = v_reservation.product_id AND tenant_id = p_tenant_id;
        INSERT INTO public.inventory_movements
            (tenant_id, product_id, product_name, quantity, type, reference_id, order_id, reason,
             previous_stock, new_stock, created_by_name, location_id, unit, actor_user_id)
        VALUES (p_tenant_id, v_reservation.product_id, v_product.name, v_reservation.quantity,
                'ESTORNO', p_order_id::text, p_order_id,
                'Liberação de reserva após expiração do pedido pendente',
                v_product.stock_quantity, v_product.stock_quantity + v_reservation.quantity,
                COALESCE(v_actor, 'Equipe'), v_reservation.location_id, v_reservation.unit, auth.uid());
        UPDATE public.stock_reservations SET status = 'RELEASED', closed_at = now()
        WHERE id = v_reservation.id;
        v_released := v_released + 1;
    END LOOP;
    RETURN jsonb_build_object('released', v_released);
END
$$;

INSERT INTO public.inventory_movements
    (tenant_id, product_id, product_name, quantity, type, reason, previous_stock, new_stock,
     created_by_name, location_id, unit)
SELECT p.tenant_id, p.id, p.name, p.stock_quantity, 'OPENING_BALANCE',
       'Saldo inicial migrado de products.stock_quantity; quantidade não alterada.',
       p.stock_quantity, p.stock_quantity, 'Migração Estoque Fase 1',
       public._stock_default_location(p.tenant_id), p.stock_unit
FROM public.products p
WHERE NOT EXISTS (
    SELECT 1 FROM public.inventory_movements m
    WHERE m.tenant_id = p.tenant_id AND m.product_id = p.id AND m.type = 'OPENING_BALANCE'
);

INSERT INTO public.stock_reservations
    (tenant_id, order_id, order_item_id, product_id, location_id, quantity, unit)
SELECT o.tenant_id, o.id, oi.id, oi.product_id, public._stock_default_location(o.tenant_id),
       oi.quantity, p.stock_unit
FROM public.orders o
JOIN public.order_items oi ON oi.order_id = o.id
JOIN public.products p ON p.id = oi.product_id AND p.tenant_id = o.tenant_id
WHERE o.status NOT IN ('DELIVERED', 'CANCELLED')
  AND EXISTS (SELECT 1 FROM public.inventory_movements m
              WHERE m.tenant_id = o.tenant_id AND m.order_id = o.id
                 OR (m.tenant_id = o.tenant_id AND m.reference_id = o.id::text AND m.type IN ('VENDA','SALE')))
ON CONFLICT (order_item_id) DO NOTHING;

CREATE VIEW public.stock_location_balances
WITH (security_barrier = true, security_invoker = true)
AS
SELECT l.tenant_id,
       l.id AS location_id,
       p.id AS product_id,
       p.name AS product_name,
       p.stock_unit AS unit,
       p.stock_quantity AS legacy_total,
       COALESCE((
           SELECT sum(m.quantity)
           FROM public.inventory_movements m
           WHERE m.tenant_id = p.tenant_id AND m.product_id = p.id
             AND m.location_id = l.id AND m.created_at >= l.created_at
       ), 0)::numeric(14,3) AS ledger_quantity,
       COALESCE((
           SELECT sum(r.quantity) FROM public.stock_reservations r
           WHERE r.tenant_id = p.tenant_id AND r.product_id = p.id
             AND r.location_id = l.id AND r.status = 'ACTIVE'
       ), 0)::numeric(14,3) AS reserved_quantity,
       COALESCE((
           SELECT sum(b.quantity) FROM public.stock_blocks b
           WHERE b.tenant_id = p.tenant_id AND b.product_id = p.id
             AND b.location_id = l.id AND b.status = 'ACTIVE'
       ), 0)::numeric(14,3) AS blocked_quantity,
       (COALESCE((
           SELECT sum(m.quantity) FROM public.inventory_movements m
           WHERE m.tenant_id = p.tenant_id AND m.product_id = p.id
             AND m.location_id = l.id AND m.created_at >= l.created_at
       ), 0) + COALESCE((
           SELECT sum(r.quantity) FROM public.stock_reservations r
           WHERE r.tenant_id = p.tenant_id AND r.product_id = p.id
             AND r.location_id = l.id AND r.status = 'ACTIVE'
       ), 0))::numeric(14,3) AS physical_quantity,
       (COALESCE((
           SELECT sum(m.quantity) FROM public.inventory_movements m
           WHERE m.tenant_id = p.tenant_id AND m.product_id = p.id
             AND m.location_id = l.id AND m.created_at >= l.created_at
       ), 0) - COALESCE((
           SELECT sum(b.quantity) FROM public.stock_blocks b
           WHERE b.tenant_id = p.tenant_id AND b.product_id = p.id
             AND b.location_id = l.id AND b.status = 'ACTIVE'
       ), 0))::numeric(14,3) AS available_quantity,
       p.min_stock,
       p.safety_stock,
       p.track_lots,
       p.stock_is_resale,
       p.is_active,
       p.cost_price
FROM public.stock_locations l
JOIN public.products p ON p.tenant_id = l.tenant_id
WHERE l.active;

CREATE OR REPLACE FUNCTION public._stock_staff(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT auth.uid() IS NOT NULL AND public.has_tenant_role(
        auth.uid(), p_tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']
    )
$$;

CREATE OR REPLACE FUNCTION public._stock_manager(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT auth.uid() IS NOT NULL AND public.has_tenant_role(
        auth.uid(), p_tenant_id, ARRAY['OWNER','MANAGER']
    )
$$;

CREATE OR REPLACE FUNCTION public.stock_dashboard(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rows jsonb;
    v_alerts jsonb;
    v_locations jsonb;
    v_summary jsonb;
    v_category text;
BEGIN
    IF NOT public._stock_staff(p_tenant_id) THEN
        RAISE EXCEPTION 'STOCK_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    SELECT category INTO v_category FROM public.tenants WHERE id = p_tenant_id;
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.product_name), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT b.product_id, b.product_name, b.location_id, l.name AS location_name,
               p.sku, p.image_url, p.price,
               b.unit, b.physical_quantity, b.reserved_quantity,
               b.blocked_quantity, b.available_quantity, b.min_stock, b.safety_stock,
               b.track_lots, b.stock_is_resale, b.is_active, b.cost_price,
               COALESCE((SELECT sum(i.quantity) FROM public.stock_incoming i
                         WHERE i.tenant_id = b.tenant_id AND i.product_id = b.product_id
                           AND i.status = 'CONFIRMED'), 0)::numeric(14,3) AS incoming_quantity,
               CASE WHEN b.available_quantity <= 0 THEN 'OUT_OF_STOCK'
                    WHEN b.available_quantity <= b.min_stock THEN 'BELOW_MINIMUM'
                    ELSE 'OK' END AS stock_status
        FROM public.stock_location_balances b
        JOIN public.stock_locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
        JOIN public.products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
        WHERE b.tenant_id = p_tenant_id
          AND b.is_active
          AND (v_category <> 'SALAO_BARBEARIA' OR b.stock_is_resale)
    ) x;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'productId', b.product_id,
        'productName', b.product_name,
        'locationId', b.location_id,
        'cause', CASE WHEN b.available_quantity <= 0 THEN 'OUT_OF_STOCK' ELSE 'BELOW_MINIMUM' END,
        'suggestedAction', CASE WHEN b.available_quantity <= 0 THEN 'Registrar recebimento ou revisar pedido de compra.'
                                ELSE 'Repor até o estoque mínimo configurado.' END,
        'available', b.available_quantity,
        'minimum', b.min_stock
    ) ORDER BY b.available_quantity), '[]'::jsonb)
    INTO v_alerts
    FROM public.stock_location_balances b
    WHERE b.tenant_id = p_tenant_id AND b.is_active
      AND (v_category <> 'SALAO_BARBEARIA' OR b.stock_is_resale)
      AND b.available_quantity <= b.min_stock;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'isDefault', is_default)
                              ORDER BY is_default DESC, name), '[]'::jsonb)
    INTO v_locations FROM public.stock_locations
    WHERE tenant_id = p_tenant_id AND active;
    SELECT jsonb_build_object(
        'activeSkus', count(DISTINCT product_id) FILTER (WHERE is_active),
        'criticalStock', count(*) FILTER (WHERE is_active AND available_quantity <= min_stock),
        'inventoryValue', COALESCE(sum(GREATEST(physical_quantity, 0) * COALESCE(cost_price, 0)), 0),
        'alertCount', count(*) FILTER (WHERE is_active AND available_quantity <= min_stock)
    ) INTO v_summary
    FROM public.stock_location_balances
    WHERE tenant_id = p_tenant_id
      AND (v_category <> 'SALAO_BARBEARIA' OR stock_is_resale);
    RETURN jsonb_build_object('products', v_rows, 'alerts', v_alerts,
                              'locations', v_locations, 'summary', v_summary);
END
$$;

CREATE OR REPLACE FUNCTION public.stock_transfer(
    p_tenant_id uuid, p_product_id uuid, p_from_location uuid, p_to_location uuid,
    p_quantity numeric, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_product public.products%ROWTYPE;
    v_available numeric(14,3);
    v_actor text;
    v_reference uuid := gen_random_uuid();
BEGIN
    IF NOT public._stock_staff(p_tenant_id) THEN
        RAISE EXCEPTION 'STOCK_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 OR p_from_location = p_to_location
       OR length(btrim(COALESCE(p_reason,''))) = 0 THEN
        RAISE EXCEPTION 'STOCK_TRANSFER_INVALID';
    END IF;
    SELECT * INTO v_product FROM public.products
    WHERE id = p_product_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_PRODUCT_NOT_FOUND'; END IF;
    IF (SELECT category = 'SALAO_BARBEARIA' FROM public.tenants WHERE id = p_tenant_id)
       AND NOT v_product.stock_is_resale THEN
        RAISE EXCEPTION 'STOCK_RESALE_ONLY';
    END IF;
    SELECT available_quantity INTO v_available FROM public.stock_location_balances
    WHERE tenant_id = p_tenant_id AND product_id = p_product_id AND location_id = p_from_location;
    IF COALESCE(v_available, 0) < p_quantity THEN RAISE EXCEPTION 'STOCK_INSUFFICIENT'; END IF;
    IF (SELECT count(*) FROM public.stock_locations
        WHERE tenant_id = p_tenant_id AND active AND id IN (p_from_location,p_to_location)) <> 2 THEN
        RAISE EXCEPTION 'STOCK_LOCATION_NOT_FOUND';
    END IF;
    SELECT COALESCE(NULLIF(name, ''), email, 'Equipe') INTO v_actor
    FROM public.users WHERE id = auth.uid();
    INSERT INTO public.inventory_movements
        (tenant_id, product_id, product_name, quantity, type, reference_id, reason,
         previous_stock, new_stock, created_by_name, location_id, unit, actor_user_id)
    VALUES
        (p_tenant_id, p_product_id, v_product.name, -p_quantity, 'TRANSFER_OUT', v_reference::text,
         btrim(p_reason), v_product.stock_quantity, v_product.stock_quantity,
         COALESCE(v_actor, 'Equipe'), p_from_location, v_product.stock_unit, auth.uid()),
        (p_tenant_id, p_product_id, v_product.name, p_quantity, 'TRANSFER_IN', v_reference::text,
         btrim(p_reason), v_product.stock_quantity, v_product.stock_quantity,
         COALESCE(v_actor, 'Equipe'), p_to_location, v_product.stock_unit, auth.uid());
    RETURN jsonb_build_object('referenceId', v_reference, 'quantity', p_quantity);
END
$$;

CREATE OR REPLACE FUNCTION public.stock_correct_weight(
    p_tenant_id uuid, p_product_id uuid, p_location_id uuid, p_delta numeric,
    p_reason text, p_lot_code text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_product public.products%ROWTYPE;
    v_location uuid;
    v_lot uuid;
    v_actor text;
    v_id uuid;
BEGIN
    IF NOT public._stock_staff(p_tenant_id) THEN
        RAISE EXCEPTION 'STOCK_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_delta IS NULL OR p_delta = 0 OR length(btrim(COALESCE(p_reason,''))) = 0 THEN
        RAISE EXCEPTION 'STOCK_WEIGHT_CORRECTION_INVALID';
    END IF;
    SELECT * INTO v_product FROM public.products
    WHERE id = p_product_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_PRODUCT_NOT_FOUND'; END IF;
    IF v_product.stock_quantity + p_delta < 0 THEN RAISE EXCEPTION 'STOCK_INSUFFICIENT'; END IF;
    IF (SELECT category = 'SALAO_BARBEARIA' FROM public.tenants WHERE id = p_tenant_id)
       AND NOT v_product.stock_is_resale THEN
        RAISE EXCEPTION 'STOCK_RESALE_ONLY';
    END IF;
    v_location := COALESCE(p_location_id, public._stock_default_location(p_tenant_id));
    IF NOT EXISTS (SELECT 1 FROM public.stock_locations
                   WHERE id = v_location AND tenant_id = p_tenant_id AND active) THEN
        RAISE EXCEPTION 'STOCK_LOCATION_NOT_FOUND';
    END IF;
    IF v_product.track_lots AND p_lot_code IS NULL THEN RAISE EXCEPTION 'STOCK_LOT_REQUIRED'; END IF;
    IF p_lot_code IS NOT NULL THEN
        INSERT INTO public.stock_lots (tenant_id, product_id, lot_code)
        VALUES (p_tenant_id, p_product_id, p_lot_code)
        ON CONFLICT (tenant_id, product_id, lot_code) DO NOTHING;
        SELECT id INTO v_lot FROM public.stock_lots
        WHERE tenant_id = p_tenant_id AND product_id = p_product_id AND lot_code = p_lot_code;
    END IF;
    UPDATE public.products SET stock_quantity = stock_quantity + p_delta, updated_at = now()
    WHERE id = p_product_id AND tenant_id = p_tenant_id;
    SELECT COALESCE(NULLIF(name, ''), email, 'Equipe') INTO v_actor
    FROM public.users WHERE id = auth.uid();
    INSERT INTO public.inventory_movements
        (tenant_id, product_id, product_name, quantity, type, reference_id, reason,
         previous_stock, new_stock, created_by_name, location_id, unit, actor_user_id, lot_id)
    VALUES (p_tenant_id, p_product_id, v_product.name, p_delta, 'WEIGHT_CORRECTION', p_lot_code,
            btrim(p_reason), v_product.stock_quantity, v_product.stock_quantity + p_delta,
            COALESCE(v_actor, 'Equipe'), v_location, v_product.stock_unit, auth.uid(), v_lot)
    RETURNING id INTO v_id;
    RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.stock_update_product_settings(
    p_tenant_id uuid, p_product_id uuid, p_stock_unit text, p_min_stock numeric,
    p_safety_stock numeric, p_track_lots boolean, p_is_resale boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_product public.products%ROWTYPE;
BEGIN
    IF NOT public._stock_manager(p_tenant_id) THEN
        RAISE EXCEPTION 'STOCK_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_stock_unit NOT IN ('un','kg','g','l','ml') OR p_min_stock < 0 OR p_safety_stock < 0 THEN
        RAISE EXCEPTION 'STOCK_SETTINGS_INVALID';
    END IF;
    IF (SELECT category = 'SALAO_BARBEARIA' FROM public.tenants WHERE id = p_tenant_id)
       AND p_track_lots THEN
        RAISE EXCEPTION 'STOCK_LOTS_NOT_SUPPORTED';
    END IF;
    SELECT * INTO v_product FROM public.products
    WHERE id = p_product_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_PRODUCT_NOT_FOUND'; END IF;
    IF p_stock_unit <> v_product.stock_unit AND v_product.stock_quantity <> 0 THEN
        RAISE EXCEPTION 'STOCK_UNIT_CHANGE_REQUIRES_ZERO_BALANCE';
    END IF;
    UPDATE public.products SET stock_unit = p_stock_unit, min_stock = p_min_stock,
        safety_stock = p_safety_stock, track_lots = p_track_lots, stock_is_resale = p_is_resale,
        updated_at = now()
    WHERE id = p_product_id AND tenant_id = p_tenant_id;
END
$$;

CREATE OR REPLACE FUNCTION public.stock_set_block(
    p_tenant_id uuid, p_product_id uuid, p_location_id uuid, p_quantity numeric,
    p_reason text, p_block boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_id uuid; v_available numeric(14,3);
BEGIN
    IF NOT public._stock_manager(p_tenant_id) THEN
        RAISE EXCEPTION 'STOCK_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 OR length(btrim(COALESCE(p_reason,''))) = 0 THEN
        RAISE EXCEPTION 'STOCK_BLOCK_INVALID';
    END IF;
    IF p_block THEN
        SELECT available_quantity INTO v_available FROM public.stock_location_balances
        WHERE tenant_id = p_tenant_id AND product_id = p_product_id AND location_id = p_location_id;
        IF COALESCE(v_available,0) < p_quantity THEN RAISE EXCEPTION 'STOCK_INSUFFICIENT'; END IF;
        INSERT INTO public.stock_blocks
            (tenant_id, product_id, location_id, quantity, reason, created_by)
        VALUES (p_tenant_id, p_product_id, p_location_id, p_quantity, btrim(p_reason), auth.uid())
        RETURNING id INTO v_id;
        RETURN v_id;
    END IF;
    UPDATE public.stock_blocks SET status = 'RELEASED', released_at = now()
    WHERE id = (SELECT id FROM public.stock_blocks
                WHERE tenant_id = p_tenant_id AND product_id = p_product_id
                  AND location_id = p_location_id AND quantity = p_quantity AND status = 'ACTIVE'
                ORDER BY created_at LIMIT 1)
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'STOCK_BLOCK_NOT_FOUND'; END IF;
    RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.stock_record_movement(
    p_tenant_id uuid, p_product_id uuid, p_location_id uuid, p_type text, p_quantity numeric,
    p_reason text, p_supplier_reference text DEFAULT NULL, p_lot_code text DEFAULT NULL,
    p_order_id uuid DEFAULT NULL, p_unit_cost numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_product public.products%ROWTYPE;
    v_location uuid;
    v_lot uuid;
    v_delta numeric(14,3);
    v_previous numeric(14,3);
    v_next numeric(14,3);
    v_movement_type text;
    v_actor text;
    v_movement_id uuid;
BEGIN
    IF NOT public._stock_staff(p_tenant_id) THEN
        RAISE EXCEPTION 'STOCK_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 99999999999.999 THEN
        RAISE EXCEPTION 'STOCK_INVALID_QUANTITY';
    END IF;
    IF p_type IN ('LOSS','DAMAGE','EXPIRY','CONSUMPTION','WEIGHT_CORRECTION') AND length(btrim(COALESCE(p_reason,''))) = 0 THEN
        RAISE EXCEPTION 'STOCK_REASON_REQUIRED';
    END IF;
    SELECT * INTO v_product FROM public.products
    WHERE id = p_product_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_PRODUCT_NOT_FOUND'; END IF;
    IF (SELECT category = 'SALAO_BARBEARIA' FROM public.tenants WHERE id = p_tenant_id)
       AND NOT v_product.stock_is_resale THEN
        RAISE EXCEPTION 'STOCK_RESALE_ONLY';
    END IF;
    v_location := COALESCE(p_location_id, public._stock_default_location(p_tenant_id));
    IF NOT EXISTS (SELECT 1 FROM public.stock_locations
                   WHERE id = v_location AND tenant_id = p_tenant_id AND active) THEN
        RAISE EXCEPTION 'STOCK_LOCATION_NOT_FOUND';
    END IF;
    IF v_product.track_lots AND p_type IN ('RECEIPT','LOSS','DAMAGE','EXPIRY') AND p_lot_code IS NULL THEN
        RAISE EXCEPTION 'STOCK_LOT_REQUIRED';
    END IF;
    IF p_lot_code IS NOT NULL THEN
        INSERT INTO public.stock_lots (tenant_id, product_id, lot_code)
        VALUES (p_tenant_id, p_product_id, p_lot_code)
        ON CONFLICT (tenant_id, product_id, lot_code) DO NOTHING;
        SELECT id INTO v_lot FROM public.stock_lots
        WHERE tenant_id = p_tenant_id AND product_id = p_product_id AND lot_code = p_lot_code;
    END IF;
    v_delta := CASE WHEN p_type IN ('LOSS','DAMAGE','EXPIRY','CONSUMPTION')
                    THEN -p_quantity ELSE p_quantity END;
    v_previous := v_product.stock_quantity;
    IF v_previous + v_delta < 0 THEN RAISE EXCEPTION 'STOCK_INSUFFICIENT'; END IF;
    UPDATE public.products
    SET stock_quantity = v_previous + v_delta,
        cost_price = CASE
            WHEN p_type = 'RECEIPT' AND p_unit_cost IS NOT NULL THEN
                CASE WHEN v_previous + v_delta = 0 THEN p_unit_cost
                     ELSE round(((v_previous * COALESCE(v_product.cost_price, p_unit_cost))
                                 + (p_quantity * p_unit_cost)) / (v_previous + v_delta), 2)
                END
            ELSE cost_price
        END,
        updated_at = now()
    WHERE id = p_product_id AND tenant_id = p_tenant_id;
    v_movement_type := CASE p_type
        WHEN 'RECEIPT' THEN 'RECEIPT'
        WHEN 'LOSS' THEN 'LOSS'
        WHEN 'DAMAGE' THEN 'DAMAGE'
        WHEN 'EXPIRY' THEN 'EXPIRY'
        WHEN 'CONSUMPTION' THEN 'CONSUMPTION'
        WHEN 'CUSTOMER_RETURN' THEN 'CUSTOMER_RETURN'
        WHEN 'WEIGHT_CORRECTION' THEN 'WEIGHT_CORRECTION'
        ELSE NULL
    END;
    IF v_movement_type IS NULL THEN RAISE EXCEPTION 'STOCK_INVALID_MOVEMENT'; END IF;
    SELECT COALESCE(NULLIF(name, ''), email, 'Equipe') INTO v_actor
    FROM public.users WHERE id = auth.uid();
    INSERT INTO public.inventory_movements
        (tenant_id, product_id, product_name, quantity, type, reference_id, reason,
         previous_stock, new_stock, created_by_name, location_id, unit, actor_user_id,
         supplier_reference, lot_id, order_id)
    VALUES (p_tenant_id, p_product_id, v_product.name, v_delta, v_movement_type,
            COALESCE(p_order_id::text, p_supplier_reference), COALESCE(NULLIF(btrim(p_reason), ''), p_type),
            v_previous, v_previous + v_delta, COALESCE(v_actor, 'Equipe'), v_location,
            v_product.stock_unit, auth.uid(), p_supplier_reference, v_lot, p_order_id)
    RETURNING id INTO v_movement_id;
    RETURN jsonb_build_object('id', v_movement_id, 'previous', v_previous, 'current', v_previous + v_delta);
END
$$;

CREATE OR REPLACE FUNCTION public.stock_create_incoming(
    p_tenant_id uuid, p_product_id uuid, p_quantity numeric, p_supplier_reference text,
    p_unit_cost numeric, p_expected_at date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_product public.products%ROWTYPE; v_id uuid;
BEGIN
    IF NOT public._stock_staff(p_tenant_id) THEN
        RAISE EXCEPTION 'STOCK_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 OR p_unit_cost IS NULL OR p_unit_cost < 0
       OR length(btrim(COALESCE(p_supplier_reference,''))) = 0 THEN
        RAISE EXCEPTION 'STOCK_INCOMING_INVALID';
    END IF;
    SELECT * INTO v_product FROM public.products
    WHERE id = p_product_id AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_PRODUCT_NOT_FOUND'; END IF;
    INSERT INTO public.stock_incoming
        (tenant_id, product_id, quantity, unit, unit_cost, supplier_reference, expected_at, created_by)
    VALUES (p_tenant_id, p_product_id, p_quantity, v_product.stock_unit, p_unit_cost,
            btrim(p_supplier_reference), p_expected_at, auth.uid())
    RETURNING id INTO v_id;
    RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.stock_receive_incoming(p_incoming_id uuid, p_location_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_incoming public.stock_incoming%ROWTYPE; v_result jsonb;
BEGIN
    SELECT * INTO v_incoming FROM public.stock_incoming WHERE id = p_incoming_id FOR UPDATE;
    IF NOT FOUND OR NOT public._stock_staff(v_incoming.tenant_id) THEN
        RAISE EXCEPTION 'STOCK_INCOMING_NOT_FOUND' USING ERRCODE = '42501';
    END IF;
    IF v_incoming.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'STOCK_INCOMING_NOT_PENDING'; END IF;
    v_result := public.stock_record_movement(v_incoming.tenant_id, v_incoming.product_id, p_location_id,
        'RECEIPT', v_incoming.quantity, 'Recebimento de compra confirmada',
        v_incoming.supplier_reference, NULL, NULL, v_incoming.unit_cost);
    UPDATE public.stock_incoming SET status = 'RECEIVED', received_at = now() WHERE id = p_incoming_id;
    RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION public.stock_submit_count(
    p_tenant_id uuid, p_location_id uuid, p_counts jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count uuid; v_product record; v_expected numeric(14,3);
BEGIN
    IF NOT public._stock_staff(p_tenant_id) THEN
        RAISE EXCEPTION 'STOCK_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(p_counts) <> 'array' OR jsonb_array_length(p_counts) = 0 THEN
        RAISE EXCEPTION 'STOCK_COUNT_EMPTY';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.stock_locations
                   WHERE tenant_id = p_tenant_id AND id = p_location_id AND active) THEN
        RAISE EXCEPTION 'STOCK_LOCATION_NOT_FOUND';
    END IF;
    INSERT INTO public.stock_counts (tenant_id, location_id, submitted_by)
    VALUES (p_tenant_id, p_location_id, auth.uid()) RETURNING id INTO v_count;
    FOR v_product IN
        SELECT x.product_id, x.counted_quantity
        FROM jsonb_to_recordset(p_counts) AS x(product_id uuid, counted_quantity numeric)
    LOOP
        IF v_product.counted_quantity IS NULL OR v_product.counted_quantity < 0
           OR v_product.counted_quantity > 99999999999.999 THEN
            RAISE EXCEPTION 'STOCK_COUNT_INVALID_QUANTITY';
        END IF;
        SELECT physical_quantity INTO v_expected
        FROM public.stock_location_balances
        WHERE tenant_id = p_tenant_id AND location_id = p_location_id AND product_id = v_product.product_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_PRODUCT_NOT_FOUND'; END IF;
        INSERT INTO public.stock_count_items (tenant_id, count_id, product_id, expected_quantity, counted_quantity, unit)
        SELECT p_tenant_id, v_count, p.id, v_expected, v_product.counted_quantity, p.stock_unit
        FROM public.products p WHERE p.id = v_product.product_id AND p.tenant_id = p_tenant_id;
    END LOOP;
    RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION public.stock_approve_count(p_count_id uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count public.stock_counts%ROWTYPE; v_item record; v_product public.products%ROWTYPE;
        v_delta numeric(14,3); v_moved integer := 0; v_actor text;
BEGIN
    SELECT * INTO v_count FROM public.stock_counts WHERE id = p_count_id FOR UPDATE;
    IF NOT FOUND OR NOT public._stock_manager(v_count.tenant_id) THEN
        RAISE EXCEPTION 'STOCK_APPROVAL_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF v_count.status <> 'PENDING' THEN RAISE EXCEPTION 'STOCK_COUNT_ALREADY_REVIEWED'; END IF;
    IF NOT p_approve THEN
        UPDATE public.stock_counts SET status = 'REJECTED', approved_by = auth.uid(), approved_at = now()
        WHERE id = p_count_id;
        RETURN jsonb_build_object('status', 'REJECTED', 'adjustments', 0);
    END IF;
    FOR v_item IN SELECT * FROM public.stock_count_items
        WHERE count_id = p_count_id ORDER BY product_id FOR UPDATE
    LOOP
        SELECT physical_quantity INTO v_delta FROM public.stock_location_balances
        WHERE tenant_id = v_count.tenant_id AND location_id = v_count.location_id
          AND product_id = v_item.product_id;
        v_delta := v_item.counted_quantity - COALESCE(v_delta, 0);
        IF v_delta <> 0 THEN
            SELECT * INTO v_product FROM public.products
            WHERE id = v_item.product_id AND tenant_id = v_count.tenant_id FOR UPDATE;
            IF v_product.stock_quantity + v_delta < 0 THEN RAISE EXCEPTION 'STOCK_INSUFFICIENT'; END IF;
            UPDATE public.products SET stock_quantity = stock_quantity + v_delta, updated_at = now()
            WHERE id = v_item.product_id AND tenant_id = v_count.tenant_id;
            SELECT COALESCE(NULLIF(name, ''), email, 'Equipe') INTO v_actor FROM public.users WHERE id = auth.uid();
            INSERT INTO public.inventory_movements
                (tenant_id, product_id, product_name, quantity, type, reference_id, reason,
                 previous_stock, new_stock, created_by_name, location_id, unit, actor_user_id)
            VALUES (v_count.tenant_id, v_item.product_id, v_product.name, v_delta, 'COUNT_ADJUSTMENT',
                    p_count_id::text, COALESCE(NULLIF(btrim(p_reason), ''), 'Ajuste aprovado após contagem física'),
                    v_product.stock_quantity, v_product.stock_quantity + v_delta,
                    COALESCE(v_actor, 'Equipe'), v_count.location_id, v_item.unit, auth.uid());
            v_moved := v_moved + 1;
        END IF;
    END LOOP;
    UPDATE public.stock_counts SET status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
    WHERE id = p_count_id;
    RETURN jsonb_build_object('status', 'APPROVED', 'adjustments', v_moved);
END
$$;

CREATE OR REPLACE FUNCTION public.stock_add_location(p_tenant_id uuid, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
    IF NOT public._stock_manager(p_tenant_id) THEN
        RAISE EXCEPTION 'STOCK_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF length(btrim(COALESCE(p_name,''))) NOT BETWEEN 2 AND 120 THEN
        RAISE EXCEPTION 'STOCK_LOCATION_NAME_INVALID';
    END IF;
    INSERT INTO public.stock_locations (tenant_id, name)
    VALUES (p_tenant_id, btrim(p_name)) RETURNING id INTO v_id;
    RETURN v_id;
END
$$;

ALTER TABLE public.stock_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_incoming ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_locations_tenant_select ON public.stock_locations FOR SELECT
    USING (public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']));
CREATE POLICY stock_lots_tenant_select ON public.stock_lots FOR SELECT
    USING (public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']));
CREATE POLICY stock_reservations_tenant_select ON public.stock_reservations FOR SELECT
    USING (public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']));
CREATE POLICY stock_incoming_tenant_select ON public.stock_incoming FOR SELECT
    USING (public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']));
CREATE POLICY stock_counts_tenant_select ON public.stock_counts FOR SELECT
    USING (public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']));
CREATE POLICY stock_count_items_tenant_select ON public.stock_count_items FOR SELECT
    USING (public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']));
CREATE POLICY stock_blocks_tenant_select ON public.stock_blocks FOR SELECT
    USING (public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']));
CREATE POLICY inventory_movements_cashier_select ON public.inventory_movements FOR SELECT
    USING (public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']));

REVOKE ALL ON public.stock_locations, public.stock_lots, public.stock_reservations,
    public.stock_incoming, public.stock_counts, public.stock_count_items, public.stock_blocks,
    public.stock_location_balances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stock_locations, public.stock_lots, public.stock_reservations,
    public.stock_incoming, public.stock_counts, public.stock_count_items, public.stock_blocks,
    public.stock_location_balances TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.stock_locations,
    public.stock_lots, public.stock_reservations, public.stock_incoming, public.stock_counts,
    public.stock_count_items, public.stock_blocks, public.inventory_movements FROM anon, authenticated;
REVOKE ALL ON public.inventory_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inventory_movements TO authenticated;

REVOKE ALL ON FUNCTION public._stock_default_location(uuid),
    public._stock_create_default_location(), public._stock_product_defaults(), public._stock_open_product_balance(),
    public._stock_prepare_movement(),
    public._stock_reject_movement_mutation(), public._stock_reserve_legacy_sale(),
    public._stock_order_reservation_lifecycle(), public._stock_staff(uuid),
    public._stock_manager(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stock_dashboard(uuid),
    public.stock_record_movement(uuid,uuid,uuid,text,numeric,text,text,text,uuid,numeric),
    public.stock_create_incoming(uuid,uuid,numeric,text,numeric,date), public.stock_receive_incoming(uuid,uuid),
    public.stock_submit_count(uuid,uuid,jsonb), public.stock_approve_count(uuid,boolean,text),
    public.stock_add_location(uuid,text), public.stock_expire_pending_reservations(uuid,uuid),
    public.stock_transfer(uuid,uuid,uuid,uuid,numeric,text),
    public.stock_correct_weight(uuid,uuid,uuid,numeric,text,text),
    public.stock_update_product_settings(uuid,uuid,text,numeric,numeric,boolean,boolean),
    public.stock_set_block(uuid,uuid,uuid,numeric,text,boolean)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_dashboard(uuid),
    public.stock_record_movement(uuid,uuid,uuid,text,numeric,text,text,text,uuid,numeric),
    public.stock_create_incoming(uuid,uuid,numeric,text,numeric,date), public.stock_receive_incoming(uuid,uuid),
    public.stock_submit_count(uuid,uuid,jsonb), public.stock_approve_count(uuid,boolean,text),
    public.stock_add_location(uuid,text), public.stock_expire_pending_reservations(uuid,uuid),
    public.stock_transfer(uuid,uuid,uuid,uuid,numeric,text),
    public.stock_correct_weight(uuid,uuid,uuid,numeric,text,text),
    public.stock_update_product_settings(uuid,uuid,text,numeric,numeric,boolean,boolean),
    public.stock_set_block(uuid,uuid,uuid,numeric,text,boolean)
    TO authenticated;

DO $widen$
DECLARE r record; v_def text; v_new text;
BEGIN
    FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             JOIN pg_language l ON l.oid = p.prolang
             WHERE n.nspname = 'public' AND l.lanname = 'plpgsql' AND p.prosrc LIKE '%stock_quantity%'
               AND p.prosrc ~* '\m(v_prev|v_prev_stock|v_new_stock)\s+INT(EGER)?\s*;'
    LOOP
        v_def := pg_get_functiondef(r.oid);
        v_new := regexp_replace(v_def, '\m(v_prev|v_prev_stock|v_new_stock)(\s+)INT(EGER)?(\s*;)', '\1\2numeric(14,3)\4', 'gi');
        IF v_new <> v_def THEN EXECUTE v_new; END IF;
    END LOOP;
END
$widen$;

NOTIFY pgrst, 'reload schema';
COMMIT;
