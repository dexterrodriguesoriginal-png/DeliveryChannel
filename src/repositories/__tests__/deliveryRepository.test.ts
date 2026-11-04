import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }));
import { deliveryRepository } from '../deliveryRepository';
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: null, error: null }); });
describe('RPCs de entrega', () => {
  it('usa o pedido e resolução selecionados sem aceitar loja ou identidade do navegador', async () => {
    await deliveryRepository.markDelivered('order1');
    expect(rpc).toHaveBeenLastCalledWith('waiter_mark_delivered', { p_order: 'order1' });
    await deliveryRepository.resolve('dispute1', 'RESENT');
    expect(rpc).toHaveBeenLastCalledWith('resolve_delivery_dispute', { p_dispute: 'dispute1', p_resolution: 'RESENT' });
  });
  it('lista por loja e mantém reenvio pendente até a nova entrega', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'a', status: 'OPEN' }, { id: 'b', status: 'RESENT', order_status: 'READY' }, { id: 'c', status: 'RESENT', order_status: 'DELIVERED' }, { id: 'd', status: 'CONFIRMED_DELIVERED' }], error: null });
    expect(await deliveryRepository.openDisputes('tenant1')).toEqual([{ id: 'a', status: 'OPEN' }, { id: 'b', status: 'RESENT', order_status: 'READY' }]);
    expect(rpc).toHaveBeenCalledWith('list_open_delivery_disputes', { p_tenant: 'tenant1' });
  });
  it('recusa acesso a outra loja sem expor o erro bruto do banco', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'private-other-store-data' } });
    await expect(deliveryRepository.openDisputes('other')).rejects.toThrow('Não foi possível carregar as entregas contestadas.');
  });
});
