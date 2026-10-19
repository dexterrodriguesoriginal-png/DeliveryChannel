/**
 * Regressão 19/10 (lojas confundidas): o pedido feito em /app/<slug> vai para a loja daquele slug e só dela.
 * O frontend nunca envia tenant_id/store_id no checkout: só p_tenant_slug, e o servidor resolve a loja.
 * Cliente com pedidos em duas lojas: cada pedido sai com o slug da loja em que foi feito.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const rpc = vi.fn();
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...a: any[]) => rpc(...a) }, isSupabaseConfigured: true, ensureValidSession: async () => true }));
import { orderRepository } from '../orderRepository';

const STORE = { 'espeto-do-bahia': 'f8965291-3c69-4052-be14-cef68bbcbf38', 'bar-do-ney': 'e516a2c9-ce4e-4983-a5a3-9facdb57c4f0' } as const;
const P1 = '11111111-1111-4111-8111-111111111111';
const input = () => ({
  customerName: 'Cliente', customerPhone: '11999990000', deliveryAddress: 'Rua X, 1',
  items: [{ productId: P1, quantity: 1 }], paymentMethod: 'CASH' as const, fulfillmentType: 'DELIVERY' as const,
  origin: 'storefront' as any,
});

// Servidor simulado: resolve a loja pelo slug (como process_checkout_atomic[_v2]).
let seq = 0;
rpc.mockImplementation(async (fn: string, args: any) => {
  if (fn === 'process_checkout_atomic_v2' || fn === 'process_checkout_atomic') {
    const tenantId = (STORE as any)[args.p_tenant_slug];
    if (!tenantId) return { data: null, error: { message: 'Loja não encontrada' } };
    const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;
    (globalThis as any).__orders = { ...((globalThis as any).__orders || {}), [id]: tenantId };
    if (fn === 'process_checkout_atomic') return { data: id, error: null };
    return { data: { order_id: id, order_number: seq, subtotal: 10, total_amount: 10, status: 'PENDING', payment_status: 'PENDING' }, error: null };
  }
  if (fn === 'get_customer_order_by_id') {
    const tenantId = (globalThis as any).__orders[args.p_order_id];
    return { data: { id: args.p_order_id, tenantId, orderNumber: seq, status: 'PENDING', items: [], totalAmount: 10, createdAt: new Date().toISOString() }, error: null };
  }
  return { data: null, error: { message: `rpc inesperada ${fn}` } };
});

afterEach(() => { delete process.env.VITE_BACKEND_SCHEMA; rpc.mockClear(); });

const checkoutCalls = () => rpc.mock.calls.filter(c => String(c[0]).startsWith('process_checkout_atomic'));

for (const mode of ['n1n6', 'legacy-020'] as const) {
  describe(`checkout respeita a loja do /app/<slug> (${mode})`, () => {
    it('cliente com pedidos em duas lojas: cada pedido vai só para a loja do slug', async () => {
      process.env.VITE_BACKEND_SCHEMA = mode;
      const a = await orderRepository.createPublicOrder('espeto-do-bahia', input());
      const b = await orderRepository.createPublicOrder('bar-do-ney', input());
      expect(a.tenantId).toBe(STORE['espeto-do-bahia']);
      expect(b.tenantId).toBe(STORE['bar-do-ney']);
      const calls = checkoutCalls();
      expect(calls.map(c => c[1].p_tenant_slug)).toEqual(['espeto-do-bahia', 'bar-do-ney']);
      for (const [, args] of calls) {
        // nenhum identificador de loja vindo do navegador (nem de outra loja aberta antes)
        expect(Object.keys(args).filter(k => /tenant_id|store_id/.test(k))).toEqual([]);
      }
    });
  });
}
