import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { InventoryMovement, InventoryMovementType } from '../types';
import { dataStore } from '../services/dataStore';
import { SecurityContext } from '../services/securityEngine';
import { isValidUuid } from '../lib/uuid';

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
  };
}

export const inventoryRepository = {
  async getMovements(context: SecurityContext, tenantId: string): Promise<InventoryMovement[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('inventory_movements')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false });

        if (error) {
          console.warn('[inventoryRepository] Erro ao carregar movimentações do Supabase:', error.message);
          return dataStore.getInventoryMovements(context, tenantId);
        }

        return (data || []).map(mapRowToMovement);
      } catch (err) {
        console.warn('[inventoryRepository] Falha ao consultar movimentações no Supabase:', err);
        return dataStore.getInventoryMovements(context, tenantId);
      }
    }
    return dataStore.getInventoryMovements(context, tenantId);
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
      try {
        const { data: rpcResult, error: rpcError } = await supabase.rpc('adjust_inventory', {
          p_product_id: productId,
          p_quantity: quantityDiff,
          p_type: type,
          p_reason: reason,
          p_reference_id: referenceId || null,
        });

        if (rpcError) {
          console.warn('[inventoryRepository] RPC adjust_inventory retornou erro, usando dataStore:', rpcError.message);
          const prod = dataStore.adjustProductStock(context, tenantId, productId, quantityDiff, reason);
          return {
            previousStock: prod.stockQuantity - quantityDiff,
            newStock: prod.stockQuantity
          };
        }

        if (rpcResult) {
          return {
            previousStock: Number(rpcResult.previousStock),
            newStock: Number(rpcResult.newStock),
          };
        }
      } catch (err) {
        console.warn('[inventoryRepository] Falha ao chamar adjust_inventory no Supabase:', err);
      }
    }

    const prod = dataStore.adjustProductStock(context, tenantId, productId, quantityDiff, reason);
    return {
      previousStock: prod.stockQuantity - quantityDiff,
      newStock: prod.stockQuantity
    };
  }
};
