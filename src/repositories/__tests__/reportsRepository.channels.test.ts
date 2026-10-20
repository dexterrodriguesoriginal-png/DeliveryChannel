import { describe, expect, it } from 'vitest';
import { summarizeSalesByChannel } from '../reportsRepository';

describe('sales by fulfillment channel', () => {
  it('includes Salão and excludes cancelled orders from counts and revenue', () => {
    expect(summarizeSalesByChannel([
      { fulfillment_type: 'DELIVERY', total_amount: 30, status: 'DELIVERED' },
      { fulfillment_type: 'PICKUP', total_amount: 20, status: 'READY' },
      { fulfillment_type: 'DINE_IN', total_amount: '45.5', status: 'CONFIRMED' },
      { fulfillment_type: 'DINE_IN', total_amount: 100, status: 'CANCELLED' },
    ])).toEqual([
      { channel: 'DELIVERY', label: 'Entrega', orderCount: 1, revenue: 30 },
      { channel: 'PICKUP', label: 'Retirada', orderCount: 1, revenue: 20 },
      { channel: 'DINE_IN', label: 'Salão', orderCount: 1, revenue: 45.5 },
    ]);
  });
});
