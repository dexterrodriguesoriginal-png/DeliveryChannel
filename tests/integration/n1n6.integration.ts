/**
 * Integração REAL (VITE_BACKEND_SCHEMA=n1n6): repositórios do frontend → supabase-js → PostgREST local →
 * PostgreSQL local com 001–020 + N1–N6 e fixtures sintéticas. Sem mocks de RPC.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../src/lib/supabase', async () => {
  const m = await import('./localClient');
  return { supabase: m.localSupabase, isSupabaseConfigured: true, ensureValidSession: async () => true };
});

import { loginAs } from './localClient';
import { orderRepository } from '../../src/repositories/orderRepository';
import { tenantRepository } from '../../src/repositories/tenantRepository';
import { publicStoreRepository } from '../../src/repositories/publicStoreRepository';
import { promotionRepository } from '../../src/repositories/promotionRepository';
import { offerRepository } from '../../src/repositories/offerRepository';
import { campaignRepository } from '../../src/repositories/campaignRepository';
import { isN1N6Backend } from '../../src/lib/backendSchema';
import { newIdempotencyKey } from '../../src/lib/backend';

const T = '10000000-0000-0000-0000-00000000000a';
const OWNER = 'a0000000-0000-0000-0000-000000000001';
const CASHIER = 'a0000000-0000-0000-0000-000000000004';
const C1 = 'a0000000-0000-0000-0000-000000000007';
const C2 = 'a0000000-0000-0000-0000-000000000008';
const P1 = 'd0000000-0000-0000-0000-0000000000a1';
const OFFER = 'e0000000-0000-0000-0000-0000000000a1';
const ORDER_C1 = '0d000000-0000-0000-0000-0000000000a1';
const ctx = (userId: string, role: any) => ({ userId, userRole: role, userName: 'teste', tenantId: T });

const checkoutInput = (extra: Record<string, unknown> = {}) => ({
  customerName: 'Cliente Dois',
  customerPhone: '11977776666',
  deliveryAddress: 'Rua Integração, 5',
  items: [{ productId: P1, quantity: 2 }],
  paymentMethod: 'PIX' as const,
  fulfillmentType: 'DELIVERY' as const,
  origin: 'storefront' as any,
  ...extra,
});

beforeAll(() => {
  expect(isN1N6Backend()).toBe(true);
});

describe('fluxo 1 — status/pagamento/PDV por RPC (N1/N2)', () => {
  it('OWNER lê pedidos e muda status por update_order_status; cancelado não reabre (servidor)', async () => {
    loginAs(OWNER);
    const orders = await orderRepository.getOrders(ctx(OWNER, 'OWNER'), T);
    expect(orders.length).toBeGreaterThan(0);
    const created = await (async () => { loginAs(C2); return orderRepository.createPublicOrder('adega-a', checkoutInput({ idempotencyKey: newIdempotencyKey() })); })();
    loginAs(OWNER);
    const confirmed = await orderRepository.updateStatus(ctx(OWNER, 'OWNER'), T, created.id, 'CONFIRMED');
    expect(confirmed.status).toBe('CONFIRMED');
    await expect(orderRepository.updateStatus(ctx(OWNER, 'OWNER'), T, created.id, 'CANCELLED', '  ')).rejects.toMatchObject({ code: 'NOTE_REQUIRED' });
    const cancelled = await orderRepository.updateStatus(ctx(OWNER, 'OWNER'), T, created.id, 'CANCELLED', 'cliente desistiu');
    expect(cancelled.status).toBe('CANCELLED');
    // Sem informar o status atual ao cliente: quem recusa é o servidor.
    await expect(orderRepository.updateStatus(ctx(OWNER, 'OWNER'), T, created.id, 'PENDING')).rejects.toBeTruthy();
  });

  it('CASHIER marca PAGO; estorno pelo CASHIER é recusado no servidor', async () => {
    loginAs(C2);
    const o = await orderRepository.createPublicOrder('adega-a', checkoutInput({ idempotencyKey: newIdempotencyKey() }));
    loginAs(CASHIER);
    const paid = await orderRepository.updatePaymentStatus(ctx(CASHIER, 'CASHIER'), T, o.id, 'PAID');
    expect(paid.paymentStatus).toBe('PAID');
    await expect(orderRepository.updatePaymentStatus(ctx(CASHIER, 'CASHIER'), T, o.id, 'REFUNDED', 'teste')).rejects.toBeTruthy();
    loginAs(OWNER);
    const refunded = await orderRepository.updatePaymentStatus(ctx(OWNER, 'OWNER'), T, o.id, 'REFUNDED', 'estorno de teste');
    expect(refunded.paymentStatus).toBe('REFUNDED');
  });

  it('PDV (CASHIER) por process_pos_sale_atomic com cupom e idempotência; sem nome/telefone fictícios', async () => {
    loginAs(CASHIER);
    const key = newIdempotencyKey();
    const input = { items: [{ productId: P1, quantity: 3 }], paymentMethod: 'CASH' as const, couponCode: 'DEZ10', idempotencyKey: key };
    const a = await orderRepository.createPosSale(ctx(CASHIER, 'CASHIER'), T, input);
    const b = await orderRepository.createPosSale(ctx(CASHIER, 'CASHIER'), T, input);
    expect(b.id).toBe(a.id);
    expect(a.subtotal).toBe(30);
    expect(a.discount).toBe(3);
    expect(a.totalAmount).toBe(27);
  });
});

describe('fluxo 2 — checkout v2 e checkout promocional (N2/N6)', () => {
  it('visitante anônimo não finaliza pedido (auth obrigatória no servidor)', async () => {
    loginAs(null);
    await expect(orderRepository.createPublicOrder('adega-a', checkoutInput({ idempotencyKey: newIdempotencyKey() }))).rejects.toBeTruthy();
  });

  it('cliente autenticado: totais do servidor, cupom e mesma chave => mesmo pedido', async () => {
    loginAs(C2);
    const key = newIdempotencyKey();
    const a = await orderRepository.createPublicOrder('adega-a', checkoutInput({ idempotencyKey: key, couponCode: 'DEZ10' }));
    const b = await orderRepository.createPublicOrder('adega-a', checkoutInput({ idempotencyKey: key, couponCode: 'DEZ10' }));
    expect(b.id).toBe(a.id);
    expect(a.subtotal).toBe(20);
    expect(a.discount).toBe(2);
    expect(a.couponCode).toBe('DEZ10');
  });

  it('OWNER ativa checkout promocional na oferta (colunas N4) e o cliente compra pelo N6', async () => {
    loginAs(OWNER);
    const updated = await offerRepository.update(ctx(OWNER, 'OWNER'), T, OFFER, {
      productId: P1,
      hasPromoCheckout: true,
      promoPrice: 7,
      promoMaxQuantityPerCustomer: 5,
      promoFulfillmentTypes: ['DELIVERY', 'PICKUP'],
    });
    expect(updated.hasPromoCheckout).toBe(true);
    expect(updated.promoPrice).toBe(7);
    expect(updated.promoFulfillment).toBe('BOTH');

    loginAs(null);
    const store = await publicStoreRepository.getPublicStore('adega-a');
    const offer = store!.offers.find(o => o.id === OFFER);
    expect(offer?.hasPromoCheckout).toBe(true);
    expect(offer?.promoPrice).toBe(7);

    loginAs(C2);
    const key = newIdempotencyKey();
    const { order, summary } = await orderRepository.createPromotionalOrder('adega-a', {
      offerId: OFFER, quantity: 2, customerName: 'Cliente Dois', customerPhone: '11977776666',
      deliveryAddress: 'Rua P, 1', paymentMethod: 'CASH', fulfillmentType: 'DELIVERY', idempotencyKey: key,
    });
    expect(summary.subtotal).toBe(14);
    expect(order.origin).toBe('storefront_promo');
    const again = await orderRepository.createPromotionalOrder('adega-a', {
      offerId: OFFER, quantity: 2, customerName: 'Cliente Dois', customerPhone: '11977776666',
      deliveryAddress: 'Rua P, 1', paymentMethod: 'CASH', fulfillmentType: 'DELIVERY', idempotencyKey: key,
    });
    expect(again.order.id).toBe(order.id);
  });
});

describe('fluxo 3 — PIX em tenant_payment_settings', () => {
  it('OWNER salva/lê (mascarado); CASHIER não lê; tenant_settings não expõe pix_key', async () => {
    loginAs(OWNER);
    const saved = await tenantRepository.savePaymentSettings(T, {
      pixEnabled: true, pixKeyType: 'CPF', pixKey: '52998224725', merchantName: 'ADEGA A', merchantCity: 'SAO PAULO',
    });
    expect(saved.pixEnabled).toBe(true);
    expect(saved.pixKeyMasked).not.toContain('52998224725');
    const read = await tenantRepository.getPaymentSettings(T);
    expect(read?.pixKeyMasked).not.toContain('52998224725');
    const tenant = await tenantRepository.getById(ctx(OWNER, 'OWNER'), T);
    expect(tenant?.settings.pixKey).toBeUndefined();

    loginAs(CASHIER);
    const cashierRead = await tenantRepository.getPaymentSettings(T).catch(() => null);
    expect(cashierRead).toBeNull();
  });

  it('cliente recebe o BR Code só do PRÓPRIO pedido', async () => {
    loginAs(C1);
    const pix = await orderRepository.getOrderPixPayload(ORDER_C1);
    expect(pix.brcode).toMatch(/^000201/);
    expect(pix.amount).toBeGreaterThan(0);
    loginAs(C2);
    await expect(orderRepository.getOrderPixPayload(ORDER_C1)).rejects.toBeTruthy();
  });
});

describe('fluxo 4 — cupom validado no servidor', () => {
  it('vitrine (validate_coupon) e PDV (validate_coupon_pos)', async () => {
    loginAs(C2);
    const pub = await orderRepository.validateCoupon({ slug: 'adega-a' }, 'dez10', [{ productId: P1, quantity: 2 }]);
    expect(pub.valid).toBe(true);
    expect(pub.discount).toBe(2);
    loginAs(CASHIER);
    const pos = await orderRepository.validateCoupon({ tenantId: T }, 'DEZ10', [{ productId: P1, quantity: 1 }]);
    expect(pos.valid).toBe(true);
    const bad = await orderRepository.validateCoupon({ slug: 'adega-a' }, 'VENCIDO', [{ productId: P1, quantity: 1 }]).catch(e => e);
    expect(bad.valid === false || bad.code).toBeTruthy();
  });

  it('CASHIER não gerencia cupons (RLS)', async () => {
    loginAs(CASHIER);
    await expect(
      promotionRepository.createCoupon(ctx(CASHIER, 'CASHIER'), T, { code: 'CAIXA1', discountType: 'FIXED_AMOUNT', discountValue: 1 } as any)
    ).rejects.toBeTruthy();
  });
});

describe('fluxo 5 — campanhas/cards/analytics (N5) e vitrine N6', () => {
  it('OWNER cria campanha + card de produto; vitrine mostra o card comprável; evento e métricas', async () => {
    loginAs(OWNER);
    const camp = await campaignRepository.createCampaign(T, { name: 'Campanha Integração' });
    const card = await campaignRepository.createCard(T, camp.id, {
      commercialMode: 'PRODUCT', productId: P1, title: 'Card A1', cardPromotionalPrice: 8, displayOrder: 0,
    });
    await campaignRepository.updateCampaign(T, camp.id, { status: 'ACTIVE' });

    loginAs(null);
    const store = await publicStoreRepository.getPublicStore('adega-a');
    const pubCard = store!.offers.find(o => o.campaignCardId === card.id);
    expect(pubCard).toBeTruthy();
    expect(pubCard!.source).toBe('CAMPAIGN_CARD');
    expect(pubCard!.campaignId).toBe(camp.id);

    const tracked = await campaignRepository.trackEvent({
      storeSlug: 'adega-a', eventType: 'CARD_CLICK', sessionId: newIdempotencyKey(), campaignId: camp.id, cardId: card.id,
    });
    expect(tracked).toBe(true);

    loginAs(C2);
    const { summary } = await orderRepository.createPromotionalOrder('adega-a', {
      campaignId: camp.id, cardId: card.id, quantity: 1, customerName: 'Cliente Dois', customerPhone: '11977776666',
      deliveryAddress: 'Rua C, 1', paymentMethod: 'CASH', fulfillmentType: 'DELIVERY', idempotencyKey: newIdempotencyKey(),
    });
    expect(summary.subtotal).toBe(8);
    expect(summary.promotion?.cardId).toBe(card.id);

    loginAs(OWNER);
    const m = await campaignRepository.getMetrics(camp.id, new Date(Date.now() - 86400000), new Date(Date.now() + 60000));
    expect(m.orders.validOrders).toBeGreaterThanOrEqual(1);
    expect(m.orders.revenue).toBeGreaterThan(0);
  });

  it('CASHIER não acessa campanhas (somente OWNER/MANAGER)', async () => {
    loginAs(CASHIER);
    const r = await campaignRepository.listCampaigns(T).catch(() => []);
    expect(r).toEqual([]);
  });
});

describe('configurações N1 (colunas por GRANT; prep sem default 30)', () => {
  it('OWNER grava default_prep_time_minutes via UPDATE permitido', async () => {
    loginAs(OWNER);
    await tenantRepository.updateSettings(ctx(OWNER, 'OWNER'), T, { defaultPrepTimeMinutes: 25 } as any);
    const t = await tenantRepository.getById(ctx(OWNER, 'OWNER'), T);
    expect((t!.settings as any).defaultPrepTimeMinutes).toBe(25);
  });
});
