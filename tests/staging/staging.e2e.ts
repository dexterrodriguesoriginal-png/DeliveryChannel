/**
 * E2E REAL no STAGING: repositórios do frontend → supabase-js → API do projeto de staging (Auth, PostgREST,
 * Storage). Login real por papel. Dados SINTÉTICOS do scripts/staging/sql/seed_synthetic.sql. Sem mocks de RPC.
 * Cria pedidos/campanhas/mídia sintéticos (nunca apaga nada).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../src/lib/supabase', async () => {
  const m = await import('./stagingClient');
  return { supabase: m.stagingSupabase, isSupabaseConfigured: true, ensureValidSession: async () => true };
});

import { loginAs, USERS, stagingSupabase as sb } from './stagingClient';
import { orderRepository } from '../../src/repositories/orderRepository';
import { tenantRepository } from '../../src/repositories/tenantRepository';
import { publicStoreRepository } from '../../src/repositories/publicStoreRepository';
import { promotionRepository } from '../../src/repositories/promotionRepository';
import { offerRepository } from '../../src/repositories/offerRepository';
import { campaignRepository } from '../../src/repositories/campaignRepository';
import { promoPerformanceRepository } from '../../src/repositories/promoPerformanceRepository';
import { isN1N6Backend } from '../../src/lib/backendSchema';
import { newIdempotencyKey } from '../../src/lib/backend';

const TA = '5a000000-0000-4000-8000-00000000000a';
const TB = '5a000000-0000-4000-8000-00000000000b';
const SLUG_A = 'stg-adega-a';
const P1 = '5b000000-0000-4000-8000-0000000000a1'; // 10,00
const P_STOCK1 = '5b000000-0000-4000-8000-0000000000a3'; // estoque 1
const PB = '5b000000-0000-4000-8000-0000000000b1';
const uid: Record<string, string> = {};
const ctx = (u: keyof typeof USERS, role: string, t = TA) => ({ userId: uid[u], userRole: role as any, userName: 'stg', tenantId: t });
const checkout = (extra: Record<string, unknown> = {}) => ({
  customerName: 'Cliente Sintético', customerPhone: '11900009999', deliveryAddress: 'Rua Sintética, 10',
  items: [{ productId: P1, quantity: 2 }], paymentMethod: 'PIX' as const, fulfillmentType: 'DELIVERY' as const,
  origin: 'storefront' as any, idempotencyKey: newIdempotencyKey(), ...extra,
});
const stock = async (id: string) => (await sb.from('products').select('stock_quantity').eq('id', id).single()).data?.stock_quantity;

beforeAll(async () => {
  expect(isN1N6Backend()).toBe(true);
  for (const k of Object.keys(USERS) as (keyof typeof USERS)[]) uid[k] = (await loginAs(USERS[k]))!;
});

describe('E1 login real e autorização por papel', () => {
  it('todos os usuários sintéticos autenticam (auth.uid() real)', () => {
    for (const k of Object.keys(USERS)) expect(uid[k]).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('anônimo não lê pedidos; DRIVER/OPERATOR não gerenciam cupons; CASHIER não acessa campanhas', async () => {
    await loginAs(null);
    expect((await sb.from('orders').select('id').limit(1)).data ?? []).toEqual([]);
    for (const u of ['driverA', 'operatorA', 'cashierA'] as const) {
      await loginAs(USERS[u]);
      await expect(promotionRepository.createCoupon(ctx(u, u.replace(/A$/, '').toUpperCase()), TA,
        { code: `X${Date.now()}`, discountType: 'FIXED_AMOUNT', discountValue: 1 } as any)).rejects.toBeTruthy();
    }
    await loginAs(USERS.cashierA);
    expect(await campaignRepository.listCampaigns(TA).catch(() => [])).toEqual([]);
  });
});

describe('E2 isolamento entre lojas', () => {
  it('OWNER A não lê pedidos/produtos de B nem grava em B', async () => {
    await loginAs(USERS.ownerA);
    expect(await orderRepository.getOrders(ctx('ownerA', 'OWNER', TB), TB).catch(() => [])).toEqual([]);
    expect((await sb.from('products').select('id').eq('id', PB)).data ?? []).toEqual([]);
    const ins = await sb.from('products').insert({ tenant_id: TB, name: 'Invasão', image_url: '/x.png', price: 1, stock_quantity: 1 });
    expect(ins.error).toBeTruthy();
    expect(await campaignRepository.listCampaigns(TB).catch(() => [])).toEqual([]);
  });
  it('cliente 2 não lê pedido do cliente 1', async () => {
    await loginAs(USERS.c1);
    const o = await orderRepository.createPublicOrder(SLUG_A, checkout());
    await loginAs(USERS.c2);
    await expect(orderRepository.getOrderPixPayload(o.id)).rejects.toBeTruthy();
    const r = await sb.rpc('get_customer_order_by_id', { p_order_id: o.id });
    expect(r.error || !r.data || (Array.isArray(r.data) && r.data.length === 0)).toBeTruthy();
  });
});

describe('E3 produtos e estoque', () => {
  it('OWNER cria produto e consulta; MANAGER lê', async () => {
    await loginAs(USERS.ownerA);
    const name = `STG E2E ${Date.now()}`;
    const ins = await sb.from('products').insert({ tenant_id: TA, name, image_url: '/demo/padaria-do-joao-logo.svg', price: 9.9, stock_quantity: 5 }).select('id').single();
    expect(ins.error).toBeNull();
    await loginAs(USERS.managerA);
    expect((await sb.from('products').select('name').eq('id', ins.data!.id).single()).data?.name).toBe(name);
  });
});

describe('E4 checkout normal, cupom, PIX, cancelamento/estorno', () => {
  it('anônimo não compra', async () => {
    await loginAs(null);
    await expect(orderRepository.createPublicOrder(SLUG_A, checkout())).rejects.toBeTruthy();
  });
  it('totais do servidor, cupom STGDEZ, idempotência', async () => {
    await loginAs(USERS.c2);
    const key = newIdempotencyKey();
    const a = await orderRepository.createPublicOrder(SLUG_A, checkout({ idempotencyKey: key, couponCode: 'STGDEZ' }));
    const b = await orderRepository.createPublicOrder(SLUG_A, checkout({ idempotencyKey: key, couponCode: 'STGDEZ' }));
    expect(b.id).toBe(a.id);
    expect(a.subtotal).toBe(20);
    expect(a.discount).toBe(2);
  });
  it('cupom de outra loja é recusado', async () => {
    await loginAs(USERS.c2);
    const r = await orderRepository.validateCoupon({ slug: SLUG_A }, 'STGB', [{ productId: P1, quantity: 1 }]).catch(e => e);
    expect(r.valid === false || r.code || r instanceof Error).toBeTruthy();
  });
  it('PIX: BR Code só do próprio pedido', async () => {
    await loginAs(USERS.c1);
    const o = await orderRepository.createPublicOrder(SLUG_A, checkout());
    const pix = await orderRepository.getOrderPixPayload(o.id);
    expect(pix.brcode).toMatch(/^000201/);
  });
  it('estoque 1: segunda unidade recusada; cancelamento devolve estoque; cancelado não reabre', async () => {
    await loginAs(USERS.ownerA);
    const before = await stock(P_STOCK1);
    await loginAs(USERS.c1);
    await expect(orderRepository.createPublicOrder(SLUG_A, checkout({ items: [{ productId: P_STOCK1, quantity: (before ?? 1) + 1 }] }))).rejects.toBeTruthy();
    const o = await orderRepository.createPublicOrder(SLUG_A, checkout({ items: [{ productId: P_STOCK1, quantity: 1 }] }));
    await loginAs(USERS.ownerA);
    expect(await stock(P_STOCK1)).toBe((before ?? 1) - 1);
    await orderRepository.updateStatus(ctx('ownerA', 'OWNER'), TA, o.id, 'CANCELLED', 'teste E2E staging');
    expect(await stock(P_STOCK1)).toBe(before);
    await expect(orderRepository.updateStatus(ctx('ownerA', 'OWNER'), TA, o.id, 'PENDING')).rejects.toBeTruthy();
  });
  it('CASHIER marca PAGO, não estorna; OWNER estorna com motivo', async () => {
    await loginAs(USERS.c2);
    const o = await orderRepository.createPublicOrder(SLUG_A, checkout());
    await loginAs(USERS.cashierA);
    expect((await orderRepository.updatePaymentStatus(ctx('cashierA', 'CASHIER'), TA, o.id, 'PAID')).paymentStatus).toBe('PAID');
    await expect(orderRepository.updatePaymentStatus(ctx('cashierA', 'CASHIER'), TA, o.id, 'REFUNDED', 'x')).rejects.toBeTruthy();
    await loginAs(USERS.ownerA);
    expect((await orderRepository.updatePaymentStatus(ctx('ownerA', 'OWNER'), TA, o.id, 'REFUNDED', 'estorno E2E')).paymentStatus).toBe('REFUNDED');
  });
  it('cupom de uso único (STGUM) consumido uma vez só', async () => {
    await loginAs(USERS.c1);
    const first = await orderRepository.createPublicOrder(SLUG_A, checkout({ couponCode: 'STGUM' })).catch(e => e);
    await loginAs(USERS.c2);
    const second = await orderRepository.createPublicOrder(SLUG_A, checkout({ couponCode: 'STGUM' })).catch(e => e);
    const ok = [first, second].filter(r => r && !(r instanceof Error) && r.discount > 0).length;
    expect(ok).toBeLessThanOrEqual(1);
  });
});

describe('E5 PDV e status', () => {
  it('CASHIER vende no PDV com cupom e idempotência; status avança pelo servidor', async () => {
    await loginAs(USERS.cashierA);
    const input = { items: [{ productId: P1, quantity: 3 }], paymentMethod: 'CASH' as const, couponCode: 'STGDEZ', idempotencyKey: newIdempotencyKey() };
    const a = await orderRepository.createPosSale(ctx('cashierA', 'CASHIER'), TA, input);
    const b = await orderRepository.createPosSale(ctx('cashierA', 'CASHIER'), TA, input);
    expect(b.id).toBe(a.id);
    expect(a.totalAmount).toBe(27);
    await loginAs(USERS.c1);
    const o = await orderRepository.createPublicOrder(SLUG_A, checkout());
    await loginAs(USERS.ownerA);
    expect((await orderRepository.updateStatus(ctx('ownerA', 'OWNER'), TA, o.id, 'CONFIRMED')).status).toBe('CONFIRMED');
  });
});

describe('E6 mídia real nos buckets', () => {
  it('OWNER envia imagem para marketing (privado) pelo fluxo N3', async () => {
    await loginAs(USERS.ownerA);
    // PNG 1x1 sintético
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const file = new File([png], 'stg.png', { type: 'image/png' });
    const r: any = await offerRepository.uploadMedia(TA, 'stg-card', file, { width: 1, height: 1 });
    expect(r).toBeTruthy();
    await loginAs(USERS.cashierA);
    const listed = await sb.storage.from('marketing').list(TA);
    expect(listed.data ?? []).toEqual([]);
    await loginAs(null);
    const anonList = await sb.storage.from('marketing').list(TA);
    expect(anonList.data ?? []).toEqual([]);
  });
});

describe('E7 cards promocionais, campanhas, vitrine N6 e Desempenho & Vendas', () => {
  it('OWNER cria campanha + card; vitrine mostra; cliente compra; métricas e desempenho refletem', async () => {
    await loginAs(USERS.ownerA);
    const camp = await campaignRepository.createCampaign(TA, { name: `STG Campanha ${Date.now()}` });
    const card = await campaignRepository.createCard(TA, camp.id, { commercialMode: 'PRODUCT', productId: P1, title: 'STG Card', cardPromotionalPrice: 8, displayOrder: 0 });
    await campaignRepository.updateCampaign(TA, camp.id, { status: 'ACTIVE' });
    await loginAs(null);
    const store = await publicStoreRepository.getPublicStore(SLUG_A);
    expect(store!.offers.find(o => o.campaignCardId === card.id)?.source).toBe('CAMPAIGN_CARD');
    expect(JSON.stringify(store)).not.toMatch(/123e4567-e89b-42d3-a456-426614174000|loja-a@example\.com/);
    expect(await campaignRepository.trackEvent({ storeSlug: SLUG_A, eventType: 'CARD_CLICK', sessionId: newIdempotencyKey(), campaignId: camp.id, cardId: card.id })).toBe(true);
    await loginAs(USERS.c2);
    const { summary } = await orderRepository.createPromotionalOrder(SLUG_A, {
      campaignId: camp.id, cardId: card.id, quantity: 1, customerName: 'Cliente Sintético', customerPhone: '11900009999',
      deliveryAddress: 'Rua Sintética, 10', paymentMethod: 'CASH', fulfillmentType: 'DELIVERY', idempotencyKey: newIdempotencyKey(),
    });
    expect(summary.subtotal).toBe(8);
    await loginAs(USERS.ownerA);
    const m = await campaignRepository.getMetrics(camp.id, new Date(Date.now() - 86400000), new Date(Date.now() + 60000));
    expect(m.orders.validOrders).toBeGreaterThanOrEqual(1);
  });
  it('oferta com checkout promocional: compra atribuída aparece no Desempenho & Vendas', async () => {
    await loginAs(USERS.ownerA);
    const off = await sb.from('offers').insert({ tenant_id: TA, product_id: P1, title: `STG Oferta ${Date.now()}`, image_url: '/demo/padaria-do-joao-logo.svg', is_active: true } as any).select('id').single();
    expect(off.error).toBeNull();
    await offerRepository.update(ctx('ownerA', 'OWNER'), TA, off.data!.id, { productId: P1, hasPromoCheckout: true, promoPrice: 7, promoMaxQuantityPerCustomer: 5, promoFulfillmentTypes: ['DELIVERY', 'PICKUP'] } as any);
    await loginAs(USERS.c1);
    const { order } = await orderRepository.createPromotionalOrder(SLUG_A, {
      offerId: off.data!.id, quantity: 2, customerName: 'Cliente Sintético', customerPhone: '11900009999',
      deliveryAddress: 'Rua Sintética, 10', paymentMethod: 'CASH', fulfillmentType: 'DELIVERY', idempotencyKey: newIdempotencyKey(),
    });
    expect(order.origin).toBe('storefront_promo');
    await loginAs(USERS.ownerA);
    const now = new Date();
    const perf: any = await promoPerformanceRepository.getPerformance(ctx('ownerA', 'OWNER'), TA,
      { start: new Date(now.getTime() - 86400000), end: new Date(now.getTime() + 60000) } as any,
      { start: new Date(now.getTime() - 2 * 86400000), end: new Date(now.getTime() - 86400000) } as any);
    expect(perf.kind).toBe('server');
    expect(JSON.stringify(perf.current)).toContain(off.data!.id);
    await loginAs(USERS.cashierA);
    const denied: any = await promoPerformanceRepository.getPerformance(ctx('cashierA', 'CASHIER'), TA,
      { start: new Date(now.getTime() - 86400000), end: now } as any, { start: new Date(now.getTime() - 2 * 86400000), end: now } as any).catch(e => e);
    expect(denied instanceof Error || denied.kind !== 'server' || JSON.stringify(denied.current).indexOf(off.data!.id) < 0).toBe(true);
  });
});
