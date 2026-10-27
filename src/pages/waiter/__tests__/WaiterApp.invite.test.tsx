// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  auth: { supabaseUser: null as null | { email: string }, activeTenant: null as null | { id: string; name: string }, activeRole: null as null | string, availableTenants: [] as Array<{ tenantId: string; tenantName: string; roleId: string }>, switchTenant: vi.fn(), isLoadingAuth: false, isMembershipLoading: false, authState: 'AUTHENTICATED', signOut: vi.fn(), signUp: vi.fn(), signInWithPassword: vi.fn(), refreshSession: vi.fn() },
  team: { listMyReceivedInvites: vi.fn(), acceptInvite: vi.fn() },
  modules: { enabled: true },
  getForTenant: vi.fn(async (_id: string) => ({ available: true, modules: [{ key: 'dine_in', enabled: true }] })),
}));
vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('../../../hooks/useModules', () => ({ useModules: () => ({ available: true, loading: false, isModuleEnabled: () => h.modules.enabled }) }));
vi.mock('../../../repositories/teamRepository', () => ({ teamRepository: h.team }));
vi.mock('../../../repositories/tenantModuleRepository', () => ({ tenantModuleRepository: { getForTenant: (id: string) => h.getForTenant(id) } }));

import { WaiterApp } from '../WaiterApp';
import { WaiterTableSheet } from '../WaiterTableSheet';

const invite = (id: string, roleId = 'WAITER') => ({ id, roleId, status: 'PENDING', tenantName: 'Bar do Zé' });
beforeEach(() => { Object.values(h.team).forEach(m => m.mockReset()); h.auth.refreshSession.mockReset(); h.auth.switchTenant.mockReset(); h.auth.supabaseUser = { email: 'ana@loja.com' }; h.auth.activeTenant = null; h.auth.activeRole = null; h.auth.availableTenants = []; h.modules.enabled = true; window.history.replaceState(null, '', '/garcom'); });
afterEach(cleanup);

describe('/garcom — convite pendente', () => {
  it('conta sem equipe com 1 convite de Garçom: aceita sozinha e recarrega a sessão (papel WAITER vem do servidor)', async () => {
    h.team.listMyReceivedInvites.mockResolvedValue([invite('i1')]); h.team.acceptInvite.mockResolvedValue({ success: true });
    render(<WaiterApp />);
    await waitFor(() => expect(h.team.acceptInvite).toHaveBeenCalledWith('i1'));
    await waitFor(() => expect(h.auth.refreshSession).toHaveBeenCalled());
  });
  it('outros cargos não são aceitos aqui; sem convite explica qual e-mail usar', async () => {
    h.team.listMyReceivedInvites.mockResolvedValue([invite('i2', 'MANAGER')]);
    render(<WaiterApp />);
    expect((await screen.findByTestId('waiter-no-access')).textContent).toContain('ana@loja.com');
    expect(h.team.acceptInvite).not.toHaveBeenCalled();
  });
  it('vários convites: mostra botões (não escolhe por você); falha do servidor aparece', async () => {
    h.team.listMyReceivedInvites.mockResolvedValue([invite('a'), invite('b')]); h.team.acceptInvite.mockRejectedValue(new Error('Convite expirado'));
    render(<WaiterApp />);
    const buttons = await screen.findAllByRole('button', { name: /Entrar na equipe/ });
    expect(buttons).toHaveLength(2); expect(h.team.acceptInvite).not.toHaveBeenCalled();
    fireEvent.click(buttons[0]);
    expect((await screen.findByRole('alert')).textContent).toContain('Convite expirado');
  });
  it('link do QR com ?email= abre o cadastro com o e-mail preenchido', async () => {
    h.auth.supabaseUser = null; window.history.replaceState(null, '', '/garcom?email=ana%40loja.com');
    render(<WaiterApp />);
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('ana@loja.com');
    expect(screen.getByRole('button', { name: 'Criar conta e entrar' })).toBeTruthy();
  });

  it('Parte H: quando a loja ativa está com salão desligado mas outra loja do garçom tem dine_in ligado (ex.: ADEGASHOW), troca automaticamente e mostra seletor de loja', async () => {
    h.auth.activeTenant = { id: 't-off', name: 'Loja Sem Salão' };
    h.auth.activeRole = 'WAITER';
    h.auth.availableTenants = [
      { tenantId: 't-off', tenantName: 'Loja Sem Salão', roleId: 'WAITER' },
      { tenantId: 't-adega', tenantName: 'ADEGASHOW', roleId: 'WAITER' },
    ];
    h.modules.enabled = false;
    h.getForTenant.mockImplementation(async (id: string) => ({
      available: true,
      modules: [{ key: 'dine_in', enabled: id === 't-adega' }],
    }));
    render(<WaiterApp />);
    expect(await screen.findByText('Salão desligado')).toBeTruthy();
    expect(screen.getByTestId('waiter-store-picker')).toBeTruthy();
    await waitFor(() => expect(h.auth.switchTenant).toHaveBeenCalledWith('t-adega'));
  });
});

describe('WaiterTableSheet — Partes A e D (Trocar responsável e Liberar mesa sem consumo)', () => {
  const baseProps: React.ComponentProps<typeof WaiterTableSheet> = {
    table: { id: 'tb-1', label: 'Mesa 04', seats: 4, active: true, qr_token: 'q'.repeat(48), status: 'OCCUPIED' } as never,
    tab: { id: 'tab-1', code: 'M04', status: 'OPEN', opened_at: new Date().toISOString(), service_fee_percent: 10, service_fee_removed: false, subtotal_cents: 0 } as never,
    info: { kind: 'OCCUPIED', label: 'Ocupada', elapsedLabel: '2 min', totalCents: 0, subtotalCents: 0, serviceFeeCents: 0 } as never,
    sessions: [],
    calls: [],
    rounds: [],
    holderSessionId: null,
    tenantSlug: 'adegashow',
    features: { holder: true, requestBill: true, approval: true, openTable: true } as never,
    busy: null,
    message: '',
    onClose: vi.fn(),
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onHandleCall: vi.fn(),
    onOpenTable: vi.fn(),
    onOrder: vi.fn(),
    onRequestBill: vi.fn(),
    onResetHolder: vi.fn(),
    onTransferHolder: vi.fn(),
  };

  it('Parte D: mesa aberta com R$ 0,00 e 0 pedidos mostra "Liberar mesa (sem consumo)" em vez de "Pedir a conta" e pede confirmação com motivo', async () => {
    const onReleaseEmptyTab = vi.fn();
    render(
      <WaiterTableSheet
        {...baseProps}
        onReleaseEmptyTab={onReleaseEmptyTab}
      />
    );
    expect(screen.queryByRole('button', { name: 'Pedir a conta' })).toBeNull();
    const releaseBtn = screen.getByTestId('waiter-release-empty-btn');
    expect(releaseBtn.textContent).toContain('Liberar mesa (sem consumo)');
    fireEvent.click(releaseBtn);
    expect(screen.getByTestId('waiter-release-empty-dialog')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Motivo para liberar a mesa'), { target: { value: 'Aberta por engano' } });
    fireEvent.click(screen.getByTestId('waiter-release-empty-confirm'));
    expect(onReleaseEmptyTab).toHaveBeenCalledWith('Aberta por engano');
  });

  it('Parte A: mostra botão "Trocar responsável" mesmo sem sessão ativa e exibe código/QR de uso único (5 min) na tela da equipe', async () => {
    const onChangeHolder = vi.fn();
    render(
      <WaiterTableSheet
        {...baseProps}
        holderCode={{ code: 'K9P4M2', expiresAt: new Date(Date.now() + 300000).toISOString(), qrToken: 'q'.repeat(48), tableLabel: 'Mesa 04', tenantSlug: 'adegashow' }}
        onChangeHolder={onChangeHolder}
      />
    );
    const holderBtn = screen.getByRole('button', { name: 'Trocar responsável' });
    fireEvent.click(holderBtn);
    expect(onChangeHolder).toHaveBeenCalledTimes(1);
    const card = screen.getByTestId('waiter-holder-code');
    expect(card.textContent).toContain('K9P4M2');
    expect(card.querySelector('svg')).toBeTruthy();
  });
});
