// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const api = vi.hoisted(() => ({ openDisputes: vi.fn(), resolve: vi.fn(), observe: vi.fn(), markDelivered: vi.fn() }));
vi.mock('../../../repositories/deliveryRepository', () => ({ deliveryRepository: api }));
import { DeliveryDisputesPanel } from './DeliveryDisputesPanel';
const row = { id: 'dispute1', order_id: 'order1', tab_id: 'closed-tab', table_id: 'table1', table_label: 'Mesa 5', order_number: 31, created_at: '2026-11-04T01:10:00Z', status: 'OPEN' };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
beforeEach(() => { Object.values(api).forEach(m => m.mockReset()); api.observe.mockReturnValue(vi.fn()); api.resolve.mockResolvedValue(undefined); });
afterEach(cleanup);
describe('Entregas contestadas', () => {
  it.each([['Confirmar entrega', 'CONFIRMED_DELIVERED'], ['Reenviar', 'RESENT']])('resolve %s mesmo quando a comanda não está mais aberta', async (label, resolution) => {
    api.openDisputes.mockResolvedValueOnce([row]).mockResolvedValue([]);
    const changed = vi.fn();
    render(<DeliveryDisputesPanel tenantId="tenant1" onResolved={changed} />);
    expect(await screen.findByText('Mesa 5 · Pedido #31')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(api.resolve).toHaveBeenCalledWith('dispute1', resolution));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(screen.queryByText('Mesa 5 · Pedido #31')).toBeNull();
  });
  it('não mostra resposta atrasada da loja anterior e remove sua assinatura', async () => {
    let finish!: (value: typeof row[]) => void;
    const stop = vi.fn(); api.observe.mockReturnValue(stop);
    api.openDisputes.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue([]);
    const { rerender } = render(<DeliveryDisputesPanel tenantId="tenant1" />); await flush();
    rerender(<DeliveryDisputesPanel tenantId="tenant2" />); await flush();
    await act(async () => { finish([row]); });
    expect(screen.queryByText('Mesa 5 · Pedido #31')).toBeNull();
    expect(stop).toHaveBeenCalledOnce();
    expect(api.openDisputes).toHaveBeenCalledWith('tenant2');
  });
  it('realtime atualiza a fila com a mesma loja', async () => {
    api.openDisputes.mockResolvedValueOnce([]).mockResolvedValue([row]);
    render(<DeliveryDisputesPanel tenantId="tenant1" />); await flush();
    await act(async () => { api.observe.mock.calls[0][1](); });
    expect(await screen.findByText('Mesa 5 · Pedido #31')).toBeTruthy();
    expect(api.openDisputes).toHaveBeenLastCalledWith('tenant1');
  });
  it('acompanha reenvio de comanda fechada até ficar pronto e registrar nova entrega', async () => {
    api.openDisputes.mockResolvedValueOnce([row]).mockResolvedValue([{ ...row, status: 'RESENT', order_status: 'PREPARING' }]);
    api.markDelivered.mockResolvedValue(undefined);
    render(<DeliveryDisputesPanel tenantId="tenant1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reenviar' }));
    expect(await screen.findByText('Pedido reenviado · Em produção')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reenviar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Entregue' })).toBeNull();
    api.openDisputes.mockResolvedValue([{ ...row, status: 'RESENT', order_status: 'READY' }]);
    await act(async () => { api.observe.mock.calls[0][1](); });
    expect(await screen.findByText('Pedido reenviado · Pronto para entregar')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Entregue' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Entregue' }).getAttribute('title')).toBe('Aguardando balcão');
    api.openDisputes.mockResolvedValue([{ ...row, status: 'RESENT', order_status: 'OUT_FOR_DELIVERY' }]);
    await act(async () => { api.observe.mock.calls[0][1](); });
    expect((screen.getByRole('button', { name: 'Entregue' }) as HTMLButtonElement).disabled).toBe(false);
    api.openDisputes.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Entregue' }));
    await waitFor(() => expect(api.markDelivered).toHaveBeenCalledWith('order1'));
    await waitFor(() => expect(screen.queryByText('Mesa 5 · Pedido #31')).toBeNull());
  });
});
