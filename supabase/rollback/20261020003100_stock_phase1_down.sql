BEGIN;

DO $restore_inventory_acl$
DECLARE v_grant record; v_grantee text; v_option text;
BEGIN
    FOR v_grant IN SELECT grantee, privilege_type, is_grantable
                   FROM public.stock_phase1_acl_snapshot
    LOOP
        v_grantee := CASE WHEN v_grant.grantee = 'PUBLIC' THEN 'PUBLIC'
                          ELSE quote_ident(v_grant.grantee) END;
        v_option := CASE WHEN v_grant.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END;
        EXECUTE format('GRANT %s ON TABLE public.inventory_movements TO %s%s',
                       v_grant.privilege_type, v_grantee, v_option);
    END LOOP;
END
$restore_inventory_acl$;

DO $rollback_guard$
BEGIN
    IF EXISTS (SELECT 1 FROM public.stock_counts)
       OR EXISTS (SELECT 1 FROM public.stock_incoming)
       OR EXISTS (SELECT 1 FROM public.stock_blocks)
       OR EXISTS (SELECT 1 FROM public.stock_lots) THEN
        RAISE EXCEPTION 'Rollback stopped: stock phase 1 contains operational data; export and reconcile it before rollback.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.inventory_movements WHERE type <> 'OPENING_BALANCE'
               AND (location_id IS NOT NULL OR lot_id IS NOT NULL OR order_id IS NOT NULL
                    OR actor_user_id IS NOT NULL OR supplier_reference IS NOT NULL)) THEN
        RAISE EXCEPTION 'Rollback stopped: stock movements contain phase 1 references; export and reconcile before rollback.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.products WHERE stock_quantity <> trunc(stock_quantity)) THEN
        RAISE EXCEPTION 'Rollback stopped: fractional stock quantities cannot be represented by the legacy integer column.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.inventory_movements
               WHERE quantity <> trunc(quantity) OR previous_stock <> trunc(previous_stock)
                  OR new_stock <> trunc(new_stock)) THEN
        RAISE EXCEPTION 'Rollback stopped: fractional ledger quantities cannot be represented by the legacy integer columns.';
    END IF;
END
$rollback_guard$;

DROP TRIGGER IF EXISTS stock_order_reservation_lifecycle ON public.orders;
DROP TRIGGER IF EXISTS stock_product_defaults ON public.products;
DROP TRIGGER IF EXISTS stock_product_opening_balance ON public.products;
DROP TRIGGER IF EXISTS stock_reserve_legacy_sale ON public.inventory_movements;
DROP TRIGGER IF EXISTS stock_movement_append_only ON public.inventory_movements;
DROP TRIGGER IF EXISTS stock_movement_prepare ON public.inventory_movements;
DROP TRIGGER IF EXISTS stock_tenant_default_location ON public.tenants;

DROP FUNCTION IF EXISTS public.stock_add_location(uuid,text);
DROP FUNCTION IF EXISTS public.stock_approve_count(uuid,boolean,text);
DROP FUNCTION IF EXISTS public.stock_submit_count(uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS public.stock_receive_incoming(uuid,uuid);
DROP FUNCTION IF EXISTS public.stock_create_incoming(uuid,uuid,numeric,text,date);
DROP FUNCTION IF EXISTS public.stock_create_incoming(uuid,uuid,numeric,text,numeric,date);
DROP FUNCTION IF EXISTS public.stock_record_movement(uuid,uuid,uuid,text,numeric,text,text,text,uuid,numeric);
DROP FUNCTION IF EXISTS public.stock_transfer(uuid,uuid,uuid,uuid,numeric,text);
DROP FUNCTION IF EXISTS public.stock_correct_weight(uuid,uuid,uuid,numeric,text,text);
DROP FUNCTION IF EXISTS public.stock_update_product_settings(uuid,uuid,text,numeric,numeric,boolean,boolean);
DROP FUNCTION IF EXISTS public.stock_set_block(uuid,uuid,uuid,numeric,text,boolean);
DROP FUNCTION IF EXISTS public.stock_expire_pending_reservations(uuid,uuid);
DROP FUNCTION IF EXISTS public.stock_dashboard(uuid);
DROP FUNCTION IF EXISTS public._stock_manager(uuid);
DROP FUNCTION IF EXISTS public._stock_staff(uuid);
DROP FUNCTION IF EXISTS public._stock_product_defaults();
DROP FUNCTION IF EXISTS public._stock_open_product_balance();
DROP FUNCTION IF EXISTS public._stock_order_reservation_lifecycle();
DROP FUNCTION IF EXISTS public._stock_reserve_legacy_sale();
DROP FUNCTION IF EXISTS public._stock_reject_movement_mutation();
DROP FUNCTION IF EXISTS public._stock_prepare_movement();
DROP FUNCTION IF EXISTS public._stock_create_default_location();
DROP FUNCTION IF EXISTS public._stock_default_location(uuid);

DROP POLICY IF EXISTS inventory_movements_cashier_select ON public.inventory_movements;
DELETE FROM public.inventory_movements WHERE type = 'OPENING_BALANCE';
DROP VIEW IF EXISTS public.stock_location_balances;
ALTER TABLE public.inventory_movements
    DROP CONSTRAINT IF EXISTS inventory_movements_order_fk,
    DROP CONSTRAINT IF EXISTS inventory_movements_lot_fk,
    DROP CONSTRAINT IF EXISTS inventory_movements_location_fk,
    DROP COLUMN IF EXISTS order_id,
    DROP COLUMN IF EXISTS lot_id,
    DROP COLUMN IF EXISTS supplier_reference,
    DROP COLUMN IF EXISTS actor_user_id,
    DROP COLUMN IF EXISTS unit,
    DROP COLUMN IF EXISTS location_id,
    DROP CONSTRAINT IF EXISTS inventory_movements_type_check,
    ADD CONSTRAINT inventory_movements_type_check
        CHECK (type IN ('ENTRADA', 'SAIDA', 'VENDA', 'ESTORNO', 'AJUSTE', 'PERDA')),
    ALTER COLUMN quantity TYPE integer USING quantity::integer,
    ALTER COLUMN previous_stock TYPE integer USING previous_stock::integer,
    ALTER COLUMN new_stock TYPE integer USING new_stock::integer;

ALTER TABLE public.products
    DROP CONSTRAINT IF EXISTS products_tenant_id_id_stock_key,
    DROP COLUMN IF EXISTS stock_is_resale,
    DROP COLUMN IF EXISTS track_lots,
    DROP COLUMN IF EXISTS safety_stock,
    DROP COLUMN IF EXISTS min_stock,
    DROP COLUMN IF EXISTS stock_unit,
    ALTER COLUMN stock_quantity TYPE integer USING stock_quantity::integer;

DROP TABLE IF EXISTS public.stock_count_items;
DROP TABLE IF EXISTS public.stock_counts;
DROP TABLE IF EXISTS public.stock_blocks;
DROP TABLE IF EXISTS public.stock_incoming;
DROP TABLE IF EXISTS public.stock_reservations;
DROP TABLE IF EXISTS public.stock_lots;
DROP TABLE IF EXISTS public.stock_locations;
DROP TABLE IF EXISTS public.stock_phase1_acl_snapshot;

DROP INDEX IF EXISTS public.inventory_movements_location_time_idx;
DROP INDEX IF EXISTS public.inventory_movements_order_idx;
DROP INDEX IF EXISTS public.inventory_movements_lot_idx;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261020003100';
NOTIFY pgrst, 'reload schema';
COMMIT;
