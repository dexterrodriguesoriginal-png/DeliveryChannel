// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DineInDeliveryNotice, DineInTracking } from './DineInTracking';

const deliveredAt = '2026-11-04T12:00:00.000Z';
const round = { orderId: 'o1', orderNumber: 12, roundNo: 1, status: 'DELIVERED', createdAt: '2026-11-04T11:50:00.000Z', deliveredAt, canDisputeDelivery: true };
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('aviso de entrega no cardápio', () => {
  it('oferece Não recebi e o retira após 5 minutos, mesmo sem novo polling', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(deliveredAt));
    const onDispute = vi.fn();
    render(<DineInDeliveryNotice round={round} onDispute={onDispute} />);
    expect(screen.getByText('Seu pedido foi entregue')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Não recebi' }));
    expect(onDispute).toHaveBeenCalledWith('o1');
    act(() => vi.advanceTimersByTime(5 * 60 * 1000));
    expect(screen.queryByRole('button', { name: 'Não recebi' })).toBeNull();
    expect(screen.getByText('Pedido recebido')).toBeTruthy();
  });

  it('respeita recusa do servidor e atualizações de disputa e reenvio', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(deliveredAt));
    const view = render(<DineInDeliveryNotice round={{ ...round, canDisputeDelivery: false }} onDispute={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Não recebi' })).toBeNull();
    view.rerender(<DineInDeliveryNotice round={{ ...round, deliveryDispute: { id: 'd1', status: 'OPEN', createdAt: deliveredAt } }} onDispute={vi.fn()} />);
    expect(screen.getByText('Entrega em verificação')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Não recebi' })).toBeNull();
    view.rerender(<DineInDeliveryNotice round={{ ...round, status: 'PREPARING', deliveredAt: null, deliveryDispute: { id: 'd1', status: 'RESENT', createdAt: deliveredAt } }} onDispute={vi.fn()} />);
    expect(screen.getByText('Pedido reenviado para produção')).toBeTruthy();
  });

  it('balão some quando todas as rodadas terminam e reaparece em um novo pedido da mesma conta', () => {
    const second = { ...round, orderId: 'o2', orderNumber: 13, roundNo: 2, status: 'PREPARING', deliveredAt: null };
    const view = render(<DineInTracking rounds={[round, second]} />);
    expect(screen.getByTestId('dinein-track-order').textContent).toContain('Preparando seu pedido');
    view.rerender(<DineInTracking rounds={[round, { ...second, status: 'DELIVERED' }]} />);
    expect(screen.queryByTestId('dinein-track-order')).toBeNull();
    view.rerender(<DineInTracking rounds={[round, { ...second, status: 'CANCELLED' }]} />);
    expect(screen.queryByTestId('dinein-track-order')).toBeNull();
    view.rerender(<DineInTracking rounds={[round, { ...second, status: 'CANCELLED' }, { ...second, orderId: 'o3', roundNo: 3, status: 'PENDING' }]} />);
    expect(screen.getByTestId('dinein-track-order').textContent).toContain('Aguardando');
    fireEvent.click(screen.getByTestId('dinein-track-order'));
    expect(screen.getByText('Cancelado', { selector: 'p' }).style.color).toBe('#374151');
  });
});
