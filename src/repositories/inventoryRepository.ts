import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  InventoryMovement,
  InventoryMovementType,
  Product,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderStatus,
  StockAdjustmentRequest,
  StockControlMode,
  StockCount,
  StockLocation,
  StockLot,
  StockLotStatus,
  StockProductBalance,
  StockSupplier,
  StockUnit,
} from '../types';
import { dataStore } from '../services/dataStore';
import {
  SecurityContext,
  validatePermission,
  validateTenantAccess,
  PrivilegeEscalationSecurityException,
} from '../services/securityEngine';
import { isValidUuid } from '../lib/uuid';
import { toBackendError } from '../lib/backend';
import {
  canConvertUnits,
  computeOperationalBalances,
  computeWeightedAverageCost,
  convertStockQuantity,
  evaluateLotStatus,
  roundCurrency,
  roundStockQty,
  selectLotsFEFO,
  stockAlerts,
  stockStatus,
  stockSummary,
  validateUnitMigration,
} from '../lib/stock';

export interface StockDashboard {
  products: StockProductBalance[];
  alerts: Array<{
    productId: string;
    productName: string;
    locationId: string;
    cause: 'OUT_OF_STOCK' | 'BELOW_MINIMUM';
    suggestedAction: string;
    available: number;
    minimum: number;
  }>;
  locations: StockLocation[];
  summary: {
    activeSkus: number;
    criticalStock: number;
    inventoryValue: number;
    alertCount: number;
  };
}

export interface StockIncoming {
  id: string;
  productId: string;
  quantity: number;
  supplierReference: string;
  unitCost: number;
  expectedAt?: string;
}

export interface StockBlockRecord {
  id: string;
  tenantId: string;
  productId: string;
  locationId: string;
  quantity: number;
  reason: string;
  status: 'ACTIVE' | 'RELEASED';
  createdBy: string;
  createdByName: string;
  createdAt: string;
  releasedAt?: string;
}

export interface StockReservationRecord {
  id: string;
  tenantId: string;
  orderId: string;
  productId: string;
  locationId: string;
  quantity: number;
  unit: StockUnit;
  status: 'ACTIVE' | 'RELEASED' | 'CONVERTED';
  createdAt: string;
  closedAt?: string;
}

const EXTENDED_STORAGE_KEY = 'delivery_channel_stock_v2_state';

interface ExtendedStockState {
  locations: Record<string, StockLocation[]>;
  lots: StockLot[];
  suppliers: StockSupplier[];
  purchaseOrders: PurchaseOrder[];
  counts: StockCount[];
  blocks: StockBlockRecord[];
  reservations: StockReservationRecord[];
  adjustmentRequests: StockAdjustmentRequest[];
  locationBalances: Record<string, number>; // key: `${tenantId}:${locationId}:${productId}`
}

function defaultSeedState(): ExtendedStockState {
  return {
    locations: {
      'tenant-adega-01': [
        { id: 'loc-adega-main', name: 'Depósito Climatizado Principal', isDefault: true },
        { id: 'loc-adega-frente', name: 'Geladeiras de Loja (Frente)', isDefault: false },
      ],
      'tenant-burger-02': [
        { id: 'loc-burger-main', name: 'Câmara Fria & Secos', isDefault: true },
      ],
      'tenant-pizza-03': [
        { id: 'loc-pizza-main', name: 'Despensa & Maturação', isDefault: true },
      ],
    },
    lots: [
      {
        id: 'lot-adega-001',
        tenantId: 'tenant-adega-01',
        productId: 'prod-adega-1',
        productName: 'Vinho Tinto Cabernet Sauvignon Reserva 750ml',
        locationId: 'loc-adega-main',
        lotCode: 'SAFRA-2023-A',
        supplierId: 'sup-adega-01',
        supplierName: 'Vinícola Serra Gaúcha Ltda',
        receivedAt: '2026-09-01T08:00:00Z',
        manufacturedAt: '2024-03-15',
        expiresOn: '2028-03-15',
        receivedQuantity: 50,
        remainingQuantity: 48,
        unit: 'un',
        unitCost: 42.0,
        status: 'ACTIVE',
      },
      {
        id: 'lot-adega-002',
        tenantId: 'tenant-adega-01',
        productId: 'prod-adega-2',
        productName: 'Cerveja Artesanal IPA Puro Malte 500ml',
        locationId: 'loc-adega-main',
        lotCode: 'IPA-LOTE-104',
        supplierId: 'sup-adega-02',
        supplierName: 'Cervejaria Lupulandia Craft',
        receivedAt: '2026-09-10T10:00:00Z',
        manufacturedAt: '2026-08-10',
        expiresOn: '2026-10-28',
        receivedQuantity: 60,
        remainingQuantity: 40,
        unit: 'un',
        unitCost: 11.2,
        status: 'ACTIVE',
        notes: 'Lote com vencimento próximo (prioridade FEFO)',
      },
      {
        id: 'lot-adega-003',
        tenantId: 'tenant-adega-01',
        productId: 'prod-adega-2',
        productName: 'Cerveja Artesanal IPA Puro Malte 500ml',
        locationId: 'loc-adega-main',
        lotCode: 'IPA-LOTE-118',
        supplierId: 'sup-adega-02',
        supplierName: 'Cervejaria Lupulandia Craft',
        receivedAt: '2026-10-01T14:00:00Z',
        manufacturedAt: '2026-09-25',
        expiresOn: '2027-03-25',
        receivedQuantity: 80,
        remainingQuantity: 80,
        unit: 'un',
        unitCost: 11.2,
        status: 'ACTIVE',
      },
      {
        id: 'lot-adega-004',
        tenantId: 'tenant-adega-01',
        productId: 'prod-adega-4',
        productName: 'Tábua de Queijos Selecionados & Castanhas 250g',
        locationId: 'loc-adega-main',
        lotCode: 'LATIC-2026-09',
        supplierId: 'sup-adega-01',
        supplierName: 'Vinícola Serra Gaúcha Ltda',
        receivedAt: '2026-09-15T09:00:00Z',
        manufacturedAt: '2026-09-10',
        expiresOn: '2026-10-25',
        receivedQuantity: 15,
        remainingQuantity: 15,
        unit: 'un',
        unitCost: 26.5,
        status: 'ACTIVE',
      },
    ],
    suppliers: [
      {
        id: 'sup-adega-01',
        tenantId: 'tenant-adega-01',
        name: 'Vinícola Serra Gaúcha Ltda',
        legalName: 'Cooperativa Vinícola Serra Gaúcha S/A',
        document: '88.451.230/0001-19',
        contactName: 'Henrique Dal Pizzol',
        phone: '(54) 3452-9000',
        email: 'comercial@serragaucha.com.br',
        defaultLeadTimeDays: 5,
        minOrderValue: 800,
        paymentTerms: '28/56 dias no boleto',
        isActive: true,
        createdAt: '2026-01-20T10:00:00Z',
        products: [
          {
            productId: 'prod-adega-1',
            productName: 'Vinho Tinto Cabernet Sauvignon Reserva 750ml',
            supplierSku: 'SG-CAB-750',
            lastUnitCost: 42.0,
            leadTimeDays: 5,
            minOrderQuantity: 12,
            packageQuantity: 6,
            purchaseUnit: 'cx',
            baseUnit: 'un',
          },
          {
            productId: 'prod-adega-4',
            productName: 'Tábua de Queijos Selecionados & Castanhas 250g',
            supplierSku: 'SG-QUEI-250',
            lastUnitCost: 26.5,
            leadTimeDays: 3,
            minOrderQuantity: 10,
            packageQuantity: 5,
            purchaseUnit: 'pack',
            baseUnit: 'un',
          },
        ],
      },
      {
        id: 'sup-adega-02',
        tenantId: 'tenant-adega-01',
        name: 'Cervejaria Lupulandia Craft',
        legalName: 'Lupulandia Bebidas Especiais Ltda',
        document: '19.832.400/0001-55',
        contactName: 'Amanda Krauss',
        phone: '(11) 99400-8811',
        email: 'pedidos@lupulandia.com.br',
        defaultLeadTimeDays: 2,
        minOrderValue: 400,
        paymentTerms: 'PIX na entrega ou 14 dias',
        isActive: true,
        createdAt: '2026-02-05T11:00:00Z',
        products: [
          {
            productId: 'prod-adega-2',
            productName: 'Cerveja Artesanal IPA Puro Malte 500ml',
            supplierSku: 'LUP-IPA-500',
            lastUnitCost: 11.2,
            leadTimeDays: 2,
            minOrderQuantity: 24,
            packageQuantity: 12,
            purchaseUnit: 'fd',
            baseUnit: 'un',
          },
        ],
      },
    ],
    purchaseOrders: [
      {
        id: 'po-adega-1001',
        code: 'OC-1001',
        tenantId: 'tenant-adega-01',
        supplierId: 'sup-adega-01',
        supplierName: 'Vinícola Serra Gaúcha Ltda',
        locationId: 'loc-adega-main',
        status: 'APPROVED',
        expectedDeliveryDate: '2026-10-25',
        items: [
          {
            id: 'poi-1',
            productId: 'prod-adega-1',
            productName: 'Vinho Tinto Cabernet Sauvignon Reserva 750ml',
            orderedQuantity: 18,
            receivedQuantity: 0,
            unit: 'un',
            packageQuantity: 6,
            unitCost: 42.0,
          },
        ],
        totalEstimated: 756.0,
        totalReceivedValue: 0,
        notes: 'Reposição programada para fim de semana',
        createdBy: 'user-owner-adega',
        createdByName: 'Roberto Viana',
        createdAt: '2026-10-18T15:00:00Z',
        submittedByName: 'Roberto Viana',
        submittedAt: '2026-10-18T15:05:00Z',
        approvedBy: 'user-owner-adega',
        approvedByName: 'Roberto Viana',
        approvedAt: '2026-10-18T15:10:00Z',
      },
    ],
    counts: [],
    blocks: [],
    reservations: [],
    adjustmentRequests: [],
    locationBalances: {},
  };
}

function loadExtendedState(): ExtendedStockState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(EXTENDED_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...defaultSeedState(),
        ...parsed,
      };
    }
  } catch {
    // ignore storage error
  }
  return defaultSeedState();
}

let extendedState: ExtendedStockState = loadExtendedState();

function persistExtendedState(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(EXTENDED_STORAGE_KEY, JSON.stringify(extendedState));
    }
  } catch {
    // ignore storage error
  }
}

function assertManagerPermission(context: SecurityContext): void {
  if (
    context.userRole !== 'OWNER' &&
    context.userRole !== 'MANAGER' &&
    context.userRole !== 'CEO' &&
    context.userRole !== 'SUPER_ADMIN'
  ) {
    throw new PrivilegeEscalationSecurityException(context.userRole, 'manage_settings');
  }
}

function ensureTenantLocations(tenantId: string): StockLocation[] {
  if (!extendedState.locations[tenantId] || extendedState.locations[tenantId].length === 0) {
    extendedState.locations[tenantId] = [
      { id: `loc-${tenantId}-default`, name: 'Estoque principal', isDefault: true },
    ];
    persistExtendedState();
  }
  return extendedState.locations[tenantId];
}

function mapRowToMovement(row: any): InventoryMovement {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    productName: row.product_name,
    quantity: Number(row.quantity),
    type: row.type as InventoryMovementType,
    referenceId: row.reference_id || undefined,
    reason: row.reason,
    previousStock: Number(row.previous_stock),
    newStock: Number(row.new_stock),
    createdByName: row.created_by_name,
    approvedByName: row.approved_by_name || undefined,
    timestamp: row.created_at,
    unit: row.unit || 'un',
    locationId: row.location_id || undefined,
    actorUserId: row.actor_user_id || undefined,
    orderId: row.order_id || undefined,
    purchaseOrderId: row.purchase_order_id || undefined,
    inventoryCountId: row.inventory_count_id || undefined,
    supplierReference: row.supplier_reference || undefined,
    lotId: row.lot_id || undefined,
    lotCode: row.lot_code || undefined,
    unitCost: row.unit_cost !== undefined && row.unit_cost !== null ? Number(row.unit_cost) : undefined,
  };
}

function mapDashboardProduct(row: any): StockProductBalance {
  return {
    productId: row.product_id,
    productName: row.product_name,
    locationId: row.location_id,
    locationName: row.location_name,
    sku: row.sku || undefined,
    imageUrl: row.image_url || undefined,
    price: Number(row.price || 0),
    unit: (row.unit || 'un') as StockUnit,
    stockControlMode: (row.stock_control_mode || (row.track_lots ? 'LOT_EXPIRY' : 'UNIT')) as StockControlMode,
    packageQuantity: row.package_quantity ? Number(row.package_quantity) : 1,
    leadTimeDays: row.lead_time_days ? Number(row.lead_time_days) : 3,
    minOrderQty: row.min_order_qty ? Number(row.min_order_qty) : 0,
    physicalQuantity: Number(row.physical_quantity || 0),
    reservedQuantity: Number(row.reserved_quantity || 0),
    blockedQuantity: Number(row.blocked_quantity || 0),
    availableQuantity: Number(row.available_quantity || 0),
    incomingQuantity: Number(row.incoming_quantity || 0),
    minStock: Number(row.min_stock || 0),
    safetyStock: Number(row.safety_stock || 0),
    trackLots: Boolean(row.track_lots),
    trackSerials: Boolean(row.track_serials),
    stockIsResale: Boolean(row.stock_is_resale),
    isActive: Boolean(row.is_active),
    costPrice: Number(row.cost_price || 0),
    stockStatus: row.stock_status,
  };
}

async function stockRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw toBackendError(error, 'Falha na operação de estoque.');
  return data as T;
}

function buildTenantProductBalances(
  context: SecurityContext,
  tenantId: string
): {
  products: StockProductBalance[];
  locations: StockLocation[];
} {
  const rawProducts = dataStore.getProducts(context, tenantId);
  const locations = ensureTenantLocations(tenantId);
  const defaultLoc = locations.find(l => l.isDefault) || locations[0];
  const now = new Date();

  // Pedidos ativos com reserva implícita ou explícita
  let activeOrders = [] as ReturnType<typeof dataStore.getOrders>;
  try {
    activeOrders = dataStore
      .getOrders(context, tenantId)
      .filter(o => !['DELIVERED', 'CANCELLED'].includes(o.status));
  } catch {
    activeOrders = [];
  }

  const tenantLots = extendedState.lots.filter(l => l.tenantId === tenantId);
  const tenantBlocks = extendedState.blocks.filter(
    b => b.tenantId === tenantId && b.status === 'ACTIVE'
  );
  const tenantReservations = extendedState.reservations.filter(
    r => r.tenantId === tenantId && r.status === 'ACTIVE'
  );
  const tenantPOs = extendedState.purchaseOrders.filter(
    po =>
      po.tenantId === tenantId &&
      (po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED')
  );

  const balances: StockProductBalance[] = [];

  for (const product of rawProducts) {
    if (!product.isActive) continue;

    for (const loc of locations) {
      const locKey = `${tenantId}:${loc.id}:${product.id}`;
      const totalProdStock = Number(product.stockQuantity || 0);

      // Distribuição de saldo físico por local
      let physicalInLoc = 0;
      if (loc.id === defaultLoc.id) {
        const otherLocsSum = locations
          .filter(other => other.id !== defaultLoc.id)
          .reduce(
            (acc, other) =>
              acc + (extendedState.locationBalances[`${tenantId}:${other.id}:${product.id}`] || 0),
            0
          );
        physicalInLoc = Math.max(0, roundStockQty(totalProdStock - otherLocsSum));
      } else {
        physicalInLoc = roundStockQty(extendedState.locationBalances[locKey] || 0);
      }

      // Reservas explícitas + reservas de pedidos em aberto (sem duplicar o mesmo orderId)
      const explicitResForLoc = tenantReservations.filter(
        r => r.productId === product.id && r.locationId === loc.id
      );
      const explicitRes = explicitResForLoc.reduce((sum, r) => sum + r.quantity, 0);
      const explicitlyReservedOrderIds = new Set(
        tenantReservations.filter(r => r.productId === product.id).map(r => r.orderId)
      );

      let orderPendingRes = 0;
      if (loc.id === defaultLoc.id) {
        for (const ord of activeOrders) {
          if (explicitlyReservedOrderIds.has(ord.id)) continue;
          if (ord.status === 'PENDING' || ord.status === 'CONFIRMED' || ord.status === 'PREPARING') {
            for (const item of ord.items) {
              if (item.productId === product.id) {
                orderPendingRes += item.quantity;
              }
            }
          }
        }
      }

      const reservedQuantity = roundStockQty(explicitRes + orderPendingRes);

      // Bloqueios manuais ativos
      const manualBlocked = tenantBlocks
        .filter(b => b.productId === product.id && b.locationId === loc.id)
        .reduce((sum, b) => sum + b.quantity, 0);

      // Lotes vencidos ou bloqueados/quarentena neste local
      const expiredOrBlockedLotsQty = tenantLots
        .filter(l => l.productId === product.id && (l.locationId === loc.id || loc.id === defaultLoc.id))
        .reduce((sum, l) => {
          const st = evaluateLotStatus(l, now);
          if (st === 'EXPIRED' || st === 'BLOCKED' || st === 'QUARANTINE') {
            return sum + Math.max(0, l.remainingQuantity);
          }
          return sum;
        }, 0);

      // Compras confirmadas/aprovadas ainda não recebidas (NUNCA entram no estoque físico)
      const incomingFromPO = tenantPOs
        .filter(po => po.locationId === loc.id || loc.id === defaultLoc.id)
        .reduce((sum, po) => {
          const itemSum = po.items
            .filter(i => i.productId === product.id)
            .reduce((s, i) => s + Math.max(0, i.orderedQuantity - i.receivedQuantity), 0);
          return sum + itemSum;
        }, 0);

      const computed = computeOperationalBalances({
        physicalQuantity: physicalInLoc,
        reservedQuantity,
        blockedQuantity: manualBlocked,
        expiredOrQuarantinedLotQuantity: expiredOrBlockedLotsQty,
        incomingQuantity: incomingFromPO,
      });

      const minStock = Number(product.minStock ?? 5);
      const unit = (product.stockUnit ||
        (['un', 'kg', 'g', 'l', 'ml', 'm', 'cm', 'm2', 'cm2', 'pack', 'cx', 'fd'].includes(
          (product.unit || '').toLowerCase()
        )
          ? (product.unit.toLowerCase() as StockUnit)
          : 'un')) as StockUnit;

      const resolvedMode: StockControlMode =
        product.stockControlMode ||
        (product.trackLots || tenantLots.some(l => l.productId === product.id)
          ? 'LOT_EXPIRY'
          : unit === 'kg' || unit === 'g'
            ? 'WEIGHT'
            : unit === 'l' || unit === 'ml'
              ? 'VOLUME'
              : unit === 'm' || unit === 'cm'
                ? 'LENGTH'
                : unit === 'm2' || unit === 'cm2'
                  ? 'AREA'
                  : unit === 'pack' || unit === 'cx' || unit === 'fd'
                    ? 'PACKAGE'
                    : 'UNIT');

      balances.push({
        productId: product.id,
        productName: product.name,
        locationId: loc.id,
        locationName: loc.name,
        sku: product.sku,
        imageUrl: product.imageUrl,
        price: product.price,
        unit,
        stockControlMode: resolvedMode,
        packageQuantity: product.packageQuantity || 1,
        leadTimeDays: product.leadTimeDays || 3,
        minOrderQty: product.minOrderQty || 0,
        physicalQuantity: computed.physicalQuantity,
        reservedQuantity: computed.reservedQuantity,
        blockedQuantity: computed.blockedQuantity,
        availableQuantity: computed.availableQuantity,
        incomingQuantity: computed.incomingQuantity,
        minStock,
        safetyStock: Number(product.safetyStock || 0),
        trackLots: Boolean(product.trackLots || resolvedMode === 'LOT_EXPIRY'),
        trackSerials: Boolean(product.trackSerials || resolvedMode === 'SERIAL'),
        stockIsResale: Boolean(product.stockIsResale),
        isActive: product.isActive,
        costPrice: Number(product.cost || 0),
        stockStatus: stockStatus(computed.availableQuantity, minStock),
        variants: product.variants,
        serialNumbers: product.serialNumbers,
        kitComponents: product.kitComponents,
      });
    }
  }

  return { products: balances, locations };
}

export const inventoryRepository = {
  /**
   * Reseta estado estendido para testes automatizados determinísticos.
   */
  resetTestState(): void {
    extendedState = defaultSeedState();
    persistExtendedState();
  },

  async getDashboard(context: SecurityContext, tenantId: string): Promise<StockDashboard> {
    validateTenantAccess(context, tenantId, 'GET_STOCK_DASHBOARD');
    validatePermission(context, 'manage_inventory');

    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const result = await stockRpc<any>('stock_dashboard', { p_tenant_id: tenantId });
        return {
          products: (result.products || []).map(mapDashboardProduct),
          alerts: result.alerts || [],
          locations: (result.locations || []).map((location: any) => ({
            id: location.id,
            name: location.name,
            isDefault: Boolean(location.isDefault),
          })),
          summary: {
            activeSkus: Number(result.summary?.activeSkus || 0),
            criticalStock: Number(result.summary?.criticalStock || 0),
            inventoryValue: Number(result.summary?.inventoryValue || 0),
            alertCount: Number(result.summary?.alertCount || 0),
          },
        };
      } catch (err) {
        console.warn('[inventoryRepository] Fallback para motor de estoque local:', err);
      }
    }

    const { products, locations } = buildTenantProductBalances(context, tenantId);
    const defaultLocId = locations.find(l => l.isDefault)?.id || locations[0]?.id;
    const primaryProducts = products.filter(p => p.locationId === defaultLocId);

    return {
      products,
      alerts: stockAlerts(primaryProducts),
      locations,
      summary: stockSummary(primaryProducts),
    };
  },

  async getMovements(context: SecurityContext, tenantId: string): Promise<InventoryMovement[]> {
    validateTenantAccess(context, tenantId, 'GET_STOCK_MOVEMENTS');
    validatePermission(context, 'manage_inventory');

    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('inventory_movements')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false });
        if (error) throw toBackendError(error, 'Falha ao carregar movimentações de estoque.');
        return (data || []).map(mapRowToMovement);
      } catch (err) {
        console.warn('[inventoryRepository] Fallback getMovements:', err);
      }
    }
    return dataStore.getInventoryMovements(context, tenantId);
  },

  async getLots(context: SecurityContext, tenantId: string): Promise<StockLot[]> {
    validateTenantAccess(context, tenantId, 'GET_STOCK_LOTS');
    validatePermission(context, 'manage_inventory');

    const now = new Date();
    return extendedState.lots
      .filter(l => l.tenantId === tenantId)
      .map(l => ({
        ...l,
        status: evaluateLotStatus(l, now),
      }))
      .sort((a, b) => (a.expiresOn || '9999-12-31').localeCompare(b.expiresOn || '9999-12-31'));
  },

  async createOrUpdateLot(
    context: SecurityContext,
    tenantId: string,
    input: {
      productId: string;
      locationId?: string;
      lotCode: string;
      supplierId?: string;
      supplierName?: string;
      manufacturedAt?: string;
      expiresOn?: string;
      receivedQuantity: number;
      unitCost: number;
      notes?: string;
      recordReceiptMovement?: boolean;
    }
  ): Promise<StockLot> {
    validateTenantAccess(context, tenantId, 'CREATE_STOCK_LOT');
    validatePermission(context, 'manage_inventory');

    const cleanCode = input.lotCode.trim().toUpperCase();
    if (!cleanCode) throw new Error('Informe o código identificador do lote.');
    if (!Number.isFinite(input.receivedQuantity) || input.receivedQuantity <= 0) {
      throw new Error('A quantidade do lote deve ser maior que zero.');
    }
    if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
      throw new Error('O custo de aquisição do lote não pode ser negativo.');
    }

    const product = dataStore.getProductById(context, tenantId, input.productId);
    if (!product) throw new Error('Produto não encontrado neste estabelecimento.');

    const locations = ensureTenantLocations(tenantId);
    const locationId = input.locationId || locations.find(l => l.isDefault)?.id || locations[0].id;
    const unit = (product.stockUnit || 'un') as StockUnit;

    const existing = extendedState.lots.find(
      l => l.tenantId === tenantId && l.productId === input.productId && l.lotCode === cleanCode
    );

    let lot: StockLot;
    if (existing) {
      existing.receivedQuantity = roundStockQty(existing.receivedQuantity + input.receivedQuantity);
      existing.remainingQuantity = roundStockQty(existing.remainingQuantity + input.receivedQuantity);
      existing.unitCost = input.unitCost > 0 ? input.unitCost : existing.unitCost;
      if (input.expiresOn) existing.expiresOn = input.expiresOn;
      if (input.supplierName) existing.supplierName = input.supplierName;
      if (input.notes) existing.notes = input.notes;
      existing.status = evaluateLotStatus(existing);
      lot = { ...existing };
    } else {
      lot = {
        id: `lot-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        tenantId,
        productId: product.id,
        productName: product.name,
        locationId,
        lotCode: cleanCode,
        supplierId: input.supplierId,
        supplierName: input.supplierName,
        receivedAt: new Date().toISOString(),
        manufacturedAt: input.manufacturedAt,
        expiresOn: input.expiresOn,
        receivedQuantity: roundStockQty(input.receivedQuantity),
        remainingQuantity: roundStockQty(input.receivedQuantity),
        unit,
        unitCost: roundCurrency(input.unitCost),
        status: 'ACTIVE',
        notes: input.notes,
      };
      lot.status = evaluateLotStatus(lot);
      extendedState.lots.unshift(lot);
    }

    if (input.recordReceiptMovement !== false) {
      dataStore.recordInventoryMovement(context, tenantId, {
        productId: product.id,
        delta: input.receivedQuantity,
        type: 'RECEIPT',
        reason: `Entrada do lote ${cleanCode}${input.supplierName ? ` (${input.supplierName})` : ''}`,
        referenceId: lot.id,
        locationId,
        lotId: lot.id,
        lotCode: cleanCode,
        supplierReference: input.supplierName,
        unitCost: input.unitCost,
        updateCostWeighted: true,
      });
    }

    persistExtendedState();
    return lot;
  },

  async setLotStatus(
    context: SecurityContext,
    tenantId: string,
    lotId: string,
    status: StockLotStatus,
    reason: string
  ): Promise<StockLot> {
    validateTenantAccess(context, tenantId, 'SET_LOT_STATUS');
    assertManagerPermission(context);

    if (!reason || !reason.trim()) {
      throw new Error('Informe o motivo para alterar a situação do lote.');
    }

    const lot = extendedState.lots.find(l => l.id === lotId && l.tenantId === tenantId);
    if (!lot) throw new Error('Lote não encontrado neste estabelecimento.');

    lot.status = status;
    lot.notes = `${reason.trim()} (por ${context.userName})`;
    persistExtendedState();
    return { ...lot };
  },

  async getSuppliers(context: SecurityContext, tenantId: string): Promise<StockSupplier[]> {
    validateTenantAccess(context, tenantId, 'GET_STOCK_SUPPLIERS');
    validatePermission(context, 'manage_inventory');

    return extendedState.suppliers
      .filter(s => s.tenantId === tenantId)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async saveSupplier(
    context: SecurityContext,
    tenantId: string,
    input: {
      id?: string;
      name: string;
      legalName?: string;
      document?: string;
      contactName?: string;
      phone?: string;
      email?: string;
      defaultLeadTimeDays: number;
      minOrderValue?: number;
      paymentTerms?: string;
      products?: StockSupplier['products'];
    }
  ): Promise<StockSupplier> {
    validateTenantAccess(context, tenantId, 'SAVE_STOCK_SUPPLIER');
    assertManagerPermission(context);

    if (!input.name || input.name.trim().length < 2) {
      throw new Error('Informe o nome do fornecedor.');
    }
    if (!Number.isFinite(input.defaultLeadTimeDays) || input.defaultLeadTimeDays < 0) {
      throw new Error('O prazo médio de entrega deve ser zero ou maior.');
    }

    if (input.id) {
      const existing = extendedState.suppliers.find(s => s.id === input.id && s.tenantId === tenantId);
      if (!existing) throw new Error('Fornecedor não encontrado.');
      existing.name = input.name.trim();
      existing.legalName = input.legalName?.trim();
      existing.document = input.document?.trim();
      existing.contactName = input.contactName?.trim();
      existing.phone = input.phone?.trim();
      existing.email = input.email?.trim();
      existing.defaultLeadTimeDays = Math.max(1, Math.round(input.defaultLeadTimeDays));
      existing.minOrderValue = input.minOrderValue;
      existing.paymentTerms = input.paymentTerms?.trim();
      if (input.products) existing.products = input.products;
      persistExtendedState();
      return { ...existing };
    }

    const created: StockSupplier = {
      id: `sup-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId,
      name: input.name.trim(),
      legalName: input.legalName?.trim(),
      document: input.document?.trim(),
      contactName: input.contactName?.trim(),
      phone: input.phone?.trim(),
      email: input.email?.trim(),
      defaultLeadTimeDays: Math.max(1, Math.round(input.defaultLeadTimeDays || 3)),
      minOrderValue: input.minOrderValue,
      paymentTerms: input.paymentTerms?.trim(),
      isActive: true,
      products: input.products || [],
      createdAt: new Date().toISOString(),
    };

    extendedState.suppliers.push(created);
    persistExtendedState();
    return created;
  },

  async getPurchaseOrders(context: SecurityContext, tenantId: string): Promise<PurchaseOrder[]> {
    validateTenantAccess(context, tenantId, 'GET_PURCHASE_ORDERS');
    validatePermission(context, 'manage_inventory');

    return extendedState.purchaseOrders
      .filter(po => po.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  /**
   * Cria um Pedido de Compra em RASCUNHO (DRAFT) ou AGUARDANDO APROVAÇÃO (PENDING_APPROVAL).
   * Regra ETAPA 7 e 10: Uma sugestão ou rascunho de compra NUNCA altera o estoque físico nem confirma ordem sozinha.
   */
  async createPurchaseOrder(
    context: SecurityContext,
    tenantId: string,
    input: {
      supplierId: string;
      locationId?: string;
      expectedDeliveryDate?: string;
      notes?: string;
      submitForApproval?: boolean;
      originRecommendation?: boolean;
      items: Array<{
        productId: string;
        orderedQuantity: number;
        unitCost: number;
        unit?: StockUnit;
        packageQuantity?: number;
      }>;
    }
  ): Promise<PurchaseOrder> {
    validateTenantAccess(context, tenantId, 'CREATE_PURCHASE_ORDER');
    validatePermission(context, 'manage_inventory');

    if (!input.items || input.items.length === 0) {
      throw new Error('Adicione ao menos um produto ao pedido de compra.');
    }

    const supplier = extendedState.suppliers.find(
      s => s.id === input.supplierId && s.tenantId === tenantId
    );
    const supplierName = supplier?.name || input.supplierId || 'Fornecedor Padrão';
    const locations = ensureTenantLocations(tenantId);
    const locationId = input.locationId || locations.find(l => l.isDefault)?.id || locations[0].id;

    const poItems: PurchaseOrderItem[] = input.items.map((item, idx) => {
      if (!Number.isFinite(item.orderedQuantity) || item.orderedQuantity <= 0) {
        throw new Error('A quantidade solicitada no pedido de compra deve ser maior que zero.');
      }
      if (!Number.isFinite(item.unitCost) || item.unitCost < 0) {
        throw new Error('O custo unitário no pedido de compra não pode ser negativo.');
      }
      const prod = dataStore.getProductById(context, tenantId, item.productId);
      if (!prod) throw new Error(`Produto ${item.productId} não pertence a este estabelecimento.`);
      return {
        id: `poi-${Date.now()}-${idx}`,
        productId: prod.id,
        productName: prod.name,
        orderedQuantity: roundStockQty(item.orderedQuantity),
        receivedQuantity: 0,
        unit: item.unit || (prod.stockUnit as StockUnit) || 'un',
        packageQuantity: item.packageQuantity || prod.packageQuantity || 1,
        unitCost: roundCurrency(item.unitCost),
      };
    });

    const totalEstimated = roundCurrency(
      poItems.reduce((sum, i) => sum + i.orderedQuantity * i.unitCost, 0)
    );

    const seq = 1001 + extendedState.purchaseOrders.filter(po => po.tenantId === tenantId).length;
    const status: PurchaseOrderStatus = input.submitForApproval ? 'PENDING_APPROVAL' : 'DRAFT';
    const now = new Date().toISOString();

    const po: PurchaseOrder = {
      id: `po-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      code: `OC-${seq}`,
      tenantId,
      supplierId: supplier?.id || input.supplierId,
      supplierName,
      locationId,
      status,
      expectedDeliveryDate: input.expectedDeliveryDate,
      items: poItems,
      totalEstimated,
      totalReceivedValue: 0,
      notes: input.notes,
      originRecommendation: Boolean(input.originRecommendation),
      createdBy: context.userId,
      createdByName: context.userName,
      createdAt: now,
      ...(input.submitForApproval
        ? { submittedByName: context.userName, submittedAt: now }
        : {}),
    };

    extendedState.purchaseOrders.unshift(po);
    persistExtendedState();
    return po;
  },

  async updatePurchaseOrderStatus(
    context: SecurityContext,
    tenantId: string,
    purchaseOrderId: string,
    action: 'SUBMIT' | 'APPROVE' | 'CANCEL',
    reason?: string
  ): Promise<PurchaseOrder> {
    validateTenantAccess(context, tenantId, 'UPDATE_PURCHASE_ORDER_STATUS');
    validatePermission(context, 'manage_inventory');

    const po = extendedState.purchaseOrders.find(
      p => p.id === purchaseOrderId && p.tenantId === tenantId
    );
    if (!po) throw new Error('Pedido de compra não encontrado.');

    const now = new Date().toISOString();

    if (action === 'SUBMIT') {
      if (po.status !== 'DRAFT') {
        throw new Error('Apenas pedidos em rascunho podem ser enviados para aprovação.');
      }
      po.status = 'PENDING_APPROVAL';
      po.submittedByName = context.userName;
      po.submittedAt = now;
    } else if (action === 'APPROVE') {
      assertManagerPermission(context);
      if (po.status !== 'PENDING_APPROVAL' && po.status !== 'DRAFT') {
        throw new Error('Apenas pedidos em rascunho ou aguardando aprovação podem ser aprovados.');
      }
      po.status = 'APPROVED';
      po.approvedBy = context.userId;
      po.approvedByName = context.userName;
      po.approvedAt = now;
    } else if (action === 'CANCEL') {
      assertManagerPermission(context);
      if (po.status === 'COMPLETED') {
        throw new Error('Pedidos de compra já concluídos não podem ser cancelados diretamente.');
      }
      po.status = 'CANCELLED';
      po.cancelledByName = context.userName;
      po.cancelledAt = now;
      po.cancellationReason = reason || 'Cancelado pelo responsável';
    }

    persistExtendedState();
    return { ...po };
  },

  /**
   * Recebimento validado de Pedido de Compra (suporta recebimento parcial e apuração de divergências).
   * Somente o recebimento validado gera entrada no estoque físico e atualiza o Custo Médio Ponderado.
   */
  async receivePurchaseOrder(
    context: SecurityContext,
    tenantId: string,
    purchaseOrderId: string,
    receiptItems: Array<{
      itemId: string;
      receivedNowQuantity: number;
      unitCost?: number;
      lotCode?: string;
      expiresOn?: string;
      divergenceReason?: string;
    }>
  ): Promise<PurchaseOrder> {
    validateTenantAccess(context, tenantId, 'RECEIVE_PURCHASE_ORDER');
    validatePermission(context, 'manage_inventory');

    const po = extendedState.purchaseOrders.find(
      p => p.id === purchaseOrderId && p.tenantId === tenantId
    );
    if (!po) throw new Error('Pedido de compra não encontrado.');
    if (po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
      throw new Error(
        'Somente pedidos de compra APROVADOS podem ter mercadorias recebidas no estoque físico.'
      );
    }

    let anyReceived = false;

    for (const rec of receiptItems) {
      if (!Number.isFinite(rec.receivedNowQuantity) || rec.receivedNowQuantity < 0) {
        throw new Error('Quantidade recebida inválida.');
      }
      if (rec.receivedNowQuantity === 0) continue;

      const poItem = po.items.find(i => i.id === rec.itemId || i.productId === rec.itemId);
      if (!poItem) continue;

      const prod = dataStore.getProductById(context, tenantId, poItem.productId);
      if (!prod) throw new Error(`Produto "${poItem.productName}" não encontrado.`);

      if (prod.trackLots && (!rec.lotCode || !rec.lotCode.trim())) {
        throw new Error(
          `O produto "${prod.name}" exige código de lote no recebimento de mercadoria.`
        );
      }

      const effectiveUnitCost =
        rec.unitCost !== undefined && rec.unitCost >= 0 ? rec.unitCost : poItem.unitCost;

      poItem.receivedQuantity = roundStockQty(poItem.receivedQuantity + rec.receivedNowQuantity);
      poItem.unitCost = roundCurrency(effectiveUnitCost);
      poItem.divergenceQuantity = roundStockQty(poItem.receivedQuantity - poItem.orderedQuantity);

      if (poItem.divergenceQuantity !== 0 && rec.divergenceReason) {
        poItem.divergenceReason = rec.divergenceReason.trim();
      }

      let createdLotId: string | undefined;
      if (rec.lotCode && rec.lotCode.trim()) {
        poItem.lotCode = rec.lotCode.trim().toUpperCase();
        poItem.expiresOn = rec.expiresOn;
        const lot = await this.createOrUpdateLot(context, tenantId, {
          productId: prod.id,
          locationId: po.locationId,
          lotCode: poItem.lotCode,
          supplierId: po.supplierId,
          supplierName: po.supplierName,
          expiresOn: rec.expiresOn,
          receivedQuantity: rec.receivedNowQuantity,
          unitCost: effectiveUnitCost,
          recordReceiptMovement: false,
        });
        createdLotId = lot.id;
      }

      dataStore.recordInventoryMovement(context, tenantId, {
        productId: prod.id,
        delta: rec.receivedNowQuantity,
        type: 'RECEIPT',
        reason: `Recebimento OC ${po.code} (${po.supplierName})${
          poItem.divergenceQuantity !== 0 && poItem.divergenceReason
            ? ` — Divergência: ${poItem.divergenceReason}`
            : ''
        }`,
        referenceId: po.code,
        purchaseOrderId: po.id,
        locationId: po.locationId,
        lotId: createdLotId,
        lotCode: poItem.lotCode,
        supplierReference: po.supplierName,
        unitCost: effectiveUnitCost,
        approvedByName: po.approvedByName || context.userName,
        updateCostWeighted: true,
      });

      anyReceived = true;
    }

    if (!anyReceived) {
      throw new Error('Informe uma quantidade recebida maior que zero para ao menos um item.');
    }

    po.totalReceivedValue = roundCurrency(
      po.items.reduce((sum, i) => sum + i.receivedQuantity * i.unitCost, 0)
    );
    const allFulfilled = po.items.every(i => i.receivedQuantity >= i.orderedQuantity);
    po.status = allFulfilled ? 'COMPLETED' : 'PARTIALLY_RECEIVED';
    po.receivedByName = context.userName;
    po.receivedAt = new Date().toISOString();

    persistExtendedState();
    return { ...po };
  },

  async getIncoming(tenantId: string): Promise<StockIncoming[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('stock_incoming')
          .select('id, product_id, quantity, supplier_reference, unit_cost, expected_at')
          .eq('tenant_id', tenantId)
          .eq('status', 'CONFIRMED')
          .order('created_at');
        if (!error && data) {
          return data.map((row: any) => ({
            id: row.id,
            productId: row.product_id,
            quantity: Number(row.quantity),
            supplierReference: row.supplier_reference,
            unitCost: Number(row.unit_cost),
            expectedAt: row.expected_at || undefined,
          }));
        }
      } catch {
        // fallback to local POs
      }
    }

    const activePOs = extendedState.purchaseOrders.filter(
      po =>
        po.tenantId === tenantId &&
        (po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED')
    );

    const list: StockIncoming[] = [];
    for (const po of activePOs) {
      for (const item of po.items) {
        const remaining = roundStockQty(item.orderedQuantity - item.receivedQuantity);
        if (remaining > 0) {
          list.push({
            id: `${po.id}:${item.id}`,
            productId: item.productId,
            quantity: remaining,
            supplierReference: `${po.code} · ${po.supplierName}`,
            unitCost: item.unitCost,
            expectedAt: po.expectedDeliveryDate,
          });
        }
      }
    }
    return list;
  },

  async getCounts(tenantId: string): Promise<StockCount[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('stock_counts')
          .select('id, tenant_id, location_id, status, submitted_at')
          .eq('tenant_id', tenantId)
          .order('submitted_at', { ascending: false });
        if (!error && data && data.length > 0) {
          const { data: items } = await supabase
            .from('stock_count_items')
            .select('count_id, product_id, expected_quantity, counted_quantity, unit')
            .eq('tenant_id', tenantId)
            .in(
              'count_id',
              data.map((count: any) => count.id)
            );
          const { data: products } = await supabase
            .from('products')
            .select('id, name, cost_price')
            .eq('tenant_id', tenantId);
          const prodMap = new Map(
            (products || []).map((p: any) => [
              p.id,
              { name: p.name, cost: Number(p.cost_price || 0) },
            ])
          );
          return data.map((count: any) => ({
            id: count.id,
            tenantId: count.tenant_id,
            locationId: count.location_id,
            status: count.status,
            submittedAt: count.submitted_at,
            items: (items || [])
              .filter((item: any) => item.count_id === count.id)
              .map((item: any) => {
                const exp = Number(item.expected_quantity);
                const cnt = Number(item.counted_quantity);
                const div = roundStockQty(cnt - exp);
                const meta = prodMap.get(item.product_id);
                return {
                  productId: item.product_id,
                  productName: meta?.name || 'Produto',
                  expectedQuantity: exp,
                  countedQuantity: cnt,
                  divergenceQuantity: div,
                  unitCost: meta?.cost || 0,
                  divergenceValue: roundCurrency(div * (meta?.cost || 0)),
                  unit: item.unit,
                };
              }),
          }));
        }
      } catch {
        // fallback local
      }
    }

    return extendedState.counts
      .filter(c => c.tenantId === tenantId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  },

  async submitCount(
    tenantId: string,
    locationId: string,
    counts: Array<{ product_id: string; counted_quantity: number; reason?: string }>,
    context?: SecurityContext,
    asDraft = false
  ): Promise<StockCount> {
    if (context) {
      validateTenantAccess(context, tenantId, 'SUBMIT_STOCK_COUNT');
      validatePermission(context, 'manage_inventory');
    }

    if (!counts || counts.length === 0) {
      throw new Error('Informe ao menos um item na contagem física.');
    }

    if (isSupabaseConfigured && isValidUuid(tenantId) && !asDraft) {
      try {
        await stockRpc('stock_submit_count', {
          p_tenant_id: tenantId,
          p_location_id: locationId,
          p_counts: counts,
        });
      } catch (err) {
        console.warn('[inventoryRepository] Fallback local submitCount:', err);
      }
    }

    const effectiveCtx: SecurityContext = context || {
      userId: 'user-staff',
      userName: 'Responsável Estoque',
      userRole: 'OWNER',
      tenantId,
    };

    const { products } = buildTenantProductBalances(effectiveCtx, tenantId);

    const items = counts.map(c => {
      if (!Number.isFinite(c.counted_quantity) || c.counted_quantity < 0) {
        throw new Error('A quantidade contada não pode ser negativa.');
      }
      const bal =
        products.find(p => p.productId === c.product_id && p.locationId === locationId) ||
        products.find(p => p.productId === c.product_id);
      if (!bal) throw new Error(`Produto ${c.product_id} não encontrado neste local.`);

      const expected = bal.physicalQuantity;
      const counted = roundStockQty(c.counted_quantity);
      const divergence = roundStockQty(counted - expected);
      return {
        productId: bal.productId,
        productName: bal.productName,
        expectedQuantity: expected,
        countedQuantity: counted,
        divergenceQuantity: divergence,
        unitCost: bal.costPrice,
        divergenceValue: roundCurrency(divergence * bal.costPrice),
        unit: bal.unit,
        reason: c.reason,
      };
    });

    const newCount: StockCount = {
      id: `cnt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId,
      locationId,
      status: asDraft ? 'DRAFT' : 'PENDING',
      submittedAt: new Date().toISOString(),
      submittedBy: effectiveCtx.userId,
      submittedByName: effectiveCtx.userName,
      items,
    };

    extendedState.counts.unshift(newCount);
    persistExtendedState();
    return newCount;
  },

  async promoteDraftCount(
    context: SecurityContext,
    tenantId: string,
    countId: string
  ): Promise<StockCount> {
    validateTenantAccess(context, tenantId, 'PROMOTE_DRAFT_COUNT');
    validatePermission(context, 'manage_inventory');

    const count = extendedState.counts.find(c => c.id === countId && c.tenantId === tenantId);
    if (!count) throw new Error('Contagem física não encontrada.');
    if (count.status !== 'DRAFT') {
      throw new Error('Somente contagens em rascunho podem ser enviadas para aprovação.');
    }
    count.status = 'PENDING';
    count.submittedBy = context.userId;
    count.submittedByName = context.userName;
    count.submittedAt = new Date().toISOString();
    persistExtendedState();
    return { ...count };
  },

  async approveCount(
    countId: string,
    approve: boolean,
    reason?: string,
    context?: SecurityContext,
    tenantId?: string
  ): Promise<StockCount> {
    const localCount = extendedState.counts.find(
      c => c.id === countId && (!tenantId || c.tenantId === tenantId)
    );

    const targetTenantId = tenantId || localCount?.tenantId || context?.tenantId || '';
    if (context && targetTenantId) {
      validateTenantAccess(context, targetTenantId, 'APPROVE_STOCK_COUNT');
      assertManagerPermission(context);
    }

    if (isSupabaseConfigured && isValidUuid(countId)) {
      try {
        await stockRpc('stock_approve_count', {
          p_count_id: countId,
          p_approve: approve,
          p_reason: reason || null,
        });
      } catch (err) {
        console.warn('[inventoryRepository] Fallback local approveCount:', err);
      }
    }

    if (!localCount) {
      throw new Error('Contagem de inventário não encontrada.');
    }
    if (localCount.status !== 'PENDING') {
      throw new Error('Esta contagem já foi revisada ou ainda está em rascunho.');
    }

    const effectiveCtx: SecurityContext = context || {
      userId: 'user-owner',
      userName: 'Gerente / Proprietário',
      userRole: 'OWNER',
      tenantId: localCount.tenantId,
    };

    assertManagerPermission(effectiveCtx);

    if (!approve) {
      localCount.status = 'REJECTED';
      localCount.approvedBy = effectiveCtx.userId;
      localCount.approvedByName = effectiveCtx.userName;
      localCount.approvedAt = new Date().toISOString();
      localCount.notes = reason || 'Contagem rejeitada sem alteração de saldos.';
      persistExtendedState();
      return { ...localCount };
    }

    for (const item of localCount.items) {
      const delta = roundStockQty(item.countedQuantity - item.expectedQuantity);
      if (delta !== 0) {
        dataStore.recordInventoryMovement(effectiveCtx, localCount.tenantId, {
          productId: item.productId,
          delta,
          type: 'COUNT_ADJUSTMENT',
          reason:
            reason?.trim() ||
            item.reason ||
            `Ajuste aprovado após inventário físico (${item.expectedQuantity} → ${item.countedQuantity} ${item.unit})`,
          referenceId: localCount.id,
          inventoryCountId: localCount.id,
          locationId: localCount.locationId,
          unit: item.unit,
          approvedByName: effectiveCtx.userName,
        });
      }
    }

    localCount.status = 'APPROVED';
    localCount.approvedBy = effectiveCtx.userId;
    localCount.approvedByName = effectiveCtx.userName;
    localCount.approvedAt = new Date().toISOString();
    localCount.notes = reason || 'Ajustes aplicados ao histórico de movimentações.';
    persistExtendedState();
    return { ...localCount };
  },

  async getAdjustmentRequests(
    context: SecurityContext,
    tenantId: string
  ): Promise<StockAdjustmentRequest[]> {
    validateTenantAccess(context, tenantId, 'GET_ADJUSTMENT_REQUESTS');
    validatePermission(context, 'manage_inventory');

    return extendedState.adjustmentRequests
      .filter(r => r.tenantId === tenantId)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  },

  /**
   * Registra movimentação auditável ou cria solicitação aguardando aprovação (ETAPA 4 & 10).
   */
  async recordMovement(
    input: {
      tenantId: string;
      productId: string;
      locationId: string;
      type: InventoryMovementType | string;
      quantity: number;
      inputUnit?: StockUnit;
      reason: string;
      supplierReference?: string;
      lotCode?: string;
      expiresOn?: string;
      orderId?: string;
      unitCost?: number;
      requireApproval?: boolean;
    },
    context?: SecurityContext
  ): Promise<{ movement?: InventoryMovement; pendingRequest?: StockAdjustmentRequest }> {
    const effectiveCtx: SecurityContext = context || {
      userId: 'user-owner-adega',
      userName: 'Responsável Estoque',
      userRole: 'OWNER',
      tenantId: input.tenantId,
    };

    validateTenantAccess(effectiveCtx, input.tenantId, 'RECORD_STOCK_MOVEMENT');
    validatePermission(effectiveCtx, 'manage_inventory');

    if (!Number.isFinite(input.quantity) || input.quantity === 0) {
      throw new Error('Informe uma quantidade válida diferente de zero.');
    }
    if (!input.reason || !input.reason.trim()) {
      throw new Error('A justificativa / motivo é obrigatória para qualquer movimentação.');
    }

    const product = dataStore.getProductById(effectiveCtx, input.tenantId, input.productId);
    if (!product) throw new Error('Produto não encontrado neste estabelecimento.');

    const baseUnit = (product.stockUnit || 'un') as StockUnit;
    const entryUnit = input.inputUnit || baseUnit;
    const convertedAbsQuantity = convertStockQuantity(
      Math.abs(input.quantity),
      entryUnit,
      baseUnit,
      product.packageQuantity
    );

    const isOutbound = [
      'SAIDA',
      'VENDA',
      'SALE',
      'LOSS',
      'PERDA',
      'DAMAGE',
      'EXPIRY',
      'CONSUMPTION',
      'RESERVATION',
      'TRANSFER_OUT',
    ].includes(input.type);

    const signedDelta =
      input.type === 'WEIGHT_CORRECTION' || input.type === 'COUNT_ADJUSTMENT' || input.type === 'AJUSTE'
        ? input.quantity < 0
          ? -convertedAbsQuantity
          : convertedAbsQuantity
        : isOutbound
          ? -convertedAbsQuantity
          : convertedAbsQuantity;

    const currentPhysical = Number(product.stockQuantity || 0);
    if (currentPhysical + signedDelta < 0) {
      throw new Error(
        `Operação bloqueada: o saldo físico não pode ficar negativo (atual: ${currentPhysical} ${baseUnit}, solicitado: ${signedDelta} ${baseUnit}).`
      );
    }

    // Se o operador não for gerente/proprietário ou se for solicitada aprovação explícita para perdas/ajustes críticos
    const isManager =
      effectiveCtx.userRole === 'OWNER' ||
      effectiveCtx.userRole === 'MANAGER' ||
      effectiveCtx.userRole === 'CEO' ||
      effectiveCtx.userRole === 'SUPER_ADMIN';

    if (
      input.requireApproval ||
      (!isManager &&
        ['COUNT_ADJUSTMENT', 'AJUSTE', 'LOSS', 'DAMAGE', 'EXPIRY', 'WEIGHT_CORRECTION'].includes(
          input.type
        ))
    ) {
      const req: StockAdjustmentRequest = {
        id: `adj-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        tenantId: input.tenantId,
        productId: product.id,
        productName: product.name,
        locationId: input.locationId,
        type: input.type as InventoryMovementType,
        previousQuantity: currentPhysical,
        newQuantity: roundStockQty(currentPhysical + signedDelta),
        delta: signedDelta,
        unit: baseUnit,
        reason: input.reason.trim(),
        lotCode: input.lotCode,
        status: 'PENDING_APPROVAL',
        requestedBy: effectiveCtx.userId,
        requestedByName: effectiveCtx.userName,
        requestedAt: new Date().toISOString(),
      };
      extendedState.adjustmentRequests.unshift(req);
      persistExtendedState();
      return { pendingRequest: req };
    }

    if (isSupabaseConfigured && isValidUuid(input.tenantId) && isValidUuid(input.productId)) {
      try {
        await stockRpc('stock_record_movement', {
          p_tenant_id: input.tenantId,
          p_product_id: input.productId,
          p_location_id: input.locationId,
          p_type: input.type,
          p_quantity: Math.abs(signedDelta),
          p_reason: input.reason,
          p_supplier_reference: input.supplierReference || null,
          p_lot_code: input.lotCode || null,
          p_order_id: input.orderId || null,
          p_unit_cost: input.unitCost ?? null,
        });
      } catch (err) {
        console.warn('[inventoryRepository] Fallback local recordMovement:', err);
      }
    }

    // Rastreabilidade de lote quando habilitada (FEFO ou lote informado)
    let resolvedLotId: string | undefined;
    let resolvedLotCode = input.lotCode?.trim().toUpperCase();

    if (product.trackLots) {
      const productLots = extendedState.lots.filter(
        l => l.tenantId === input.tenantId && l.productId === product.id
      );

      if (signedDelta > 0 && ['RECEIPT', 'ENTRADA'].includes(input.type)) {
        if (!resolvedLotCode) {
          throw new Error(`O produto "${product.name}" exige identificação de lote na entrada.`);
        }
        const lot = await this.createOrUpdateLot(effectiveCtx, input.tenantId, {
          productId: product.id,
          locationId: input.locationId,
          lotCode: resolvedLotCode,
          supplierName: input.supplierReference,
          expiresOn: input.expiresOn,
          receivedQuantity: signedDelta,
          unitCost: input.unitCost ?? product.cost ?? 0,
          recordReceiptMovement: false,
        });
        resolvedLotId = lot.id;
      } else if (signedDelta < 0) {
        if (resolvedLotCode) {
          const targetLot = productLots.find(l => l.lotCode === resolvedLotCode);
          if (!targetLot) {
            throw new Error(`Lote "${resolvedLotCode}" não encontrado para o produto "${product.name}".`);
          }
          if (
            ['SALE', 'VENDA', 'CONSUMPTION'].includes(input.type) &&
            evaluateLotStatus(targetLot) !== 'ACTIVE'
          ) {
            throw new Error(
              `O lote "${resolvedLotCode}" está ${evaluateLotStatus(targetLot)} e não pode ser utilizado para venda/consumo.`
            );
          }
          if (targetLot.remainingQuantity < Math.abs(signedDelta)) {
            throw new Error(
              `Saldo insuficiente no lote "${resolvedLotCode}" (restante: ${targetLot.remainingQuantity} ${baseUnit}).`
            );
          }
          targetLot.remainingQuantity = roundStockQty(
            targetLot.remainingQuantity - Math.abs(signedDelta)
          );
          targetLot.status = evaluateLotStatus(targetLot);
          resolvedLotId = targetLot.id;
        } else if (productLots.length > 0) {
          // Alocação automática FEFO (Primeiro que Vence, Primeiro que Sai)
          const fefo = selectLotsFEFO(productLots, Math.abs(signedDelta));
          if (fefo.unfulfilledQuantity > 0 && ['SALE', 'VENDA', 'CONSUMPTION'].includes(input.type)) {
            throw new Error(
              `Saldo em lotes válidos insuficiente para "${product.name}". Verifique se há lotes vencidos ou bloqueados.`
            );
          }
          for (const alloc of fefo.allocations) {
            const lotObj = productLots.find(l => l.id === alloc.lotId);
            if (lotObj) {
              lotObj.remainingQuantity = roundStockQty(
                lotObj.remainingQuantity - alloc.allocatedQuantity
              );
              lotObj.status = evaluateLotStatus(lotObj);
              resolvedLotId = lotObj.id;
              resolvedLotCode = lotObj.lotCode;
            }
          }
        }
      }
    }

    const conversionNote =
      entryUnit !== baseUnit
        ? ` [Convertido: ${Math.abs(input.quantity)} ${entryUnit} → ${convertedAbsQuantity} ${baseUnit}]`
        : '';

    const { movement } = dataStore.recordInventoryMovement(effectiveCtx, input.tenantId, {
      productId: product.id,
      delta: signedDelta,
      type: input.type as InventoryMovementType,
      reason: `${input.reason.trim()}${conversionNote}`,
      referenceId: input.orderId || input.supplierReference || resolvedLotCode,
      locationId: input.locationId,
      lotId: resolvedLotId,
      lotCode: resolvedLotCode,
      supplierReference: input.supplierReference,
      orderId: input.orderId,
      unitCost: input.unitCost,
      updateCostWeighted: ['RECEIPT', 'ENTRADA'].includes(input.type) && input.unitCost !== undefined,
    });

    persistExtendedState();
    return { movement };
  },

  async reviewAdjustmentRequest(
    context: SecurityContext,
    tenantId: string,
    requestId: string,
    approve: boolean,
    reviewNotes?: string
  ): Promise<StockAdjustmentRequest> {
    validateTenantAccess(context, tenantId, 'REVIEW_ADJUSTMENT_REQUEST');
    assertManagerPermission(context);

    const req = extendedState.adjustmentRequests.find(
      r => r.id === requestId && r.tenantId === tenantId
    );
    if (!req) throw new Error('Solicitação de ajuste não encontrada.');
    if (req.status !== 'PENDING_APPROVAL') {
      throw new Error('Esta solicitação já foi processada.');
    }

    req.approvedBy = context.userId;
    req.approvedByName = context.userName;
    req.approvedAt = new Date().toISOString();
    req.reviewNotes = reviewNotes;

    if (!approve) {
      req.status = 'REJECTED';
      persistExtendedState();
      return { ...req };
    }

    dataStore.recordInventoryMovement(context, tenantId, {
      productId: req.productId,
      delta: req.delta,
      type: req.type,
      reason: `${req.reason} (Aprovado por ${context.userName})`,
      referenceId: req.id,
      locationId: req.locationId,
      lotCode: req.lotCode,
      approvedByName: context.userName,
    });

    req.status = 'COMPLETED';
    persistExtendedState();
    return { ...req };
  },

  async createIncoming(
    input: {
      tenantId: string;
      productId: string;
      quantity: number;
      supplierReference: string;
      unitCost: number;
      expectedAt?: string;
    },
    context?: SecurityContext
  ): Promise<PurchaseOrder> {
    const effectiveCtx: SecurityContext = context || {
      userId: 'user-owner-adega',
      userName: 'Responsável Compras',
      userRole: 'OWNER',
      tenantId: input.tenantId,
    };
    const po = await this.createPurchaseOrder(effectiveCtx, input.tenantId, {
      supplierId: input.supplierReference,
      expectedDeliveryDate: input.expectedAt,
      submitForApproval: false,
      items: [
        {
          productId: input.productId,
          orderedQuantity: input.quantity,
          unitCost: input.unitCost,
        },
      ],
    });
    return this.updatePurchaseOrderStatus(effectiveCtx, input.tenantId, po.id, 'APPROVE');
  },

  async receiveIncoming(
    incomingId: string,
    locationId: string,
    context?: SecurityContext
  ): Promise<void> {
    if (incomingId.includes(':')) {
      const [poId, itemId] = incomingId.split(':');
      const po = extendedState.purchaseOrders.find(p => p.id === poId);
      if (!po) throw new Error('Pedido de compra não encontrado.');
      const item = po.items.find(i => i.id === itemId);
      if (!item) throw new Error('Item do pedido de compra não encontrado.');
      const remaining = roundStockQty(item.orderedQuantity - item.receivedQuantity);
      const effectiveCtx: SecurityContext = context || {
        userId: 'user-owner-adega',
        userName: 'Responsável Recebimento',
        userRole: 'OWNER',
        tenantId: po.tenantId,
      };
      await this.receivePurchaseOrder(effectiveCtx, po.tenantId, po.id, [
        {
          itemId: item.id,
          receivedNowQuantity: remaining,
          unitCost: item.unitCost,
          lotCode: `LOTE-${po.code}`,
        },
      ]);
      return;
    }

    if (isSupabaseConfigured && isValidUuid(incomingId)) {
      await stockRpc('stock_receive_incoming', {
        p_incoming_id: incomingId,
        p_location_id: locationId,
      });
    }
  },

  async addLocation(
    tenantId: string,
    name: string,
    context?: SecurityContext
  ): Promise<StockLocation> {
    if (context) {
      validateTenantAccess(context, tenantId, 'ADD_STOCK_LOCATION');
      assertManagerPermission(context);
    }
    const clean = name.trim();
    if (clean.length < 2) throw new Error('Informe um nome válido para o local de estoque.');

    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        await stockRpc('stock_add_location', { p_tenant_id: tenantId, p_name: clean });
      } catch (err) {
        console.warn('[inventoryRepository] Fallback local addLocation:', err);
      }
    }

    const locs = ensureTenantLocations(tenantId);
    if (locs.some(l => l.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error('Já existe um local de estoque com este nome neste estabelecimento.');
    }
    const created: StockLocation = {
      id: `loc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: clean,
      isDefault: false,
    };
    locs.push(created);
    persistExtendedState();
    return created;
  },

  async setBlock(
    context: SecurityContext,
    input: {
      tenantId: string;
      productId: string;
      locationId: string;
      quantity: number;
      reason: string;
      block: boolean;
    }
  ): Promise<void> {
    validateTenantAccess(context, input.tenantId, 'SET_STOCK_BLOCK');
    assertManagerPermission(context);

    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new Error('Informe uma quantidade válida para bloqueio/desbloqueio.');
    }
    if (!input.reason || !input.reason.trim()) {
      throw new Error('Informe o motivo do bloqueio/desbloqueio.');
    }

    if (input.block) {
      const { products } = buildTenantProductBalances(context, input.tenantId);
      const bal = products.find(
        p => p.productId === input.productId && p.locationId === input.locationId
      );
      if (!bal || bal.availableQuantity < input.quantity) {
        throw new Error(
          `Saldo disponível insuficiente para bloqueio (disponível: ${bal?.availableQuantity ?? 0}).`
        );
      }
      extendedState.blocks.push({
        id: `blk-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        tenantId: input.tenantId,
        productId: input.productId,
        locationId: input.locationId,
        quantity: roundStockQty(input.quantity),
        reason: input.reason.trim(),
        status: 'ACTIVE',
        createdBy: context.userId,
        createdByName: context.userName,
        createdAt: new Date().toISOString(),
      });
    } else {
      const activeBlocks = extendedState.blocks.filter(
        b =>
          b.tenantId === input.tenantId &&
          b.productId === input.productId &&
          b.locationId === input.locationId &&
          b.status === 'ACTIVE'
      );
      let toRelease = roundStockQty(input.quantity);
      for (const blk of activeBlocks) {
        if (toRelease <= 0) break;
        if (blk.quantity <= toRelease) {
          toRelease = roundStockQty(toRelease - blk.quantity);
          blk.status = 'RELEASED';
          blk.releasedAt = new Date().toISOString();
        } else {
          blk.quantity = roundStockQty(blk.quantity - toRelease);
          toRelease = 0;
        }
      }
    }
    persistExtendedState();
  },

  async updateSettings(
    input: {
      tenantId: string;
      productId: string;
      unit: StockUnit | string;
      stockControlMode?: StockControlMode;
      packageQuantity?: number;
      leadTimeDays?: number;
      minOrderQty?: number;
      minStock: number;
      safetyStock: number;
      trackLots: boolean;
      trackSerials?: boolean;
      isResale: boolean;
      convertExistingBalance?: boolean;
    },
    context?: SecurityContext
  ): Promise<void> {
    const effectiveCtx: SecurityContext = context || {
      userId: 'user-owner-adega',
      userName: 'Proprietário',
      userRole: 'OWNER',
      tenantId: input.tenantId,
    };

    validateTenantAccess(effectiveCtx, input.tenantId, 'UPDATE_PRODUCT_STOCK_SETTINGS');
    assertManagerPermission(effectiveCtx);

    if (input.minStock < 0 || input.safetyStock < 0) {
      throw new Error('Estoque mínimo e estoque de segurança não podem ser negativos.');
    }

    const product = dataStore.getProductById(effectiveCtx, input.tenantId, input.productId);
    if (!product) throw new Error('Produto não encontrado neste estabelecimento.');

    const currentUnit = (product.stockUnit ||
      (['un', 'kg', 'g', 'l', 'ml', 'm', 'cm', 'm2', 'cm2', 'pack', 'cx', 'fd'].includes(
        (product.unit || '').toLowerCase()
      )
        ? (product.unit.toLowerCase() as StockUnit)
        : 'un')) as StockUnit;
    const nextUnit = input.unit as StockUnit;

    const migration = validateUnitMigration(
      currentUnit,
      nextUnit,
      Number(product.stockQuantity || 0),
      input.packageQuantity || product.packageQuantity
    );

    if (!migration.valid) {
      throw new Error(migration.errorMessage);
    }

    if (migration.requiresExplicitConversion && migration.convertedBalance !== undefined) {
      const prevQty = Number(product.stockQuantity || 0);
      const nextQty = migration.convertedBalance;
      const diff = roundStockQty(nextQty - prevQty);
      if (diff !== 0) {
        dataStore.recordInventoryMovement(effectiveCtx, input.tenantId, {
          productId: product.id,
          delta: diff,
          type: 'AJUSTE',
          reason: `Conversão auditada de unidade-base: ${prevQty} ${currentUnit} → ${nextQty} ${nextUnit}`,
          unit: nextUnit,
          approvedByName: effectiveCtx.userName,
        });
      }
    }

    dataStore.updateProduct(effectiveCtx, input.tenantId, input.productId, {
      unit: nextUnit,
      stockUnit: nextUnit,
      stockControlMode: input.stockControlMode || product.stockControlMode,
      packageQuantity: input.packageQuantity ?? product.packageQuantity,
      leadTimeDays: input.leadTimeDays ?? product.leadTimeDays,
      minOrderQty: input.minOrderQty ?? product.minOrderQty,
      minStock: input.minStock,
      safetyStock: input.safetyStock,
      trackLots: input.trackLots,
      trackSerials: input.trackSerials ?? product.trackSerials,
      stockIsResale: input.isResale,
    });

    if (isSupabaseConfigured && isValidUuid(input.tenantId)) {
      try {
        await stockRpc('stock_update_product_settings', {
          p_tenant_id: input.tenantId,
          p_product_id: input.productId,
          p_stock_unit: input.unit,
          p_min_stock: input.minStock,
          p_safety_stock: input.safetyStock,
          p_track_lots: input.trackLots,
          p_is_resale: input.isResale,
        });
      } catch (err) {
        console.warn('[inventoryRepository] Fallback local updateSettings:', err);
      }
    }
  },

  async transfer(
    input: {
      tenantId: string;
      productId: string;
      fromLocation: string;
      toLocation: string;
      quantity: number;
      reason: string;
    },
    context?: SecurityContext
  ): Promise<void> {
    const effectiveCtx: SecurityContext = context || {
      userId: 'user-owner-adega',
      userName: 'Responsável Estoque',
      userRole: 'OWNER',
      tenantId: input.tenantId,
    };

    validateTenantAccess(effectiveCtx, input.tenantId, 'TRANSFER_STOCK');
    validatePermission(effectiveCtx, 'manage_inventory');

    if (!input.fromLocation || !input.toLocation || input.fromLocation === input.toLocation) {
      throw new Error('Selecione locais de origem e destino diferentes.');
    }
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new Error('A quantidade a transferir deve ser maior que zero.');
    }
    if (!input.reason || !input.reason.trim()) {
      throw new Error('Informe o motivo da transferência entre locais.');
    }

    const { products, locations } = buildTenantProductBalances(effectiveCtx, input.tenantId);
    const fromBal = products.find(
      p => p.productId === input.productId && p.locationId === input.fromLocation
    );
    const toLoc = locations.find(l => l.id === input.toLocation);
    const defaultLoc = locations.find(l => l.isDefault) || locations[0];

    if (!fromBal || !toLoc) {
      throw new Error('Local de origem ou destino não encontrado.');
    }
    if (fromBal.availableQuantity < input.quantity) {
      throw new Error(
        `Saldo disponível insuficiente na origem (${fromBal.availableQuantity} ${fromBal.unit}).`
      );
    }

    if (input.fromLocation !== defaultLoc.id) {
      const fromKey = `${input.tenantId}:${input.fromLocation}:${input.productId}`;
      extendedState.locationBalances[fromKey] = roundStockQty(
        Math.max(0, (extendedState.locationBalances[fromKey] || 0) - input.quantity)
      );
    }
    if (input.toLocation !== defaultLoc.id) {
      const toKey = `${input.tenantId}:${input.toLocation}:${input.productId}`;
      extendedState.locationBalances[toKey] = roundStockQty(
        (extendedState.locationBalances[toKey] || 0) + input.quantity
      );
    }

    const refId = `trf-${Date.now()}`;
    dataStore.recordInventoryMovement(effectiveCtx, input.tenantId, {
      productId: input.productId,
      delta: 0,
      type: 'TRANSFER_OUT',
      reason: `Transferência enviada (${fromBal.locationName} → ${toLoc.name}): ${input.quantity} ${fromBal.unit} — ${input.reason.trim()}`,
      referenceId: refId,
      locationId: input.fromLocation,
      locationName: fromBal.locationName,
    });
    dataStore.recordInventoryMovement(effectiveCtx, input.tenantId, {
      productId: input.productId,
      delta: 0,
      type: 'TRANSFER_IN',
      reason: `Transferência recebida (${fromBal.locationName} → ${toLoc.name}): ${input.quantity} ${fromBal.unit} — ${input.reason.trim()}`,
      referenceId: refId,
      locationId: input.toLocation,
      locationName: toLoc.name,
    });

    persistExtendedState();
  },

  /**
   * Reserva atômica de estoque para pedidos (ETAPA 4 — evita que dois pedidos comprometam a mesma unidade disponível).
   */
  async reserveOrderStock(
    context: SecurityContext,
    tenantId: string,
    orderId: string,
    items: Array<{ productId: string; quantity: number }>
  ): Promise<StockReservationRecord[]> {
    validateTenantAccess(context, tenantId, 'RESERVE_ORDER_STOCK');

    const { products, locations } = buildTenantProductBalances(context, tenantId);
    const defaultLoc = locations.find(l => l.isDefault) || locations[0];

    // Pré-validação integral antes de gravar qualquer reserva (atomicidade)
    for (const item of items) {
      const bal = products.find(
        p => p.productId === item.productId && p.locationId === defaultLoc.id
      );
      if (!bal) throw new Error(`Produto ${item.productId} não encontrado no estoque.`);
      if (bal.stockControlMode === 'NONE') continue;
      if (bal.availableQuantity < item.quantity) {
        throw new Error(
          `OUT_OF_STOCK: Estoque disponível insuficiente para "${bal.productName}" (disponível: ${bal.availableQuantity} ${bal.unit}, solicitado: ${item.quantity} ${bal.unit}).`
        );
      }
    }

    const created: StockReservationRecord[] = [];
    for (const item of items) {
      const bal = products.find(
        p => p.productId === item.productId && p.locationId === defaultLoc.id
      )!;
      if (bal.stockControlMode === 'NONE') continue;

      const res: StockReservationRecord = {
        id: `res-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        tenantId,
        orderId,
        productId: item.productId,
        locationId: defaultLoc.id,
        quantity: roundStockQty(item.quantity),
        unit: bal.unit,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
      };
      extendedState.reservations.push(res);
      created.push(res);
    }

    persistExtendedState();
    return created;
  },

  async finalizeOrderStock(
    context: SecurityContext,
    tenantId: string,
    orderId: string,
    outcome: 'SALE_COMPLETED' | 'CANCELLED_RELEASE'
  ): Promise<void> {
    validateTenantAccess(context, tenantId, 'FINALIZE_ORDER_STOCK');

    const activeRes = extendedState.reservations.filter(
      r => r.tenantId === tenantId && r.orderId === orderId && r.status === 'ACTIVE'
    );

    for (const res of activeRes) {
      if (outcome === 'SALE_COMPLETED') {
        res.status = 'CONVERTED';
        res.closedAt = new Date().toISOString();
        dataStore.recordInventoryMovement(context, tenantId, {
          productId: res.productId,
          delta: -res.quantity,
          type: 'SALE',
          reason: `Baixa definitiva por conclusão do pedido #${orderId}`,
          referenceId: orderId,
          orderId,
          locationId: res.locationId,
          unit: res.unit,
        });
      } else {
        res.status = 'RELEASED';
        res.closedAt = new Date().toISOString();
        dataStore.recordInventoryMovement(context, tenantId, {
          productId: res.productId,
          delta: 0,
          type: 'CANCEL_RELEASE',
          reason: `Reserva liberada por cancelamento do pedido #${orderId}`,
          referenceId: orderId,
          orderId,
          locationId: res.locationId,
          unit: res.unit,
        });
      }
    }

    persistExtendedState();
  },

  async expireReservation(tenantId: string, orderId: string): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(orderId)) {
      await stockRpc('stock_expire_pending_reservations', {
        p_tenant_id: tenantId,
        p_order_id: orderId,
      });
    }
  },

  async adjustStock(
    context: SecurityContext,
    tenantId: string,
    productId: string,
    quantityDiff: number,
    type: InventoryMovementType,
    reason: string,
    referenceId?: string
  ): Promise<{ previousStock: number; newStock: number }> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(productId)) {
      const { data, error } = await supabase.rpc('adjust_inventory', {
        p_product_id: productId,
        p_quantity: quantityDiff,
        p_type: type,
        p_reason: reason,
        p_reference_id: referenceId || null,
      });
      if (error) throw toBackendError(error, 'Falha ao ajustar o estoque.');
      if (data)
        return {
          previousStock: Number(data.previousStock),
          newStock: Number(data.newStock),
        };
      throw new Error('O servidor não confirmou o ajuste de estoque.');
    }
    const prod: Product = dataStore.adjustProductStock(
      context,
      tenantId,
      productId,
      quantityDiff,
      reason,
      type,
      referenceId
    );
    return { previousStock: prod.stockQuantity - quantityDiff, newStock: prod.stockQuantity };
  },
};
