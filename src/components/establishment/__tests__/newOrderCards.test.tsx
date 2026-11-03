// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NewOrderCards } from '../dashboard/NewOrderCards';
import { newOrderIds, updateNewOrderQueue } from '../../../lib/orders/orderAlerts';
import type { Order } from '../../../types';

const order = (id: string, extra: Partial<Order> = {}): Order => ({
  id, orderNumber: Number(id), status: 'PENDING', fulfillmentType: 'DELIVERY',
  createdAt: new Date(2026, 10, 3, 10, Number(id)).toISOString(), items: [], ...extra,
} as Order);
afterEach(cleanup);

describe('Fila de cards por pedido', () => {
  it('primeira leitura é silenciosa; três chegadas seguidas preservam três cards', () => {
    const initial = order('1');
    expect(newOrderIds(null, [initial])).toEqual([]);
    const seen = new Set([initial.id]);
    let queue: Order[] = [];
    const all = [initial];
    for (const id of ['2', '3', '4']) {
      all.push(order(id));
      queue = updateNewOrderQueue(queue, all, newOrderIds(seen, all));
      all.forEach(o => seen.add(o.id));
    }
    const ui = render(<NewOrderCards orders={queue} role="OWNER" onAccept={vi.fn()} onView={vi.fn()} onDismiss={vi.fn()} />);
    expect(ui.getAllByTestId('new-order-card')).toHaveLength(3);
    expect(ui.getAllByRole('button', { name: 'Aceitar pedido' })).toHaveLength(3);
    expect(ui.getAllByTestId('new-order-card')[0].getAttribute('data-order-id')).toBe('4');
  });
  it('rodada CONFIRMED ganha card com Ver mesa e Enviado à cozinha', () => {
    const round = order('2', { status: 'CONFIRMED', fulfillmentType: 'DINE_IN', tableLabel: '02' });
    const fresh = newOrderIds(new Set(['1']), [round]);
    const view = vi.fn();
    const ui = render(<NewOrderCards orders={updateNewOrderQueue([], [round], fresh)} role="OWNER" onAccept={vi.fn()} onView={view} onDismiss={vi.fn()} />);
    expect(ui.getByText('Enviado à cozinha')).toBeTruthy();
    expect(ui.queryByRole('button', { name: 'Aceitar pedido' })).toBeNull();
    fireEvent.click(ui.getByRole('button', { name: 'Ver mesa' }));
    expect(view).toHaveBeenCalledWith(round);
  });
  it('limita a três e +N; fechar remove só aquele card, aceitar remove o PENDING quando status muda', () => {
    const orders = ['1', '2', '3', '4'].map(id => order(id));
    const dismiss = vi.fn();
    const accept = vi.fn();
    const ui = render(<NewOrderCards orders={orders} role="OWNER" onAccept={accept} onView={vi.fn()} onDismiss={dismiss} />);
    expect(ui.getAllByTestId('new-order-card')).toHaveLength(3);
    expect(ui.getByTestId('new-orders-more').textContent).toBe('+1 pedido');
    fireEvent.click(ui.getByRole('button', { name: 'Fechar aviso do pedido 2' }));
    expect(dismiss).toHaveBeenCalledWith('2');
    fireEvent.click(ui.getAllByRole('button', { name: 'Aceitar pedido' })[0]);
    expect(accept).toHaveBeenCalledWith(orders[0]);
    const accepted = orders.map(o => o.id === '1' ? { ...o, status: 'CONFIRMED' as const } : o);
    expect(updateNewOrderQueue(orders, accepted, []).map(o => o.id)).not.toContain('1');
    expect(newOrderIds(new Set(orders.map(o => o.id)), accepted)).toEqual([]);
  });
  it('não perde IDs já vistos quando um pedido sai da consulta e retorna', () => {
    const seen = new Set(['1', '2']);
    expect(newOrderIds(seen, [order('2')])).toEqual([]);
    expect(newOrderIds(seen, [order('1'), order('2')])).toEqual([]);
    expect(newOrderIds(seen, [order('3', { awaitingOnlinePayment: true })])).toEqual([]);
  });
});
