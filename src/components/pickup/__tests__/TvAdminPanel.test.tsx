// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mock = vi.hoisted(() => ({ list: vi.fn(), createCode: vi.fn(), revoke: vi.fn() }));
vi.mock('../../../repositories/tvAccessRepository', () => ({ tvAccessRepository: mock }));
import { TvAdminPanel } from '../TvAdminPanel';
beforeEach(() => { vi.resetAllMocks(); mock.list.mockResolvedValue([]); });
afterEach(cleanup);
it('exibe link e QR, gera código e lista TVs sem expor tokens', async () => {
  mock.list.mockResolvedValue([{ id: 'device', label: 'TV principal', lastSeenAt: null }]);
  mock.createCode.mockResolvedValue({ code: '123456', expiresAt: new Date(Date.now()+600000).toISOString() });
  render(<TvAdminPanel tenantId="tenant" />);
  await screen.findByText(/TV principal/);
  expect(screen.getByRole('link').getAttribute('href')).toMatch(/\/tv$/);
  expect(screen.getByTitle('Abrir TV de chamada')).toBeTruthy();
  fireEvent.click(screen.getByText('Ativar nova TV'));
  await screen.findByText('123456');
  expect(mock.createCode).toHaveBeenCalledWith('tenant', 'TV do balcão');
  mock.list.mockResolvedValue([]);
  fireEvent.click(screen.getByText('Desativar'));
  await waitFor(() => expect(mock.revoke).toHaveBeenCalledWith('tenant', 'device'));
  await screen.findByText('Nenhuma TV ativa.');
});
it('exibe erro do backend', async () => {
  mock.list.mockRejectedValue(new Error('Sem permissão nesta loja.'));
  render(<TvAdminPanel tenantId="tenant" />);
  expect((await screen.findByRole('alert')).textContent).toContain('Sem permissão');
});
