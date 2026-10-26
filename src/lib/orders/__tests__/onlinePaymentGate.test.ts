import { describe, expect, it } from 'vitest';
import { visibleStaffOrders } from '../onlinePaymentGate';
import { buildOrderAlerts, newPendingIds, nextStepFor } from '../orderAlerts';
import { countPendingRows } from '../../tenant/storeSwitcher';
import { mapStaffOrderRow } from '../../../repositories/orderMappers';
import type { Order } from '../../../types';
const order = (id: string, awaitingOnlinePayment: boolean, status: Order['status'] = 'PENDING'): Order => ({
  id, tenantId: 'A', awaitingOnlinePayment, status, items: [], createdAt: '2026-10-26T12:00:00Z', fulfillmentType: 'DELIVERY',
} as unknown as Order);
describe('online payment gate across staff views', () => {
  it('keeps unpaid orders out of lists, dispatch, dashboard counts and sound alerts', () => {
    const rows = [order('online', true), order('cash', false), order('online-ready', true, 'READY')];
    expect(visibleStaffOrders(rows).map(o => o.id)).toEqual(['cash']);
    expect(buildOrderAlerts(rows).total).toBe(1);
    expect(newPendingIds(new Set(), rows)).toEqual(['cash']);
    expect(nextStepFor(rows[0], 'OWNER')).toBeNull();
    expect(nextStepFor(rows[2], 'OWNER')).toBeNull();
    expect(nextStepFor(rows[1], 'OWNER')?.to).toBe('CONFIRMED');
  });
  it('releases the same order after confirmation and preserves delivery/PDV defaults', () => {
    const pending = order('online', true);
    expect(visibleStaffOrders([pending])).toEqual([]);
    expect(newPendingIds(new Set(), [{ ...pending, awaitingOnlinePayment: false }])).toEqual(['online']);
    expect(visibleStaffOrders([{ id: 'legacy' } as Order])).toHaveLength(1);
  });
  it('maps the database gate and filters tenant counters without hiding client orders', () => {
    expect(mapStaffOrderRow({ awaiting_online_payment: true }).awaitingOnlinePayment).toBe(true);
    expect(countPendingRows([{ tenant_id: 'A', awaiting_online_payment: true }, { tenant_id: 'A', awaiting_online_payment: false }, { tenant_id: 'B', awaiting_online_payment: false }], ['A'])).toEqual({ A: 1 });
  });
});
