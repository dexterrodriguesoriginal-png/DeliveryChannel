// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { auth, rpc } = vi.hoisted(() => ({
  auth: {
    supabaseUser: null as any, isLoadingAuth: false, isMembershipLoading: false,
    availableTenants: [] as any[], activeTenant: null as any, authState: 'UNAUTHENTICATED',
    signUp: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(), switchTenant: vi.fn(),
    refreshSession: vi.fn(), resendConfirmationEmail: vi.fn(), clearEmailConfirmation: vi.fn(), pendingConfirmationEmail: null,
  }, rpc: vi.fn(),
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc }, isSupabaseConfigured: true }));
import { TeamAccessPage, readTeamAccessPath, TEAM_INVITE_REQUIRED_MESSAGE } from '../TeamAccessPage';
const fill = () => {
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Equipe' } });
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'membro@example.test' } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'password123' } });
};
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/equipe/loja/kitchen?signup=1');
  auth.supabaseUser = null; auth.availableTenants = []; auth.activeTenant = null;
  auth.signUp.mockResolvedValue({ success: true, requiresEmailConfirmation: true });
  auth.signInWithPassword.mockResolvedValue({ success: true });
  rpc.mockResolvedValue({ data: { invited: true }, error: null });
});
afterEach(cleanup);

describe('primeiro acesso por papel e loja', () => {
  it('nega imediatamente e não cria conta quando falta convite', async () => {
    rpc.mockResolvedValue({ data: { invited: false }, error: null });
    render(<TeamAccessPage />); fill(); fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    await screen.findByText(TEAM_INVITE_REQUIRED_MESSAGE);
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('team_invite_check', { p_slug: 'loja', p_email: 'membro@example.test', p_role: 'KITCHEN' });
  });
  it('só cria a conta após convite confirmado, com metadados de equipe', async () => {
    render(<TeamAccessPage />); fill(); fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    await screen.findByText('Confirme seu e-mail');
    expect(auth.signUp).toHaveBeenCalledWith('membro@example.test', 'password123', 'Equipe', undefined,
      { audience: 'team', team_signup_slug: 'loja', team_signup_role: 'KITCHEN' });
  });
  it('mostrar/ocultar senha funciona também no login', () => {
    window.history.replaceState({}, '', '/equipe/loja/cashier');
    render(<TeamAccessPage />);
    const password = screen.getByLabelText('Senha') as HTMLInputElement;
    expect(password.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' })); expect(password.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha' })); expect(password.type).toBe('password');
  });
  it('conta autenticada aceita só o convite da loja e papel do link', async () => {
    auth.supabaseUser = { id: 'user' };
    render(<TeamAccessPage />);
    await waitFor(() => expect(auth.refreshSession).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith('team_accept_invite', { p_slug: 'loja', p_role: 'KITCHEN' });
  });
  it('seleciona o vínculo da loja do link, sem trocar para outra loja', async () => {
    auth.supabaseUser = { id: 'user' };
    auth.availableTenants = [
      { tenantId: 'other', tenantSlug: 'outra', roleId: 'OWNER', status: 'ACTIVE' },
      { tenantId: 'requested', tenantSlug: 'loja', roleId: 'KITCHEN', status: 'ACTIVE' },
    ];
    render(<TeamAccessPage />);
    await waitFor(() => expect(auth.switchTenant).toHaveBeenCalledWith('requested'));
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejeita papel e slug inválidos', () => {
    expect(readTeamAccessPath('/equipe/loja/kitchen')).toEqual({ slug: 'loja', role: 'KITCHEN' });
    expect(readTeamAccessPath('/equipe/outra/ceo')).toBeNull();
    expect(readTeamAccessPath('/equipe/%2e%2e/owner')).toBeNull();
  });
});
