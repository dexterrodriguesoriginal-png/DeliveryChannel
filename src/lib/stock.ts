import { BusinessType, StockProductBalance } from '../types';

export function stockStatus(available: number, minimum: number): StockProductBalance['stockStatus'] {
  if (available <= 0) return 'OUT_OF_STOCK';
  if (available <= minimum) return 'BELOW_MINIMUM';
  return 'OK';
}

export function stockAlerts(products: StockProductBalance[]) {
  return products
    .filter(product => product.isActive && product.availableQuantity <= product.minStock)
    .map(product => ({
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
}

export function stockSummary(products: StockProductBalance[]) {
  const active = products.filter(product => product.isActive);
  return {
    activeSkus: new Set(active.map(product => product.productId)).size,
    criticalStock: active.filter(product => product.availableQuantity <= product.minStock).length,
    inventoryValue: active.reduce(
      (total, product) => total + Math.max(0, product.physicalQuantity) * product.costPrice,
      0
    ),
    alertCount: active.filter(product => product.availableQuantity <= product.minStock).length,
  };
}

export function businessUsesStock(type?: BusinessType | null): boolean {
  return type !== 'OUTRO';
}
