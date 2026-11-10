// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { CallScreen } from '../CallScreen';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ activeTenant: { id: 'tenant1', theme: { primaryColor: '#7c3aed', tokens: { version: 1, palette: { accent: '#f59e0b', buttonBg: '#7c3aed', buttonText: '#ffffff' } } } } }),
}));
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }) } }));
vi.mock('../../../repositories/arrivalRepository', () => ({
  arrivalRepository: {
    listOpen: vi.fn(async () => []),
    listReadyTotem: vi.fn(async () => ['321']),
    subscribe: () => () => {},
    getStoreQr: vi.fn(async () => ({ showNameOnTv: false })),
  },
}));

afterEach(() => cleanup());

describe('TV /chamada usa o tema da loja', () => {
  it('pinta senhas prontas com o acento do tema, sem verde fixo', async () => {
    render(<CallScreen tenantId="tenant1" storeName="Loja Tema" />);
    await waitFor(() => expect(screen.getByTestId('totem-ready-codes')).toBeTruthy());
    const heading = screen.getByText('Prontos para retirada');
    const tile = screen.getByText('321');
    expect(heading.className).not.toMatch(/text-green-400/);
    expect(tile.className).not.toMatch(/bg-green-500/);
    expect(heading.getAttribute('style') || '').toMatch(/#f59e0b/i);
    expect(tile.getAttribute('style') || '').toMatch(/#f59e0b/i);
  });
});
