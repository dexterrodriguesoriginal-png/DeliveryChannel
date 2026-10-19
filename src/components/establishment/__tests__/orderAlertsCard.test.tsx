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
  <OrderAlertsCard alerts={buildOrderAlerts(orders, { prepMinutes: 30 })} role={role} onStep={vi.fn()} onView={vi.fn()} {...extra} />);

describe('OrderAlertsCard (Dashboard, faixa compacta)', () => {
  it('estado vazio: só a faixa com "Nenhum pedido pendente", chips zerados e sem lista', () => {
    const html = render([], 'OWNER', { onViewAll: vi.fn() });
    expect(html).toContain('data-testid="alerts-empty"');
    expect(html).toContain('Nenhum pedido pendente');
    expect(html).not.toContain('data-testid="alert-order"');
    for (const k of ['novos', 'emPreparo', 'prontos', 'atrasados']) expect(html).toContain(`data-testid="alert-chip-${k}" data-count="0"`);
    expect(html).toContain('Ver pedidos');
  });
  it('dono vê no máximo 3 linhas, cada uma com próximo passo, dados do pedido e olho; "+N pedidos"', () => {
    const html = render([o('o1', 'PENDING', 1), o('o2', 'CONFIRMED', 5), o('o3', 'PREPARING', 5), o('o4', 'READY', 5), o('o5', 'READY', 5, { fulfillmentType: 'PICKUP' })], 'OWNER', { onViewAll: vi.fn() });
    expect(html.match(/data-testid="alert-order"/g)).toHaveLength(3);
    // ordem: novos, prontos (entrega, retirada), em preparo
    for (const step of ['accept', 'call_driver', 'pickup_done']) expect(html).toContain(`data-step="${step}"`);
    for (const label of ['Aceitar', 'Chamar entregador', 'Confirmar retirada', 'Ver pedido']) expect(html).toContain(label);
    expect(html).toContain('+2 pedidos');
    expect(html).toContain('Dona Cleusa');
    expect(html).toContain('https://wa.me/5511988887777');
    expect(html).toContain('2x Picanha');
    expect(html).toContain('Retirada');
    expect(html).toContain('Dinheiro');
    expect(html).toContain('data-testid="alert-chip-novos" data-count="1"');
    expect(html).toContain('data-testid="alert-chip-emPreparo" data-count="2"');
    expect(html).toContain('data-testid="alert-chip-prontos" data-count="2"');
    // Recusar/Cancelar saem da linha (ficam na tela do pedido)
    expect(html).not.toContain('Recusar');
    expect(html).not.toContain('data-testid="alert-cancel"');
  });
  it('maxRows maior mostra todas as etapas (Iniciar preparo, Marcar como pronto)', () => {
    const html = render([o('o2', 'CONFIRMED', 5), o('o3', 'PREPARING', 5)], 'OWNER');
    expect(html).toContain('Iniciar preparo');
    expect(html).toContain('Marcar como pronto');
    expect(html).not.toContain('data-testid="alerts-more"');
  });
  it('atrasado conta no chip Atrasados; chip de estoque baixo só com acesso ao estoque', () => {
    const html = render([o('o9', 'PREPARING', 45)], 'OWNER', { lowStockCount: 3, onGoInventory: vi.fn() });
    expect(html).toContain('data-testid="alert-chip-atrasados" data-count="1"');
    expect(html).toContain('data-testid="alert-chip-estoque" data-count="3"');
    expect(html).toContain('Estoque baixo');
    expect(render([o('o9', 'PREPARING', 45)], 'OWNER', { lowStockCount: 3 })).not.toContain('alert-chip-estoque');
  });
  it('papel sem permissão (gestão de entregas) não vê botão de etapa, só o olho', () => {
    const html = render([o('o1', 'PENDING', 1)], 'DELIVERY_MANAGER');
    expect(html).not.toContain('data-testid="alert-next-step"');
    expect(html).toContain('data-testid="alert-view"');
  });
  it('aguardando entregador: sem botão, com aviso; pedido recém-chegado destacado; bairro curto', () => {
    const html = render([
      o('o7', 'WAITING_FOR_DRIVER', 3, { deliveryAddress: 'Rua Italo Martinelli, 138 - Vila Silviânia, Carapicuíba' }),
      o('o8', 'PENDING', 0),
    ], 'OWNER', { highlightIds: new Set(['o8']) });
    expect(html).toContain('Aguardando um entregador aceitar');
    expect(html).toContain('NOVO');
    expect(html).toContain('Vila Silviânia');
  });
});
