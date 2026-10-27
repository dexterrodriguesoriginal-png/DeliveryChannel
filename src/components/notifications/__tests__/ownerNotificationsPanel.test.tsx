// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
const now = Date.now();
const rows = [
  { id: 'a', tenant_id: 'T1', kind: 'ORDER_NEW', ref_id: 'o1', title: 'Novo pedido', created_at: new Date(now - 30_000).toISOString(), read_at: null },
  { id: 'b', tenant_id: 'T1', kind: 'ORDER_MESSAGE', ref_id: 'o1', title: 'Nova mensagem do entregador', created_at: new Date(now - 5 * 60_000).toISOString(), read_at: null },
  { id: 'c', tenant_id: 'T1', kind: 'DRIVER_JOIN_REQUEST', ref_id: 'd1', title: 'Entregador quer entrar', created_at: new Date(now - 2 * 3600_000).toISOString(), read_at: null },
  { id: 'd', tenant_id: 'T1', kind: 'ORDER_NEW', ref_id: 'o2', title: 'Novo pedido', created_at: new Date(now - 26 * 3600_000).toISOString(), read_at: new Date().toISOString() },
];
const read = vi.fn(() => Promise.resolve());
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ activeTenant: { id: 'T1' }, supabaseUser: { id: 'U1' }, activeRole: 'OWNER' }) }));
vi.mock('../../../lib/supabase', () => { const ch: any = { on: () => ch, subscribe: () => ch }; return { supabase: { channel: () => ch, removeChannel: () => Promise.resolve() } }; });
vi.mock('../../../repositories/dispatchChatRepository', () => ({
  dispatchChatRepository: { notifications: () => Promise.resolve(rows), visibleNotifications: () => Promise.resolve(rows), read: (...a: any[]) => (read as any)(...a),
    orderBriefs: () => Promise.resolve({ o1: { orderNumber: 45, customerName: 'Cliente Balcão', total: 13 } }) },
}));
import { OwnerNotifications } from '../OwnerNotifications';
afterEach(() => { cleanup(); read.mockClear(); });

describe('Painel de notificações redesenhado', () => {
  it('mostra o contador no botão, cartões com detalhe e tempo relativo, filtra e marca todas como lidas', async () => {
    const onOpen = vi.fn();
    const ui = render(<OwnerNotifications onOpen={onOpen} />);
    const bell = await waitFor(() => ui.getByRole('button', { name: 'Notificações, 3 não lidas' }));
    expect(ui.getByTestId('unread-badge').textContent).toBe('3');
    fireEvent.click(bell);
    const panel = await waitFor(() => ui.getByTestId('notification-panel'));
    expect(panel.querySelectorAll('[data-testid="notification-item"]')).toHaveLength(4);
    await waitFor(() => expect(panel.textContent).toContain('#45 · Cliente Balcão · R$'));
    expect(panel.textContent).toContain('agora'); expect(panel.textContent).toContain('há 5 min'); expect(panel.textContent).toContain('há 2 h'); expect(panel.textContent).toContain('ontem');
    expect(panel.querySelector('[data-type="chat"]')).not.toBeNull(); expect(panel.querySelector('[data-type="driver"]')).not.toBeNull();
    fireEvent.click(ui.getByRole('tab', { name: /Não lidas/ }));
    expect(panel.querySelectorAll('[data-testid="notification-item"]')).toHaveLength(3);
    fireEvent.click(ui.getByText('Marcar todas como lidas'));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(ui.queryByTestId('unread-badge')).toBeNull());
    expect(panel.textContent).toContain('Nenhuma notificação não lida.');
  });
  it('clique no cartão abre o pedido e fecha o painel; Esc também fecha', async () => {
    const onOpen = vi.fn();
    const ui = render(<OwnerNotifications onOpen={onOpen} />);
    fireEvent.click(await waitFor(() => ui.getByRole('button', { name: /Notificações,/ })));
    const panel = await waitFor(() => ui.getByTestId('notification-panel'));
    fireEvent.click(panel.querySelector('.dcn-main')!);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(read).toHaveBeenCalledWith('T1', 'a');
    await waitFor(() => expect(ui.queryByTestId('notification-panel')).toBeNull());
    fireEvent.click(ui.getByRole('button', { name: /Notificações,/ }));
    await waitFor(() => ui.getByTestId('notification-panel'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(ui.queryByTestId('notification-panel')).toBeNull());
  });
});
