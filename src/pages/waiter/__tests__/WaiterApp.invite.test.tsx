// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  auth: { supabaseUser: null as null | { email: string }, activeTenant: null, activeRole: null, isLoadingAuth: false, isMembershipLoading: false, authState: 'AUTHENTICATED', signOut: vi.fn(), signUp: vi.fn(), signInWithPassword: vi.fn(), refreshSession: vi.fn() },
  team: { listMyReceivedInvites: vi.fn(), acceptInvite: vi.fn() },
}));
vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('../../../hooks/useModules', () => ({ useModules: () => ({ available: true, loading: false, isModuleEnabled: () => true }) }));
vi.mock('../../../repositories/teamRepository', () => ({ teamRepository: h.team }));

import { WaiterApp } from '../WaiterApp';

const invite = (id: string, roleId = 'WAITER') => ({ id, roleId, status: 'PENDING', tenantName: 'Bar do Zé' });
beforeEach(() => { Object.values(h.team).forEach(m => m.mockReset()); h.auth.refreshSession.mockReset(); h.auth.supabaseUser = { email: 'ana@loja.com' }; window.history.replaceState(null, '', '/garcom'); });
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
});
