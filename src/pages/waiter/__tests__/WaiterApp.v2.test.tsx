// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
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
    loadMenu: vi.fn(async () => ({ products: [], categories: [] })),
  },
  modules: { enabled: true },
}));

const mockChannel: any = {
  on: () => mockChannel,
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
vi.mock('../../../hooks/useModules', () => ({ useModules: () => ({ available: true, loading: false, isModuleEnabled: () => h.modules.enabled }) }));
vi.mock('../../../repositories/waiterV2Repository', () => ({
  waiterV2Repository: h.waiterV2,
  DEFAULT_SERVICE_SETTINGS: { mode: 'FREE', hybridHelp: false, acceptTimeoutSeconds: 60, dispatchTimeoutSeconds: 60 },
}));
vi.mock('../../../repositories/salonStaffRepository', () => ({ salonStaffRepository: h.salonStaff }));
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
});
