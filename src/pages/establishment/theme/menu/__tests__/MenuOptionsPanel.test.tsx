// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MenuOptionsPanel } from '../MenuOptionsPanel';
import { DEFAULT_MENU_OPTIONS } from '../../../../../lib/menu/menuOptions';
import type { SecurityContext } from '../../../../../services/securityEngine';
vi.mock('../../../../../repositories/menuOptionsRepository', () => ({ menuOptionsRepository: {
  load: vi.fn(async () => ({ ...DEFAULT_MENU_OPTIONS })), save: vi.fn(),
} }));
afterEach(cleanup);
it.each(['COUNTER', 'BOTH'])('explica o totem do salão com link em %s', async mode => {
  render(<MenuOptionsPanel tenantId="loja" slug="minha-loja" securityContext={{ userId: 'dono', userRole: 'OWNER', tenantId: 'loja' } as SecurityContext} />);
  const select = screen.getByLabelText('Modo de atendimento') as HTMLSelectElement;
  await waitFor(() => expect(select.disabled || select.closest('fieldset')?.disabled).toBe(false));
  fireEvent.change(select, { target: { value: mode } });
  expect(screen.getByText(/O totem do salão já está disponível/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Abrir totem do salão' }).getAttribute('href')).toBe(`${window.location.origin}/totem/minha-loja`);
  expect(screen.queryByText(/permanece indisponível/)).toBeNull();
});
