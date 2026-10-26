// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  mine: vi.fn(), respond: vi.fn(), subscribe: vi.fn(), stop: vi.fn(), toast: vi.fn(), getOrders: vi.fn(), sound: vi.fn(), unlock: vi.fn(),
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ activeTenant: { id: 't', name: 'Loja A', settings: {} }, currentUser: { id: 'd', name: 'Entregador' }, securityContext: { userId: 'd' }, driverApprovalStatus: 'APPROVED', signOut: vi.fn() }) }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('../../../repositories/driverOfferRepository', () => ({ driverOfferRepository: { mine: mocks.mine, respond: mocks.respond, subscribeDriver: mocks.subscribe } }));
vi.mock('../../../repositories/orderRepository', () => ({ orderRepository: { getOrders: mocks.getOrders, subscribeToOrders: () => () => {} } }));
vi.mock('../../../repositories/driverRepository', () => ({ driverInviteRepository: { getOwnAvailability: async () => 'AVAILABLE' } }));
vi.mock('../../../repositories/handoffRepository', () => ({ handoffRepository: { getPickupCode: async () => ({ code: '4321' }) } }));
vi.mock('../../../lib/useDriverLocationTracking', () => ({ useDriverLocationTracking: () => ({ consent: 'REJECTED' }) }));
vi.mock('../../../components/driver/DriverDeliveryMap', () => ({ DriverDeliveryMap: () => null }));
vi.mock('../../../components/chat/OrderChat', () => ({ OrderChat: () => null }));
vi.mock('../../../components/layout/MobileNavigation', () => ({ MobileNavigation: () => null }));
vi.mock('../../../utils/audio', () => ({ playNewOrderSound: mocks.sound, unlockAudio: mocks.unlock }));
import { DriverApp } from '../DriverApp';
import { MyDriverOffer } from '../../../repositories/driverOfferRepository';
const NOW = Date.parse('2026-10-26T19:00:00Z');
const offer: MyDriverOffer = { id: 'f', tenant_id: 't', order_id: 'o', order_number: 42, store_name: 'Loja A', neighborhood: 'Centro', delivery_fee: 7, expires_at: new Date(NOW + 60000).toISOString() };
let rows: MyDriverOffer[], root: Root, host: HTMLDivElement, refresh: () => void;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(NOW); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  rows = []; mocks.mine.mockImplementation(async () => rows); mocks.getOrders.mockResolvedValue([]);
  mocks.respond.mockImplementation(async () => { rows = []; return { success: true }; });
  mocks.subscribe.mockImplementation((_id, cb) => { refresh = cb; return mocks.stop; });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const mount = () => act(async () => root.render(<DriverApp />));
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === label)!;
  expect(button).toBeTruthy(); await act(async () => button.click());
}
describe('DriverApp recebe ofertas sem acesso antecipado ao pedido', () => {
  it('realtime abre oferta, toca uma vez, recusa e encerra a assinatura', async () => {
    await mount(); expect(mocks.subscribe).toHaveBeenCalledWith('d', expect.any(Function));
    rows = [offer]; await act(async () => refresh());
    expect(host.textContent).toContain('Nova oferta de corrida'); expect(host.textContent).toContain('Centro');
    expect(host.textContent).not.toContain('4321'); expect(mocks.sound).toHaveBeenCalledOnce();
    await act(async () => refresh()); expect(mocks.sound).toHaveBeenCalledOnce();
    await click('Recusar'); expect(mocks.respond).toHaveBeenCalledWith('f', false);
    expect(host.querySelector('[aria-label="Oferta de corrida"]')).toBeNull();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Chamada recusada' }));
    await act(async () => root.unmount()); expect(mocks.stop).toHaveBeenCalledOnce(); root = createRoot(host);
  });
  it('polling de 10 s recupera oferta e aceite exibe código e endereço do pedido atribuído', async () => {
    await mount(); rows = [offer]; await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(host.textContent).toContain('Nova oferta de corrida'); expect(host.textContent).not.toContain('Rua completa');
    mocks.respond.mockImplementation(async () => {
      rows = []; mocks.getOrders.mockResolvedValue([{ id: 'o', tenantId: 't', driverId: 'd', orderNumber: 42, status: 'WAITING_FOR_DRIVER', fulfillmentType: 'DELIVERY', customerName: 'Cliente autorizado', customerPhone: '11999999999', deliveryAddress: 'Rua completa, 123', deliveryFee: 7, totalAmount: 27, subtotal: 20, discount: 0, paymentMethod: 'CASH', paymentStatus: 'PAYMENT_ON_DELIVERY', items: [], statusHistory: [], createdAt: new Date(NOW).toISOString() }]);
      return { success: true, accepted: true };
    });
    await click('Aceitar'); expect(mocks.respond).toHaveBeenCalledWith('f', true);
    expect(host.textContent).toContain('4321'); expect(host.textContent).toContain('Mostre este código na loja');
    expect(host.textContent).toContain('Rua completa, 123');
  });
  it('expiração recuperada no polling remove a oferta e não atribui o pedido', async () => {
    rows = [offer]; await mount(); rows = [];
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(host.querySelector('[aria-label="Oferta de corrida"]')).toBeNull(); expect(mocks.respond).not.toHaveBeenCalled();
  });
  it('aceite expirado mostra mensagem amigável e recarrega ofertas', async () => {
    rows = [offer]; await mount(); mocks.respond.mockImplementationOnce(async () => { rows = []; throw new Error('OFFER_EXPIRED'); });
    await click('Aceitar'); expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Esta chamada expirou. Aguarde uma nova oferta.' }));
    expect(host.querySelector('[aria-label="Oferta de corrida"]')).toBeNull();
  });
});
