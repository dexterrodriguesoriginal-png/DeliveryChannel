import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, from, query, state } = vi.hoisted(() => {
  const state = { rows: [] as any[] };
  const query: any = {};
  for (const method of ['select','eq','in','match','order','limit']) query[method] = vi.fn(() => query);
  query.then = (resolve: any) => Promise.resolve({ data: state.rows, error: null }).then(resolve);
  return { rpc: vi.fn(), from: vi.fn(() => query), query, state };
});
vi.mock('../../lib/supabase', () => ({ supabase: { rpc, from }, isSupabaseConfigured: true }));
import { orderRepository } from '../orderRepository';
import { dispatchChatRepository as notifications, OwnerNotification } from '../dispatchChatRepository';
import { paymentRepository } from '../paymentRepository';
const input = { customerName: 'Cliente', customerPhone: '11999990000', paymentMethod: 'CREDIT_CARD' as const, origin: 'storefront' as const, items: [], onlinePayment: true };
beforeEach(() => {
  vi.clearAllMocks(); process.env.VITE_BACKEND_SCHEMA = 'n1n6'; state.rows=[];
  rpc.mockImplementation(async (fn: string) => ({ data: fn === 'get_customer_order_by_id' ? { id: 'order', items: [] } : { order_id: 'order', order_number: 1 }, error: null }));
});
afterEach(() => { delete process.env.VITE_BACKEND_SCHEMA; });
describe('checkout payment choice', () => {
  it.each([false,true])('sends the online choice before creating the charge (options=%s)', async options => {
    await orderRepository.createPublicOrder('loja-a', { ...input, items: options ? [{ productId: 'p', quantity: 1, options: [{ groupId: 'g', optionId: 'o', qty: 1 }] }] : [] });
    expect(rpc).toHaveBeenCalledWith(options ? 'process_checkout_atomic_v3' : 'process_checkout_atomic_v2', expect.objectContaining({ p_tenant_slug: 'loja-a', p_online_payment: true }));
  });
  it('sends false for payment on delivery, and true for promotional online orders', async () => {
    await orderRepository.createPublicOrder('loja-a', { ...input, onlinePayment: false });
    expect(rpc).toHaveBeenCalledWith('process_checkout_atomic_v2', expect.objectContaining({ p_online_payment: false }));
    await orderRepository.createPromotionalOrder('loja-a', { ...input, offerId: '11111111-1111-4111-8111-111111111111', quantity: 1 });
    expect(rpc).toHaveBeenCalledWith('process_promotional_checkout_atomic', expect.objectContaining({ p_online_payment: true }));
  });
});
describe('staff list and notification defense', () => {
  it('filters the query AND server rows before lists or counters', async () => {
    state.rows = [{ id: 'hidden', tenant_id: '11111111-1111-4111-8111-111111111111', awaiting_online_payment: true }];
    expect(await orderRepository.getOrders({} as any, state.rows[0].tenant_id)).toEqual([]);
    expect(query.match).toHaveBeenCalledWith({ awaiting_online_payment: false });
    expect(await orderRepository.countPendingByTenant([state.rows[0].tenant_id])).toEqual({ [state.rows[0].tenant_id]: 0 });
  });
  it('checks notification orders before sound/balloon; join requests need no order', async () => {
    state.rows = [{ id: 'paid', awaiting_online_payment: false }, { id: 'unpaid', awaiting_online_payment: true }];
    const rows = [{ id:'n1', kind:'ORDER_NEW', ref_id:'unpaid' },{ id:'n2',kind:'ORDER_NEW',ref_id:'paid' },{ id:'n3',kind:'DRIVER_JOIN_REQUEST',ref_id:'driver' }] as OwnerNotification[];
    expect((await notifications.visibleNotifications('A',rows)).map(n => n.id)).toEqual(['n2','n3']);
    expect(query.eq).toHaveBeenCalledWith('tenant_id','A');
  });
});
describe('manual payment confirmation', () => {
  it('uses the tenant-scoped minimal list and an order number to confirm', async () => {
    await paymentRepository.toConfirm('A');
    expect(rpc).toHaveBeenLastCalledWith('list_payments_to_confirm', { p_tenant:'A' });
    await paymentRepository.confirmPending('A',42);
    expect(rpc).toHaveBeenLastCalledWith('confirm_pending_online_payment', { p_tenant:'A',p_order_number:42 });
  });
});
