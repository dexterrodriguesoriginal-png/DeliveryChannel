import { describe, expect, it } from 'vitest';
import { businessUsesStock, stockAlerts, stockStatus, stockSummary } from '../stock';
import { StockProductBalance } from '../../types';

const balance = (overrides: Partial<StockProductBalance> = {}): StockProductBalance => ({
  productId: 'p1',
  productName: 'Produto',
  locationId: 'l1',
  locationName: 'Principal',
  price: 10,
  unit: 'un',
  physicalQuantity: 8,
  reservedQuantity: 2,
  blockedQuantity: 1,
  availableQuantity: 5,
  incomingQuantity: 4,
  minStock: 5,
  safetyStock: 2,
  trackLots: false,
  stockIsResale: false,
  isActive: true,
  costPrice: 3,
  stockStatus: 'BELOW_MINIMUM',
  ...overrides,
});

describe('stock helpers', () => {
  it('derives empty, critical, and healthy stock status from available quantity', () => {
    expect(stockStatus(0, 0)).toBe('OUT_OF_STOCK');
    expect(stockStatus(2, 3)).toBe('BELOW_MINIMUM');
    expect(stockStatus(4, 3)).toBe('OK');
  });

  it('creates alerts with a distinct cause and suggested action', () => {
    expect(stockAlerts([
      balance({ availableQuantity: 0, minStock: 0 }),
      balance({ productId: 'p2', availableQuantity: 2, minStock: 5 }),
      balance({ productId: 'p3', isActive: false, availableQuantity: 0 }),
    ])).toMatchObject([
      { productId: 'p1', cause: 'OUT_OF_STOCK', suggestedAction: expect.stringContaining('recebimento') },
      { productId: 'p2', cause: 'BELOW_MINIMUM', suggestedAction: expect.stringContaining('Repor') },
    ]);
  });

  it('counts distinct active SKUs and values physical stock at weighted-average cost', () => {
    expect(stockSummary([
      balance({ physicalQuantity: 8, costPrice: 3 }),
      balance({ locationId: 'l2', physicalQuantity: 2, costPrice: 3 }),
      balance({ productId: 'p2', physicalQuantity: 1.5, costPrice: 8, minStock: 0 }),
    ])).toEqual({
      activeSkus: 2,
      criticalStock: 2,
      inventoryValue: 42,
      alertCount: 2,
    });
  });

  it('hides stock navigation for business types that do not use inventory', () => {
    expect(businessUsesStock('OUTRO')).toBe(false);
    expect(businessUsesStock('SALAO_BARBEARIA')).toBe(true);
    expect(businessUsesStock(undefined)).toBe(true);
  });
});
