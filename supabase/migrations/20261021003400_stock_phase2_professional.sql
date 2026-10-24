-- =============================================================================
-- Migration: 20261021003400_stock_phase2_professional.sql
-- Purpose: Evolução profissional do módulo de Estoque & Movimentações (Fase 2)
--          - Modos de controle multi-segmento (unidade, peso, volume, embalagem,
--            variação, série, lote/validade, kit, sem controle)
--          - Saldos operacionais completos (em trânsito, avariado, quarentena,
--            estoque de segurança, lead time, ponto de pedido)
--          - Lotes e validade com FEFO (stock_lots)
--          - Fornecedores e Pedidos de Compra com aprovação e recebimento parcial
--          - Fila de aprovação humana para ajustes críticos e inventário físico
--          - RLS multi-tenant estrita por tenant_id
-- =============================================================================

BEGIN;

-- 1. Evolução da tabela products para modos de controle configuráveis
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_control_mode text NOT NULL DEFAULT 'UNIT',
  ADD COLUMN IF NOT EXISTS package_quantity numeric(14, 4),
  ADD COLUMN IF NOT EXISTS safety_stock numeric(14, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reorder_point numeric(14, 4),
  ADD COLUMN IF NOT EXISTS lead_time_days integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS min_order_quantity numeric(14, 4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supplier_id uuid,
  ADD COLUMN IF NOT EXISTS controls_expiry boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_serial boolean NOT NULL DEFAULT false;

-- 2. Evolução de stock_balances com saldos em trânsito, avariado e quarentena
ALTER TABLE public.stock_balances
  ADD COLUMN IF NOT EXISTS in_transit_quantity numeric(14, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damaged_quantity numeric(14, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quarantine_quantity numeric(14, 4) NOT NULL DEFAULT 0;

-- 3. Tabela de Lotes e Validade (FEFO)
CREATE TABLE IF NOT EXISTS public.stock_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.stock_locations(id) ON DELETE CASCADE,
  lot_code text NOT NULL,
  manufactured_at date,
  expires_at date,
  initial_quantity numeric(14, 4) NOT NULL DEFAULT 0,
  current_quantity numeric(14, 4) NOT NULL DEFAULT 0,
  reserved_quantity numeric(14, 4) NOT NULL DEFAULT 0,
  unit_cost numeric(14, 4) NOT NULL DEFAULT 0,
  supplier_id uuid,
  supplier_name text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'QUARANTINE', 'EXPIRED', 'DEPLETED', 'BLOCKED')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_lots_tenant_product
  ON public.stock_lots (tenant_id, product_id, expires_at ASC NULLS LAST);

ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_lots_tenant_select ON public.stock_lots;
CREATE POLICY stock_lots_tenant_select ON public.stock_lots
  FOR SELECT TO authenticated
  USING (public._stock_staff(tenant_id));

DROP POLICY IF EXISTS stock_lots_tenant_write ON public.stock_lots;
CREATE POLICY stock_lots_tenant_write ON public.stock_lots
  FOR ALL TO authenticated
  USING (public._stock_staff(tenant_id))
  WITH CHECK (public._stock_staff(tenant_id));

-- 4. Tabela de Fornecedores (stock_suppliers)
CREATE TABLE IF NOT EXISTS public.stock_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  legal_name text,
  document text,
  contact_name text,
  phone text,
  email text,
  lead_time_days integer NOT NULL DEFAULT 2,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  linked_product_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_suppliers_tenant
  ON public.stock_suppliers (tenant_id, is_active);

ALTER TABLE public.stock_suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_suppliers_tenant_select ON public.stock_suppliers;
CREATE POLICY stock_suppliers_tenant_select ON public.stock_suppliers
  FOR SELECT TO authenticated
  USING (public._stock_staff(tenant_id));

DROP POLICY IF EXISTS stock_suppliers_tenant_write ON public.stock_suppliers;
CREATE POLICY stock_suppliers_tenant_write ON public.stock_suppliers
  FOR ALL TO authenticated
  USING (public._stock_manager(tenant_id))
  WITH CHECK (public._stock_manager(tenant_id));

-- 5. Pedidos de Compra e Recebimento Parcial/Total (stock_purchase_orders)
CREATE TABLE IF NOT EXISTS public.stock_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  supplier_id uuid REFERENCES public.stock_suppliers(id) ON DELETE SET NULL,
  supplier_name text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (
    status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')
  ),
  invoice_number text,
  notes text,
  expected_delivery_at date,
  total_estimated_cost numeric(14, 4) NOT NULL DEFAULT 0,
  total_received_cost numeric(14, 4) NOT NULL DEFAULT 0,
  created_by uuid,
  created_by_name text,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  received_at timestamptz,
  cancelled_by_name text,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_purchase_orders_tenant
  ON public.stock_purchase_orders (tenant_id, status, created_at DESC);

ALTER TABLE public.stock_purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_purchase_orders_tenant_select ON public.stock_purchase_orders;
CREATE POLICY stock_purchase_orders_tenant_select ON public.stock_purchase_orders
  FOR SELECT TO authenticated
  USING (public._stock_staff(tenant_id));

DROP POLICY IF EXISTS stock_purchase_orders_tenant_write ON public.stock_purchase_orders;
CREATE POLICY stock_purchase_orders_tenant_write ON public.stock_purchase_orders
  FOR ALL TO authenticated
  USING (public._stock_staff(tenant_id))
  WITH CHECK (public._stock_staff(tenant_id));

CREATE TABLE IF NOT EXISTS public.stock_purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.stock_purchase_orders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  ordered_quantity numeric(14, 4) NOT NULL CHECK (ordered_quantity > 0),
  received_quantity numeric(14, 4) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  unit StockUnit DEFAULT 'un',
  expected_unit_cost numeric(14, 4) NOT NULL DEFAULT 0,
  received_unit_cost numeric(14, 4),
  lot_code text,
  expires_at date,
  divergence_notes text
);

ALTER TABLE public.stock_purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_po_items_tenant_select ON public.stock_purchase_order_items;
CREATE POLICY stock_po_items_tenant_select ON public.stock_purchase_order_items
  FOR SELECT TO authenticated
  USING (public._stock_staff(tenant_id));

DROP POLICY IF EXISTS stock_po_items_tenant_write ON public.stock_purchase_order_items;
CREATE POLICY stock_po_items_tenant_write ON public.stock_purchase_order_items
  FOR ALL TO authenticated
  USING (public._stock_staff(tenant_id))
  WITH CHECK (public._stock_staff(tenant_id));

-- 6. Solicitações de Ajuste com Aprovação Humana (stock_adjustment_requests)
CREATE TABLE IF NOT EXISTS public.stock_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.stock_locations(id) ON DELETE CASCADE,
  delta numeric(14, 4) NOT NULL,
  previous_balance numeric(14, 4) NOT NULL,
  new_balance numeric(14, 4) NOT NULL,
  movement_type text NOT NULL,
  reason text NOT NULL,
  unit_cost numeric(14, 4),
  lot_id uuid REFERENCES public.stock_lots(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
  requested_by uuid,
  requested_by_name text,
  requested_by_role text,
  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_adj_requests_tenant_status
  ON public.stock_adjustment_requests (tenant_id, status, created_at DESC);

ALTER TABLE public.stock_adjustment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_adj_requests_tenant_select ON public.stock_adjustment_requests;
CREATE POLICY stock_adj_requests_tenant_select ON public.stock_adjustment_requests
  FOR SELECT TO authenticated
  USING (public._stock_staff(tenant_id));

DROP POLICY IF EXISTS stock_adj_requests_tenant_insert ON public.stock_adjustment_requests;
CREATE POLICY stock_adj_requests_tenant_insert ON public.stock_adjustment_requests
  FOR INSERT TO authenticated
  WITH CHECK (public._stock_staff(tenant_id));

DROP POLICY IF EXISTS stock_adj_requests_tenant_review ON public.stock_adjustment_requests;
CREATE POLICY stock_adj_requests_tenant_review ON public.stock_adjustment_requests
  FOR UPDATE TO authenticated
  USING (public._stock_manager(tenant_id))
  WITH CHECK (public._stock_manager(tenant_id));

-- 7. Evolução de stock_movements para rastreabilidade completa (antes/depois, lote, fornecedor, aprovador)
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS previous_balance numeric(14, 4),
  ADD COLUMN IF NOT EXISTS new_balance numeric(14, 4),
  ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES public.stock_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lot_code text,
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.stock_suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_name text,
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS approved_by_name text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

COMMIT;
