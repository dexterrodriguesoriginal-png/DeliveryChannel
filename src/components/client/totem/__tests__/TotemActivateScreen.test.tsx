// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const activateUser = vi.fn();
const activateAsStaff = vi.fn();
vi.mock('../../../../repositories/totemAccessRepository', () => ({
  totemAccessRepository: {
    activateUser: (...args: unknown[]) => activateUser(...args),
    activateAsStaff: (...args: unknown[]) => activateAsStaff(...args),
  },
}));

import { TotemActivateScreen } from '../TotemActivateScreen';

const login = { tenantId: 'tn', slug: 'loja', name: 'Adega Loja', accent: '#176444' };
const token = 'a'.repeat(64);

beforeEach(() => { activateUser.mockReset(); activateAsStaff.mockReset(); });
afterEach(cleanup);

describe('TotemActivateScreen', () => {
  it('shows the locked-totem copy and activates with a totem user', async () => {
    const onActivated = vi.fn();
    activateUser.mockResolvedValue({ ok: true, token, deviceId: 'd1', label: 'Caixa 1' });
    render(<TotemActivateScreen slug="loja" login={login} onActivated={onActivated} />);
    expect(screen.getByTestId('totem-activate-screen').textContent).toMatch(/Totem não ativado/);
    fireEvent.change(screen.getByTestId('totem-activate-username'), { target: { value: 'totem01' } });
    fireEvent.change(screen.getByTestId('totem-activate-password'), { target: { value: 'senha1234' } });
    fireEvent.click(screen.getByTestId('totem-activate-submit'));
    await waitFor(() => expect(onActivated).toHaveBeenCalledWith({ token, deviceId: 'd1', label: 'Caixa 1' }));
  });

  it('warns when activating would revoke another device', async () => {
    activateUser.mockResolvedValueOnce({
      ok: false, reason: 'ACTIVE_DEVICE', message: 'já ativo', device: { id: 'old', label: 'Caixa antigo', lastSeenAt: null },
    });
    activateUser.mockResolvedValueOnce({ ok: true, token, deviceId: 'd2', label: 'Caixa 2' });
    const onActivated = vi.fn();
    render(<TotemActivateScreen slug="loja" login={login} onActivated={onActivated} />);
    fireEvent.change(screen.getByTestId('totem-activate-username'), { target: { value: 'totem01' } });
    fireEvent.change(screen.getByTestId('totem-activate-password'), { target: { value: 'senha1234' } });
    fireEvent.change(screen.getByTestId('totem-activate-label'), { target: { value: 'Caixa 2' } });
    fireEvent.click(screen.getByTestId('totem-activate-submit'));
    expect(await screen.findByTestId('totem-activate-revoke-warn')).toBeTruthy();
    fireEvent.click(screen.getByTestId('totem-activate-confirm-revoke'));
    await waitFor(() => expect(activateUser).toHaveBeenLastCalledWith(expect.objectContaining({ confirmRevoke: true })));
    await waitFor(() => expect(onActivated).toHaveBeenCalled());
  });
});
