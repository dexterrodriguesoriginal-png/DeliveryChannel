// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import type { OwnerNotification } from '../../../repositories/dispatchChatRepository';
import type { OrderBrief } from '../../../lib/notifications/notificationView';

const state = vi.hoisted(() => ({
  rows: [] as OwnerNotification[], details: {} as Record<string, OrderBrief>,
  event: null as null | ((payload: any) => void),
  sound: vi.fn(), read: vi.fn(async () => {}), update: vi.fn(async () => ({})),
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ activeTenant: { id: 'T1' }, supabaseUser: { id: 'U1' }, activeRole: 'OWNER', securityContext: { userId: 'U1' } }) }));
vi.mock('../../../lib/supabase', () => {
  const channel: any = { on: (_event: any, _filter: any, callback: any) => { state.event = callback; return channel; }, subscribe: () => channel };
  return { supabase: { channel: () => channel, removeChannel: vi.fn() } };
});
vi.mock('../../../repositories/dispatchChatRepository', () => ({ dispatchChatRepository: {
  notifications: async () => [...state.rows], visibleNotifications: async (_tenant: string, rows: OwnerNotification[]) => rows.filter(n => n.tenant_id === 'T1'),
  orderBriefs: async () => ({ ...state.details }), read: (...args: any[]) => (state.read as any)(...args),
} }));
vi.mock('../../../repositories/orderRepository', () => ({ orderRepository: { updateStatus: (...args: any[]) => (state.update as any)(...args) } }));
vi.mock('../../../utils/audio', () => ({ playNewOrderSound: () => state.sound() }));
import { OwnerNotifications } from '../OwnerNotifications';

const notification = (id: string, extra: Partial<OwnerNotification> = {}): OwnerNotification => ({
  id, tenant_id: 'T1', kind: 'ORDER_NEW', ref_id: `order-${id}`, title: `Novo pedido ${id}`,
  created_at: new Date(2026, 10, 3, 10, Number(id)).toISOString(), read_at: null, ...extra,
});
let poll: () => void;
beforeEach(() => {
  state.rows = []; state.details = {}; state.event = null; state.sound.mockClear(); state.read.mockClear(); state.update.mockClear();
  localStorage.setItem('dc:notifications:T1:U1', JSON.stringify({ balloon: true, sound: true }));
  const original = window.setInterval.bind(window);
  vi.spyOn(window, 'setInterval').mockImplementation(((callback: TimerHandler, timeout: number, ...args: any[]) => {
    if (timeout === 15000) poll = callback as () => void;
    return original(callback, timeout, ...args);
  }) as typeof window.setInterval);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

async function mount(onOpen = vi.fn()) {
  const ui = render(<OwnerNotifications onOpen={onOpen} />);
  await waitFor(() => expect(ui.getByRole('button', { name: /Notificações,/ })).toBeTruthy());
  // Aguarda também o carregamento inicial antes de inserir novos eventos.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return ui;
}
async function insert(row: OwnerNotification, detail?: Partial<OrderBrief>) {
  state.rows.unshift(row);
  state.details[row.ref_id] = { orderNumber: row.id, customerName: 'Cliente', total: 10, status: 'PENDING', fulfillmentType: 'DELIVERY', ...detail };
  await act(async () => { state.event!({ eventType: 'INSERT', new: row }); });
}

describe('Cards de novas notificações: realtime e fallback', () => {
  it('primeira carga não toca nem gera cards', async () => {
    state.rows = [notification('1')];
    const ui = await mount();
    await waitFor(() => expect(ui.getByTestId('unread-badge').textContent).toBe('1'));
    expect(ui.queryAllByTestId('notification-toast')).toHaveLength(0);
    expect(state.sound).not.toHaveBeenCalled();
  });
  it('três INSERTs seguidos mostram três cards mesmo com o painel aberto; +N preserva o quarto', async () => {
    const ui = await mount();
    fireEvent.click(ui.getByRole('button', { name: /Notificações,/ }));
    await waitFor(() => ui.getByTestId('notification-panel'));
    for (const id of ['1', '2', '3']) await insert(notification(id));
    expect(ui.getAllByTestId('notification-toast')).toHaveLength(3);
    expect(ui.getByTestId('notification-panel').getAttribute('data-state')).toBe('open');
    await insert(notification('4'));
    expect(ui.getAllByTestId('notification-toast')).toHaveLength(3);
    expect(ui.getByTestId('notification-toasts-more').textContent).toBe('+1 aviso');
    expect(ui.getAllByTestId('notification-toast')[0].getAttribute('data-notification-id')).toBe('4');
    fireEvent.click(within(ui.getAllByTestId('notification-toast')[0]).getByRole('button', { name: 'Fechar aviso' }));
    expect(ui.getAllByTestId('notification-toast')).toHaveLength(3);
    expect(ui.queryByTestId('notification-toasts-more')).toBeNull();
    expect(ui.getAllByTestId('notification-toast').some(el => el.getAttribute('data-notification-id') === '1')).toBe(true);
  });
  it('poll recupera não lidas sem realtime e não repete som/cards em leituras seguintes', async () => {
    const ui = await mount();
    state.rows = [notification('1'), notification('2', { read_at: new Date().toISOString() })];
    state.details = { 'order-1': { orderNumber: 1, customerName: 'Cliente', total: 10, status: 'PENDING' } };
    await act(async () => { poll(); });
    await waitFor(() => expect(ui.getAllByTestId('notification-toast')).toHaveLength(1));
    expect(state.sound).toHaveBeenCalledTimes(1);
    await act(async () => { poll(); });
    expect(state.sound).toHaveBeenCalledTimes(1);
    expect(ui.getAllByTestId('notification-toast')).toHaveLength(1);
    // Aceite feito em outra tela também encerra o card no próximo polling.
    state.details['order-1'].status = 'CONFIRMED';
    await act(async () => { poll(); });
    await waitFor(() => expect(ui.queryAllByTestId('notification-toast')).toHaveLength(0));
  });
  it('rodada CONFIRMED abre a mesa; PENDING aceita sem depender de abrir o pedido', async () => {
    const onOpen = vi.fn();
    const ui = await mount(onOpen);
    await insert(notification('1'), { status: 'CONFIRMED', fulfillmentType: 'DINE_IN', tabId: 'tab-1' });
    const tableToast = ui.getByTestId('notification-toast');
    expect(within(tableToast).getByText('Enviado à cozinha')).toBeTruthy();
    fireEvent.click(within(tableToast).getByRole('button', { name: 'Ver mesa' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ ref_id: 'order-1', tableTarget: 'tab-1' }));
    await insert(notification('2'));
    fireEvent.click(within(ui.getByTestId('notification-toast')).getByRole('button', { name: 'Aceitar pedido' }));
    await waitFor(() => expect(state.update).toHaveBeenCalledWith({ userId: 'U1' }, 'T1', 'order-2', 'CONFIRMED', undefined, 'PENDING'));
    await waitFor(() => expect(ui.queryByTestId('notification-toast')).toBeNull());
  });
  it('evento de outra loja não gera card', async () => {
    const ui = await mount();
    await act(async () => { state.event!({ eventType: 'INSERT', new: notification('9', { tenant_id: 'OTHER' }) }); });
    expect(ui.queryByTestId('notification-toast')).toBeNull();
    expect(state.sound).not.toHaveBeenCalled();
  });
});
