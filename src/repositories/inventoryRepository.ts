import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  InventoryMovement,
  InventoryMovementType,
  Product,
  StockCount,
  StockLocation,
  StockProductBalance,
} from '../types';
import { dataStore } from '../services/dataStore';
import { SecurityContext } from '../services/securityEngine';
import { isValidUuid } from '../lib/uuid';
import { localOnly } from '../lib/backend';
import { toBackendError } from '../lib/backend';

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
    timestamp: row.created_at,
    unit: row.unit || 'un',
    locationId: row.location_id || undefined,
    actorUserId: row.actor_user_id || undefined,
    orderId: row.order_id || undefined,
    supplierReference: row.supplier_reference || undefined,
    lotId: row.lot_id || undefined,
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
    unit: row.unit,
    physicalQuantity: Number(row.physical_quantity || 0),
    reservedQuantity: Number(row.reserved_quantity || 0),
    blockedQuantity: Number(row.blocked_quantity || 0),
    availableQuantity: Number(row.available_quantity || 0),
    incomingQuantity: Number(row.incoming_quantity || 0),
    minStock: Number(row.min_stock || 0),
    safetyStock: Number(row.safety_stock || 0),
    trackLots: Boolean(row.track_lots),
    stockIsResale: Boolean(row.stock_is_resale),
    isActive: Boolean(row.is_active),
    costPrice: Number(row.cost_price || 0),
    stockStatus: row.stock_status,
  };
}

function requireConnectedTenant(tenantId: string): void {
  if (!isSupabaseConfigured || !isValidUuid(tenantId)) {
    throw new Error('Esta operação de estoque precisa de uma loja conectada ao servidor.');
  }
}

async function stockRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw toBackendError(error, 'Falha na operação de estoque.');
  return data as T;
}

export const inventoryRepository = {
  async getDashboard(context: SecurityContext, tenantId: string): Promise<StockDashboard> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
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
    }

    const products = localOnly('estoque', () => dataStore.getProducts(context, tenantId));
    const balances = products.filter(product => product.isActive).map(mapLocalProduct);
    const alerts = balances.filter(product => product.availableQuantity <= product.minStock).map(product => ({
      productId: product.productId,
      productName: product.productName,
      locationId: product.locationId,
      cause: product.availableQuantity <= 0 ? 'OUT_OF_STOCK' as const : 'BELOW_MINIMUM' as const,
      suggestedAction: product.availableQuantity <= 0
        ? 'Registrar recebimento ou revisar pedido de compra.'
        : 'Repor até o estoque mínimo configurado.',
      available: product.availableQuantity,
      minimum: product.minStock,
    }));
    return {
      products: balances,
      alerts,
      locations: [{ id: 'local-default', name: 'Estoque principal', isDefault: true }],
      summary: {
        activeSkus: balances.length,
        criticalStock: alerts.length,
        inventoryValue: balances.reduce((sum, product) => sum + product.physicalQuantity * product.costPrice, 0),
        alertCount: alerts.length,
      },
    };
  },

  async getMovements(context: SecurityContext, tenantId: string): Promise<InventoryMovement[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      const { data, error } = await supabase
        .from('inventory_movements')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw toBackendError(error, 'Falha ao carregar movimentações de estoque.');
      return (data || []).map(mapRowToMovement);
    }
    return localOnly('estoque', () => dataStore.getInventoryMovements(context, tenantId));
  },

  async getIncoming(tenantId: string): Promise<StockIncoming[]> {
    requireConnectedTenant(tenantId);
    const { data, error } = await supabase.from('stock_incoming')
      .select('id, product_id, quantity, supplier_reference, unit_cost, expected_at')
      .eq('tenant_id', tenantId).eq('status', 'CONFIRMED').order('created_at');
    if (error) throw toBackendError(error, 'Falha ao carregar compras confirmadas.');
    return (data || []).map((row: any) => ({
      id: row.id,
      productId: row.product_id,
      quantity: Number(row.quantity),
      supplierReference: row.supplier_reference,
      unitCost: Number(row.unit_cost),
      expectedAt: row.expected_at || undefined,
    }));
  },

  async getCounts(tenantId: string): Promise<StockCount[]> {
    requireConnectedTenant(tenantId);
    const { data, error } = await supabase.from('stock_counts')
      .select('id, tenant_id, location_id, status, submitted_at')
      .eq('tenant_id', tenantId).order('submitted_at', { ascending: false });
    if (error) throw toBackendError(error, 'Falha ao carregar contagens físicas.');
    const counts = data || [];
    if (!counts.length) return [];
    const { data: items, error: itemsError } = await supabase.from('stock_count_items')
      .select('count_id, product_id, expected_quantity, counted_quantity, unit')
      .eq('tenant_id', tenantId).in('count_id', counts.map((count: any) => count.id));
    if (itemsError) throw toBackendError(itemsError, 'Falha ao carregar itens das contagens.');
    const { data: products, error: productsError } = await supabase.from('products')
      .select('id, name').eq('tenant_id', tenantId);
    if (productsError) throw toBackendError(productsError, 'Falha ao carregar nomes de produtos.');
    const names = new Map((products || []).map((product: any) => [product.id, product.name]));
    return counts.map((count: any) => ({
      id: count.id,
      tenantId: count.tenant_id,
      locationId: count.location_id,
      status: count.status,
      submittedAt: count.submitted_at,
      items: (items || []).filter((item: any) => item.count_id === count.id).map((item: any) => ({
        productId: item.product_id,
        productName: names.get(item.product_id) || 'Produto',
        expectedQuantity: Number(item.expected_quantity),
        countedQuantity: Number(item.counted_quantity),
        unit: item.unit,
      })),
    }));
  },

  async recordMovement(input: {
    tenantId: string;
    productId: string;
    locationId: string;
    type: string;
    quantity: number;
    reason: string;
    supplierReference?: string;
    lotCode?: string;
  }): Promise<void> {
    requireConnectedTenant(input.tenantId);
    await stockRpc('stock_record_movement', {
      p_tenant_id: input.tenantId,
      p_product_id: input.productId,
      p_location_id: input.locationId,
      p_type: input.type,
      p_quantity: input.quantity,
      p_reason: input.reason,
      p_supplier_reference: input.supplierReference || null,
      p_lot_code: input.lotCode || null,
      p_order_id: null,
      p_unit_cost: null,
    });
  },

  async createIncoming(input: {
    tenantId: string;
    productId: string;
    quantity: number;
    supplierReference: string;
    unitCost: number;
    expectedAt?: string;
  }): Promise<void> {
    requireConnectedTenant(input.tenantId);
    await stockRpc('stock_create_incoming', {
      p_tenant_id: input.tenantId,
      p_product_id: input.productId,
      p_quantity: input.quantity,
      p_supplier_reference: input.supplierReference,
      p_unit_cost: input.unitCost,
      p_expected_at: input.expectedAt || null,
    });
  },

  async receiveIncoming(incomingId: string, locationId: string): Promise<void> {
    await stockRpc('stock_receive_incoming', { p_incoming_id: incomingId, p_location_id: locationId });
  },

  async submitCount(tenantId: string, locationId: string, counts: Array<{ product_id: string; counted_quantity: number }>): Promise<void> {
    requireConnectedTenant(tenantId);
    await stockRpc('stock_submit_count', {
      p_tenant_id: tenantId,
      p_location_id: locationId,
      p_counts: counts,
    });
  },

  async approveCount(countId: string, approve: boolean, reason?: string): Promise<void> {
    await stockRpc('stock_approve_count', {
      p_count_id: countId,
      p_approve: approve,
      p_reason: reason || null,
    });
  },

  async addLocation(tenantId: string, name: string): Promise<void> {
    requireConnectedTenant(tenantId);
    await stockRpc('stock_add_location', { p_tenant_id: tenantId, p_name: name });
  },

  async updateSettings(input: {
    tenantId: string;
    productId: string;
    unit: string;
    minStock: number;
    safetyStock: number;
    trackLots: boolean;
    isResale: boolean;
  }): Promise<void> {
    requireConnectedTenant(input.tenantId);
    await stockRpc('stock_update_product_settings', {
      p_tenant_id: input.tenantId,
      p_product_id: input.productId,
      p_stock_unit: input.unit,
      p_min_stock: input.minStock,
      p_safety_stock: input.safetyStock,
      p_track_lots: input.trackLots,
      p_is_resale: input.isResale,
    });
  },

  async transfer(input: {
    tenantId: string;
    productId: string;
    fromLocation: string;
    toLocation: string;
    quantity: number;
    reason: string;
  }): Promise<void> {
    requireConnectedTenant(input.tenantId);
    await stockRpc('stock_transfer', {
      p_tenant_id: input.tenantId,
      p_product_id: input.productId,
      p_from_location: input.fromLocation,
      p_to_location: input.toLocation,
      p_quantity: input.quantity,
      p_reason: input.reason,
    });
  },

  async expireReservation(tenantId: string, orderId: string): Promise<void> {
    requireConnectedTenant(tenantId);
    await stockRpc('stock_expire_pending_reservations', { p_tenant_id: tenantId, p_order_id: orderId });
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
      if (data) return {
        previousStock: Number(data.previousStock),
        newStock: Number(data.newStock),
      };
      throw new Error('O servidor não confirmou o ajuste de estoque.');
    }
    const prod: Product = dataStore.adjustProductStock(context, tenantId, productId, quantityDiff, reason);
    return { previousStock: prod.stockQuantity - quantityDiff, newStock: prod.stockQuantity };
  },
};

function mapLocalProduct(product: Product): StockProductBalance {
  const quantity = Number(product.stockQuantity || 0);
  const minStock = Number(product.minStock || 0);
  return {
    productId: product.id,
    productName: product.name,
    locationId: 'local-default',
    locationName: 'Estoque principal',
    sku: product.sku,
    imageUrl: product.imageUrl,
    price: product.price,
    unit: product.stockUnit || 'un',
    physicalQuantity: quantity,
    reservedQuantity: 0,
    blockedQuantity: 0,
    availableQuantity: quantity,
    incomingQuantity: 0,
    minStock,
    safetyStock: product.safetyStock || 0,
    trackLots: Boolean(product.trackLots),
    stockIsResale: Boolean(product.stockIsResale),
    isActive: product.isActive,
    costPrice: product.cost || 0,
    stockStatus: quantity <= 0 ? 'OUT_OF_STOCK' : quantity <= minStock ? 'BELOW_MINIMUM' : 'OK',
  };
}
