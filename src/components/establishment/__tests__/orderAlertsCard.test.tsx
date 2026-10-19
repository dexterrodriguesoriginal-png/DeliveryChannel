import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderAlertsCard } from '../dashboard/OrderAlertsCard';
import { buildOrderAlerts } from '../../../lib/orders/orderAlerts';

const NOW = Date.now();
const o = (id: string, status: string, agoMin: number, extra: Record<string, unknown> = {}) => ({
  id, orderNumber: Number(id.replace(/\D/g, '')) || 1, status, createdAt: new Date(NOW - agoMin * 60000).toISOString(),
  fulfillmentType: 'DELIVERY', items: [{ productId: 'p', productName: 'Picanha', quantity: 2, unitPrice: 30, totalPrice: 60 }],
  totalAmount: 60, customerName: 'Dona Cleusa', customerPhone: '11988887777', deliveryAddress: 'Rua A, 1', paymentMethod: 'CASH', ...extra,
}) as any;
const render = (orders: any[], role: any, extra: Record<string, unknown> = {}) => renderToStaticMarkup(
  <OrderAlertsCard alerts={buildOrderAlerts(orders, { prepMinutes: 30 })} role={role} onStep={vi.fn()} onCancel={vi.fn()} onView={vi.fn()} {...extra} />);

describe('OrderAlertsCard (Dashboard)', () => {
  it('estado vazio em pt-BR', () => {
    const html = render([], 'OWNER');
    expect(html).toContain('data-testid="alerts-empty"');
    expect(html).toContain('Nenhum pedido esperando');
  });
  it('dono vê um botão de próxima etapa por pedido + Recusar/Ver pedido; dados do pedido completos', () => {
    const html = render([o('o1', 'PENDING', 1), o('o2', 'CONFIRMED', 5), o('o3', 'PREPARING', 5), o('o4', 'READY', 5), o('o5', 'READY', 5, { fulfillmentType: 'PICKUP' })], 'OWNER');
    for (const step of ['accept', 'start', 'ready', 'call_driver', 'pickup_done']) expect(html).toContain(`data-step="${step}"`);
    for (const label of ['Aceitar', 'Iniciar preparo', 'Marcar como pronto', 'Chamar entregador', 'Confirmar retirada', 'Recusar', 'Ver pedido']) expect(html).toContain(label);
    expect(html).toContain('Dona Cleusa');
    expect(html).toContain('https://wa.me/5511988887777');
    expect(html).toContain('2x Picanha');
    expect(html).toContain('Retirada no local');
    expect(html).toContain('Dinheiro');
  });
  it('atrasado aparece na seção Atrasados; selo de estoque baixo', () => {
    const html = render([o('o9', 'PREPARING', 45)], 'OWNER', { lowStockCount: 3 });
    expect(html).toContain('data-testid="alerts-late"');
    expect(html).toContain('3 produtos acabando');
  });
  it('papel sem permissão (gestão de entregas) não vê Aceitar nem Recusar', () => {
    const html = render([o('o1', 'PENDING', 1)], 'DELIVERY_MANAGER');
    expect(html).not.toContain('data-testid="alert-next-step"');
    expect(html).not.toContain('data-testid="alert-cancel"');
    expect(html).toContain('Ver pedido');
  });
  it('aguardando entregador: sem botão, com aviso; pedido recém-chegado destacado', () => {
    const html = render([o('o7', 'WAITING_FOR_DRIVER', 3), o('o8', 'PENDING', 0)], 'OWNER', { highlightIds: new Set(['o8']) });
    expect(html).toContain('Aguardando um entregador aceitar');
    expect(html).toContain('NOVO');
  });
});
