// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  tenant: { id: 'tenant-a', name: 'Loja A', slug: 'loja-a' },
  context: { userId: 'owner-a' },
  members: [] as any[], directory: [] as any[] | null,
  toast: vi.fn(),
  team: { listTeamMembers: vi.fn(), listPendingInvites: vi.fn(), createInvite: vi.fn(), removeTeamMember: vi.fn(), revokeInvite: vi.fn() },
  waiter: { directory: vi.fn(), createWaiter: vi.fn(), deleteWaiter: vi.fn(), setActive: vi.fn(), reactivateWaiter: vi.fn() },
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ activeTenant: h.tenant, securityContext: h.context }) }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ showToast: h.toast }) }));
vi.mock('../../../repositories/teamRepository', () => ({ teamRepository: h.team }));
vi.mock('../../../repositories/waiterV2Repository', () => ({ waiterV2Repository: h.waiter, WaiterAdminError: class extends Error {} }));
vi.mock('../../../components/establishment/WaiterPhonePairingCard', () => ({ WaiterPhonePairingCard: () => null }));
vi.mock('../../../components/establishment/WaiterAccessBlock', () => ({ WaiterAccessBlock: () => null }));

import { TeamPage } from '../TeamPage';

const member = (id: string, name: string, username: string | null) => ({
  member: { id, userId: `user-${id}`, tenantId: 'tenant-a', role: 'WAITER', status: 'ACTIVE', name, email: '', createdAt: '2026-10-01T00:00:00Z' },
  directory: { id, userId: `user-${id}`, roleId: 'WAITER', status: 'ACTIVE', name, username, email: '', phone: '11999990000', waiterActive: username ? true : null },
});
beforeEach(() => {
  Object.values(h.team).forEach(fn => fn.mockReset()); Object.values(h.waiter).forEach(fn => fn.mockReset()); h.toast.mockReset();
  h.tenant = { id: 'tenant-a', name: 'Loja A', slug: 'loja-a' };
  const legacy = member('old', 'Garçom antigo', null), current = member('new', 'Garçom novo', 'novo');
  h.members = [legacy.member, current.member]; h.directory = [legacy.directory, current.directory];
  h.team.listTeamMembers.mockImplementation(async () => h.members);
  h.team.listPendingInvites.mockResolvedValue([]);
  h.waiter.directory.mockImplementation(async () => h.directory);
  h.waiter.deleteWaiter.mockImplementation(async (_tenant: string, userId: string) => {
    h.members = h.members.map(m => m.userId === userId ? { ...m, status: 'INACTIVE' } : m);
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

  it('does not show a late team response from the previous store after a store switch', async () => {
    const oldMembers = [...h.members];
    let resolveOld!: (members: any[]) => void;
    h.team.listTeamMembers.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const view = render(<TeamPage />);
    h.tenant = { id: 'tenant-b', name: 'Loja B', slug: 'loja-b' };
    h.members = [{ ...member('other', 'Equipe da loja B', null).member, tenantId: 'tenant-b' }]; h.directory = [];
    view.rerender(<TeamPage />);
    await screen.findByText('Equipe da loja B');
    resolveOld(oldMembers);
    await waitFor(() => expect(screen.queryByText('Garçom antigo')).toBeNull());
    expect(screen.getByText('Equipe da loja B')).toBeTruthy();
  });
});
