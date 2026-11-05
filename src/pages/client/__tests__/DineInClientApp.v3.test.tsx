// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  rpc: vi.fn(), enterTable: vi.fn(), listFreeTables: vi.fn(), moveTable: vi.fn(), signUp: vi.fn(),
  user: null as null | { id: string; is_anonymous?: boolean; user_metadata?: Record<string, string> },
  subscriptions: [] as Array<{ table: string; filter: string; callback: () => void }>,
  channels: new Map<string, { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }>(),
  installPrompt: null as null | ReturnType<typeof vi.fn>, clearInstallPrompt: vi.fn(),
  removed: vi.fn(),
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ supabaseUser: h.user, signUp: h.signUp }) }));
vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {
  rpc: (...args: unknown[]) => h.rpc(...args),
  channel: (name: string) => {
    // Supabase reuses the SAME object when a component asks for an existing channel name.
    if (h.channels.has(name)) return h.channels.get(name);
    const channel = {
      on: vi.fn((_type: unknown, filter: { table: string; filter: string }, callback: () => void) => { h.subscriptions.push({ ...filter, callback }); return channel; }),
      subscribe: vi.fn(() => channel),
    };
    h.channels.set(name, channel);
    return channel;
  }, removeChannel: (...args: unknown[]) => h.removed(...args),
} }));
const product = { id: 'p1', name: 'Chopp', description: '', price: 12, imageUrl: '', isActive: true, isAvailable: true, optionGroups: [] };
vi.mock('../../../lib/pwa/applyStoreIdentity', () => ({ applyStoreIdentity: vi.fn().mockResolvedValue({}) }));
vi.mock('../../../lib/pwa/installState', () => ({ getDeferredPrompt: () => h.installPrompt ? { prompt: h.installPrompt } : null, clearDeferredPrompt: () => h.clearInstallPrompt() }));
vi.mock('../../../repositories/publicStoreRepository', () => ({ publicStoreRepository: { loadPublicStore: async () => ({ status: 'ok', data: { tenant: { id: 'tn', name: 'Loja X' }, products: [product] } }) } }));
vi.mock('../../../repositories/tenantModuleRepository', () => ({ tenantModuleRepository: { getPublicEnabled: async () => new Set(['dine_in']) } }));
vi.mock('../../../repositories/productOptionRepository', () => ({ productOptionRepository: { getPublicForProducts: async () => new Map() } }));
vi.mock('../../../repositories/mesasQrRepository', () => ({ mesasQrRepository: { capabilities: async () => ({ tableAccess: true }) } }));
vi.mock('../../../repositories/tableAccessRepository', () => ({ tableAccessRepository: {
  enterTable: (...args: unknown[]) => h.enterTable(...args),
  listFreeTables: (...args: unknown[]) => h.listFreeTables(...args),
  moveTable: (...args: unknown[]) => h.moveTable(...args),
  pingPending: vi.fn(),
} }));
vi.mock('../../../repositories/waiterV2Repository', () => ({ waiterV2Repository: { myTableWaiter: async () => null } }));

import { DineInClientApp, SESSION_KEY_PREFIX } from '../DineInClientApp';
import { dineInCartStorageKey } from '../../../lib/customer/dineInCartStorage';

const TOKEN = 'k'.repeat(48);
const openMenu = async () => fireEvent.click(await screen.findByRole('button', { name: 'Cardápio' }));
const round = (status = 'PENDING', id = 'o1') => ({ orderId: id, orderNumber: 12, roundNo: 1, status, customerName: 'Ana', mine: true, subtotal: 12, createdAt: '2026-11-03T12:00:00Z', queuePosition: 4, items: [{ name: 'Chopp', quantity: 1 }] });
const myTab = (rounds: ReturnType<typeof round>[] = [], status = 'OPEN') => ({ tabId: 'tb', status, mode: 'TABLE', tableLabel: 'Mesa 03', serviceFeePercent: 0, serviceFeeRemoved: false, subtotal: rounds.length * 12, rounds, me: { sessionId: 's1', role: 'GUEST', approved: true, displayName: 'Ana' } });
let account = myTab();
let moveRequests: any[] = [];

beforeEach(() => {
  h.rpc.mockReset(); h.enterTable.mockReset(); h.listFreeTables.mockReset(); h.moveTable.mockReset(); h.signUp.mockReset(); h.subscriptions.length = 0; h.removed.mockReset();
  h.channels.clear(); h.installPrompt = null; h.clearInstallPrompt.mockReset();
  localStorage.clear(); sessionStorage.clear(); h.user = null; account = myTab(); moveRequests = [];
  window.history.replaceState(null, '', '/app/loja-x?mesa=' + TOKEN);
  h.enterTable.mockResolvedValue({ state: 'GUEST', sessionId: 's1', approved: true });
  h.listFreeTables.mockResolvedValue([]);
  h.rpc.mockImplementation(async (name: string) => {
    if (name === 'resolve_table_qr') return { data: { available: true, tenantSlug: 'loja-x', storeName: 'Loja X', tableLabel: 'Mesa 03' }, error: null };
    if (name === 'get_my_tab') return { data: account, error: null };
    if (name === 'list_my_table_move_requests') return { data: moveRequests, error: null };
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
    await openMenu();
    fireEvent.click(await screen.findByTestId('confirm-identity-continue'));
    await waitFor(() => expect(h.enterTable).toHaveBeenCalledTimes(1));
    const nextToken = change === 'token' ? 'n'.repeat(48) : TOKEN;
    if (change === 'user') h.user = { id: 'u2' };
    h.enterTable.mockResolvedValue({ state: 'GUEST', sessionId: 'new-session', approved: true });
    view.rerender(<DineInClientApp token={nextToken} />);
    await openMenu();
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
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar Chopp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fazer pedido' }));
    fireEvent.click(await screen.findByTestId('confirm-order-submit'));
    await waitFor(() => expect(finishOldOrder).toBeTypeOf('function'));
    const nextToken = 'n'.repeat(48);
    h.enterTable.mockResolvedValue({ state: 'GUEST', sessionId: 'new-session', approved: true });
    view.rerender(<DineInClientApp token={nextToken} />);
    await openMenu();
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
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Pedir a conta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chamar garçom para fechar a conta' }));
    await waitFor(() => expect(finishOldBill).toBeTypeOf('function'));
    const nextToken = 'n'.repeat(48);
    h.enterTable.mockResolvedValue({ state: 'GUEST', sessionId: 'new-session', approved: true });
    view.rerender(<DineInClientApp token={nextToken} />);
    await openMenu();
    fireEvent.click(await screen.findByTestId('confirm-identity-continue'));
    await screen.findByRole('button', { name: 'Pedir a conta' });
    await act(async () => finishOldBill({ data: null, error: null }));
    expect(screen.queryByRole('button', { name: 'Conta pedida' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pedir a conta' }).hasAttribute('disabled')).toBe(false);
  });

  it('sacola fixa abre itens sem rolar, volta ao menu e só pede cadastro ao finalizar; preserva quantidades até confirmar', async () => {
    const view = render(<DineInClientApp token={TOKEN} />);
    await openMenu();
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
    await openMenu();
    fireEvent.click(await screen.findByTestId('confirm-identity-continue'));
    const confirm = await screen.findByRole('dialog', { name: 'Confirmar pedido na mesa' });
    expect(confirm.textContent).toContain('3× Chopp');
    expect(confirm.textContent).toContain('Sem gelo');
    expect(h.rpc.mock.calls.some(call => call[0] === 'submit_round')).toBe(false);
  });

  it('acompanha sinal realtime da própria comanda, atualiza posição escalar e mostra timeline com duração', async () => {
    h.user = { id: 'u1' }; sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1'); account = myTab([round()]);
    const view = render(<DineInClientApp token={TOKEN} />);
    await openMenu();
    expect((await screen.findByTestId('dinein-track-order')).textContent).toContain('Você é o 4º da fila');
    const subscription = h.subscriptions.find(item => item.table === 'dining_tracking_revisions');
    expect(subscription?.filter).toBe('tab_id=eq.tb');
    expect(h.subscriptions.some(item => item.table === 'orders')).toBe(false);
    account = myTab([{ ...round('PREPARING'), queuePosition: 2, confirmedAt: '2026-11-03T12:01:00Z', preparingAt: '2026-11-03T12:03:00Z' } as any]);
    await act(async () => subscription!.callback());
    await waitFor(() => expect(screen.getByTestId('dinein-track-order').textContent).toContain('Preparando seu pedido · Você é o 2º da fila'));
    fireEvent.click(screen.getByTestId('dinein-track-order'));
    account = myTab([{ ...round('DELIVERED'), queuePosition: null, confirmedAt: '2026-11-03T12:01:00Z', preparingAt: '2026-11-03T12:03:00Z', readyAt: '2026-11-03T12:10:00Z', servedAt: '2026-11-03T12:11:00Z', deliveredAt: '2026-11-03T12:12:00Z' } as any]);
    await act(async () => subscription!.callback());
    await waitFor(() => expect(screen.queryByTestId('dinein-track-order')).toBeNull());
    const timeline = await screen.findByRole('dialog', { name: 'Acompanhar pedido' });
    expect(timeline.textContent).toContain('Pedido feito'); expect(timeline.textContent).toContain('Preparo iniciado'); expect(timeline.textContent).toContain('Entregue em 12 min');
    expect(timeline.querySelectorAll('time[dateTime]').length).toBe(6);
    view.unmount(); expect(h.removed).toHaveBeenCalled();
  });

  it('pedido da conta muda texto/cor e bloqueia novo pedido; minha conta colore entregues e cancelados', async () => {
    h.user = { id: 'u1' }; sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1'); account = myTab([round('DELIVERED'), round('CANCELLED', 'o2')]);
    render(<DineInClientApp token={TOKEN} />);
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Pedir a conta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chamar garçom para fechar a conta' }));
    const pending = await screen.findByRole('button', { name: 'Conta pedida' });
    expect(pending.hasAttribute('disabled')).toBe(true); expect(pending.className).toContain('dinein-bill-requested');
    expect(h.rpc).toHaveBeenCalledWith('request_bill', { p_session_id: 's1', p_choice: 'CAIXA', p_cash_tendered_cents: null });
    account = { ...account, status: 'AWAITING_PAYMENT' };
    fireEvent.click(screen.getByRole('button', { name: 'Minha conta' }));
    await screen.findByRole('dialog', { name: 'Minha conta' });
    expect(screen.getByTestId('account-round-o1').style.color).toBe('#15803d');
    expect(screen.getByTestId('account-round-o2').style.color).toBe('#374151');
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
    await openMenu();
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
    await openMenu();
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
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Pedir mais' }));
    await screen.findByText('O pagamento já está em andamento ou foi confirmado. Chame o garçom para conferir.');
    await screen.findByRole('button', { name: 'Aguardando PIX' });
    expect(screen.queryByRole('button', { name: 'Pedir mais' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Adicionar Chopp' }).hasAttribute('disabled')).toBe(true);
  });

  it('cliente contesta pela própria sessão mesmo após fechar a conta, vê a disputa e horários por item', async () => {
    h.user = { id: 'u1' }; sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1');
    const deliveredAt = new Date().toISOString();
    const mine = { ...round('DELIVERED'), deliveredAt, canDisputeDelivery: true, items: [{ name: 'Chopp', quantity: 1, deliveredAt }] };
    const another = { ...mine, orderId: 'other-order', mine: false };
    account = myTab([mine, another] as any, 'CLOSED');
    const originalRpc = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === 'customer_dispute_delivery') {
        account = myTab([{ ...mine, canDisputeDelivery: false, deliveryDispute: { id: 'd1', status: 'OPEN', createdAt: deliveredAt } }, another] as any, 'CLOSED');
        return { data: { id: 'd1', status: 'OPEN' }, error: null };
      }
      return originalRpc(name, args);
    });
    render(<DineInClientApp token={TOKEN} />);
    await openMenu();
    expect(await screen.findByText('Seu pedido foi entregue')).toBeTruthy();
    expect(screen.queryByTestId('delivery-notice-other-order')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Não recebi' }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('customer_dispute_delivery', { p_session_id: 's1', p_order: 'o1' }));
    await screen.findByText('Entrega em verificação');
    expect(screen.queryByRole('button', { name: 'Não recebi' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Minha conta' }));
    const item = screen.getByTestId('account-round-o1');
    expect(item.textContent).toContain('Entregue às');
    expect(item.querySelector('time')?.getAttribute('dateTime')).toBe(deliveredAt);
    account = myTab([{ ...mine, status: 'PREPARING', deliveredAt: null, canDisputeDelivery: false, deliveryDispute: { id: 'd1', status: 'RESENT', createdAt: deliveredAt, resolvedAt: deliveredAt } }] as any, 'CLOSED');
    await act(async () => h.subscriptions.find(item => item.table === 'dining_tracking_revisions')!.callback());
    await waitFor(() => expect(screen.getAllByText('Pedido reenviado para produção').length).toBeGreaterThan(0));
    expect(screen.getByTestId('account-round-o1').querySelector('time')).toBeNull();
  });

  it('prazo recusado pelo servidor atualiza a entrega recebida e retira Não recebi', async () => {
    h.user = { id: 'u1' }; sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1');
    account = myTab([{ ...round('DELIVERED'), deliveredAt: new Date().toISOString(), canDisputeDelivery: true }] as any);
    const originalRpc = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === 'customer_dispute_delivery') {
        account = myTab([{ ...round('DELIVERED'), deliveredAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), canDisputeDelivery: false }] as any);
        return { data: null, error: { message: 'DELIVERY_DISPUTE_WINDOW_EXPIRED' } };
      }
      return originalRpc(name, args);
    });
    render(<DineInClientApp token={TOKEN} />);
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Não recebi' }));
    await screen.findByText('O prazo de 5 minutos terminou. Chame o garçom para conferir sua entrega.');
    await screen.findByText('Pedido recebido');
    expect(screen.queryByRole('button', { name: 'Não recebi' })).toBeNull();
  });

  it.each([
    ['token', 'list'], ['user', 'list'], ['token', 'move'], ['user', 'move'],
  ] as const)('ignora resposta antiga de mudar mesa após troca de %s (%s)', async (change, operation) => {
    let finishOld!: (value: any) => void;
    h.user = { id: 'u1' }; sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1');
    if (operation === 'list') h.listFreeTables.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
    else {
      h.listFreeTables.mockResolvedValueOnce([{ id: 'old-table', label: 'Mesa antiga', seats: 4, area: null }]);
      h.moveTable.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
    }
    const view = render(<DineInClientApp token={TOKEN} />);
    await openMenu();
    fireEvent.click(await screen.findByTestId('dinein-move-table-btn'));
    if (operation === 'move') fireEvent.click(await screen.findByTestId('move-to-table-old-table'));
    await waitFor(() => expect(finishOld).toBeTypeOf('function'));
    const nextToken = change === 'token' ? 'n'.repeat(48) : TOKEN;
    if (change === 'user') h.user = { id: 'u2' };
    h.enterTable.mockResolvedValue({ state: 'GUEST', sessionId: 'new-session', approved: true });
    h.listFreeTables.mockResolvedValue([{ id: 'new-table', label: 'Mesa atual', seats: 4, area: null }]);
    view.rerender(<DineInClientApp token={nextToken} />);
    await openMenu();
    expect(screen.queryByTestId('dinein-move-table-modal')).toBeNull();
    fireEvent.click(await screen.findByTestId('confirm-identity-continue'));
    await waitFor(() => expect(sessionStorage.getItem(SESSION_KEY_PREFIX + nextToken)).toBe('new-session'));
    fireEvent.click(await screen.findByTestId('dinein-move-table-btn'));
    await screen.findByTestId('move-to-table-new-table');
    await act(async () => finishOld(operation === 'list'
      ? [{ id: 'old-table', label: 'Mesa antiga', seats: 4, area: null }]
      : { notice: 'Mesa antiga → Mesa privada', tabId: 'old-tab' }));
    expect(screen.getByTestId('dinein-move-table-modal')).toBeTruthy();
    expect(screen.getByTestId('move-to-table-new-table')).toBeTruthy();
    expect(screen.queryByTestId('move-to-table-old-table')).toBeNull();
    expect(screen.queryByText(/Mesa trocada/)).toBeNull();
  });

  it('cliente solicita mudança e só acompanha a nova mesa depois de autorização, preservando sessão e dívida no reload', async () => {
    h.user = { id: 'u1' };
    account = myTab([round('PENDING', 'first'), round('DELIVERED', 'second')]);
    sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1');
    h.listFreeTables.mockResolvedValue([
      { id: 't7', label: 'Mesa 07', area: 'Varanda', seats: 4 },
    ]);
    h.moveTable.mockImplementation(async () => {
      moveRequests = [{ id: 'req1', status: 'PENDING', tabId: 'tb', fromTableId: 't3', toTableId: 't7', fromLabel: 'Mesa 03', toLabel: 'Mesa 07', requestedAt: '2026-11-04T12:10:00Z' }];
      return { ...moveRequests[0], requestId: 'req1', notice: 'Solicitação enviada' };
    });

    const view = render(<DineInClientApp token={TOKEN} />);
    await openMenu();
    const moveBtn = await screen.findByTestId('dinein-move-table-btn');
    expect(moveBtn.hasAttribute('disabled')).toBe(false);
    fireEvent.click(moveBtn);

    expect(await screen.findByTestId('dinein-move-table-modal')).toBeTruthy();
    expect(h.listFreeTables).toHaveBeenCalledWith('s1');
    fireEvent.click(await screen.findByTestId('move-to-table-t7'));

    await waitFor(() => expect(h.moveTable).toHaveBeenCalledWith('s1', { tableId: 't7' }));
    expect(await screen.findByText('Mudança de mesa aguardando autorização. Sua conta continua na mesa atual.')).toBeTruthy();
    expect(screen.getByText(/Você está na Mesa 03/)).toBeTruthy();
    expect(screen.queryByText(/Você está na Mesa 07/)).toBeNull();
    expect(screen.getByTestId('dinein-move-table-btn').hasAttribute('disabled')).toBe(true);
    expect(sessionStorage.getItem(SESSION_KEY_PREFIX + TOKEN)).toBe('s1');
    // A resposta da equipe muda a conta no servidor; só então o cliente muda de mesa.
    account = { ...account, tableLabel: 'Mesa 07', tableMoves: [{ id: 'mv1', action: 'MOVE', fromLabel: 'Mesa 03', toLabel: 'Mesa 07', actorKind: 'STAFF', createdAt: '2026-11-04T12:11:00Z' }] } as any;
    moveRequests = [{ ...moveRequests[0], status: 'APPROVED' }];
    await act(async () => h.subscriptions.find(item => item.table === 'dining_tracking_revisions')!.callback());
    expect(await screen.findByText('Mudança de mesa autorizada. Sua conta, pedidos e valores acompanham a nova mesa.')).toBeTruthy();
    expect(screen.getByText(/Você está na Mesa 07/)).toBeTruthy();

    // Em Minha conta, exibe o histórico de mesas
    fireEvent.click(screen.getByRole('button', { name: 'Minha conta' }));
    expect((await screen.findByTestId('account-table-moves')).textContent).toContain('Mesa 03 → Mesa 07');
    expect(sessionStorage.getItem(SESSION_KEY_PREFIX + TOKEN)).toBe('s1');
    // Reload still uses the original URL, whose physical table is now free.
    // Re-entering that QR would replace the debt with a newly opened account.
    view.unmount(); h.enterTable.mockClear(); h.rpc.mockClear();
    render(<DineInClientApp token={TOKEN} />);
    await openMenu();
    await screen.findByRole('button', { name: 'Minha conta' });
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('get_my_tab', { p_session_id: 's1' }));
    expect(h.enterTable).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(SESSION_KEY_PREFIX + TOKEN)).toBe('s1');
    fireEvent.click(screen.getByRole('button', { name: 'Minha conta' }));
    expect(await screen.findByTestId('account-round-first')).toBeTruthy();
    expect(screen.getByTestId('account-round-second')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Minha conta' }).textContent).toContain('Mesa 07');
    expect(screen.getByRole('dialog', { name: 'Minha conta' }).textContent).toContain('24,00');

  });

  it('recusa da mudança mantém a conta e libera uma nova solicitação', async () => {
    h.user = { id: 'u1' }; sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1');
    account = myTab([round('PREPARING')]);
    moveRequests = [{ id: 'req1', status: 'PENDING', tabId: 'tb', fromTableId: 't3', toTableId: 't7', fromLabel: 'Mesa 03', toLabel: 'Mesa 07' }];
    render(<DineInClientApp token={TOKEN} />);
    await openMenu();
    await screen.findByText('Mudança de mesa aguardando autorização. Sua conta continua na mesa atual.');
    moveRequests = [{ ...moveRequests[0], status: 'REJECTED' }];
    await act(async () => h.subscriptions.find(item => item.table === 'dining_tracking_revisions')!.callback());
    await screen.findByText('Solicitação de mudança de mesa recusada. Sua conta continua na mesa atual.');
    expect(screen.getByText(/Você está na Mesa 03/)).toBeTruthy();
    expect(screen.getByTestId('dinein-move-table-btn').hasAttribute('disabled')).toBe(false);
    expect(sessionStorage.getItem(SESSION_KEY_PREFIX + TOKEN)).toBe('s1');
  });

  it('exibe código de entrega de 4 dígitos por rodada e bloqueia "Não recebi" quando confirmado com código', async () => {
    h.user = { id: 'u1' };
    sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1');
    const deliveredAt = new Date().toISOString();
    account = {
      ...myTab([
        { ...round('READY', 'o-ready'), deliveryCode: '4821' } as any,
        { ...round('DELIVERED', 'o-confirmed'), deliveredAt, canDisputeDelivery: false, deliveryConfirmedWithCode: true } as any,
      ]),
      requireDeliveryCode: true,
    } as any;

    render(<DineInClientApp token={TOKEN} />);
    await openMenu();
    const trackingBar = await screen.findByTestId('dinein-track-order');
    expect(trackingBar.textContent).toContain('Seu código de entrega: 4821 - informe ao garçom');
    expect(screen.getByTestId('delivery-notice-o-confirmed').textContent).toContain('Entrega confirmada com código');
    expect(screen.queryByRole('button', { name: 'Não recebi' })).toBeNull();

    fireEvent.click(trackingBar);
    expect((await screen.findByTestId('round-delivery-code-o-ready')).textContent).toContain('4821');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar acompanhamento' }));

    fireEvent.click(screen.getByRole('button', { name: 'Minha conta' }));
    expect((await screen.findByTestId('account-round-code-o-ready')).textContent).toContain('4821');
  });

  it('mostra no cardápio e acompanhamento códigos de outras rodadas da conta aprovada, mesmo após rodada antiga sem código', async () => {
    h.user = { id: 'u1' };
    sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1');
    account = myTab([
      round('PREPARING', 'old-without-code'),
      { ...round('READY', 'staff-round'), mine: false, roundNo: 2, deliveryCode: '4821' } as any,
      { ...round('OUT_FOR_DELIVERY', 'guest-round'), mine: false, roundNo: 3, deliveryCode: '7193' } as any,
      { ...round('DELIVERED', 'done'), deliveryCode: '1234' } as any,
      { ...round('CANCELLED', 'cancelled'), deliveryCode: '5678' } as any,
    ]);

    render(<DineInClientApp token={TOKEN} />);
    await openMenu();
    const visibleCodes = await screen.findByRole('region', { name: 'Seus códigos de entrega' });
    expect(visibleCodes.textContent).toContain('Seu código de entrega: 4821 - informe ao garçom');
    expect(visibleCodes.textContent).toContain('Seu código de entrega: 7193 - informe ao garçom');
    expect(visibleCodes.textContent).not.toMatch(/1234|5678/);
    expect(screen.queryByRole('dialog')).toBeNull();
    const tracking = screen.getByTestId('dinein-track-order');
    expect(tracking.textContent).toContain('4821');
    expect(tracking.textContent).toContain('7193');
    fireEvent.click(tracking);
    expect((await screen.findByTestId('round-delivery-code-staff-round')).textContent).toContain('Seu código de entrega: 4821 - informe ao garçom');
    expect(screen.getByTestId('round-delivery-code-guest-round').textContent).toContain('7193');
  });

  it('não mostra código de sessão sem aprovação em nenhum ponto, inclusive em resposta antiga com código', async () => {
    h.user = { id: 'u1' };
    sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1');
    account = myTab([{ ...round('READY'), deliveryCode: '4821' } as any]);
    render(<DineInClientApp token={TOKEN} />);
    await openMenu();
    await screen.findByTestId('dinein-delivery-code-o1');
    account = { ...account, me: { ...account.me, approved: false } };
    await act(async () => h.subscriptions.find(item => item.table === 'tab_sessions')!.callback());
    expect(screen.queryByRole('region', { name: 'Seus códigos de entrega' })).toBeNull();
    expect(screen.getByTestId('dinein-track-order').textContent).not.toContain('4821');
    fireEvent.click(screen.getByTestId('dinein-track-order'));
    expect(screen.queryByTestId('round-delivery-code-o1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar acompanhamento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Minha conta' }));
    expect(screen.queryByTestId('account-round-code-o1')).toBeNull();
  });

  it('remove código ao entregar a rodada e destaca o novo código no próximo pedido', async () => {
    h.user = { id: 'u1' };
    sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1');
    account = myTab([{ ...round('READY'), deliveryCode: '4821' } as any]);
    render(<DineInClientApp token={TOKEN} />);
    await openMenu();
    await screen.findByTestId('dinein-delivery-code-o1');
    const refresh = h.subscriptions.find(item => item.table === 'dining_tracking_revisions')!.callback;
    account = myTab([{ ...round('DELIVERED'), deliveryCode: '4821' } as any]);
    await act(async () => refresh());
    expect(screen.queryByRole('region', { name: 'Seus códigos de entrega' })).toBeNull();
    expect(screen.queryByTestId('dinein-track-order')).toBeNull();
    account = myTab([
      round('DELIVERED'),
      { ...round('CONFIRMED', 'next'), roundNo: 2, deliveryCode: '7193' } as any,
    ]);
    await act(async () => refresh());
    expect(screen.getByTestId('dinein-delivery-code-next').textContent).toContain('Seu código de entrega: 7193 - informe ao garçom');
    expect(screen.getByTestId('dinein-track-order').textContent).toContain('7193');
    expect(screen.queryByTestId('dinein-delivery-code-o1')).toBeNull();
  });
});


describe('Entrega 2 — início da mesa', () => {
  it.each(['/mesa/' + TOKEN, '/app/slug-sem-autoridade?mesa=' + TOKEN])('abre Home no QR %s e usa somente a loja resolvida pelo token', async path => {
    window.history.replaceState(null, '', path);
    render(<DineInClientApp token={TOKEN} />);
    const home = await screen.findByTestId('dinein-home');
    expect(within(home).getByRole('link', { name: 'Meu app' }).getAttribute('href')).toBe('/app/loja-x');
    expect(screen.queryByRole('button', { name: 'Adicionar Chopp' })).toBeNull();
    expect(h.enterTable).not.toHaveBeenCalled();
    fireEvent.click(within(home).getByRole('button', { name: 'Cardápio' }));
    expect(await screen.findByRole('button', { name: 'Adicionar Chopp' })).toBeTruthy();
  });

  it('preserva a confirmação de identidade depois do atalho para um cliente logado', async () => {
    h.user = { id: 'u1' };
    render(<DineInClientApp token={TOKEN} />);
    const home = await screen.findByTestId('dinein-home');
    expect(h.enterTable).not.toHaveBeenCalled();
    fireEvent.click(within(home).getByRole('button', { name: 'Cardápio' }));
    await screen.findByTestId('confirm-identity-continue');
    expect(h.enterTable).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-identity-continue'));
    await waitFor(() => expect(h.enterTable).toHaveBeenCalledTimes(1));
  });

  it('Meu app reutiliza o evento de instalação e mantém a URL da loja correta', async () => {
    h.installPrompt = vi.fn().mockResolvedValue(undefined);
    render(<DineInClientApp token={TOKEN} />);
    fireEvent.click(within(await screen.findByTestId('dinein-home')).getByRole('link', { name: 'Meu app' }));
    await waitFor(() => expect(h.clearInstallPrompt).toHaveBeenCalledOnce());
    expect(h.installPrompt).toHaveBeenCalledOnce();
    expect(h.enterTable).not.toHaveBeenCalled();
  });

  it('a sacola continua acessível na Home e Adicionar mais itens abre o cardápio', async () => {
    render(<DineInClientApp token={TOKEN} />);
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar Chopp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao início da mesa' }));
    expect(screen.getByTestId('dinein-home')).toBeTruthy();
    fireEvent.click(screen.getByTestId('dinein-bag-counter'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Sua sacola' })).getByRole('button', { name: 'Adicionar mais itens' }));
    expect(screen.queryByTestId('dinein-home')).toBeNull();
    expect(screen.getByRole('button', { name: 'Adicionar Chopp' })).toBeTruthy();
    expect(screen.getByTestId('dinein-bag-counter').textContent).toBe('1');
  });

  it('duas instâncias da mesma mesa não se inscrevem duas vezes no mesmo canal', async () => {
    h.user = { id: 'u1' };
    sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 's1');
    account = myTab([round()]);
    const view = render(<React.StrictMode><DineInClientApp token={TOKEN} /><DineInClientApp token={TOKEN} /></React.StrictMode>);
    await waitFor(() => expect(screen.getAllByTestId('dinein-home')).toHaveLength(2));
    await waitFor(() => expect(h.channels.size).toBeGreaterThanOrEqual(4));
    for (const channel of h.channels.values()) expect(channel.subscribe).toHaveBeenCalledOnce();
    view.unmount();
    expect(h.removed).toHaveBeenCalled();
  });
});
