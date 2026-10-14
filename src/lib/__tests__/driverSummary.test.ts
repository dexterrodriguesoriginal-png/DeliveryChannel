import { describe, it, expect } from 'vitest';
import { computeDriverDailySummary } from '../driverSummary';

const now = new Date('2026-10-14T15:00:00');
const o = (p: any) => ({ status: 'DELIVERED', driverId: 'd1', deliveryFee: 7, statusHistory: [], updatedAt: now.toISOString(), ...p });

describe('resumo diário do entregador', () => {
  it('conta só entregues hoje pelo próprio entregador', () => {
    const orders: any[] = [
      o({}),
      o({ driverId: 'd2' }),
      o({ status: 'OUT_FOR_DELIVERY' }),
      o({ updatedAt: '2026-10-10T12:00:00' }),
    ];
    expect(computeDriverDailySummary(orders, 'd1', now)).toEqual({ deliveredCount: 1, feesTotal: 7 });
  });
  it('sem pedidos ou sem driverId retorna zero', () => {
    expect(computeDriverDailySummary([], 'd1', now)).toEqual({ deliveredCount: 0, feesTotal: 0 });
    expect(computeDriverDailySummary([o({})] as any, undefined, now)).toEqual({ deliveredCount: 0, feesTotal: 0 });
  });
});
