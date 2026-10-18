import { describe, it, expect } from 'vitest';
import { groupOrderHistory, isFailedAttempt, dayLabel } from '../orderHistory';
import type { Order } from '../../../types';

const now = Date.parse('2026-10-17T20:00:00-03:00');
let n = 0;
const order = (createdAt: string, status: Order['status'], paymentStatus: Order['paymentStatus'] = 'PENDING', items = [{ productId: 'a', quantity: 1 }]): Order =>
  ({ id: `o${++n}`, orderNumber: n, createdAt, status, paymentStatus, items, statusHistory: [] } as unknown as Order);

describe('histórico de pedidos', () => {
  it('tentativa falha = cancelado sem pagamento', () => {
    expect(isFailedAttempt({ status: 'CANCELLED', paymentStatus: 'PENDING' })).toBe(true);
    expect(isFailedAttempt({ status: 'CANCELLED', paymentStatus: 'REFUNDED' })).toBe(false);
    expect(isFailedAttempt({ status: 'DELIVERED', paymentStatus: 'PAID' })).toBe(false);
  });

  it('agrupa por dia (Hoje/Ontem) do mais recente para o mais antigo', () => {
    const g = groupOrderHistory([
      order('2026-10-16T12:00:00-03:00', 'DELIVERED', 'PAID'),
      order('2026-10-17T19:00:00-03:00', 'PREPARING'),
      order('2026-10-10T12:00:00-03:00', 'DELIVERED', 'PAID'),
    ], now);
    expect(g.map(d => d.label)).toEqual(['Hoje', 'Ontem', expect.stringMatching(/10 de outubro/)]);
  });

  it('junta tentativas falhas consecutivas iguais (7 repetidas viram 1 grupo)', () => {
    const fails = Array.from({ length: 7 }, (_, i) => order(`2026-10-17T18:${String(10 + i).padStart(2, '0')}:00-03:00`, 'CANCELLED'));
    const ok = order('2026-10-17T18:30:00-03:00', 'DELIVERED', 'PAID');
    const g = groupOrderHistory([...fails, ok], now);
    expect(g).toHaveLength(1);
    expect(g[0].entries).toHaveLength(2);
    expect(g[0].entries[0].kind).toBe('order');
    const grp = g[0].entries[1];
    expect(grp.kind).toBe('failedGroup');
    if (grp.kind === 'failedGroup') {
      expect(grp.orders).toHaveLength(7);
      expect(grp.latest.createdAt).toBe('2026-10-17T18:16:00-03:00');
    }
  });

  it('não junta falhas com itens diferentes nem falhas separadas por um pedido real', () => {
    const a = order('2026-10-17T18:00:00-03:00', 'CANCELLED');
    const b = order('2026-10-17T18:05:00-03:00', 'CANCELLED', 'PENDING', [{ productId: 'b', quantity: 1 }]);
    const g1 = groupOrderHistory([a, b], now);
    expect(g1[0].entries.map(e => e.kind)).toEqual(['order', 'order']);
    const c = order('2026-10-17T18:10:00-03:00', 'DELIVERED', 'PAID');
    const d = order('2026-10-17T18:15:00-03:00', 'CANCELLED');
    const g2 = groupOrderHistory([a, c, d], now);
    expect(g2[0].entries.map(e => e.kind)).toEqual(['order', 'order', 'order']);
  });

  it('rótulo de dia antigo', () => {
    expect(dayLabel('2026-10-01', now)).toMatch(/01 de outubro/);
  });
});
