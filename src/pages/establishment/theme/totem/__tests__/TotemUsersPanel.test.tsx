// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecurityContext } from '../../../../../services/securityEngine';

const listUsers = vi.fn();
const listDevices = vi.fn();
const createUser = vi.fn();
const setUserPassword = vi.fn();
const setUserActive = vi.fn();
const revokeDevice = vi.fn();

vi.mock('../../../../../repositories/totemAccessRepository', () => ({
  totemAccessRepository: {
    listUsers: (...a: unknown[]) => listUsers(...a),
    listDevices: (...a: unknown[]) => listDevices(...a),
    createUser: (...a: unknown[]) => createUser(...a),
    setUserPassword: (...a: unknown[]) => setUserPassword(...a),
    setUserActive: (...a: unknown[]) => setUserActive(...a),
    revokeDevice: (...a: unknown[]) => revokeDevice(...a),
  },
}));

import { TotemUsersPanel } from '../TotemUsersPanel';

const ctx = { userId: 'owner', userRole: 'OWNER', tenantId: 'store-a', userName: 'Dono' } as SecurityContext;

beforeEach(() => {
  listUsers.mockReset(); listDevices.mockReset(); createUser.mockReset();
  setUserPassword.mockReset(); setUserActive.mockReset(); revokeDevice.mockReset();
  listUsers.mockResolvedValue([]);
  listDevices.mockResolvedValue([]);
  createUser.mockResolvedValue({ id: 'u1' });
});
afterEach(cleanup);

describe('TotemUsersPanel', () => {
  it('mostra o formulário, o aviso e o erro visível se o RPC falhar', async () => {
    listUsers.mockRejectedValue(new Error('função admin_list_totem_users não existe'));
    render(<TotemUsersPanel securityContext={ctx} tenantId="store-a" />);
    expect(screen.getByRole('heading', { name: 'Usuários do totem' })).toBeTruthy();
    expect(screen.getByTestId('totem-users-hint').textContent).toMatch(/Para ativar o aparelho, crie um usuário do totem abaixo/);
    await waitFor(() => expect(screen.getByTestId('totem-users-error').textContent).toMatch(/admin_list_totem_users/));
    expect(screen.getByLabelText('Rótulo')).toBeTruthy();
    expect(screen.getByLabelText('Usuário')).toBeTruthy();
    expect(screen.getByLabelText('Senha')).toBeTruthy();
    expect(screen.getByLabelText('Confirmar')).toBeTruthy();
    expect(screen.getByTestId('totem-user-create-submit').textContent).toMatch(/Criar usuário/);
  });

  it('não cria usuário se as senhas não coincidem e mostra o erro', async () => {
    render(<TotemUsersPanel securityContext={ctx} tenantId="store-a" />);
    await waitFor(() => expect(listUsers).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Rótulo'), { target: { value: 'Caixa 1' } });
    fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'totem01' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha1234' } });
    fireEvent.change(screen.getByLabelText('Confirmar'), { target: { value: 'outra1234' } });
    fireEvent.click(screen.getByTestId('totem-user-create-submit'));
    await waitFor(() => expect(screen.getByTestId('totem-users-error').textContent).toMatch(/não coincidem/));
    expect(createUser).not.toHaveBeenCalled();
  });

  it('cria usuário quando as senhas coincidem', async () => {
    render(<TotemUsersPanel securityContext={ctx} tenantId="store-a" />);
    await waitFor(() => expect(listUsers).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Rótulo'), { target: { value: 'Caixa 1' } });
    fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'totem01' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha1234' } });
    fireEvent.change(screen.getByLabelText('Confirmar'), { target: { value: 'senha1234' } });
    fireEvent.click(screen.getByTestId('totem-user-create-submit'));
    await waitFor(() => expect(createUser).toHaveBeenCalled());
    expect(createUser.mock.calls[0][2]).toEqual({ label: 'Caixa 1', username: 'totem01', password: 'senha1234' });
  });
});
