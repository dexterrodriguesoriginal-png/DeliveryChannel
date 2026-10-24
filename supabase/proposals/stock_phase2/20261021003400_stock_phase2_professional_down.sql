-- =============================================================================
-- Rollback: 20261021003400_stock_phase2_professional_down.sql
-- Reverte de forma segura as estruturas introduzidas na Fase 2 do Estoque
-- =============================================================================

BEGIN;

ALTER TABLE public.stock_movements
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by_name,
  DROP COLUMN IF EXISTS approved_by_user_id,
  DROP COLUMN IF EXISTS invoice_number,
  DROP COLUMN IF EXISTS supplier_name,
  DROP COLUMN IF EXISTS supplier_id,
  DROP COLUMN IF EXISTS lot_code,
  DROP COLUMN IF EXISTS lot_id,
  DROP COLUMN IF EXISTS new_balance,
  DROP COLUMN IF EXISTS previous_balance;

DROP TABLE IF EXISTS public.stock_adjustment_requests;
DROP TABLE IF EXISTS public.stock_purchase_order_items;
DROP TABLE IF EXISTS public.stock_purchase_orders;
DROP TABLE IF EXISTS public.stock_suppliers;
DROP TABLE IF EXISTS public.stock_lots;

ALTER TABLE public.stock_balances
  DROP COLUMN IF EXISTS quarantine_quantity,
  DROP COLUMN IF EXISTS damaged_quantity,
  DROP COLUMN IF EXISTS in_transit_quantity;

ALTER TABLE public.products
  DROP COLUMN IF EXISTS requires_serial,
  DROP COLUMN IF EXISTS controls_expiry,
  DROP COLUMN IF EXISTS supplier_id,
  DROP COLUMN IF EXISTS min_order_quantity,
  DROP COLUMN IF EXISTS lead_time_days,
  DROP COLUMN IF EXISTS reorder_point,
  DROP COLUMN IF EXISTS safety_stock,
  DROP COLUMN IF EXISTS package_quantity,
  DROP COLUMN IF EXISTS stock_control_mode;

COMMIT;
