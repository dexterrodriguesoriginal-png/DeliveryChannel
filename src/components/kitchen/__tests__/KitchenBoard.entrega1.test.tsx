// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { repo } = vi.hoisted(() => ({ repo: { listOrders: vi.fn(), setStatus: vi.fn(), subscribe: vi.fn(), lock: vi.fn() } }));
vi.mock('../../../repositories/kitchenRepository', () => ({ kitchenRepository: repo }));
vi.mock('../../../utils/audio', () => ({ playShortBeep: vi.fn() }));
import { KitchenBoard } from '../KitchenBoard';
const orders = [
  { order_id: 'a', order_number: 1, status: 'CONFIRMED', fulfillment_type: 'DINE_IN', table_label: '1', round_no: 2, created_at: '2026-11-03T10:00:00Z', items: [] },
  { order_id: 'b', order_number: 2, status: 'PREPARING', fulfillment_type: 'DELIVERY', created_at: '2026-11-03T10:00:00Z', items: [] },
] as any;
beforeEach(() => { vi.clearAllMocks(); repo.listOrders.mockResolvedValue(orders); repo.setStatus.mockResolvedValue({}); repo.subscribe.mockReturnValue(() => {}); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('KDS da equipe', () => {
  it('confirma rodada e permite só Preparando/Pronto pelos botões grandes', async () => {
    render(<KitchenBoard client={{} as any} tenantId="loja" storeName="Loja" mode="staff" initialOrders={orders} />);
    expect(screen.getByText('Mesa 1 · rodada 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preparando' }));
    await waitFor(() => expect(repo.setStatus).toHaveBeenCalledWith({}, 'a', 'PREPARING'));
    fireEvent.click(screen.getByRole('button', { name: 'Pronto' }));
    await waitFor(() => expect(repo.setStatus).toHaveBeenCalledWith({}, 'b', 'READY'));
    expect(screen.queryByText(/telefone|endereço|financeiro/i)).toBeNull();
  });
  it('assina sinais da própria loja e mantém fallback de 15 segundos', async () => {
    vi.useFakeTimers();
    await act(async () => { render(<KitchenBoard client={{} as any} tenantId="loja" storeName="Loja" mode="staff" />); });
    expect(repo.subscribe).toHaveBeenCalledWith({}, 'loja', expect.any(Function));
    expect(repo.listOrders).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(repo.listOrders).toHaveBeenCalledTimes(2);
  });
});
