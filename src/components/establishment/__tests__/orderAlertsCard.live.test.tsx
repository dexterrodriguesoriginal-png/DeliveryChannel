// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { OrderAlertsCard } from '../dashboard/OrderAlertsCard';
import { buildOrderAlerts } from '../../../lib/orders/orderAlerts';

const order = (status: string) => ({
  id: 'o1', orderNumber: 60, status, createdAt: new Date().toISOString(), fulfillmentType: 'DINE_IN',
  items: [], totalAmount: 10, customerName: 'Cliente', paymentMethod: 'CASH',
}) as any;
const card = (status: string) => <OrderAlertsCard alerts={buildOrderAlerts([order(status)], { prepMinutes: 30 })} role={'OWNER' as any} onStep={vi.fn()} onView={vi.fn()} />;

describe('Alertas de pedidos muda de cor ao vivo (Entrega 1.5)', () => {
  it('vermelho → laranja → roxo conforme o status avança', () => {
    const r = render(card('CONFIRMED'));
    const bg = () => (r.getByTestId('alert-order') as HTMLElement).style.backgroundColor.toLowerCase();
    const first = bg();
    r.rerender(card('PREPARING'));
    const second = bg();
    r.rerender(card('READY'));
    const third = bg();
    expect(new Set([first, second, third]).size).toBe(3);
    expect([first, second, third].join('|')).toMatch(/(#fbd5d5|251, 213, 213).*\|.*(#fee2cc|254, 226, 204).*\|.*(#ecdcfc|236, 220, 252)/);
  });
});

