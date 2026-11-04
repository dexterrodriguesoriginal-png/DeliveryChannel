// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const api = vi.hoisted(() => ({ waiterEnabled: vi.fn(), pending: vi.fn(), resolve: vi.fn() }));
vi.mock('../../../../repositories/tableMoveApprovalRepository', () => ({ tableMoveApprovalRepository: api }));
vi.mock('../../../../lib/supabase', () => ({ supabase: {} }));
import { TableMoveRequestsPanel } from '../TableMoveRequestsPanel';
const request = { id: 'req1', tabId: 'tab1', fromTableId: 't3', fromLabel: 'Mesa 3', toTableId: 't7', toLabel: 'Mesa 7', status: 'PENDING', requestedAt: '2026-11-04T12:00:00Z' };
beforeEach(() => { Object.values(api).forEach(method => method.mockReset()); api.waiterEnabled.mockResolvedValue(false); api.pending.mockResolvedValue([request]); api.resolve.mockResolvedValue(undefined); });
afterEach(cleanup);
describe('autorização da mudança de mesa', () => {
  it.each([true, false])('dono pode responder à solicitação com approve=%s', async approve => {
    const changed = vi.fn(); render(<TableMoveRequestsPanel tenantId="shop" viewerId="owner" role="OWNER" onResolved={changed} />);
    expect(await screen.findByText('Mesa 3 → Mesa 7')).toBeTruthy();
    api.pending.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: approve ? 'Autorizar' : 'Recusar' }));
    await waitFor(() => expect(api.resolve).toHaveBeenCalledWith('req1', approve));
    expect(changed).toHaveBeenCalledOnce();
    expect(api.waiterEnabled).not.toHaveBeenCalled();
  });
  it('garçom sem permissão não consulta pedidos nem exibe botões', async () => {
    render(<TableMoveRequestsPanel tenantId="shop" viewerId="waiter" role="WAITER" />);
    await waitFor(() => expect(api.waiterEnabled).toHaveBeenCalledWith('shop'));
    expect(api.pending).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Autorizar' })).toBeNull();
  });
  it('garçom habilitado recebe os pedidos limitados pelo servidor e pode autorizar', async () => {
    api.waiterEnabled.mockResolvedValue(true);
    render(<TableMoveRequestsPanel tenantId="shop" viewerId="waiter" role="WAITER" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Autorizar' }));
    await waitFor(() => expect(api.resolve).toHaveBeenCalledWith('req1', true));
  });
  it('gerente não herda autorização do dono e não consulta os pedidos', async () => {
    render(<TableMoveRequestsPanel tenantId="shop" viewerId="manager" role="MANAGER" />);
    await act(async () => { await Promise.resolve(); });
    expect(api.pending).not.toHaveBeenCalled(); expect(api.waiterEnabled).not.toHaveBeenCalled();
  });
  it('retira dados e ignora resposta da loja/identidade anterior', async () => {
    let finish!: (rows: unknown[]) => void;
    api.pending.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue([]);
    const view = render(<TableMoveRequestsPanel tenantId="old-shop" viewerId="old-owner" role="OWNER" />);
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    view.rerender(<TableMoveRequestsPanel tenantId="new-shop" viewerId="new-owner" role="OWNER" />);
    await act(async () => finish([request]));
    expect(screen.queryByText('Mesa 3 → Mesa 7')).toBeNull();
  });
  it('não bloqueia outra identidade enquanto uma decisão anterior ainda responde', async () => {
    let finish!: () => void;
    api.resolve.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    const changed = vi.fn();
    const view = render(<TableMoveRequestsPanel tenantId="old-shop" viewerId="old-owner" role="OWNER" onResolved={changed} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Autorizar' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    api.pending.mockResolvedValue([{ ...request, id: 'req2', fromLabel: 'Mesa atual' }]);
    view.rerender(<TableMoveRequestsPanel tenantId="new-shop" viewerId="new-owner" role="OWNER" onResolved={changed} />);
    await screen.findByText('Mesa atual → Mesa 7');
    expect(screen.getByRole('button', { name: 'Autorizar' }).hasAttribute('disabled')).toBe(false);
    await act(async () => finish());
    expect(changed).not.toHaveBeenCalled(); expect(screen.getByText('Mesa atual → Mesa 7')).toBeTruthy();
  });
  it('mostra a recusa do servidor sem fingir autorização', async () => {
    api.resolve.mockRejectedValue(new Error('FORBIDDEN: permissão retirada pelo dono.'));
    const changed = vi.fn(); render(<TableMoveRequestsPanel tenantId="shop" viewerId="owner" role="OWNER" onResolved={changed} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Autorizar' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'FORBIDDEN: permissão retirada pelo dono.');
    expect(changed).not.toHaveBeenCalled(); expect(screen.getByText('Mesa 3 → Mesa 7')).toBeTruthy();
  });
});
