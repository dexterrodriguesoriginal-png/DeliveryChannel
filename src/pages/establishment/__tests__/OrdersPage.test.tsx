// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order, OrderStatus } from '../../../types';

const mocks = vi.hoisted(() => ({
  auth: {
    activeTenant: { id: 'tenant-1', name: 'Loja', settings: {} },
    securityContext: {}, availableTenants: [], activeRole: 'OWNER',
  },
  getOrders: vi.fn(), archiveOrders: vi.fn(), updateStatus: vi.fn(),
  showToast: vi.fn(), listDrivers: vi.fn(), queue: vi.fn(), offer: vi.fn(), offerRows: [] as any[],
  cancelOffer: vi.fn(), offersChanged: (() => {}) as () => void,
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../../hooks/useModules', () => ({ useModules: () => ({ isModuleEnabled: () => true }) }));
vi.mock('../../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false }));
vi.mock('../../../repositories/orderRepository', () => ({ orderRepository: {
  getOrders: mocks.getOrders, archiveOrders: mocks.archiveOrders, updateStatus: mocks.updateStatus,
  subscribeToOrders: () => () => {},
} }));
vi.mock('../../../repositories/driverRepository', () => ({
  driverRepository: {}, driverInviteRepository: { listAssignableDrivers: mocks.listDrivers },
}));
vi.mock('../../../repositories/productRepository', () => ({ productRepository: { getProducts: async () => [] } }));
vi.mock('../../../repositories/arrivalRepository', () => ({ arrivalRepository: { listOpen: async () => [], isOn: () => false } }));
vi.mock('../../../repositories/dispatchChatRepository', () => ({ dispatchChatRepository: { queue: mocks.queue } }));
vi.mock('../../../repositories/driverOfferRepository', () => ({ driverOfferRepository: {
  expire: async () => 0, forOrders: async () => mocks.offerRows, offer: mocks.offer, cancel: mocks.cancelOffer,
  subscribeTenant: (_tenant: string, changed: () => void) => { mocks.offersChanged = changed; return () => {}; },
} }));
vi.mock('../../../lib/orders/newOrderAlarm', () => ({ useNewOrderAlarm: () => ({}) }));
vi.mock('../../../components/pickup/ArrivalQueuePanel', () => ({ ArrivalQueuePanel: () => null }));
vi.mock('../../../components/pickup/PickupHandoverModal', () => ({ PickupHandoverModal: () => null }));
vi.mock('../../../components/establishment/PDVModal', () => ({ PDVModal: () => null }));
vi.mock('../../../components/establishment/ThermalReceiptModal', () => ({ ThermalReceiptModal: () => null }));
vi.mock('../../../components/chat/OrderChat', () => ({ OrderChat: () => null }));

import { OrdersPage } from '../OrdersPage';
import { KanbanOrderCard } from '../../../components/establishment/KanbanOrderCard';

const VIEW_KEY = 'adegafood_orders_view_mode';
const order = (status: OrderStatus, extra: Partial<Order> = {}): Order => ({
  id: 'order-1', orderNumber: 123, customerName: 'Cliente Teste',
  status, fulfillmentType: 'DELIVERY', createdAt: new Date().toISOString(),
  totalAmount: 10, items: [], statusHistory: [], paymentMethod: 'CASH', paymentStatus: 'PAID',
  ...extra,
} as Order);

let container: HTMLDivElement;
let root: Root;
const button = (label: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === label)!;
const click = async (element: HTMLElement) => { await act(async () => { element.click(); }); };
const render = async (tab = 'ALL') => { await act(async () => { root.render(<OrdersPage activeTab={tab} />); }); };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear(); sessionStorage.clear();
  mocks.auth.activeRole = 'OWNER';
  mocks.offerRows = []; mocks.listDrivers.mockResolvedValue([]); mocks.queue.mockResolvedValue({ mode: 'OWNER_PICKS', drivers: [] });
  mocks.offer.mockResolvedValue({ success: true }); mocks.cancelOffer.mockResolvedValue({ success: true });
  mocks.getOrders.mockResolvedValue([order('PREPARING')]);
  mocks.archiveOrders.mockResolvedValue(undefined);
  mocks.updateStatus.mockResolvedValue(order('READY'));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({ matches: false }) as MediaQueryList);
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove(); vi.restoreAllMocks();
});

describe('visões de Pedidos', () => {
  it('inicia no Kanban, oferece somente Kanban/Lista e persiste a escolha após remontar', async () => {
    await render();
    expect(button('Kanban').getAttribute('aria-pressed')).toBe('true');
    expect(button('Lista')).toBeDefined();
    expect(button('Cards')).toBeUndefined(); expect(button('Tabela')).toBeUndefined();
    expect(container.querySelector('table')).toBeNull();
    await click(button('Lista'));
    expect(container.querySelector('table')?.textContent).toContain('Cliente Teste');
    expect(localStorage.getItem(VIEW_KEY)).toBe('table');
    await act(async () => { root.unmount(); });
    root = createRoot(container); await render();
    expect(button('Lista').getAttribute('aria-pressed')).toBe('true');
    await click(button('Kanban'));
    expect(container.querySelector('table')).toBeNull();
    expect(localStorage.getItem(VIEW_KEY)).toBe('kanban');
  });

  it.each(['cards', 'invalid'])('migra a preferência %s para Kanban', async saved => {
    localStorage.setItem(VIEW_KEY, saved); await render();
    expect(button('Kanban').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(VIEW_KEY)).toBe('kanban');
  });

  it('funciona quando localStorage está indisponível', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await render();
    expect(button('Kanban').getAttribute('aria-pressed')).toBe('true');
    await click(button('Lista'));
    expect(container.querySelector('table')).not.toBeNull();
  });

  it.each(['DELIVERED', 'CANCELLED', 'ARCHIVED'])('mostra %s na Lista e permite arquivar/desarquivar pelo painel', async tab => {
    const archived = tab === 'ARCHIVED';
    mocks.getOrders.mockResolvedValue([order(tab === 'CANCELLED' ? 'CANCELLED' : 'DELIVERED', archived ? { archivedAt: new Date().toISOString() } : {})]);
    await render(tab);
    expect(button('Lista').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('tbody')?.textContent).toContain('Cliente Teste');
    await click(container.querySelector('tbody tr')!);
    const action = archived ? 'Desarquivar' : 'Arquivar';
    expect(button(action)).toBeDefined(); await click(button(action));
    expect(mocks.archiveOrders).toHaveBeenCalledWith(['order-1'], !archived);
    await render('ALL');
    expect(button('Kanban').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(VIEW_KEY)).toBe('kanban');
  });

  it('restringe o arquivamento no painel ao dono/gerente e a pedidos encerrados', async () => {
    mocks.auth.activeRole = 'CASHIER';
    mocks.getOrders.mockResolvedValue([order('CANCELLED')]); await render('CANCELLED');
    await click(container.querySelector('tbody tr')!);
    expect(button('Arquivar')).toBeUndefined();
    expect(button('Desarquivar')).toBeUndefined();
  });

  it('mantém marcar como pronto no Kanban', async () => {
    await render();
    await click(button('Marcar como Pronto'));
    expect(mocks.updateStatus).toHaveBeenCalledWith({}, 'tenant-1', 'order-1', 'READY', undefined, 'PREPARING');
  });
});

describe('ações preservadas no Kanban', () => {
  it.each([
    ['PENDING', 'DELIVERY', 'CONFIRMED'],
    ['CONFIRMED', 'DELIVERY', 'PREPARING'],
    ['PREPARING', 'DELIVERY', 'READY'],
    ['READY', 'PICKUP', 'DELIVERED'],
    ['READY', 'DINE_IN', 'DELIVERED'],
    ['OUT_FOR_DELIVERY', 'DELIVERY', 'DELIVERED'],
  ] as const)('%s / %s avança para %s', async (status, fulfillmentType, next) => {
    const onUpdateStatus = vi.fn(async () => {});
    const onAssignDriverClick = vi.fn();
    await act(async () => { root.render(<KanbanOrderCard order={order(status, { fulfillmentType })}
      onUpdateStatus={onUpdateStatus} onAssignDriverClick={onAssignDriverClick} onSelectOrder={() => {}} />); });
    await click(container.querySelector('button:last-child')!);
    expect(onUpdateStatus).toHaveBeenCalledWith('order-1', next);
    expect(onAssignDriverClick).not.toHaveBeenCalled();
    if (fulfillmentType === 'DINE_IN') expect(container.querySelector('[data-testid="card-call-driver"]')).toBeNull();
  });

  it('chama o entregador uma vez, recusa pedidos e abre detalhes', async () => {
    const onUpdateStatus = vi.fn(async () => {}), onAssignDriverClick = vi.fn(), onCancelClick = vi.fn(), onSelectOrder = vi.fn();
    const ready = order('READY');
    const props = { onUpdateStatus, onAssignDriverClick, onCancelClick, onSelectOrder };
    await act(async () => { root.render(<KanbanOrderCard order={ready} {...props} />); });
    await click(container.querySelector('[data-testid="card-call-driver"]')!);
    expect(onUpdateStatus).not.toHaveBeenCalled();
    expect(onAssignDriverClick).toHaveBeenCalledExactlyOnceWith(ready);
    await click(container.firstElementChild as HTMLElement);
    expect(onSelectOrder).toHaveBeenCalledWith(ready);
    const pending = order('PENDING');
    await act(async () => { root.render(<KanbanOrderCard order={pending} {...props} />); });
    await click(button('Recusar'));
    expect(onCancelClick).toHaveBeenCalledWith(pending);
  });
});

describe('chamadas de entregador na tela de Pedidos', () => {
  const available = { id: 'dr1', userId: 'd1', name: 'Ana Teste', approvalStatus: 'APPROVED', status: 'AVAILABLE' };
  const offered = () => ({ id: 'f', tenant_id: 'tenant-1', order_id: 'order-1', driver_user_id: 'd1', status: 'OFFERED', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString() });
  it.each(['OWNER','DELIVERY_MANAGER'])('%s escolhe apenas disponível, vê quem recusou e envia oferta', async role => {
    mocks.auth.activeRole = role; mocks.getOrders.mockResolvedValue([order('READY')]);
    mocks.listDrivers.mockResolvedValue([available, { ...available, id: 'dr2', userId: 'd2', name: 'Ocupado', status: 'ON_DELIVERY' }]);
    mocks.queue.mockResolvedValue({ mode: 'OWNER_PICKS', drivers: [{ id: 'dr1', user_id: 'd1', name: 'Ana' }] });
    mocks.offerRows = [{ ...offered(), status: 'DECLINED' }];
    await render(); await click(container.querySelector('[data-testid="card-call-driver"]')!);
    const form = container.querySelector('form')!, select = form.querySelector('select')!;
    expect(select.textContent).toContain('Ana Teste — recusou'); expect(select.textContent).not.toContain('Ocupado');
    await act(async () => { select.value = 'd1'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(mocks.offer).toHaveBeenCalledWith('order-1', 'd1');
    expect(mocks.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Chamada enviada' }));
  });
  it('fila automática mostra o primeiro nome e deixa a escolha com o servidor', async () => {
    mocks.getOrders.mockResolvedValue([order('READY')]); mocks.listDrivers.mockResolvedValue([available]);
    mocks.queue.mockResolvedValue({ mode: 'AUTO_QUEUE', drivers: [{ id: 'dr1', user_id: 'd1', name: 'Ana' }] });
    await render(); await click(container.querySelector('[data-testid="card-call-driver"]')!);
    const form = container.querySelector('form')!; expect(form.textContent).toContain('Será chamado: Ana'); expect(form.querySelector('select')).toBeNull();
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(mocks.offer).toHaveBeenCalledWith('order-1', null);
  });
  it.each(['DECLINED','EXPIRED'])('realtime %s mostra toast e permite chamar outro', async status => {
    mocks.getOrders.mockResolvedValue([order('READY')]); mocks.offerRows = [offered()];
    await render(); expect(container.textContent).toContain('Aguardando aceite do entregador');
    mocks.offerRows = [{ ...offered(), status }]; await act(async () => mocks.offersChanged());
    expect(mocks.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: status === 'DECLINED' ? 'Entregador recusou' : 'Entregador não respondeu' }));
    expect(container.textContent).toContain('Chamar outro');
  });
});
// resync
