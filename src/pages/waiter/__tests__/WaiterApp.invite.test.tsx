// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  auth: { supabaseUser: null as null | { email: string }, activeTenant: null as null | { id: string; name: string; slug?: string }, activeRole: null as null | string, availableTenants: [] as Array<{ tenantId: string; tenantName: string; roleId: string; tenantSlug?: string; status?: string }>, switchTenant: vi.fn(), isLoadingAuth: false, isMembershipLoading: false, authState: 'AUTHENTICATED', signOut: vi.fn(), signUp: vi.fn(), signInWithPassword: vi.fn(), refreshSession: vi.fn() },
  team: { listMyReceivedInvites: vi.fn(), acceptInvite: vi.fn() },
  rpc: vi.fn(),
  modules: { enabled: true },
  getForTenant: vi.fn(async (_id: string) => ({ available: true, modules: [{ key: 'dine_in', enabled: true }] })),
  getPublicEnabled: vi.fn(async (_id: string) => new Set<string>()),
}));
vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: { rpc: h.rpc } }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('../../../hooks/useModules', () => ({ useModules: () => ({ available: true, loading: false, isModuleEnabled: () => h.modules.enabled }) }));
vi.mock('../../../repositories/teamRepository', () => ({ teamRepository: h.team }));
vi.mock('../../../repositories/tenantModuleRepository', () => ({ tenantModuleRepository: { getForTenant: (id: string) => h.getForTenant(id), getPublicEnabled: (id: string) => h.getPublicEnabled(id) } }));

import { WaiterApp } from '../WaiterApp';
import { WaiterTableSheet } from '../WaiterTableSheet';

const invite = (id: string, roleId = 'WAITER') => ({ id, roleId, status: 'PENDING', tenantName: 'Bar do Zé' });
beforeEach(() => { h.rpc.mockReset(); h.auth.signUp.mockReset(); h.auth.signInWithPassword.mockReset(); Object.values(h.team).forEach(m => m.mockReset()); h.auth.refreshSession.mockReset(); h.auth.switchTenant.mockReset(); h.auth.switchTenant.mockResolvedValue(true); h.auth.supabaseUser = { email: 'ana@loja.com' }; h.auth.activeTenant = null; h.auth.activeRole = null; h.auth.availableTenants = []; h.auth.isMembershipLoading = false; h.modules.enabled = true; h.getPublicEnabled.mockReset(); h.getPublicEnabled.mockResolvedValue(new Set<string>()); window.history.replaceState(null, '', '/garcom'); });
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

  it('QR da loja A não lista nem aceita convite da loja B', async () => {
    window.history.replaceState(null, '', '/garcom/adega-a');
    h.team.listMyReceivedInvites.mockResolvedValue([{ ...invite('convite-b'), tenantId: 'tenant-b', tenantName: 'SEGREDO_LOJA_B' }]);
    h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'INVITE_REQUIRED' } });
    render(<WaiterApp />);
    expect((await screen.findByTestId('waiter-no-access')).textContent).toContain('Este e-mail não foi convidado. Fale com o estabelecimento.');
    expect(h.rpc).toHaveBeenCalledWith('team_accept_invite', { p_slug: 'adega-a', p_role: 'WAITER' });
    expect(h.team.listMyReceivedInvites).not.toHaveBeenCalled();
    expect(h.team.acceptInvite).not.toHaveBeenCalled();
    expect(h.auth.refreshSession).not.toHaveBeenCalled();
    expect(screen.queryByText(/SEGREDO_LOJA_B/)).toBeNull();
  });
  it('QR aceita exclusivamente o convite da loja e recarrega a sessão', async () => {
    window.history.replaceState(null, '', '/garcom/adega-a');
    h.rpc.mockResolvedValue({ data: { tenant_id: 'tenant-a', role: 'WAITER' }, error: null });
    render(<WaiterApp />);
    await waitFor(() => expect(h.auth.refreshSession).toHaveBeenCalledTimes(1));
    expect(h.rpc).toHaveBeenCalledWith('team_accept_invite', { p_slug: 'adega-a', p_role: 'WAITER' });
    expect(h.team.listMyReceivedInvites).not.toHaveBeenCalled();
    expect(h.team.acceptInvite).not.toHaveBeenCalled();
  });

  it('QR da loja A seleciona só o vínculo A e não monta dados da loja B durante a troca', async () => {
    window.history.replaceState(null, '', '/garcom/adega-a');
    h.auth.activeTenant = { id: 'tenant-b', name: 'SEGREDO_LOJA_B', slug: 'adega-b' };
    h.auth.activeRole = 'WAITER';
    h.auth.availableTenants = [
      { tenantId: 'tenant-b', tenantName: 'SEGREDO_LOJA_B', tenantSlug: 'adega-b', roleId: 'WAITER', status: 'ACTIVE' },
      { tenantId: 'tenant-a', tenantName: 'Loja A', tenantSlug: 'adega-a', roleId: 'WAITER', status: 'ACTIVE' },
    ];
    render(<WaiterApp />);
    await waitFor(() => expect(h.auth.switchTenant).toHaveBeenCalledExactlyOnceWith('tenant-a'));
    expect(screen.getByTestId('waiter-loading')).toBeTruthy();
    expect(screen.queryByText(/SEGREDO_LOJA_B/)).toBeNull();
    expect(h.getPublicEnabled).not.toHaveBeenCalled();
    expect(h.team.listMyReceivedInvites).not.toHaveBeenCalled();
  });
  it('QR sem vínculo A verifica somente convite A e não usa a loja B ativa', async () => {
    window.history.replaceState(null, '', '/garcom/adega-a');
    h.auth.activeTenant = { id: 'tenant-b', name: 'SEGREDO_LOJA_B', slug: 'adega-b' };
    h.auth.activeRole = 'WAITER';
    h.auth.availableTenants = [{ tenantId: 'tenant-b', tenantName: 'SEGREDO_LOJA_B', tenantSlug: 'adega-b', roleId: 'WAITER', status: 'ACTIVE' }];
    h.rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
    render(<WaiterApp />);
    await screen.findByTestId('waiter-no-access');
    expect(h.auth.switchTenant).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith('team_accept_invite', { p_slug: 'adega-a', p_role: 'WAITER' });
    expect(screen.queryByText(/SEGREDO_LOJA_B/)).toBeNull();
  });
  it('garçom já vinculado cujo vínculo vem sem slug: usa a loja confirmada pelo servidor e não entra em loop', async () => {
    window.history.replaceState(null, '', '/garcom/adega-a');
    h.auth.activeTenant = null;
    h.auth.availableTenants = [];
    h.rpc.mockResolvedValue({ data: { tenant_id: 'tenant-a', role: 'WAITER' }, error: null });
    h.auth.refreshSession.mockImplementation(async () => {
      h.auth.availableTenants = [{ tenantId: 'tenant-a', tenantName: 'Loja A', tenantSlug: '', roleId: 'WAITER', status: 'ACTIVE' }];
    });
    const view = render(<WaiterApp />);
    await waitFor(() => expect(h.auth.refreshSession).toHaveBeenCalledTimes(1));
    view.rerender(<WaiterApp />);
    await waitFor(() => expect(h.auth.switchTenant).toHaveBeenCalledExactlyOnceWith('tenant-a'));
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });
  it('vínculo continua ausente depois de entrar: mostra erro com Tentar novamente em vez de piscar', async () => {
    window.history.replaceState(null, '', '/garcom/adega-a');
    h.rpc.mockResolvedValue({ data: { tenant_id: 'tenant-a', role: 'WAITER' }, error: null });
    h.auth.refreshSession.mockImplementation(async () => { h.auth.isMembershipLoading = true; });
    const view = render(<WaiterApp />);
    await waitFor(() => expect(h.auth.refreshSession).toHaveBeenCalledTimes(1));
    view.rerender(<WaiterApp />);
    h.auth.isMembershipLoading = false;
    view.rerender(<WaiterApp />);
    expect((await screen.findByTestId('waiter-no-access')).textContent).toContain('Não foi possível abrir a loja deste link');
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.auth.refreshSession).toHaveBeenCalledTimes(1);
  });
  it('slug ambíguo em vínculos falha fechado sem escolher outra loja', () => {
    window.history.replaceState(null, '', '/garcom/adega-a');
    h.auth.activeTenant = { id: 'tenant-b', name: 'SEGREDO_LOJA_B', slug: 'adega-b' };
    h.auth.activeRole = 'WAITER';
    h.auth.availableTenants = [
      { tenantId: 'tenant-a1', tenantName: 'Loja A1', tenantSlug: 'adega-a', roleId: 'WAITER', status: 'ACTIVE' },
      { tenantId: 'tenant-a2', tenantName: 'Loja A2', tenantSlug: 'adega-a', roleId: 'WAITER', status: 'ACTIVE' },
    ];
    render(<WaiterApp />);
    expect(screen.getByTestId('waiter-scope-ambiguous')).toBeTruthy();
    expect(h.auth.switchTenant).not.toHaveBeenCalled(); expect(h.rpc).not.toHaveBeenCalled();
    expect(screen.queryByText(/SEGREDO_LOJA_B/)).toBeNull();
  });

  it('salão desligado no QR A não muda automaticamente para B nem mostra seletor de outras lojas', async () => {
    window.history.replaceState(null, '', '/garcom/adega-a');
    h.auth.activeTenant = { id: 'tenant-a', name: 'Loja A', slug: 'adega-a' };
    h.auth.activeRole = 'WAITER';
    h.auth.availableTenants = [
      { tenantId: 'tenant-a', tenantName: 'Loja A', tenantSlug: 'adega-a', roleId: 'WAITER', status: 'ACTIVE' },
      { tenantId: 'tenant-b', tenantName: 'SEGREDO_LOJA_B', tenantSlug: 'adega-b', roleId: 'WAITER', status: 'ACTIVE' },
    ];
    h.modules.enabled = false;
    h.getForTenant.mockClear();
    render(<WaiterApp />);
    await screen.findByTestId('waiter-tool-off');
    expect(h.auth.switchTenant).not.toHaveBeenCalled();
    expect(h.getForTenant).not.toHaveBeenCalled();
    expect(screen.queryByTestId('waiter-store-picker')).toBeNull();
    expect(screen.queryByText(/SEGREDO_LOJA_B/)).toBeNull();
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
  it('Parte H: leitura de módulos diz desligado mas a fonte das Ferramentas (RPC pública) diz dine_in ligado: NÃO mostra "Salão desligado"', async () => {
    h.auth.activeTenant = { id: 't-adega', name: 'ADEGASHOW' };
    h.auth.activeRole = 'WAITER';
    h.auth.availableTenants = [{ tenantId: 't-adega', tenantName: 'ADEGASHOW', roleId: 'WAITER' }];
    h.modules.enabled = false;
    h.getPublicEnabled.mockResolvedValue(new Set(['dine_in']));
    render(<WaiterApp />);
    await waitFor(() => expect(h.getPublicEnabled).toHaveBeenCalledWith('t-adega'));
    await waitFor(() => expect(screen.queryByTestId('waiter-tool-off')).toBeNull());
    expect(screen.queryByText('Salão desligado')).toBeNull();
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
  it('não permite pedir conta mesmo com consumo; conta solicitada aguarda autorização do caixa', () => {
    render(<WaiterTableSheet {...baseProps} tab={{ ...baseProps.tab!, status: 'BILL_REQUESTED' }} info={{ ...baseProps.info, totalCents: 2200 }} rounds={[{ id: 'r', tab_id: 'tab-1', status: 'READY', subtotal: 20, created_at: new Date().toISOString(), round_no: 1, order_number: 44, customer_name: 'Cliente' }]} />);
    expect(screen.queryByRole('button', { name: 'Pedir a conta' })).toBeNull();
    expect(screen.queryByLabelText('Cobrar conta autorizada')).toBeNull();
    expect(screen.getByText('Conta solicitada pelo cliente. Aguarde o caixa autorizar o fechamento.')).toBeTruthy();
    expect(screen.getByText('Pronto no balcão · balcão chamando')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Lançar pedido' }) as HTMLButtonElement).disabled).toBe(true);
  });
});


describe('/garcom — cadastro só após convite da loja', () => {
  const openSignup = () => {
    h.auth.supabaseUser = null;
    window.history.replaceState(null, '', '/garcom/bar-do-ze?signup=1');
    render(<WaiterApp />);
    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: 'Ana Silva' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'Ana@loja.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segura123' } });
  };
  const submitSignup = () => fireEvent.click(screen.getByRole('button', { name: 'Criar conta e entrar' }));

  it('não convidado: mensagem imediata e não chama signUp nem dispara confirmação', async () => {
    h.rpc.mockResolvedValue({ data: { invited: false }, error: null });
    openSignup(); submitSignup();
    expect((await screen.findByRole('alert')).textContent).toBe('Este e-mail não foi convidado. Fale com o estabelecimento.');
    expect(h.rpc).toHaveBeenCalledWith('waiter_invite_check', { p_slug: 'bar-do-ze', p_email: 'Ana@loja.com' });
    expect(h.auth.signUp).not.toHaveBeenCalled();
    expect(screen.queryByTestId('waiter-confirm-email')).toBeNull();
  });

  it('convidado: checa primeiro, envia a loja para a defesa do servidor e não aceita termos de dono', async () => {
    h.rpc.mockResolvedValue({ data: { invited: true }, error: null });
    h.auth.signUp.mockResolvedValue({ success: true, requiresEmailConfirmation: true });
    openSignup(); submitSignup();
    await screen.findByTestId('waiter-confirm-email');
    expect(h.auth.signUp).toHaveBeenCalledWith('Ana@loja.com', 'segura123', 'Ana Silva', undefined, { audience: 'team', waiter_signup_slug: 'bar-do-ze' });
    expect(h.rpc.mock.invocationCallOrder[0]).toBeLessThan(h.auth.signUp.mock.invocationCallOrder[0]);
  });

  it('limite da checagem também recusa cadastro sem enviar e-mail', async () => {
    h.rpc.mockResolvedValue({ data: { invited: false, rate_limited: true }, error: null });
    openSignup(); submitSignup();
    expect((await screen.findByRole('alert')).textContent).toBe('Este e-mail não foi convidado. Fale com o estabelecimento.');
    expect(h.auth.signUp).not.toHaveBeenCalled();
  });

  it('falha na checagem bloqueia signUp e permite tentar de novo', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    openSignup(); submitSignup();
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível verificar o convite. Tente novamente em instantes.');
    expect(h.auth.signUp).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Criar conta e entrar' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('rota sem loja exige o identificador antes de consultar convite', async () => {
    h.auth.supabaseUser = null;
    window.history.replaceState(null, '', '/garcom?signup=1');
    render(<WaiterApp />);
    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@loja.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: '123456' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Criar conta e entrar' }).closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toContain('Informe o identificador da loja');
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.auth.signUp).not.toHaveBeenCalled();
    h.rpc.mockResolvedValue({ data: { invited: false }, error: null });
    fireEvent.change(screen.getByLabelText('Identificador da loja'), { target: { value: 'outra-loja' } });
    submitSignup();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('waiter_invite_check', { p_slug: 'outra-loja', p_email: 'ana@loja.com' }));
  });

  it('olho alterna senha no signup e login por e-mail, sem enviar formulário', () => {
    openSignup();
    const password = screen.getByLabelText('Senha') as HTMLInputElement;
    expect(password.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(password.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(password.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Já tenho conta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(password.type).toBe('text');
    expect(h.auth.signInWithPassword).not.toHaveBeenCalled(); expect(h.auth.signUp).not.toHaveBeenCalled();
  });

  it('olho no login por usuário usa Mostrar senha/Ocultar senha', async () => {
    h.auth.supabaseUser = null;
    h.rpc.mockResolvedValue({ data: { name: 'Bar do Zé', slug: 'bar-do-ze' }, error: null });
    window.history.replaceState(null, '', '/garcom/bar-do-ze');
    render(<WaiterApp />);
    await screen.findByText('Bar do Zé');
    const password = screen.getByLabelText('Senha') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(password.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(password.type).toBe('password');
  });
});
