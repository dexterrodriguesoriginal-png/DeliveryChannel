/**
 * Checkout do MODO DEMO (dataStore local) com as regras de modalidade/retirada.
 * Isto valida a lógica do preview; NÃO valida o backend real (Supabase).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const mem: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in mem ? mem[k] : null),
  setItem: (k: string, v: string) => { mem[k] = String(v); },
  removeItem: (k: string) => { delete mem[k]; },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
};

let ds: any;
let adega: any;
let burger: any;
const baseOrder = {
  customerName: 'Teste', customerPhone: '+5511987654321', paymentMethod: 'PIX' as const,
  deliveryAddress: 'Rua A, 1', origin: 'direct' as const,
};

beforeAll(async () => {
  ds = (await import('../dataStore')).dataStore;
  adega = ds.tenants.find((t: any) => t.slug === 'adega-premium');
  burger = ds.tenants.find((t: any) => t.slug === 'burger-craft');
});

beforeEach(() => {
  adega.settings = { ...adega.settings, deliveryEnabled: true, pickupEnabled: true, pickupDiscountEnabled: true,
    pickupDiscountPercent: 15, pickupDiscountExcludedProductIds: [], pickupDiscountExcludedOfferIds: [], pickupDiscountExcludePromotional: false };
  for (const p of ds.products) if (p.tenantId === adega.id) p.stockQuantity = 500;
});

function adegaProduct() {
  return ds.products.find((p: any) => p.tenantId === adega.id && p.isActive);
}

describe('dataStore (demo) — checkout normal', () => {
  it('(6/14) retirada aplica 15% sobre itens elegíveis, taxa 0, total = subtotal − desconto', () => {
    const p = adegaProduct();
    const o = ds.createPublicOrder('adega-premium', { ...baseOrder, fulfillmentType: 'PICKUP', items: [{ productId: p.id, quantity: 3 }] });
    const expected = Math.round(o.subtotal * 15) / 100;
    expect(o.fulfillmentType).toBe('PICKUP');
    expect(o.deliveryFee).toBe(0);
    expect(o.pickupDiscount).toBeCloseTo(expected, 2);
    expect(o.totalAmount).toBeCloseTo(o.subtotal - expected, 2);
  });

  it('(13) delivery cobra a taxa da loja (ou frete grátis) e não aplica desconto de retirada', () => {
    const p = adegaProduct();
    const o = ds.createPublicOrder('adega-premium', { ...baseOrder, fulfillmentType: 'DELIVERY', items: [{ productId: p.id, quantity: 3 }] });
    const thr = adega.settings.freeDeliveryThreshold;
    expect(o.deliveryFee).toBe(thr && o.subtotal >= thr ? 0 : adega.settings.deliveryFee);
    expect(o.pickupDiscount).toBe(0);
  });

  it('(2/3/4) modalidade desabilitada pela loja é recusada', () => {
    const p = adegaProduct();
    adega.settings.pickupEnabled = false;
    expect(() => ds.createPublicOrder('adega-premium', { ...baseOrder, fulfillmentType: 'PICKUP', items: [{ productId: p.id, quantity: 3 }] })).toThrow();
    adega.settings.deliveryEnabled = false;
    expect(() => ds.createPublicOrder('adega-premium', { ...baseOrder, fulfillmentType: 'DELIVERY', items: [{ productId: p.id, quantity: 3 }] })).toThrow(/não está aceitando/);
  });

  it('(7) produto excluído não recebe desconto', () => {
    const p = adegaProduct();
    adega.settings.pickupDiscountExcludedProductIds = [p.id];
    const o = ds.createPublicOrder('adega-premium', { ...baseOrder, fulfillmentType: 'PICKUP', items: [{ productId: p.id, quantity: 3 }] });
    expect(o.pickupDiscount).toBe(0);
    expect(o.totalAmount).toBe(o.subtotal);
  });

  it('(10) preços/descontos enviados pelo navegador são ignorados', () => {
    const p = adegaProduct();
    const o = ds.createPublicOrder('adega-premium', {
      ...baseOrder, fulfillmentType: 'PICKUP',
      items: [{ productId: p.id, quantity: 3, unitPrice: 0.01, discount: 999 } as any],
      totalAmount: 0.01, pickupDiscount: 999, deliveryFee: -50,
    } as any);
    expect(o.items[0].unitPrice).toBeGreaterThan(0.01);
    expect(o.totalAmount).toBeGreaterThan(0);
    expect(o.pickupDiscount).toBeCloseTo(Math.round(o.subtotal * 15) / 100, 2);
  });

  it('(11) configurações/produtos de outro estabelecimento não se misturam', () => {
    burger.settings = { ...burger.settings, pickupEnabled: true, pickupDiscountEnabled: true, pickupDiscountPercent: 50 };
    adega.settings.pickupDiscountEnabled = false;
    const p = adegaProduct();
    const o = ds.createPublicOrder('adega-premium', { ...baseOrder, fulfillmentType: 'PICKUP', items: [{ productId: p.id, quantity: 3 }] });
    expect(o.pickupDiscount).toBe(0); // usa a config da ADEGA, não a do burger
    const bp = ds.products.find((x: any) => x.tenantId === burger.id);
    expect(() => ds.createPublicOrder('adega-premium', { ...baseOrder, fulfillmentType: 'PICKUP', items: [{ productId: bp.id, quantity: 1 }] }))
      .toThrow(/não pertence/);
  });

  it('(12) requisição repetida com a mesma chave não duplica pedido nem baixa estoque 2x', () => {
    const p = adegaProduct();
    const before = ds.orders.length;
    const stock0 = p.stockQuantity;
    const key = '7b2c7f0e-0000-4000-8000-000000000012';
    const a = ds.createPublicOrder('adega-premium', { ...baseOrder, fulfillmentType: 'PICKUP', idempotencyKey: key, items: [{ productId: p.id, quantity: 3 }] });
    const b = ds.createPublicOrder('adega-premium', { ...baseOrder, fulfillmentType: 'PICKUP', idempotencyKey: key, items: [{ productId: p.id, quantity: 3 }] });
    expect(b.id).toBe(a.id);
    expect(ds.orders.length).toBe(before + 1);
    expect(p.stockQuantity).toBe(stock0 - 3);
  });
});

describe('dataStore (demo) — checkout promocional (oferta independente)', () => {
  const offerId = 'offer-test-fulfillment';
  beforeEach(() => {
    ds.offers = ds.offers.filter((o: any) => o.id !== offerId);
    ds.offers.push({
      id: offerId, tenantId: adega.id, title: 'Combo Teste', isActive: true, destinationType: 'CUSTOM_OFFER',
      hasPromoCheckout: true, promoTitle: 'Combo Teste', promoPrice: 44.9, promoOriginalPrice: 59.9,
      promoMaxQuantityPerCustomer: 10, promoMinQuantity: 1, promoFulfillmentTypes: ['DELIVERY', 'PICKUP'], promoTimesUsed: 0,
    });
  });

  it('(8) preço próprio da oferta + retirada 15%', () => {
    const r = ds.processPromotionalCheckout('adega-premium', { ...baseOrder, offerId, quantity: 2, fulfillmentType: 'PICKUP' });
    expect(r.order.subtotal).toBe(89.8);
    expect(r.order.pickupDiscount).toBe(13.47);
    expect(r.order.deliveryFee).toBe(0);
    expect(r.order.totalAmount).toBe(76.33);
  });

  it('(8b) oferta em exceção não recebe desconto', () => {
    adega.settings.pickupDiscountExcludedOfferIds = [offerId];
    const r = ds.processPromotionalCheckout('adega-premium', { ...baseOrder, offerId, quantity: 2, fulfillmentType: 'PICKUP' });
    expect(r.order.pickupDiscount).toBe(0);
  });

  it('restrição antiga do card (somente DELIVERY) é respeitada', () => {
    ds.offers.find((o: any) => o.id === offerId).promoFulfillmentTypes = ['DELIVERY'];
    expect(() => ds.processPromotionalCheckout('adega-premium', { ...baseOrder, offerId, quantity: 1, fulfillmentType: 'PICKUP' })).toThrow();
  });
});
