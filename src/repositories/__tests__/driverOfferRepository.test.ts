import { describe, it, expect, vi, beforeEach } from 'vitest';
const { rpc, on, subscribe, channel, removeChannel } = vi.hoisted(() => {
  const rpc = vi.fn(), on = vi.fn(), subscribe = vi.fn(), removeChannel = vi.fn();
  const channel = { on, subscribe }; on.mockReturnValue(channel); subscribe.mockReturnValue(channel);
  return { rpc, on, subscribe, channel, removeChannel };
});
vi.mock('../../lib/supabase', () => ({ supabase: { rpc, channel: vi.fn(() => channel), removeChannel } }));
import { driverOfferRepository as repo } from '../driverOfferRepository';
import { dispatchErrorMessage } from '../../lib/orders/dispatchErrors';
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { success: true }, error: null }); });
describe('RPCs de ofertas', () => {
  it('fila automática deixa a escolha com o servidor', async () => {
    await repo.offer('o', null); expect(rpc).toHaveBeenLastCalledWith('offer_order_to_driver', { p_order_id: 'o', p_driver_user_id: null });
    await repo.offer('o', 'd'); expect(rpc).toHaveBeenLastCalledWith('offer_order_to_driver', { p_order_id: 'o', p_driver_user_id: 'd' });
  });
  it('responde, cancela e configura com identificadores precisos', async () => {
    await repo.respond('f', false); expect(rpc).toHaveBeenLastCalledWith('driver_respond_offer', { p_offer_id: 'f', p_accept: false });
    await repo.respond('f', true); expect(rpc).toHaveBeenLastCalledWith('driver_respond_offer', { p_offer_id: 'f', p_accept: true });
    await repo.cancel('f'); expect(rpc).toHaveBeenLastCalledWith('cancel_driver_offer', { p_offer_id: 'f' });
    await repo.setTimeout('t', 60); expect(rpc).toHaveBeenLastCalledWith('set_driver_offer_timeout', { p_tenant_id: 't', p_seconds: 60 });
  });
  it('preserva erros retornados como dados e erros do PostgREST para o mapper', async () => {
    rpc.mockResolvedValueOnce({ data: { success: false, error: 'OFFER_EXPIRED' }, error: null });
    await expect(repo.respond('f', true)).rejects.toThrow('OFFER_EXPIRED');
    const error = { code: '42501', message: 'OFFER_NOT_FOUND' }; rpc.mockResolvedValueOnce({ data: null, error });
    await expect(repo.respond('f', true)).rejects.toEqual(error);
  });
  it('realtime do entregador filtra pelo usuário e limpa o canal', () => {
    const refresh = vi.fn(), stop = repo.subscribeDriver('d', refresh);
    expect(on).toHaveBeenLastCalledWith('postgres_changes', { event: '*', schema: 'public', table: 'order_driver_offers', filter: 'driver_user_id=eq.d' }, refresh);
    stop(); expect(removeChannel).toHaveBeenCalledWith(channel);
  });
  it.each([
    ['OFFER_EXPIRED','expirou'],['OFFER_NOT_FOUND','não está mais disponível'],['DRIVER_BUSY','indisponível'],
    ['NO_DRIVER_IN_QUEUE','Nenhum entregador aceitou'],['ORDER_NOT_READY','Pronto'],['OFFER_ALREADY_EXISTS','aguardando aceite'],
  ])('traduz %s para pt-BR inclusive com SQLSTATE 42501', (message, expected) => {
    expect(dispatchErrorMessage({ message, code: '42501' })).toContain(expected);
  });
});
