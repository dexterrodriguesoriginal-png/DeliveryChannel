import { describe, it, expect } from 'vitest';
import {
  buildPerformanceCsv, compareMetric, computePromoPerformance, getPromoCardKind, orderPromoRevenue, previousPeriod,
  resolvePeriod, staleCheckoutCards, mapPromoOrderRow, topCardsByRevenue, usageLimitAlerts, type PromoOrder,
} from '../promoPerformance';
import type { Offer } from '../../types';

const T = 'tenant-a';
const card = (id: string, extra: Partial<Offer> = {}) => ({ id, tenantId: T, title: id, isActive: true, order: 0, ...extra }) as Offer;
const ord = (id: string, extra: Partial<PromoOrder> = {}): PromoOrder => ({
  id, tenantId: T, status: 'DELIVERED', paymentStatus: 'PAID', totalAmount: 110, deliveryFee: 10,
  createdAt: '2026-10-10T15:00:00-03:00', origin: 'promotional_checkout', redemptionNumber: 1, promoDiscount: 0, ...extra,
});
const range = { start: new Date('2026-10-01T00:00:00-03:00'), end: new Date('2026-10-15T00:00:00-03:00') };
const cards = [card('c1', { hasPromoCheckout: true }), card('c2', { productId: 'p1' }), card('c3')];

describe('resolvePeriod / previousPeriod', () => {
  const now = new Date(2026, 9, 14, 8, 30);
  it('hoje', () => { const r = resolvePeriod('today', now)!; expect(r.start).toEqual(new Date(2026, 9, 14)); expect(r.end).toEqual(new Date(2026, 9, 15)); });
  it('7 dias inclui hoje', () => { expect(resolvePeriod('7d', now)!.start).toEqual(new Date(2026, 9, 8)); });
  it('30 dias', () => { expect(resolvePeriod('30d', now)!.start).toEqual(new Date(2026, 8, 15)); });
  it('personalizado inclusivo', () => { expect(resolvePeriod('custom', now, { from: '2026-10-01', to: '2026-10-03' })!.end).toEqual(new Date(2026, 9, 4)); });
  it('personalizado inválido', () => { expect(resolvePeriod('custom', now, { from: '2026-10-05', to: '2026-10-01' })).toBeNull(); expect(resolvePeriod('custom', now, {})).toBeNull(); });
  it('período anterior tem a mesma duração e termina no início do atual', () => {
    const r = resolvePeriod('7d', now)!; const p = previousPeriod(r);
    expect(p.start).toEqual(new Date(2026, 9, 1)); expect(p.end).toEqual(r.start);
    const t = previousPeriod(resolvePeriod('today', now)!); expect(t.start).toEqual(new Date(2026, 9, 13));
  });
});

describe('computePromoPerformance (atribuição)', () => {
  it('calcula indicadores e ticket médio sem frete', () => {
    const s = computePromoPerformance({ tenantId: T, cards, range, orders: [ord('o1', { offerId: 'c1', promoDiscount: 20 }), ord('o2', { offerId: 'c1', totalAmount: 60, deliveryFee: 0, redemptionNumber: 2 })] });
    expect(s.attributedOrders).toBe(2); expect(s.revenue).toBe(160); expect(s.redemptions).toBe(2); expect(s.averageTicket).toBe(80); expect(s.discount).toBe(20);
    const r = s.rows.find(x => x.cardId === 'c1')!; expect(r.discountRatio).toBe(0.13); expect(r.averageTicket).toBe(80);
  });
  it('resgate só conta com registro do servidor', () => {
    const s = computePromoPerformance({ tenantId: T, cards, range, orders: [ord('o1', { offerId: 'c1', redemptionNumber: null }), ord('o2', { offerId: 'c1' })] });
    expect(s.attributedOrders).toBe(2); expect(s.redemptions).toBe(1);
  });
  it('deduplica o mesmo pedido', () => {
    const o = ord('o1', { offerId: 'c1' });
    expect(computePromoPerformance({ tenantId: T, cards, range, orders: [o, o, { ...o }] }).attributedOrders).toBe(1);
  });
  it('exclui cancelados e estornados de pedidos, faturamento, resgates e desconto', () => {
    const s = computePromoPerformance({ tenantId: T, cards, range, orders: [
      ord('o1', { offerId: 'c1', status: 'CANCELLED', promoDiscount: 5 }), ord('o2', { offerId: 'c1', paymentStatus: 'REFUNDED' }), ord('o3', { offerId: 'c1' })] });
    expect(s.attributedOrders).toBe(1); expect(s.revenue).toBe(100); expect(s.redemptions).toBe(1); expect(s.discount).toBe(0); expect(s.cancelledOrRefunded).toBe(2);
    expect(s.rows.find(r => r.cardId === 'c1')!.cancelledOrders).toBe(2);
  });
  it('não atribui vendas comuns do produto divulgado', () => {
    const s = computePromoPerformance({ tenantId: T, cards, range, orders: [ord('o1', { origin: 'direct' })] });
    expect(s.attributedOrders).toBe(0); expect(s.averageTicket).toBeNull(); expect(s.rows.find(r => r.cardId === 'c2')!.orders).toBeNull();
  });
  it('card apenas visual não recebe faturamento nem desconto', () => {
    const row = computePromoPerformance({ tenantId: T, cards, range, orders: [] }).rows.find(r => r.cardId === 'c3')!;
    expect(row.kind).toBe('BANNER_ONLY'); expect(row.revenue).toBeNull(); expect(row.discount).toBeNull();
  });
  it('isola lojas', () => {
    const s = computePromoPerformance({ tenantId: T, range,
      cards: [...cards, card('x1', { hasPromoCheckout: true, tenantId: 'tenant-b' })],
      orders: [ord('o1', { offerId: 'c1', tenantId: 'tenant-b' }), ord('o2', { offerId: 'x1' })] });
    expect(s.attributedOrders).toBe(0); expect(s.unattributedPromoOrders).toBe(1); expect(s.rows.some(r => r.cardId === 'x1')).toBe(false);
  });
  it('respeita os limites do período', () => {
    const s = computePromoPerformance({ tenantId: T, cards, range, orders: [
      ord('o1', { offerId: 'c1', createdAt: '2026-09-30T23:59:00-03:00' }), ord('o2', { offerId: 'c1', createdAt: '2026-10-15T00:00:00-03:00' }), ord('o3', { offerId: 'c1', createdAt: '2026-10-01T00:00:00-03:00' })] });
    expect(s.attributedOrders).toBe(1);
  });
  it('tipos e receita não negativa', () => {
    expect(getPromoCardKind({ destinationType: 'PRODUCT' } as Offer)).toBe('PRODUCT');
    expect(getPromoCardKind({ hasPromoCheckout: true } as Offer)).toBe('CUSTOM_OFFER');
    expect(orderPromoRevenue({ totalAmount: 5, deliveryFee: 10 })).toBe(0);
  });
});

describe('ideia 1: comparação com período anterior', () => {
  it('setas e percentuais', () => {
    expect(compareMetric(150, 100)).toEqual({ direction: 'up', pct: 50 });
    expect(compareMetric(50, 100)).toEqual({ direction: 'down', pct: -50 });
    expect(compareMetric(100, 100)).toEqual({ direction: 'flat', pct: 0 });
  });
  it('sem base quando anterior é zero ou inexistente (não inventa %)', () => {
    expect(compareMetric(10, 0).direction).toBe('none'); expect(compareMetric(null, 5).pct).toBeNull(); expect(compareMetric(5, null).direction).toBe('none');
  });
});

describe('ideia 2: top 3 e cards sem venda', () => {
  it('top 3 por faturamento ignora cards sem faturamento e n/a', () => {
    const cs = [card('a', { hasPromoCheckout: true }), card('b', { hasPromoCheckout: true }), card('c', { hasPromoCheckout: true }), card('d', { hasPromoCheckout: true }), card('v')];
    const s = computePromoPerformance({ tenantId: T, cards: cs, range, orders: [
      ord('1', { offerId: 'a', totalAmount: 30, deliveryFee: 0 }), ord('2', { offerId: 'b', totalAmount: 90, deliveryFee: 0 }),
      ord('3', { offerId: 'c', totalAmount: 60, deliveryFee: 0 }), ord('4', { offerId: 'd', totalAmount: 10, deliveryFee: 0 })] });
    expect(topCardsByRevenue(s.rows).map(r => r.cardId)).toEqual(['b', 'c', 'a']);
    expect(topCardsByRevenue(computePromoPerformance({ tenantId: T, cards: cs, range, orders: [] }).rows)).toEqual([]);
  });
  it('alerta só cards de checkout ativos há ≥7 dias sem venda válida nos últimos 7 dias', () => {
    const now = new Date('2026-10-14T12:00:00-03:00');
    const cs = [
      card('vende', { hasPromoCheckout: true, createdAt: '2026-09-01T00:00:00Z' }),
      card('parado', { hasPromoCheckout: true, createdAt: '2026-09-01T00:00:00Z' }),
      card('so-cancelado', { hasPromoCheckout: true, createdAt: '2026-09-01T00:00:00Z' }),
      card('novo', { hasPromoCheckout: true, createdAt: '2026-10-12T00:00:00Z' }),
      card('pausado', { hasPromoCheckout: true, createdAt: '2026-09-01T00:00:00Z', isActive: false }),
      card('visual', { createdAt: '2026-09-01T00:00:00Z' }),
      card('outra-loja', { hasPromoCheckout: true, createdAt: '2026-09-01T00:00:00Z', tenantId: 'tenant-b' }),
    ];
    const orders = [ord('1', { offerId: 'vende', createdAt: '2026-10-12T10:00:00-03:00' }), ord('2', { offerId: 'so-cancelado', createdAt: '2026-10-12T10:00:00-03:00', status: 'CANCELLED' }), ord('3', { offerId: 'parado', createdAt: '2026-10-01T10:00:00-03:00' })];
    const stale = staleCheckoutCards({ tenantId: T, cards: cs, orders, now, isLive: c => c.isActive });
    expect(stale.map(c => c.id).sort()).toEqual(['parado', 'so-cancelado']);
  });
});

describe('ideia 3: limite de usos ≥ 90%', () => {
  it('usa o contador real e o limite configurado', () => {
    const a = usageLimitAlerts([
      card('a', { hasPromoCheckout: true, promoUsageLimit: 10, promoTimesUsed: 9 }),
      card('b', { hasPromoCheckout: true, promoUsageLimit: 10, promoTimesUsed: 8 }),
      card('c', { hasPromoCheckout: true, promoUsageLimit: 5, promoTimesUsed: 5 }),
      card('d', { hasPromoCheckout: true, promoTimesUsed: 500 }),
      card('e', { promoUsageLimit: 1, promoTimesUsed: 1 }),
    ]);
    expect(a.map(x => x.card.id)).toEqual(['c', 'a']); expect(a[0].exhausted).toBe(true); expect(a[1].pct).toBe(90);
  });
});

describe('ideia 4/5: CSV com desconto × faturamento', () => {
  it('gera CSV pt-BR com n/a para métricas não aplicáveis e escapa campos', () => {
    const cs = [card('c1', { hasPromoCheckout: true, title: 'Combo; "Top"', promoUsageLimit: 10, promoTimesUsed: 3 }), card('c3', { title: '=HYPERLINK()' })];
    const s = computePromoPerformance({ tenantId: T, cards: cs, range, orders: [ord('o1', { offerId: 'c1', promoDiscount: 25 })] });
    const csv = buildPerformanceCsv({ cards: cs, rows: s.rows, range, statusLabel: () => 'Ativo' });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('01/10/2026 a 14/10/2026;c1;"Combo; ""Top""";Checkout promocional;Ativo;1;0;100,00;100,00;1;25,00;0,25;3;10');
    expect(lines[2]).toContain(`"'=HYPERLINK()";Apenas visual;Ativo;n/a;n/a;n/a;n/a;n/a;n/a;n/a;n/a;n/a`);
  });
});

describe('mapPromoOrderRow (contrato com orders/order_items da 026)', () => {
  it('lê origem, resgate do servidor e desconto apenas dos itens do card', () => {
    const o = mapPromoOrderRow({ id: 'o', tenant_id: T, status: 'PENDING', payment_status: 'PENDING', total_amount: '80.00', delivery_fee: '0', discount: '5', created_at: 'x',
      origin: 'promotional_checkout', offer_id: 'c1', campaign_metadata: { redemption_number: 3 },
      order_items: [{ offer_id: 'c1', discount_amount: '20.00' }, { offer_id: null, discount_amount: '7' }] });
    expect(o.offerId).toBe('c1'); expect(o.redemptionNumber).toBe(3); expect(o.promoDiscount).toBe(25);
  });
  it('base sem 026: sem offer_id e sem resgate', () => {
    const o = mapPromoOrderRow({ id: 'o', tenant_id: T, status: 'PENDING', payment_status: 'PAID', total_amount: 10, delivery_fee: 0, created_at: 'x' });
    expect(o.offerId).toBeUndefined(); expect(o.redemptionNumber).toBeNull(); expect(o.promoDiscount).toBe(0);
  });
});
