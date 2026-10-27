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
    if (!archived) await click(button('Lista'));
    expect(button('Lista').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('tbody')?.textContent).toContain('Cliente Teste');
    await click(container.querySelector('tbody tr')!);
    const action = archived ? 'Desarquivar' : 'Arquivar';
    expect(button(action)).toBeDefined(); await click(button(action));
    expect(mocks.archiveOrders).toHaveBeenCalledWith(['order-1'], !archived);
    await render('ALL');
    await click(button('Kanban'));
    expect(button('Kanban').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(VIEW_KEY)).toBe('kanban');
  });

  it('restringe o arquivamento no painel ao dono/gerente e a pedidos encerrados', async () => {
    mocks.auth.activeRole = 'CASHIER';
    mocks.getOrders.mockResolvedValue([order('CANCELLED')]); await render('CANCELLED'); await click(button('Lista'));
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

describe('novo visual do Kanban', () => {
  const input = async (element: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const cards = () => Array.from(container.querySelectorAll('.orders-kanban-card'));

  it('mantém as cinco colunas vazias com as cores e tints solicitados', async () => {
    mocks.getOrders.mockResolvedValue([]); await render();
    const themes = [['waiting', '#ef4444', '#fdecec'], ['production', '#f97316', '#fef1e7'], ['ready', '#a855f7', '#f6eefe'], ['delivered', '#16a34a', '#e8f6ed'], ['cancelled', '#6b7280', '#f0f1f2']];
    for (const [column, color, tint] of themes) {
      const lane = container.querySelector<HTMLElement>(`[data-column="${column}"]`)!;
      const swatch = document.createElement('span'); swatch.style.backgroundColor = tint;
      expect(lane.style.backgroundColor).toBe(swatch.style.backgroundColor);
      swatch.style.backgroundColor = color;
      expect(lane.querySelector<HTMLElement>('header')!.style.backgroundColor).toBe(swatch.style.backgroundColor);
      expect(lane.textContent).toContain('Qtd: 0 · Total: R$');
      expect(lane.textContent).toContain('NENHUM PEDIDO');
    }
    expect(container.querySelectorAll('[data-column]')).toHaveLength(5);
  });

  it('conta e totaliza somente pedidos visíveis, incluindo cancelados e sem expor pagamento online pendente', async () => {
    mocks.getOrders.mockResolvedValue([
      order('PENDING', { id: 'a', totalAmount: 10.1 }), order('CONFIRMED', { id: 'b', totalAmount: 20.2 }),
      order('READY', { id: 'c', totalAmount: 45.9 }), order('OUT_FOR_DELIVERY', { id: 'd', totalAmount: 12.3 }),
      order('CANCELLED', { id: 'e' }), order('DELIVERED', { id: 'f' }),
      order('PENDING', { id: 'hidden', totalAmount: 999, awaitingOnlinePayment: true }),
      order('DELIVERED', { id: 'archived', archivedAt: new Date().toISOString() }),
    ]);
    await render();
    expect(cards()).toHaveLength(6);
    expect(container.querySelector('[data-column="waiting"] header')?.textContent).toContain('Qtd: 2 · Total: R$ 30,30');
    expect(container.querySelector('[data-column="ready"] header')?.textContent).toContain('Qtd: 2 · Total: R$ 58,20');
    expect(container.querySelector('[data-testid="order-card-hidden"]')).toBeNull();
    expect(container.querySelector('[data-testid="order-card-archived"]')).toBeNull();
    await click(container.querySelector('[data-column="cancelled"] [aria-label="Arquivar pedido"]')!);
    expect(mocks.archiveOrders).toHaveBeenCalledWith(['e'], true);
  });

  it('busca por número, nome e telefone sem aceitar nomes inexistentes', async () => {
    mocks.getOrders.mockResolvedValue([
      order('PREPARING', { id: 'ana', customerName: 'Ana', orderNumber: 42, customerPhone: '(11) 91234-5678' }),
      order('READY', { id: 'bia', customerName: 'Bia', orderNumber: 99, customerPhone: '(21) 98888-7777' }),
    ]);
    await render(); const search = container.querySelector<HTMLInputElement>('[aria-label="Buscar pedidos"]')!;
    for (const [query, expected] of [['Ana', 'ana'], ['#99', 'bia'], ['2198888', 'bia']]) {
      await input(search, query); expect(cards()).toHaveLength(1); expect(cards()[0].getAttribute('data-testid')).toBe(`order-card-${expected}`);
    }
    await input(search, 'Inexistente'); expect(cards()).toHaveLength(0);
    expect(container.querySelectorAll('[data-column]')).toHaveLength(5);
    await click(container.querySelector('[aria-label="Limpar busca"]')!); expect(cards()).toHaveLength(2);
  });

  it('filtra Hoje, Ontem, 7 dias e o seletor existente em Mais', async () => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const ago = (days: number) => { const date = new Date(today); date.setDate(date.getDate() - days); return date.toISOString(); };
    mocks.getOrders.mockResolvedValue([0, 1, 6, 8].map(days => order('PREPARING', { id: `day-${days}`, createdAt: ago(days) })));
    await render(); expect(cards()).toHaveLength(1);
    await click(button('Ontem')); expect(cards()).toHaveLength(1); expect(cards()[0].getAttribute('data-testid')).toBe('order-card-day-1');
    await click(button('7 dias')); expect(cards()).toHaveLength(3);
    const period = container.querySelector<HTMLSelectElement>('[aria-label="Selecionar período"]')!;
    await act(async () => { period.value = 'ALL'; period.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(cards()).toHaveLength(4);
  });

  it('mantém o badge de aceite na coluna saiu/pronto e permite cancelar a chamada', async () => {
    mocks.getOrders.mockResolvedValue([order('READY')]);
    mocks.offerRows = [{ id: 'offer-1', order_id: 'order-1', status: 'OFFERED', expires_at: new Date(Date.now() + 60000).toISOString() }];
    await render();
    const lane = container.querySelector('[data-column="ready"]')!;
    expect(lane.querySelector('[data-testid="driver-offer-strip"]')?.textContent).toContain('Aguardando aceite do entregador');
    expect(lane.querySelector('[role="timer"]')).not.toBeNull();
    expect(lane.querySelector('[data-testid="card-call-driver"]')).toBeNull();
    await click(button('Cancelar chamada'));
    expect(mocks.cancelOffer).toHaveBeenCalledWith('offer-1');
  });

  it('entregador que aceitou abre os detalhes e a validação do código sem criar nova oferta', async () => {
    mocks.getOrders.mockResolvedValue([order('WAITING_FOR_DRIVER', { driverId: 'driver-1', driverAcceptedAt: new Date().toISOString() })]);
    await render();
    const card = container.querySelector('.orders-kanban-card')!;
    expect(card.textContent).toContain('Entregador a caminho da loja');
    await click(card.querySelector('.orders-card-action')!);
    expect(container.querySelector('[data-testid="pickup-code"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="handoff-pickup"]')).not.toBeNull();
    expect(mocks.offer).not.toHaveBeenCalled(); expect(mocks.updateStatus).not.toHaveBeenCalled();
  });
});

describe('atalhos visuais no card', () => {
  it('preserva impressão, chat com ponto de não lido e arquivamento como ações separadas', async () => {
    const ready = order('WAITING_FOR_DRIVER', { driverId: 'driver-1', driverAcceptedAt: new Date().toISOString() });
    const onPrint = vi.fn(), onOpenChat = vi.fn(), onSelectOrder = vi.fn(), onArchive = vi.fn();
    const props = { onPrint, onOpenChat, onSelectOrder, onArchive, onUpdateStatus: vi.fn(), onAssignDriverClick: vi.fn() };
    await act(async () => { root.render(<KanbanOrderCard order={ready} unreadChat {...props} />); });
    expect(container.querySelector('[data-testid="unread-chat-dot"]')).not.toBeNull();
    await click(container.querySelector('[aria-label="Abrir chat com o entregador"]')!);
    expect(onOpenChat).toHaveBeenCalledWith(ready); expect(onSelectOrder).not.toHaveBeenCalled();
    await click(container.querySelector('[aria-label="Imprimir pedido"]')!);
    expect(onPrint).toHaveBeenCalledWith(ready); expect(onSelectOrder).not.toHaveBeenCalled();
    const cancelled = order('CANCELLED');
    await act(async () => { root.render(<KanbanOrderCard order={cancelled} {...props} />); });
    await click(container.querySelector('[aria-label="Arquivar pedido"]')!);
    expect(onArchive).toHaveBeenCalledWith(cancelled);
  });
});

describe('arrastar no Kanban', () => {
  const drop = async (column: string, id: string) => {
    const lane = container.querySelector(`[data-column="${column}"]`)!;
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { getData: () => id } });
    await act(async () => { lane.dispatchEvent(event); });
  };

  it('não volta etapas nem conclui delivery sem passar pelo entregador', async () => {
    mocks.getOrders.mockResolvedValue([order('PREPARING', { id: 'prep' }), order('READY', { id: 'ready', fulfillmentType: 'DELIVERY' })]);
    await render();
    await drop('waiting', 'prep');
    await drop('delivered', 'ready');
    expect(mocks.updateStatus).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Movimento não permitido' }));
    expect(mocks.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Despacho pendente' }));
  });

  it('continua avançando etapas pelo arraste', async () => {
    mocks.getOrders.mockResolvedValue([order('PREPARING', { id: 'prep' })]);
    await render();
    await drop('ready', 'prep');
    expect(mocks.updateStatus).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'prep', 'READY', undefined, 'PREPARING');
  });

  it('zoom 10–130% na toolbar: aplica no Kanban e na Lista, persiste (chave por usuário) e o % volta a 100', async () => {
    await render();
    const value = () => container.querySelector('[data-testid=orders-zoom-value]')!.textContent;
    expect(value()).toBe('100%');
    await click(container.querySelector('[data-testid=orders-zoom-out]') as HTMLElement);
    await click(container.querySelector('[data-testid=orders-zoom-out]') as HTMLElement);
    expect(value()).toBe('80%');
    const kb = container.querySelector('[data-testid=orders-kanban-layout]') as HTMLElement;
    expect(kb.style.getPropertyValue('--oz')).toBe('0.8');
    expect(localStorage.getItem('dc:orders-zoom:v1:anon')).toBe('80');
    await click(button('Lista'));
    const list = container.querySelector('[data-testid=orders-list]') as HTMLElement;
    expect(list.style.getPropertyValue('--oz')).toBe('0.8');
    await click(container.querySelector('[data-testid=orders-zoom-in]') as HTMLElement);
    expect(list.style.getPropertyValue('--oz')).toBe('0.9');
    await click(container.querySelector('[data-testid=orders-zoom-value]') as HTMLElement);
    expect(value()).toBe('100%');
  });

  it('Lista: cada linha usa a cor do status (Entregue verde, Cancelado cinza, Em preparo laranja)', async () => {
    mocks.getOrders.mockResolvedValue([
      order('DELIVERED', { id: 'd', orderNumber: 44 }), order('CANCELLED', { id: 'c', orderNumber: 43 }),
      order('PREPARING', { id: 'p', orderNumber: 42 }), order('PENDING', { id: 'w', orderNumber: 41 }), order('READY', { id: 'r', orderNumber: 40 }),
    ]);
    await render('ALL'); await click(button('Lista'));
    const rows = Array.from(container.querySelectorAll('[data-testid=orders-list-row]')) as HTMLElement[];
    const colorOf = (n: string) => rows.find(r => r.textContent?.includes(`#${n}`))!.style.getPropertyValue('--row-color');
    expect(colorOf('44')).toBe('#16a34a');
    expect(colorOf('43')).toBe('#6b7280');
    expect(colorOf('42')).toBe('#f97316');
    expect(colorOf('41')).toBe('#ef4444');
    expect(colorOf('40')).toBe('#a855f7');
    expect(rows.find(r => r.textContent?.includes('#44'))!.getAttribute('data-column')).toBe('delivered');
  });
});

describe('card compacto e painel lateral de detalhes', () => {
  const props = { onUpdateStatus: vi.fn(), onAssignDriverClick: vi.fn(), onSelectOrder: vi.fn() };
  it('mostra #número e cliente, valor · tipo · pagamento, semáforo e selo Pago, sem botão grande', async () => {
    const paid = order('PENDING', { totalAmount: 1, paymentMethod: 'PIX', onlinePayment: { status: 'paid' } as Order['onlinePayment'] });
    await act(async () => { root.render(<KanbanOrderCard order={paid} {...props} />); });
    const card = container.querySelector('.orders-kanban-card')!;
    expect(card.querySelector('.orders-card-title')?.textContent).toContain('#123 Cliente Teste');
    expect(card.querySelector('.orders-card-sub-text')?.textContent).toMatch(/R\$\s*1,00 · Delivery · PIX/);
    expect(card.querySelector('.orders-card-paid')?.textContent).toBe('Pago');
    expect(card.querySelector('.orders-card-dot')?.getAttribute('data-urgency')).toBe('ok');
    expect(card.textContent).not.toContain('Ver detalhes'); expect(card.textContent).not.toContain('Entregue ');
  });
  it('semáforo: âmbar perto de atrasar e vermelho atrasado; encerrado não tem timer', async () => {
    const ago = (m: number) => new Date(Date.now() - m * 60000).toISOString();
    for (const [min, level] of [[20, 'near'], [45, 'late']] as const) {
      await act(async () => { root.render(<KanbanOrderCard order={order('PREPARING', { createdAt: ago(min) })} {...props} />); });
      expect(container.querySelector('.orders-card-dot')?.getAttribute('data-urgency')).toBe(level);
    }
    await act(async () => { root.render(<KanbanOrderCard order={order('DELIVERED')} {...props} />); });
    expect(container.querySelector('.orders-card-timer')).toBeNull();
    expect(container.querySelector('.orders-card-action')).toBeNull();
  });
  it('cancelar fica nas ações rápidas e o clique no card abre os detalhes', async () => {
    const onCancelClick = vi.fn(), onSelectOrder = vi.fn();
    const preparing = order('PREPARING');
    await act(async () => { root.render(<KanbanOrderCard order={preparing} {...props} onSelectOrder={onSelectOrder} onCancelClick={onCancelClick} />); });
    await click(container.querySelector('[aria-label="Cancelar pedido"]')!);
    expect(onCancelClick).toHaveBeenCalledWith(preparing); expect(onSelectOrder).not.toHaveBeenCalled();
    await click(container.querySelector('.orders-card-hover')!);
    expect(onSelectOrder).toHaveBeenCalledWith(preparing);
  });
  it('clicar no card abre o painel lateral com X/Esc, destaca o selecionado e troca o conteúdo', async () => {
    mocks.getOrders.mockResolvedValue([order('PREPARING', { id: 'a', orderNumber: 10 }), order('PREPARING', { id: 'b', orderNumber: 11 })]);
    await render();
    expect(container.querySelector('[data-testid="order-detail-panel"]')).toBeNull();
    await click(container.querySelector('[data-testid="order-card-a"]')!);
    const panel = () => container.querySelector('[data-testid="order-detail-panel"]');
    expect(panel()?.textContent).toContain('Pedido #10');
    expect(container.querySelector('[data-testid="order-card-a"]')?.getAttribute('data-selected')).toBe('true');
    await click(container.querySelector('[data-testid="order-card-b"]')!);
    expect(panel()?.textContent).toContain('Pedido #11');
    expect(container.querySelector('[data-testid="order-card-a"]')?.getAttribute('data-selected')).toBe('false');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(panel()).toBeNull();
    await click(container.querySelector('[data-testid="order-card-a"]')!);
    await click(panel()!.querySelector('[title="Fechar painel de detalhes"]') as HTMLElement);
    expect(panel()).toBeNull();
  });
});
