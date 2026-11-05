import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderAlertsCard } from '../dashboard/OrderAlertsCard';
import { buildOrderAlerts } from '../../../lib/orders/orderAlerts';
import { statusColorTokens } from '../../../lib/orders/statusColors';

const NOW = Date.now();
const o = (id: string, status: string, agoMin: number, extra: Record<string, unknown> = {}) => ({
  id, orderNumber: Number(id.replace(/\D/g, '')) || 1, status, createdAt: new Date(NOW - agoMin * 60000).toISOString(),
  fulfillmentType: 'DELIVERY', items: [{ productId: 'p', productName: 'Picanha', quantity: 2, unitPrice: 30, totalPrice: 60 }],
  totalAmount: 60, customerName: 'Dona Cleusa', customerPhone: '11988887777', deliveryAddress: 'Rua A, 1', paymentMethod: 'CASH', ...extra,
}) as any;
const render = (orders: any[], role: any, extra: Record<string, unknown> = {}) => renderToStaticMarkup(
  <OrderAlertsCard alerts={buildOrderAlerts(orders, { prepMinutes: 30 })} role={role} onStep={vi.fn()} onView={vi.fn()} {...extra} />);

describe('OrderAlertsCard (Dashboard, faixa compacta)', () => {
  it.each(['PENDING', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'])('linha %s usa a mesma paleta de Pedidos e garçom', status => {
    const html = render([o('o1', status, 1, { fulfillmentType: 'DINE_IN' })], 'OWNER', { highlightIds: new Set(['o1']) });
    const row = html.match(/<li[^>]*data-testid="alert-order"[^>]*>/)?.[0];
    const colors = statusColorTokens(status);
    expect(row).toContain(`background-color:${colors.alertBg}`);
    expect(row).toContain(`color:${colors.fg}`);
    expect(row).toContain(`border-color:${colors.border}`);
    expect(row).not.toContain('ring-blue');
    if (status === 'OUT_FOR_DELIVERY') expect(html).toContain('Servido · aguardando entrega na mesa');
  });
  it('atrasado usa vermelho canônico e entregue ou cancelado sai dos alertas', () => {
    const html = render([o('o1', 'PREPARING', 45), o('o2', 'DELIVERED', 1), o('o3', 'CANCELLED', 1)], 'OWNER');
    expect(html.match(/<li[^>]*data-testid="alert-order"[^>]*>/)?.[0]).toContain(`background-color:${statusColorTokens('LATE').bg}`);
    expect(html).not.toContain('data-order-id="o2"');
    expect(html).not.toContain('data-order-id="o3"');
    const preparing = render([o('o1', 'PREPARING', 1)], 'OWNER');
    expect(preparing.match(/<div[^>]*data-testid="order-alerts-card"[^>]*>/)?.[0]).toContain(`background-color:${statusColorTokens('PREPARING').alertBg}`);
    const mixed = render([o('o1', 'READY', 1, { fulfillmentType: 'DINE_IN' }), o('o2', 'PENDING', 1)], 'OWNER');
    expect(mixed.match(/<div[^>]*data-testid="order-alerts-card"[^>]*>/)?.[0]).toContain(`background-color:${statusColorTokens('PENDING').alertBg}`);
  });
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
  it('pedido de mesa pronto exibe Ver pedido e nunca abre rota do salão ou chama entregador', () => {
    const html = render([
      o('o46', 'READY', 5, { orderNumber: 46, fulfillmentType: 'DINE_IN', tableLabel: 'Mesa 04', deliveryAddress: '' }),
    ], 'OWNER');
    expect(html).toContain('Mesa 04 · Salão');
    expect(html).toContain('Ver pedido');
    expect(html).not.toContain('Abrir mesa');
    expect(html).not.toContain('data-step="open_table"');
    expect(html).not.toContain('Chamar entregador');
    expect(html).toContain('AGUARDANDO GARÇOM');
  });
});

 it('mesa aguardando oferece Ver pedido e Aceitar pedido; confirmada envia para produção', () => {
   const pending = render([o('o80','PENDING',1,{fulfillmentType:'DINE_IN',tableLabel:'Mesa 08'})], 'OWNER');
   expect(pending).toContain('Ver pedido'); expect(pending).toContain('Aceitar pedido');
   expect(pending).toContain('data-step="accept"'); expect(pending).not.toContain('Abrir mesa');
   const confirmed = render([o('o81','CONFIRMED',1,{fulfillmentType:'DINE_IN',tableLabel:'Mesa 08'})], 'OWNER');
   expect(confirmed).toContain('Ver pedido'); expect(confirmed).toContain('Enviar p/ produção');
   expect(confirmed).toContain('data-step="start"');
 });

