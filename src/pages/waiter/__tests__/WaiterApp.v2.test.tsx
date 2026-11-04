// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  realtimeOrders: null as null | (() => void),
  readySound: vi.fn(),
  auth: {
    supabaseUser: null as null | { id: string; email: string },
    currentUser: { id: 'u-waiter-1', name: 'João Silva', role: 'WAITER' },
    activeTenant: null as null | { id: string; name: string; slug: string },
    activeRole: null as null | string,
    availableTenants: [] as Array<{ tenantId: string; tenantName: string; roleId: string }>,
    switchTenant: vi.fn(),
    isLoadingAuth: false,
    isMembershipLoading: false,
    authState: 'AUTHENTICATED',
    signOut: vi.fn(),
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    refreshSession: vi.fn(),
    securityContext: {},
  },
  waiterV2: {
    available: vi.fn(async () => true),
    loginStore: vi.fn(async (slug: string) => ({ name: 'Pizzaria Bella', slug })),
    loginWithUsername: vi.fn(async () => {}),
    settings: vi.fn(async () => ({ mode: 'FIXED', hybridHelp: true, acceptTimeoutSeconds: 60, dispatchTimeoutSeconds: 60 })),
    assignments: vi.fn(async () => [{ table_id: 't-1', waiter_id: 'u-waiter-1' }, { table_id: 't-2', waiter_id: 'u-waiter-2' }]),
    roster: vi.fn(async () => [
      { userId: 'u-waiter-1', name: 'João Silva', photoUrl: null, online: true, busy: false, tableCount: 1, openCalls: 0 },
      { userId: 'u-waiter-2', name: 'Maria Souza', photoUrl: null, online: true, busy: false, tableCount: 1, openCalls: 0 },
    ]),
    heartbeat: vi.fn(async () => {}),
    goOffline: vi.fn(async () => {}),
    acceptCall: vi.fn(async () => {}),
    escalateCall: vi.fn(async () => {}),
    escalateDue: vi.fn(async () => {}),
    helpTable: vi.fn(async () => {}),
    passTables: vi.fn(async () => 1),
    report: vi.fn(async () => []),
    myTableWaiter: vi.fn(async () => ({ name: 'João Silva', photoUrl: null })),
  },
  salonStaff: {
    snapshot: vi.fn(async () => ({
      tables: [
        { id: 't-1', label: 'Mesa 01', area: 'Salão', seats: 4 },
        { id: 't-2', label: 'Mesa 02', area: 'Varanda', seats: 2 },
      ],
      tabs: [
        { id: 'tab-1', table_id: 't-1', status: 'OPEN', opened_at: new Date().toISOString(), service_fee_percent: 10, service_fee_removed: false },
        { id: 'tab-2', table_id: 't-2', status: 'OPEN', opened_at: new Date().toISOString(), service_fee_percent: 10, service_fee_removed: false },
      ],
      sessions: [],
      calls: [
        { id: 'c-1', tab_id: 'tab-1', type: 'CALL', status: 'OPEN', created_at: new Date().toISOString(), route: 'ASSIGNED', assigned_to: 'u-waiter-1', accepted_by: null },
      ],
      rounds: [],
      releaseRequired: false,
    })),
    accessExtras: vi.fn(async () => ({ responsibleSessionByTab: new Map(), claimableTabs: new Set() })),
    handleCall: vi.fn(async () => {}),
    closeTab: vi.fn(async (_tabId: string, _method: string, _totalCents: number) => {}),
    releaseEmptyTab: vi.fn(async (_tabId: string, _reason: string) => {}),
    loadMenu: vi.fn(async () => ({ products: [], categories: [] })),
    joinTables: vi.fn(async () => ({ tabId: 'tab-1', primaryTableId: 't-1', joinedTableIds: ['t-1', 't-2'] })),
    separateTable: vi.fn(async () => ({ tabId: 'tab-1', separatedTableId: 't-2' })),
  },
  modules: { enabled: true },
  delivery: { markDelivered: vi.fn(async () => {}), openDisputes: vi.fn(async () => []), resolve: vi.fn(async () => {}), observe: vi.fn(() => vi.fn()) },
  payments: { tabPixStatus: vi.fn(), observeTabPix: vi.fn(() => vi.fn()) },
}));

const mockChannel: any = {
  on: (_event: string, filter: { table: string }, callback: () => void) => { if (filter.table === 'orders') h.realtimeOrders = callback; return mockChannel; },
  subscribe: () => ({}),
};

vi.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    channel: () => mockChannel,
    removeChannel: vi.fn(),
  },
}));

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('../../../utils/audio', () => ({ playShortBeep: h.readySound, playNewOrderSound: vi.fn(), unlockAudio: vi.fn() }));
vi.mock('../../../hooks/useModules', () => ({ useModules: () => ({ available: true, loading: false, isModuleEnabled: () => h.modules.enabled }) }));
vi.mock('../../../repositories/waiterV2Repository', () => ({
  waiterV2Repository: h.waiterV2,
  DEFAULT_SERVICE_SETTINGS: { mode: 'FREE', hybridHelp: false, acceptTimeoutSeconds: 60, dispatchTimeoutSeconds: 60 },
}));
vi.mock('../../../repositories/salonStaffRepository', () => ({ salonStaffRepository: h.salonStaff }));
vi.mock('../../../repositories/deliveryRepository', () => ({ deliveryRepository: h.delivery }));
vi.mock('../../../repositories/paymentRepository', () => ({ paymentRepository: h.payments }));
vi.mock('../../../repositories/tabReceiptRepository', () => ({ tabReceiptRepository: { target: vi.fn(async () => ({ exists: false, maskedEmail: null })) } }));
vi.mock('../../../repositories/tenantModuleRepository', () => ({
  tenantModuleRepository: {
    getForTenant: vi.fn(async () => ({ available: true, modules: [{ key: 'dine_in', enabled: true }] })),
    getPublicEnabled: vi.fn(async () => new Set(['dine_in'])),
  },
}));

import { WaiterApp } from '../WaiterApp';

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.supabaseUser = null;
  h.auth.activeTenant = null;
  h.auth.activeRole = null;
  window.history.replaceState(null, '', '/garcom');
});
afterEach(cleanup);

describe('Garçom v2 — Login simples e Modos de atendimento', () => {
  it('Acesso por QR da loja /garcom/:slug abre tela "Entrar como garçom" sem e-mail', async () => {
    window.history.replaceState(null, '', '/garcom/pizzaria-bella');
    render(<WaiterApp />);

    expect(await screen.findByTestId('waiter-login-username')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Entrar como garçom' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Pizzaria Bella')).toBeTruthy());

    const userInput = screen.getByLabelText('Usuário') as HTMLInputElement;
    const passInput = screen.getByPlaceholderText('sua senha') as HTMLInputElement;
    fireEvent.change(userInput, { target: { value: 'joao' } });
    fireEvent.change(passInput, { target: { value: '123456' } });

    const submitBtn = screen.getByRole('button', { name: 'Entrar como garçom' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(h.waiterV2.loginWithUsername).toHaveBeenCalledWith('pizzaria-bella', 'joao', '123456');
    });
  });

  it('Mostra chamados com badge de "Sua mesa" e botão "Vou atender"', async () => {
    h.auth.supabaseUser = { id: 'u-waiter-1', email: 'joao.pizzaria@garcom.deliverychannel.local' };
    h.auth.activeTenant = { id: 't-1', name: 'Pizzaria Bella', slug: 'pizzaria-bella' };
    h.auth.activeRole = 'WAITER';

    render(<WaiterApp />);

    // Vai para a aba chamados
    const callsTabBtn = await screen.findByRole('button', { name: /Chamados/i });
    fireEvent.click(callsTabBtn);

    expect(await screen.findByText('Sua mesa')).toBeTruthy();
    const acceptBtn = screen.getByRole('button', { name: 'Vou atender' });
    expect(acceptBtn).toBeTruthy();

    fireEvent.click(acceptBtn);
    await waitFor(() => {
      expect(h.waiterV2.acceptCall).toHaveBeenCalledWith('c-1');
    });
  });

  it('Troca de turno: passar mesas pelo botão em "Mais"', async () => {
    h.auth.supabaseUser = { id: 'u-waiter-1', email: 'joao.pizzaria@garcom.deliverychannel.local' };
    h.auth.activeTenant = { id: 't-1', name: 'Pizzaria Bella', slug: 'pizzaria-bella' };
    h.auth.activeRole = 'WAITER';

    render(<WaiterApp />);

    // Vai para a aba Mais
    const moreTabBtn = await screen.findByRole('button', { name: /Mais/i });
    fireEvent.click(moreTabBtn);

    const passShiftBtn = await screen.findByRole('button', { name: /Passar mesas \(troca de turno\)/i });
    fireEvent.click(passShiftBtn);

    expect(await screen.findByTestId('pass-shift-form')).toBeTruthy();
    expect(screen.getByText('Mesa 01')).toBeTruthy();

    const confirmBtn = screen.getByRole('button', { name: /Confirmar troca/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(h.waiterV2.passTables).toHaveBeenCalledWith('t-1', 'u-waiter-1', 'u-waiter-2', null);
    });
  });

  it('Meus pedidos mostra apenas suas mesas e avisa ao chegar pronto pelo realtime', async () => {
    h.auth.supabaseUser = { id: 'u-waiter-1', email: 'joao@garcom.deliverychannel.local' };
    h.auth.activeTenant = { id: 't-1', name: 'Pizzaria Bella', slug: 'pizzaria-bella' };
    h.auth.activeRole = 'WAITER';
    const base = await h.salonStaff.snapshot();
    const makeRound = (id: string, tab_id: string, order_number: number) => ({ id, tab_id, status: 'PREPARING', subtotal: 20, created_at: new Date().toISOString(), round_no: 1, order_number, customer_name: 'Cliente' });
    const own = makeRound('my-order', 'tab-1', 51);
    const other = makeRound('other-order', 'tab-2', 99);
    h.salonStaff.snapshot.mockResolvedValue({ ...base, rounds: [own, other] } as never);
    try {
      render(<WaiterApp />);
      fireEvent.click(await screen.findByRole('button', { name: 'Meus pedidos' }));
      expect(await screen.findByText('#51 · rodada 1')).toBeTruthy();
      expect(screen.queryByText('#99 · rodada 1')).toBeNull();
      expect(screen.getByText('Preparando seu pedido')).toBeTruthy();
      expect(screen.queryByTestId('waiter-counter-alert')).toBeNull();
      h.salonStaff.snapshot.mockResolvedValue({ ...base, rounds: [{ ...own, status: 'READY' }, other] } as never);
      h.realtimeOrders?.();
      const counterAlert = await screen.findByTestId('waiter-counter-alert');
      expect(counterAlert.style.backgroundColor).toBe('#DCFCE7');
      expect(counterAlert.style.color).toBe('#0F172A');
      const pickupToast = await screen.findByText('Balcão chamando: pedido pronto para levar à mesa.');
      expect(pickupToast.style.backgroundColor).toBe('#DCFCE7');
      expect(pickupToast.style.color).toBe('#0F172A');
      expect(screen.getByText('Pronto no balcão · balcão chamando')).toBeTruthy();
      expect(h.readySound).toHaveBeenCalledTimes(1);
      h.realtimeOrders?.();
      await waitFor(() => expect(h.salonStaff.snapshot).toHaveBeenCalled());
      expect(h.readySound).toHaveBeenCalledTimes(1);
    } finally { h.salonStaff.snapshot.mockResolvedValue(base); }
  });
  it('segunda e terceira rodadas mudam a cor e chamam o garçom novamente na mesma conta', async () => {
    h.auth.supabaseUser = { id: 'u-waiter-1', email: 'joao@garcom.deliverychannel.local' };
    h.auth.activeTenant = { id: 't-1', name: 'Pizzaria Bella', slug: 'pizzaria-bella' };
    h.auth.activeRole = 'WAITER';
    const base = await h.salonStaff.snapshot();
    const first = { id: 'first-order', tab_id: 'tab-1', status: 'DELIVERED', subtotal: 20, created_at: new Date().toISOString(), round_no: 1, order_number: 51, customer_name: 'Cliente' };
    const second = { ...first, id: 'second-order', round_no: 2, order_number: 52, status: 'READY' };
    const third = { ...first, id: 'third-order', round_no: 3, order_number: 53, status: 'PENDING' };
    h.salonStaff.snapshot.mockResolvedValue({ ...base, rounds: [first] } as never);
    try {
      render(<WaiterApp />);
      const table = await screen.findByTestId('salon-table-t-1');
      expect(table.getAttribute('data-status')).toBe('OCCUPIED');
      expect(screen.queryByTestId('waiter-counter-alert')).toBeNull();

      // The second round can finish preparation before the next snapshot arrives.
      h.salonStaff.snapshot.mockResolvedValue({ ...base, rounds: [first, second] } as never);
      h.realtimeOrders?.();
      await waitFor(() => expect(table.getAttribute('data-status')).toBe('READY'));
      expect(table.style.getPropertyValue('--sc-bg')).toBe('#1AB0F5');
      expect(screen.getByTestId('waiter-counter-alert').textContent).toContain('1 pedido pronto');
      expect(h.readySound).toHaveBeenCalledTimes(1);
      h.realtimeOrders?.();
      await waitFor(() => expect(h.salonStaff.snapshot).toHaveBeenCalled());
      expect(h.readySound).toHaveBeenCalledTimes(1);

      const history = [first, { ...second, status: 'DELIVERED' }];
      h.salonStaff.snapshot.mockResolvedValue({ ...base, rounds: history } as never);
      h.realtimeOrders?.();
      await waitFor(() => expect(screen.queryByTestId('waiter-counter-alert')).toBeNull());
      for (const [status, color] of [['PENDING', 'NEW_ORDER'], ['PREPARING', 'PREPARING'], ['READY', 'READY']]) {
        h.salonStaff.snapshot.mockResolvedValue({ ...base, rounds: [...history, { ...third, status }] } as never);
        h.realtimeOrders?.();
        await waitFor(() => expect(table.getAttribute('data-status')).toBe(color));
      }
      expect(screen.getByTestId('waiter-counter-alert').textContent).toContain('1 pedido pronto');
      expect(h.readySound).toHaveBeenCalledTimes(2);
      fireEvent.click(table);
      const deliver = screen.getByRole('button', { name: 'Entregue' }) as HTMLButtonElement;
      expect(deliver.disabled).toBe(true);
      expect(deliver.title).toBe('Aguardando balcão');
      fireEvent.click(deliver);
      expect(h.delivery.markDelivered).not.toHaveBeenCalled();
    } finally { h.salonStaff.snapshot.mockResolvedValue(base); }
  });

  it('garçom registra Entregue para rodada liberada pelo balcão e atualiza a lista', async () => {
    h.auth.supabaseUser = { id: 'u-waiter-1', email: 'joao@garcom.deliverychannel.local' };
    h.auth.activeTenant = { id: 't-1', name: 'Pizzaria Bella', slug: 'pizzaria-bella' };
    h.auth.activeRole = 'WAITER';
    const base = await h.salonStaff.snapshot();
    const own = { id: 'ready-order', tab_id: 'tab-1', status: 'OUT_FOR_DELIVERY', subtotal: 20, created_at: new Date().toISOString(), round_no: 1, order_number: 55, customer_name: 'Cliente' };
    h.salonStaff.snapshot.mockResolvedValue({ ...base, rounds: [own] } as never);
    h.delivery.markDelivered.mockImplementationOnce(async () => { h.salonStaff.snapshot.mockResolvedValue({ ...base, rounds: [{ ...own, status: 'DELIVERED', delivered_at: '2026-11-04T01:10:00Z' }] } as never); });
    try {
      render(<WaiterApp />);
      fireEvent.click(await screen.findByRole('button', { name: 'Meus pedidos' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Entregue' }));
      await waitFor(() => expect(h.delivery.markDelivered).toHaveBeenCalledWith('ready-order'));
      expect(await screen.findByText(/Entregue às/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Entregue' })).toBeNull();
    } finally { h.salonStaff.snapshot.mockResolvedValue(base); }
  });
  it('Mais não leva o garçom à rota do dono', async () => {
    h.auth.supabaseUser = { id: 'u-waiter-1', email: 'joao@garcom.deliverychannel.local' };
    h.auth.activeTenant = { id: 't-1', name: 'Pizzaria Bella', slug: 'pizzaria-bella' };
    h.auth.activeRole = 'WAITER';
    render(<WaiterApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mais' }));
    expect(screen.queryByRole('link', { name: 'Abrir o Salão' })).toBeNull();
  });

  it.each(['CASH', 'CREDIT_CARD'] as const)('avisa pagamento recebido e mesa liberada em verde claro após %s confirmado', async method => {
    h.auth.supabaseUser = { id: 'u-waiter-1', email: 'joao@garcom.deliverychannel.local' };
    h.auth.activeTenant = { id: 't-1', name: 'Pizzaria Bella', slug: 'pizzaria-bella' };
    h.auth.activeRole = 'WAITER';
    const base = await h.salonStaff.snapshot();
    const round = { id: 'paid-order', tab_id: 'tab-1', status: 'DELIVERED', subtotal: 20, created_at: new Date().toISOString(), round_no: 1, order_number: 55, customer_name: 'Cliente' };
    h.salonStaff.snapshot.mockResolvedValue({ ...base, calls: [], tabs: base.tabs.map(tab => tab.id === 'tab-1' ? { ...tab, status: 'WAITER_AUTHORIZED' } : tab), rounds: [round] } as never);
    try {
      render(<WaiterApp />);
      fireEvent.click(await screen.findByTestId('salon-table-t-1'));
      fireEvent.change(await screen.findByLabelText('Forma de pagamento da conta'), { target: { value: method } });
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar pagamento recebido' }));
      const toast = await screen.findByText('Pagamento confirmado. Mesa liberada.');
      expect(h.salonStaff.closeTab).toHaveBeenCalledWith('tab-1', method, 2200);
      expect(toast.style.backgroundColor).toBe('#DCFCE7');
      expect(toast.style.color).toBe('#0F172A');
    } finally { h.salonStaff.snapshot.mockResolvedValue(base); }
  });

  it('avisa em verde claro ao concluir PIX confirmado pelo servidor sem repetir o fechamento', async () => {
    h.auth.supabaseUser = { id: 'u-waiter-1', email: 'joao@garcom.deliverychannel.local' };
    h.auth.activeTenant = { id: 't-1', name: 'Pizzaria Bella', slug: 'pizzaria-bella' };
    h.auth.activeRole = 'WAITER';
    const base = await h.salonStaff.snapshot();
    h.salonStaff.snapshot.mockResolvedValue({ ...base, calls: [], tabs: base.tabs.map(tab => tab.id === 'tab-1' ? { ...tab, status: 'AWAITING_PAYMENT' } : tab) } as never);
    h.payments.tabPixStatus.mockResolvedValue({ pix: { id: 'pix-1', tabId: 'tab-1', status: 'paid', tabClosed: true, amountCents: 2200, paidAt: '2026-11-04T01:10:00Z' } });
    try {
      render(<WaiterApp />);
      fireEvent.click(await screen.findByTestId('salon-table-t-1'));
      expect(await screen.findByRole('heading', { name: 'Pagamento confirmado' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
      const toast = await screen.findByText('Pagamento confirmado. Mesa liberada.');
      expect(toast.style.backgroundColor).toBe('#DCFCE7');
      expect(toast.style.color).toBe('#0F172A');
      expect(h.salonStaff.closeTab).not.toHaveBeenCalled();
    } finally { h.salonStaff.snapshot.mockResolvedValue(base); }
  });

  it('avisa em verde claro ao liberar mesa sem consumo', async () => {
    h.auth.supabaseUser = { id: 'u-waiter-1', email: 'joao@garcom.deliverychannel.local' };
    h.auth.activeTenant = { id: 't-1', name: 'Pizzaria Bella', slug: 'pizzaria-bella' };
    h.auth.activeRole = 'WAITER';
    render(<WaiterApp />);
    fireEvent.click(await screen.findByTestId('salon-table-t-1'));
    fireEvent.click(screen.getByTestId('waiter-release-empty-btn'));
    fireEvent.change(screen.getByLabelText('Motivo para liberar a mesa'), { target: { value: 'Aberta por engano' } });
    fireEvent.click(screen.getByTestId('waiter-release-empty-confirm'));
    const toast = await screen.findByText('Mesa liberada.');
    expect(h.salonStaff.releaseEmptyTab).toHaveBeenCalledWith('tab-1', 'Aberta por engano');
    expect(toast.style.backgroundColor).toBe('#DCFCE7');
    expect(toast.style.color).toBe('#0F172A');
  });

  it('exige código de 4 dígitos para marcar Entregue quando ativado e permite Juntar/Separar mesas na comanda', async () => {
    h.auth.supabaseUser = { id: 'u-waiter-1', email: 'joao@garcom.deliverychannel.local' };
    h.auth.activeTenant = { id: 't-1', name: 'Pizzaria Bella', slug: 'pizzaria-bella' };
    h.auth.activeRole = 'WAITER';
    const base = await h.salonStaff.snapshot();
    const own = {
      id: 'ready-order',
      tab_id: 'tab-1',
      status: 'OUT_FOR_DELIVERY',
      subtotal: 20,
      created_at: new Date().toISOString(),
      round_no: 1,
      order_number: 55,
      customer_name: 'Cliente',
      delivery_code_required: true,
    };
    h.salonStaff.snapshot.mockResolvedValue({
      ...base,
      requireDeliveryCode: true,
      joinedTables: [{ tab_id: 'tab-1', table_id: 't-2' }],
      tableMoves: [{ id: 'mv-1', tab_id: 'tab-1', action: 'MOVE', from_label: 'Mesa 01', to_label: 'Mesa 02', actor_kind: 'CUSTOMER', actor_name: 'Ana', created_at: new Date().toISOString() }],
      rounds: [own],
    } as never);
    try {
      render(<WaiterApp />);
      const table = await screen.findByTestId('salon-table-t-1');
      fireEvent.click(table);

      expect(await screen.findByTestId('waiter-joined-tables')).toBeTruthy();
      expect(screen.getByTestId('waiter-table-moves').textContent).toContain('Mesa 01 → Mesa 02');

      const deliverBtn = screen.getByRole('button', { name: 'Entregue' }) as HTMLButtonElement;
      expect(deliverBtn.disabled).toBe(true);
      const codeInput = screen.getByTestId('waiter-delivery-code-ready-order');
      fireEvent.change(codeInput, { target: { value: '4821' } });
      expect(deliverBtn.disabled).toBe(false);
      fireEvent.click(deliverBtn);
      await waitFor(() => expect(h.delivery.markDelivered).toHaveBeenCalledWith('ready-order', '4821'));

      fireEvent.click(screen.getByTestId('waiter-separate-table-t-2'));
      await waitFor(() => expect(h.salonStaff.separateTable).toHaveBeenCalledWith('tab-1', 't-2'));
    } finally {
      h.salonStaff.snapshot.mockResolvedValue(base);
    }
  });
});
