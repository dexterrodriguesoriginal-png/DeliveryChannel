// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  rpc: vi.fn(), enterTable: vi.fn(), signUp: vi.fn(),
  user: null as null | { id: string; is_anonymous?: boolean; user_metadata?: Record<string, string> },
  subscriptions: [] as Array<{ table: string; filter: string; callback: () => void }>,
  removed: vi.fn(),
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ supabaseUser: h.user, signUp: h.signUp }) }));
vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {
  rpc: (...args: unknown[]) => h.rpc(...args),
  channel: () => {
    const channel = { on: (_type: unknown, filter: { table: string; filter: string }, callback: () => void) => { h.subscriptions.push({ ...filter, callback }); return channel; }, subscribe: () => channel };
    return channel;
  }, removeChannel: (...args: unknown[]) => h.removed(...args),
} }));
const product = { id: 'p1', name: 'Chopp', description: '', price: 12, imageUrl: '', isActive: true, isAvailable: true, optionGroups: [] };
vi.mock('../../../lib/pwa/applyStoreIdentity', () => ({ applyStoreIdentity: vi.fn().mockResolvedValue({}) }));
vi.mock('../../../repositories/publicStoreRepository', () => ({ publicStoreRepository: { loadPublicStore: async () => ({ status: 'ok', data: { tenant: { id: 'tn', name: 'Loja X' }, products: [product] } }) } }));
vi.mock('../../../repositories/tenantModuleRepository', () => ({ tenantModuleRepository: { getPublicEnabled: async () => new Set(['dine_in']) } }));
vi.mock('../../../repositories/productOptionRepository', () => ({ productOptionRepository: { getPublicForProducts: async () => new Map() } }));
vi.mock('../../../repositories/mesasQrRepository', () => ({ mesasQrRepository: { capabilities: async () => ({ tableAccess: true }) } }));
vi.mock('../../../repositories/tableAccessRepository', () => ({ tableAccessRepository: { enterTable: (...args: unknown[]) => h.enterTable(...args), pingPending: vi.fn() } }));
vi.mock('../../../repositories/waiterV2Repository', () => ({ waiterV2Repository: { myTableWaiter: async () => null } }));

import { DineInClientApp, SESSION_KEY_PREFIX } from '../DineInClientApp';
import { dineInCartStorageKey } from '../../../lib/customer/dineInCartStorage';

const TOKEN = 'k'.repeat(48);
const round = (status = 'PENDING', id = 'o1') => ({ orderId: id, orderNumber: 12, roundNo: 1, status, customerName: 'Ana', mine: true, subtotal: 12, createdAt: '2026-11-03T12:00:00Z', queuePosition: 4, items: [{ name: 'Chopp', quantity: 1 }] });
const myTab = (rounds: ReturnType<typeof round>[] = [], status = 'OPEN') => ({ tabId: 'tb', status, mode: 'TABLE', tableLabel: 'Mesa 03', serviceFeePercent: 0, serviceFeeRemoved: false, subtotal: rounds.length * 12, rounds, me: { sessionId: 's1', role: 'GUEST', approved: true, displayName: 'Ana' } });
let account = myTab();

beforeEach(() => {
  h.rpc.mockReset(); h.enterTable.mockReset(); h.signUp.mockReset(); h.subscriptions.length = 0; h.removed.mockReset();
  localStorage.clear(); sessionStorage.clear(); h.user = null; account = myTab();
  window.history.replaceState(null, '', '/app/loja-x?mesa=' + TOKEN);
  h.enterTable.mockResolvedValue({ state: 'GUEST', sessionId: 's1', approved: true });
  h.rpc.mockImplementation(async (name: string) => {
    if (name === 'resolve_table_qr') return { data: { available: true, tenantSlug: 'loja-x', storeName: 'Loja X', tableLabel: 'Mesa 03' }, error: null };
    if (name === 'get_my_tab') return { data: account, error: null };
    if (name === 'submit_round') return { data: { orderId: 'o1' }, error: null };
    return { data: null, error: null };
  });
});
afterEach(cleanup);

describe('Garçom v3 — cliente QR', () => {
  it.each(['token', 'user'] as const)('ignora enterTable antigo após troca de %s e preserva somente a sessão/role atuais', async change => {
    let finishOldEntry!: (value: { state: string; sessionId: string; approved: boolean }) => void;
    h.user = { id: 'u1' };
    h.enterTable.mockReturnValueOnce(new Promise(resolve => { finishOldEntry = resolve; }));
    const view = render(<DineInClientApp token={TOKEN} />);
    fireEvent.click(await screen.findByTestId('confirm-identity-continue'));
    await waitFor(() => expect(h.enterTable).toHaveBeenCalledTimes(1));
    const nextToken = change === 'token' ? 'n'.repeat(48) : TOKEN;
    if (change === 'user') h.user = { id: 'u2' };
    h.enterTable.mockResolvedValue({ state: 'GUEST', sessionId: 'new-session', approved: true });
    view.rerender(<DineInClientApp token={nextToken} />);
    fireEvent.click(await screen.findByTestId('confirm-identity-continue'));
    await waitFor(() => expect(sessionStorage.getItem(SESSION_KEY_PREFIX + nextToken)).toBe('new-session'));
    await act(async () => finishOldEntry({ state: 'RESPONSIBLE', sessionId: 'old-session', approved: true }));
    expect(sessionStorage.getItem(SESSION_KEY_PREFIX + nextToken)).toBe('new-session');
    if (change === 'token') expect(sessionStorage.getItem(SESSION_KEY_PREFIX + TOKEN)).toBeNull();
    expect(h.rpc.mock.calls.some(call => call[0] === 'get_my_tab' && call[1]?.p_session_id === 'old-session')).toBe(false);
    expect(screen.getByTestId('role-chip').textContent).toContain('Convidado');
  });

  it('resposta antiga de enviar pedido não limpa a sacola montada em outro QR', async () => {
    let finishOldOrder!: (value: unknown) => void;
    h.user = { id: 'u1' }; sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1');
    const originalRpc = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation((name: string, args: unknown) => name === 'submit_round'
      ? new Promise(resolve => { finishOldOrder = resolve; }) : originalRpc(name, args));
    const view = render(<DineInClientApp token={TOKEN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar Chopp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fazer pedido' }));
    fireEvent.click(await screen.findByTestId('confirm-order-submit'));
    await waitFor(() => expect(finishOldOrder).toBeTypeOf('function'));
    const nextToken = 'n'.repeat(48);
    h.enterTable.mockResolvedValue({ state: 'GUEST', sessionId: 'new-session', approved: true });
    view.rerender(<DineInClientApp token={nextToken} />);
    fireEvent.click(await screen.findByTestId('confirm-identity-continue'));
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar Chopp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Chopp' }));
    await act(async () => finishOldOrder({ data: { orderId: 'old-order' }, error: null }));
    expect(screen.getByTestId('dinein-bag-counter').textContent).toContain('2');
    expect(screen.queryByText('Pedido feito! A cozinha já recebeu.')).toBeNull();
    expect(JSON.parse(localStorage.getItem(dineInCartStorageKey(nextToken)) || '{}').lines[0].quantity).toBe(2);
  });

  it('resposta antiga de pedir conta não muda o estado da nova comanda', async () => {
    let finishOldBill!: (value: unknown) => void;
    h.user = { id: 'u1' }; sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1');
    const originalRpc = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation((name: string, args: unknown) => name === 'request_bill'
      ? new Promise(resolve => { finishOldBill = resolve; }) : originalRpc(name, args));
    const view = render(<DineInClientApp token={TOKEN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pedir a conta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chamar garçom para fechar a conta' }));
    await waitFor(() => expect(finishOldBill).toBeTypeOf('function'));
    const nextToken = 'n'.repeat(48);
    h.enterTable.mockResolvedValue({ state: 'GUEST', sessionId: 'new-session', approved: true });
    view.rerender(<DineInClientApp token={nextToken} />);
    fireEvent.click(await screen.findByTestId('confirm-identity-continue'));
    await screen.findByRole('button', { name: 'Pedir a conta' });
    await act(async () => finishOldBill({ data: null, error: null }));
    expect(screen.queryByRole('button', { name: 'Conta pedida' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pedir a conta' }).hasAttribute('disabled')).toBe(false);
  });

  it('sacola fixa abre itens sem rolar, volta ao menu e só pede cadastro ao finalizar; preserva quantidades até confirmar', async () => {
    const view = render(<DineInClientApp token={TOKEN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar Chopp' }));
    fireEvent.click(screen.getByTestId('dinein-bag-counter'));
    const bag = screen.getByRole('dialog', { name: 'Sua sacola' });
    fireEvent.click(within(bag).getByRole('button', { name: 'Aumentar Chopp' }));
    expect(screen.getByTestId('dinein-bag-counter').textContent).toContain('2');
    fireEvent.click(within(bag).getByRole('button', { name: 'Adicionar mais itens' }));
    expect(screen.queryByRole('dialog', { name: 'Sua sacola' })).toBeNull();
    fireEvent.click(screen.getByTestId('dinein-bag-counter'));
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar pedido' }));
    await screen.findByTestId('identity-gate');
    expect(h.enterTable).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(dineInCartStorageKey(TOKEN)) || '{}')).toMatchObject({ checkoutPending: true, lines: [{ productId: 'p1', quantity: 2 }] });
    h.signUp.mockResolvedValue({ success: true });
    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: 'Ana Souza' } });
    fireEvent.change(screen.getByLabelText('Celular'), { target: { value: '11999990000' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@example.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo123' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta e continuar' }));
    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    h.user = { id: 'u1', user_metadata: { name: 'Ana' } };
    view.rerender(<DineInClientApp token={TOKEN} />);
    const confirm = await screen.findByRole('dialog', { name: 'Confirmar pedido na mesa' });
    expect(confirm.textContent).toContain('2× Chopp');
    expect(h.rpc.mock.calls.some(call => call[0] === 'submit_round')).toBe(false);
    account = myTab([round()]);
    fireEvent.click(screen.getByTestId('confirm-order-submit'));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('submit_round', expect.objectContaining({ p_session_id: 's1', p_items: [{ productId: 'p1', quantity: 2, notes: '', options: [] }] })));
    await screen.findByTestId('dinein-app-banner');
    expect(screen.getByRole('link', { name: 'Instalar app da loja' }).getAttribute('href')).toBe('/app/loja-x');
    await waitFor(() => expect(localStorage.getItem(dineInCartStorageKey(TOKEN))).toBeNull());
  });

  it('retorno do e-mail restaura carrinho e vai à revisão do pedido depois de confirmar a identidade', async () => {
    localStorage.setItem(dineInCartStorageKey(TOKEN), JSON.stringify({ at: Date.now(), checkoutPending: true, lines: [{ productId: 'p1', quantity: 3, options: [], notes: 'Sem gelo' }] }));
    h.user = { id: 'u1' };
    render(<DineInClientApp token={TOKEN} />);
    fireEvent.click(await screen.findByTestId('confirm-identity-continue'));
    const confirm = await screen.findByRole('dialog', { name: 'Confirmar pedido na mesa' });
    expect(confirm.textContent).toContain('3× Chopp');
    expect(confirm.textContent).toContain('Sem gelo');
    expect(h.rpc.mock.calls.some(call => call[0] === 'submit_round')).toBe(false);
  });

  it('acompanha sinal realtime da própria comanda, atualiza posição escalar e mostra timeline com duração', async () => {
    h.user = { id: 'u1' }; sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1'); account = myTab([round()]);
    const view = render(<DineInClientApp token={TOKEN} />);
    expect((await screen.findByTestId('dinein-track-order')).textContent).toContain('Você é o 4º da fila');
    const subscription = h.subscriptions.find(item => item.table === 'dining_tracking_revisions');
    expect(subscription?.filter).toBe('tab_id=eq.tb');
    expect(h.subscriptions.some(item => item.table === 'orders')).toBe(false);
    account = myTab([{ ...round('PREPARING'), queuePosition: 2, confirmedAt: '2026-11-03T12:01:00Z', preparingAt: '2026-11-03T12:03:00Z' } as any]);
    await act(async () => subscription!.callback());
    await waitFor(() => expect(screen.getByTestId('dinein-track-order').textContent).toContain('Preparando seu pedido · Você é o 2º da fila'));
    account = myTab([{ ...round('DELIVERED'), queuePosition: null, confirmedAt: '2026-11-03T12:01:00Z', preparingAt: '2026-11-03T12:03:00Z', readyAt: '2026-11-03T12:10:00Z', servedAt: '2026-11-03T12:11:00Z', deliveredAt: '2026-11-03T12:12:00Z' } as any]);
    await act(async () => subscription!.callback());
    fireEvent.click(screen.getByTestId('dinein-track-order'));
    const timeline = await screen.findByRole('dialog', { name: 'Acompanhar pedido' });
    expect(timeline.textContent).toContain('Pedido feito'); expect(timeline.textContent).toContain('Preparo iniciado'); expect(timeline.textContent).toContain('Entregue em 12 min');
    expect(timeline.querySelectorAll('time[dateTime]').length).toBe(6);
    view.unmount(); expect(h.removed).toHaveBeenCalled();
  });

  it('pedido da conta muda texto/cor e bloqueia novo pedido; minha conta colore entregues e cancelados', async () => {
    h.user = { id: 'u1' }; sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1'); account = myTab([round('DELIVERED'), round('CANCELLED', 'o2')]);
    render(<DineInClientApp token={TOKEN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pedir a conta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chamar garçom para fechar a conta' }));
    const pending = await screen.findByRole('button', { name: 'Conta pedida' });
    expect(pending.hasAttribute('disabled')).toBe(true); expect(pending.className).toContain('dinein-bill-requested');
    expect(h.rpc).toHaveBeenCalledWith('request_bill', { p_session_id: 's1', p_choice: 'CAIXA', p_cash_tendered_cents: null });
    account = { ...account, status: 'AWAITING_PAYMENT' };
    fireEvent.click(screen.getByRole('button', { name: 'Minha conta' }));
    await screen.findByRole('dialog', { name: 'Minha conta' });
    expect(screen.getByTestId('account-round-o1').className).toContain('text-green-800');
    expect(screen.getByTestId('account-round-o2').className).toContain('text-red-800');
    expect(screen.queryByRole('button', { name: 'Pedir a conta' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Adicionar Chopp' }).hasAttribute('disabled')).toBe(true);
  });

  it.each(['BILL_REQUESTED', 'WAITER_AUTHORIZED'])('Pedir mais reabre %s pela sessão e libera novos pedidos após confirmação do servidor', async status => {
    h.user = { id: 'u1' }; sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1'); account = myTab([round()], status);
    const originalRpc = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === 'reopen_tab_from_bill') { account = myTab([round()]); return { data: { status: 'OPEN' }, error: null }; }
      return originalRpc(name, args);
    });
    render(<DineInClientApp token={TOKEN} />);
    const reopen = await screen.findByRole('button', { name: 'Pedir mais' });
    expect(screen.getByRole('button', { name: 'Adicionar Chopp' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('region', { name: 'Situação da conta' }).className).toContain('dinein-bill-requested');
    fireEvent.click(reopen);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('reopen_tab_from_bill', { p_session_id: 's1' }));
    await screen.findByText('Comanda reaberta. Você já pode pedir mais; a equipe foi avisada.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Adicionar Chopp' }).hasAttribute('disabled')).toBe(false));
    expect(screen.queryByRole('button', { name: 'Pedir mais' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pedir a conta' }).hasAttribute('disabled')).toBe(false);
  });

  it.each([
    { status: 'AWAITING_PAYMENT', pixStatus: 'pending' },
    { status: 'BILL_REQUESTED', pixStatus: 'creating' },
    { status: 'WAITER_AUTHORIZED', pixStatus: 'paid' },
    { status: 'CLOSED', pixStatus: 'paid' },
  ])('não oferece Pedir mais para $status com PIX $pixStatus', async state => {
    h.user = { id: 'u1' }; sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1'); account = { ...myTab([round()], state.status), ...state };
    render(<DineInClientApp token={TOKEN} />);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('get_my_tab', { p_session_id: 's1' }));
    if (state.status === 'CLOSED') await screen.findByRole('alert');
    else await screen.findByRole('region', { name: 'Situação da conta' });
    expect(screen.queryByRole('button', { name: 'Pedir mais' })).toBeNull();
    if (state.status === 'AWAITING_PAYMENT') {
      const awaiting = screen.getByRole('button', { name: 'Aguardando PIX' });
      expect(awaiting.className).toContain('dinein-bill-awaiting-pix');
      expect(awaiting.className).not.toContain('dinein-bill-requested');
    }
  });

  it('recusa de reabertura mantém pedidos bloqueados e atualiza o PIX iniciado em outra tela', async () => {
    h.user = { id: 'u1' }; sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1'); account = myTab([round()], 'BILL_REQUESTED');
    const originalRpc = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === 'reopen_tab_from_bill') {
        account = { ...account, status: 'AWAITING_PAYMENT' };
        return { data: null, error: { message: 'PIX_PENDING' } };
      }
      return originalRpc(name, args);
    });
    render(<DineInClientApp token={TOKEN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pedir mais' }));
    await screen.findByText('O pagamento já está em andamento ou foi confirmado. Chame o garçom para conferir.');
    await screen.findByRole('button', { name: 'Aguardando PIX' });
    expect(screen.queryByRole('button', { name: 'Pedir mais' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Adicionar Chopp' }).hasAttribute('disabled')).toBe(true);
  });
});
