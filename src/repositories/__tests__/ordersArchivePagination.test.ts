import { beforeEach, describe, expect, it, vi } from 'vitest';
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { from }, isSupabaseConfigured: true }));
import { orderRepository } from '../orderRepository';

const tenantId = '10000000-0000-0000-0000-00000000000a';
const orders = Array.from({ length: 1001 }, (_, i) => ({ id: `order-${i}`, tenant_id: tenantId, status: 'CANCELLED' }));

describe('lista completa para arquivar todos os cancelados', () => {
  beforeEach(() => { from.mockReset(); });
  it('carrega além do limite padrão, mantendo o escopo da loja em cada página', async () => {
    const scopes: string[] = [];
    from.mockImplementation(table => {
      if (table === 'order_payments') return { select: () => ({ eq: () => ({ in: async () => ({ error: { message: 'optional enrichment unavailable' } }) }) }) };
      const q = {
        select: () => q,
        eq: (_key: string, value: string) => { scopes.push(value); return q; },
        order: () => q,
        range: (start: number, end: number) => Promise.resolve({ data: orders.slice(start, end + 1), error: null }),
      };
      return q;
    });
    const result = await orderRepository.getOrders({} as any, tenantId, { allPages: true });
    expect(result).toHaveLength(1001);
    expect(new Set(result.map(o => o.id)).size).toBe(1001);
    expect(scopes).toEqual([tenantId, tenantId, tenantId]);
    expect(result.at(-1)?.id).toBe('order-1000');
  });
  it('não apresenta lote parcial se a leitura de outra página falhar', async () => {
    let page = 0;
    const q = { select: () => q, eq: () => q, order: () => q,
      range: async () => ++page === 1 ? { data: orders.slice(0, 500), error: null } : { data: null, error: { message: 'connection lost' } },
    };
    from.mockReturnValue(q);
    await expect(orderRepository.getOrders({} as any, tenantId, { allPages: true })).rejects.toThrow();
  });
});
