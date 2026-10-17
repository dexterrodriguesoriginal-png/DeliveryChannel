import { describe, it, expect } from 'vitest';
import { attachCustomerHistory, mapCustomerOrderRow } from '../orderMappers';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const row = (id: string, status: string) => ({
  id, tenant_id: 't', order_number: 28, customer_name: 'C', customer_phone: '1', delivery_address: 'R',
  subtotal: 10, delivery_fee: 3.5, discount: 0, total_amount: 13.5, payment_method: 'CASH',
  payment_status: 'PAYMENT_ON_DELIVERY', fulfillment_type: 'DELIVERY', status, created_at: '2026-10-17T10:00:00Z',
  updated_at: '2026-10-17T10:00:00Z', order_items: [],
});

describe('attachCustomerHistory', () => {
  it('anexa só status + horário, ordenado, por pedido; descarta note/changed_by', () => {
    const orders = [mapCustomerOrderRow(row(A, 'CONFIRMED')), mapCustomerOrderRow(row(B, 'PENDING'))];
    const out = attachCustomerHistory(orders, [
      { order_id: A, status: 'CONFIRMED', created_at: '2026-10-17T10:02:00Z', note: 'interno', changed_by: 'Fulano (OWNER)' },
      { order_id: A, status: 'PENDING', created_at: '2026-10-17T10:00:00Z' },
      { order_id: 'outro', status: 'DELIVERED', created_at: '2026-10-17T11:00:00Z' },
    ]);
    expect(out[0].statusHistory).toEqual([
      { status: 'PENDING', timestamp: '2026-10-17T10:00:00Z', changedBy: '' },
      { status: 'CONFIRMED', timestamp: '2026-10-17T10:02:00Z', changedBy: '' },
    ]);
    expect(JSON.stringify(out)).not.toContain('Fulano');
    expect(JSON.stringify(out)).not.toContain('interno');
    expect(out[1].statusHistory).toEqual([]);
  });
});
