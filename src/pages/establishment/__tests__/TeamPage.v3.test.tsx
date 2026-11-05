// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  tenant: { id: 'tenant-a', name: 'Loja A', slug: 'loja-a' },
  context: { userId: 'owner-a' },
  role: 'OWNER',
  tools: { waiter: true, kitchen: true },
  settings: { listTools: vi.fn(), listPermissions: vi.fn(), setPermission: vi.fn() },
  members: [] as any[], directory: [] as any[] | null,
  toast: vi.fn(),
  team: { listTeamMembers: vi.fn(), listPendingInvites: vi.fn(), createInvite: vi.fn(), removeTeamMember: vi.fn(), revokeInvite: vi.fn(), resendInvite: vi.fn() },
  waiter: { directory: vi.fn(), createWaiter: vi.fn(), deleteWaiter: vi.fn(), setActive: vi.fn(), reactivateWaiter: vi.fn() },
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ activeTenant: h.tenant, securityContext: h.context, activeRole: h.role }) }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ showToast: h.toast }) }));
vi.mock('../../../repositories/storeTeamRepository', () => ({ storeTeamRepository: h.settings }));
vi.mock('../../../repositories/teamRepository', () => ({ teamRepository: h.team }));
vi.mock('../../../repositories/waiterV2Repository', () => ({ waiterV2Repository: h.waiter, WaiterAdminError: class extends Error {} }));
vi.mock('../../../components/establishment/WaiterPhonePairingCard', () => ({ WaiterPhonePairingCard: () => null }));
vi.mock('../../../components/establishment/WaiterAccessBlock', () => ({ WaiterAccessBlock: () => null }));
vi.mock('../../../components/establishment/waiter/TableMoveApprovalSetting', () => ({ TableMoveApprovalSetting: () => null }));

import { TeamPage } from '../TeamPage';

const member = (id: string, name: string, username: string | null) => ({
  member: { id, userId: `user-${id}`, tenantId: 'tenant-a', role: 'WAITER', status: 'ACTIVE', name, email: '', createdAt: '2026-10-01T00:00:00Z' },
  directory: { id, userId: `user-${id}`, roleId: 'WAITER', status: 'ACTIVE', name, username, email: '', phone: '11999990000', waiterActive: username ? true : null },
});
beforeEach(() => {
  Object.values(h.team).forEach(fn => fn.mockReset()); Object.values(h.waiter).forEach(fn => fn.mockReset()); h.toast.mockReset();
  h.tenant = { id: 'tenant-a', name: 'Loja A', slug: 'loja-a' };
  h.role = 'OWNER'; h.tools = { waiter: true, kitchen: true };
  h.settings.listTools.mockImplementation(async () => h.tools);
  h.settings.listPermissions.mockResolvedValue([]);
  h.settings.setPermission.mockReset();
  const legacy = member('old', 'Garçom antigo', null), current = member('new', 'Garçom novo', 'novo');
  h.members = [legacy.member, current.member]; h.directory = [legacy.directory, current.directory];
  h.team.listTeamMembers.mockImplementation(async () => h.members);
  h.team.listPendingInvites.mockResolvedValue([]);
  h.waiter.directory.mockImplementation(async () => h.directory);
  h.waiter.deleteWaiter.mockImplementation(async (_tenant: string, userId: string) => {
    h.members = h.members.map(m => m.userId === userId ? { ...m, status: 'INACTIVE' } : m);
    h.directory = h.directory?.map(m => m.userId === userId ? { ...m, status: 'INACTIVE' } : m) || null;
  });
  Object.defineProperty(window, 'confirm', { configurable: true, value: vi.fn().mockReturnValue(true) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Equipe Garçom v3', () => {
  it('has one add button and routes waiter to username/password without requiring email', async () => {
    render(<TeamPage />);
    await screen.findByText('Garçom antigo');
    expect(screen.getAllByRole('button', { name: 'Adicionar membro da equipe' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Convidar garçom|Convidar colaborador/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar membro da equipe' }));
    fireEvent.change(screen.getByLabelText('Tipo de membro *'), { target: { value: 'WAITER' } });
    expect(screen.queryByLabelText('E-mail do Colaborador *')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByTestId('waiter-create-form')).toBeTruthy();
    expect(screen.getByLabelText('Usuário * (único na loja)')).toBeTruthy();
    expect(screen.getByLabelText('Senha')).toBeTruthy();
    expect(h.team.createInvite).not.toHaveBeenCalled();
  });

  it('keeps the other member types on email invitations', async () => {
    render(<TeamPage />);
    await screen.findByText('Garçom antigo');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar membro da equipe' }));
    fireEvent.change(screen.getByLabelText('Tipo de membro *'), { target: { value: 'CASHIER' } });
    fireEvent.change(screen.getByLabelText('E-mail do Colaborador *'), { target: { value: 'caixa@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar Convite' }));
    await waitFor(() => expect(h.team.createInvite).toHaveBeenCalledWith({ userId: 'owner-a' }, 'tenant-a', 'caixa@example.com', 'CASHIER'));
    expect(h.waiter.createWaiter).not.toHaveBeenCalled();
  });

  it.each([['old', 'Garçom antigo'], ['new', 'Garçom novo']])('removes %s waiter, refreshes the list and uses the waiter message', async (id, name) => {
    render(<TeamPage />);
    await screen.findByText(name);
    fireEvent.click(screen.getByRole('button', { name: `Remover ${name} da equipe` }));
    await waitFor(() => expect(screen.queryByText(name)).toBeNull());
    expect(h.waiter.deleteWaiter).toHaveBeenCalledWith('tenant-a', `user-${id}`);
    expect(h.team.removeTeamMember).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith({ type: 'warning', title: 'Garçom Removido', message: `O garçom ${name} foi removido da equipe.` });
    expect(h.team.listTeamMembers.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps username/password flow when directory loading is temporarily unavailable', async () => {
    h.directory = null;
    render(<TeamPage />);
    await screen.findByText('Garçom antigo');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar membro da equipe' }));
    fireEvent.change(screen.getByLabelText('Tipo de membro *'), { target: { value: 'WAITER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByTestId('waiter-create-form')).toBeTruthy();
    expect(h.team.createInvite).not.toHaveBeenCalled();
  });

  it('shows the actual friendly create error in the waiter form', async () => {
    h.waiter.createWaiter.mockRejectedValueOnce(new Error('O usuário já existe. Tente outro nome de usuário.'));
    render(<TeamPage />);
    await screen.findByText('Garçom antigo');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar membro da equipe' }));
    fireEvent.change(screen.getByLabelText('Tipo de membro *'), { target: { value: 'WAITER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'João' } });
    fireEvent.change(screen.getByLabelText('Telefone *'), { target: { value: '11999990000' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha123' } });
    fireEvent.submit(screen.getByTestId('waiter-create-form'));
    expect((await screen.findByRole('alert')).textContent).toBe('O usuário já existe. Tente outro nome de usuário.');
    expect(h.waiter.createWaiter).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', name: 'João', username: 'joao', password: 'senha123' }));
  });

  it('closes the previous store member modal immediately when switching stores', async () => {
    const view = render(<TeamPage />);
    await screen.findByText('Garçom novo');
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByDisplayValue('Garçom novo')).toBeTruthy();
    h.tenant = { id: 'tenant-b', name: 'Loja B', slug: 'loja-b' };
    h.members = []; h.directory = [];
    view.rerender(<TeamPage />);
    expect(screen.queryByDisplayValue('Garçom novo')).toBeNull();
    expect(screen.queryByText('Editar garçom')).toBeNull();
  });

  it('does not show a late team response from the previous store after a store switch', async () => {
    const oldMembers = [...h.members];
    let resolveOld!: (members: any[]) => void;
    h.team.listTeamMembers.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const view = render(<TeamPage />);
    h.tenant = { id: 'tenant-b', name: 'Loja B', slug: 'loja-b' };
    h.members = [{ ...member('other', 'Equipe da loja B', null).member, tenantId: 'tenant-b' }];
    h.directory = [member('other', 'Equipe da loja B', null).directory];
    view.rerender(<TeamPage />);
    await screen.findByText('Equipe da loja B');
    resolveOld(oldMembers);
    await waitFor(() => expect(screen.queryByText('Garçom antigo')).toBeNull());
    expect(screen.getByText('Equipe da loja B')).toBeTruthy();
  });
});


describe('Equipe organizada por papel', () => {
  it('groups members and pending invitations with counts and role access links', async () => {
    h.members.push({ ...member('k', 'Maria cozinha', null).member, role: 'KITCHEN' });
    h.directory!.push({ ...member('k', 'Maria cozinha', null).directory, roleId: 'KITCHEN' });
    h.team.listPendingInvites.mockResolvedValue([{ id: 'invite-k', tenantId: 'tenant-a', email: 'cozinha@example.com', roleId: 'KITCHEN', status: 'PENDING', expiresAt: '2026-12-01T00:00:00Z' }]);
    render(<TeamPage />);
    await screen.findByText('Maria cozinha');
    const kitchen = screen.getByTestId('team-role-KITCHEN');
    expect(kitchen.textContent).toContain('Cozinha (2)');
    expect(kitchen.textContent).toContain('1 membros · 1 convites pendentes');
    expect(kitchen.querySelector('a[href="/equipe/loja-a/kitchen?signup=1"]')).toBeTruthy();
    expect(screen.getByTestId('team-role-WAITER').querySelector('a[href="/garcom/loja-a?signup=1"]')).toBeTruthy();
  });
  it('hides optional roles, members and QR when tools are disabled', async () => {
    h.tools = { waiter: false, kitchen: false };
    render(<TeamPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Adicionar membro da equipe' }).hasAttribute('disabled')).toBe(false));
    expect(screen.queryByTestId('team-role-WAITER')).toBeNull();
    expect(screen.queryByTestId('team-role-KITCHEN')).toBeNull();
    expect(screen.queryByText('Garçom antigo')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar membro da equipe' }));
    expect(screen.queryByRole('option', { name: /Garçom|Cozinha/ })).toBeNull();
  });
  it('allows the owner to toggle role permission through the validated RPC', async () => {
    h.settings.listPermissions.mockResolvedValue([{ role: 'MANAGER', permission: 'view_reports', enabled: true }, { role: 'OWNER', permission: 'view_reports', enabled: true }, { role: 'MANAGER', permission: 'view_finances', enabled: false }]);
    render(<TeamPage />);
    await screen.findByText('Garçom antigo');
    fireEvent.click(screen.getByText('Permissões de Gerente'));
    const toggle = screen.getByRole('switch', { name: 'Relatórios: Gerente' });
    fireEvent.click(toggle);
    await waitFor(() => expect(h.settings.setPermission).toHaveBeenCalledWith('tenant-a', 'MANAGER', 'view_reports', false));
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('switch', { name: 'Financeiro sensível: Gerente' }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Permissões de Dono'));
    expect((screen.getByRole('switch', { name: 'Relatórios: Dono' }) as HTMLInputElement).disabled).toBe(true);
  });
  it('keeps permission switches read only for managers', async () => {
    h.role = 'MANAGER';
    h.settings.listPermissions.mockResolvedValue([{ role: 'MANAGER', permission: 'view_reports', enabled: true }]);
    render(<TeamPage />);
    await screen.findByText('Garçom antigo');
    fireEvent.click(screen.getByText('Permissões de Gerente'));
    const toggle = screen.getByRole('switch', { name: 'Relatórios: Gerente' });
    expect((toggle as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(toggle);
    expect(h.settings.setPermission).not.toHaveBeenCalled();
  });
  it('supports an email invitation for a waiter from the single add flow', async () => {
    render(<TeamPage />);
    await screen.findByText('Garçom antigo');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar membro da equipe' }));
    fireEvent.change(screen.getByLabelText('Tipo de membro *'), { target: { value: 'WAITER' } });
    fireEvent.change(screen.getByLabelText('Forma de acesso'), { target: { value: 'invite' } });
    fireEvent.change(screen.getByLabelText('E-mail do Colaborador *'), { target: { value: 'waiter@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar Convite' }));
    await waitFor(() => expect(h.team.createInvite).toHaveBeenCalledWith(h.context, 'tenant-a', 'waiter@example.com', 'WAITER'));
    expect(h.waiter.createWaiter).not.toHaveBeenCalled();
  });
});

describe('Entrega 1.1: diretório, abas e convites', () => {
  const invite = { id: 'invite-cashier', tenantId: 'tenant-a', email: 'convidado@example.com', roleId: 'CASHIER', status: 'PENDING', expiresAt: '2026-12-01T00:00:00Z' };

  it.each(['MANAGER', 'CASHIER', 'KITCHEN', 'WAITER', 'OPERATOR', 'DELIVERY_MANAGER', 'DRIVER'])('mostra convidado aceito %s presente só no diretório autorizado', async role => {
    h.members = [];
    h.directory = [{ ...member('accepted', 'Membro aceito', null).directory, roleId: role }];
    render(<TeamPage />);
    await screen.findByText('Membro aceito');
    expect(screen.getByTestId(`team-role-${role}`).textContent).toContain('1 membros · 0 convites pendentes');
    expect(screen.getByRole('tab', { name: 'Todos (1)' }).getAttribute('aria-selected')).toBe('true');
  });

  it('não ressuscita vínculos da consulta direta quando o diretório está vazio', async () => {
    h.directory = [];
    render(<TeamPage />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Adicionar membro da equipe' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText('Garçom antigo')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Todos (0)' })).toBeTruthy();
  });

  it('usa diretório mesmo se a consulta direta falhar e inclui só vínculos ativos', async () => {
    h.team.listTeamMembers.mockRejectedValue(new Error('consulta indisponível'));
    h.directory![0].status = 'SUSPENDED';
    render(<TeamPage />);
    await screen.findByText('Garçom novo');
    expect(screen.queryByText('Garçom antigo')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Garçom (1)' })).toBeTruthy();
  });

  it('mostra erro e permite atualizar quando o diretório falha, sem ocultar a falha no fallback', async () => {
    h.waiter.directory.mockRejectedValueOnce(new Error('Sem permissão ou conexão'));
    render(<TeamPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar o diretório');
    expect(screen.queryByText('Garçom antigo')).toBeNull();
    fireEvent.click(screen.getByTitle('Atualizar dados'));
    await screen.findByText('Garçom antigo');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('filtra por aba, conta membros e pendências e mascara endereços de RPC antigo', async () => {
    h.directory!.push({ ...member('cashier', 'Caixa ativo', null).directory, roleId: 'CASHIER' });
    h.team.listPendingInvites.mockResolvedValue([invite, { ...invite, id: 'accepted-invite', email: 'aceito@example.com', status: 'ACCEPTED' }]);
    render(<TeamPage />);
    await screen.findByText('Caixa ativo');
    expect(screen.getByRole('tab', { name: 'Todos (4)' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Todos (4)', 'Gerente (0)', 'Caixa (2)', 'Cozinha (0)', 'Garçom (2)', 'Estoque (0)', 'Coordenador (0)', 'Entregador (0)']);
    fireEvent.click(screen.getByRole('tab', { name: 'Caixa (2)' }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Caixa ativo')).toBeTruthy();
    expect(within(panel).queryByText('Garçom novo')).toBeNull();
    expect(within(panel).getByText('co***@ex***.com')).toBeTruthy();
    expect(within(panel).getByText('Convite pendente')).toBeTruthy();
    expect(document.body.textContent).not.toContain(invite.email);
    expect(within(panel).queryByText('aceito@example.com')).toBeNull();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Caixa (2)' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Cozinha (0)' }).getAttribute('aria-selected')).toBe('true');
  });

  it('renova por id e abre compartilhamento sem alegar envio de e-mail', async () => {
    h.team.listPendingInvites.mockResolvedValue([invite]);
    render(<TeamPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reenviar' }));
    await screen.findByText('Compartilhar convite');
    expect(h.team.resendInvite).toHaveBeenCalledWith(h.context, 'tenant-a', invite.id);
    expect(screen.getByText('Nenhum e-mail é enviado automaticamente. Mostre o QR ou envie o link ao colaborador.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /equipe\/loja-a\/cashier/ }).length).toBeGreaterThan(0);
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Convite renovado' }));
    expect(JSON.stringify(h.toast.mock.calls)).not.toContain(invite.email);
    expect(h.team.createInvite).not.toHaveBeenCalled();
  });

  it('cancela a pendência e mantém endereço mascarado no feedback', async () => {
    let pending = [invite];
    h.team.listPendingInvites.mockImplementation(async () => pending);
    h.team.revokeInvite.mockImplementation(async () => { pending = []; });
    render(<TeamPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByText('Convite pendente')).toBeNull());
    expect(h.team.revokeInvite).toHaveBeenCalledWith(h.context, 'tenant-a', invite.id);
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'O convite para co***@ex***.com foi cancelado.' }));
    expect(JSON.stringify(h.toast.mock.calls)).not.toContain(invite.email);
  });

  it('descarta renovação atrasada da loja anterior', async () => {
    let finish!: () => void;
    h.team.resendInvite.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    h.team.listPendingInvites.mockResolvedValue([invite]);
    const view = render(<TeamPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reenviar' }));
    h.tenant = { id: 'tenant-b', name: 'Loja B', slug: 'loja-b' };
    h.directory = []; h.members = []; h.team.listPendingInvites.mockResolvedValue([]);
    view.rerender(<TeamPage />);
    finish();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Adicionar membro da equipe' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText('Compartilhar convite')).toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('desmonta imediatamente o compartilhamento de convite ao trocar a loja', async () => {
    h.team.listPendingInvites.mockResolvedValue([invite]);
    const view = render(<TeamPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reenviar' }));
    await screen.findByText('Compartilhar convite');
    h.tenant = { id: 'tenant-b', name: 'Loja B', slug: 'loja-b' };
    h.directory = []; h.members = []; h.team.listPendingInvites.mockResolvedValue([]);
    view.rerender(<TeamPage />);
    expect(screen.queryByText('Compartilhar convite')).toBeNull();
    expect(screen.queryByText('Convite para co***@ex***.com')).toBeNull();
    expect(document.querySelector('a[href="/equipe/loja-a/cashier?signup=1"]')).toBeNull();
  });

  it('não publica falha de carregamento da loja anterior após desmontar', async () => {
    let fail!: (reason: Error) => void;
    h.waiter.directory.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const view = render(<TeamPage />);
    h.tenant = { id: 'tenant-b', name: 'Loja B', slug: 'loja-b' };
    h.directory = []; h.members = [];
    view.rerender(<TeamPage />);
    fail(new Error('falha atrasada'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Adicionar membro da equipe' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('carrega o diretório com o ciclo de efeitos do StrictMode', async () => {
    render(<React.StrictMode><TeamPage /></React.StrictMode>);
    await screen.findByText('Garçom novo');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

