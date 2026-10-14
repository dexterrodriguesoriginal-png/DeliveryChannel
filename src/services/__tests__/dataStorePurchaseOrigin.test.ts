/** Checkout do MODO DEMO com preço por origem. NÃO valida o backend real (Supabase). */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
const mem: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in mem ? mem[k] : null), setItem: (k: string, v: string) => { mem[k] = String(v); },
  removeItem: (k: string) => { delete mem[k]; }, clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
};
let ds: any; let adega: any; let burger: any;
const base = { customerName: 'Teste', customerPhone: '+5511987654321', paymentMethod: 'PIX' as const, deliveryAddress: 'Rua A, 1', origin: 'direct' as const };
beforeAll(async () => {
  ds = (await import('../dataStore')).dataStore;
  adega = ds.tenants.find((t: any) => t.slug === 'adega-premium');
  burger = ds.tenants.find((t: any) => t.slug === 'burger-craft');
});
beforeEach(() => {
  adega.settings = { ...adega.settings, deliveryEnabled: true, pickupEnabled: true, deliveryFee: 7.9, freeDeliveryThreshold: 150,
    pickupDiscountEnabled: true, pickupDiscountPercent: 15, pickupDiscountExcludedProductIds: [], pickupDiscountExcludedOfferIds: [], pickupDiscountExcludePromotional: false };
  for (const p of ds.products) if (p.tenantId === adega.id) p.stockQuantity = 500;
  const c = ds.promotionCarousels.find((x: any) => x.id === 'carousel-adega-1');
  c.isActive = true; for (const i of c.items) { i.isActive = true; delete i.endDate; }
});
const CAT = [{ productId: 'prod-adega-1', quantity: 1 }, { productId: 'prod-adega-2', quantity: 1 }];
const CAMP = [{ productId: 'prod-adega-1', quantity: 1, source: 'campaign', campaignItemId: 'pci-1' }, { productId: 'prod-adega-2', quantity: 1, source: 'campaign', campaignItemId: 'pci-2' }];
const order = (items: any[], mode = 'DELIVERY') => ds.createPublicOrder('adega-premium', { ...base, fulfillmentType: mode, items });

describe('dataStore demo — preço por origem', () => {
  it('catálogo: subtotal 89,80 (não usa mais o menor preço do carrossel)', () => {
    const o = order(CAT);
    expect(o.subtotal).toBe(89.8);
    expect(o.totalAmount).toBe(97.7);
  });
  it('campanha: subtotal 82,53; retirada 15% => 70,15', () => {
    expect(order(CAMP).subtotal).toBe(82.53);
    expect(order(CAMP, 'PICKUP').totalAmount).toBe(70.15);
  });
  it('mesmo produto em 2 linhas (catálogo + campanha) => 69,90 + 62,93', () => {
    const o = order([{ productId: 'prod-adega-1', quantity: 1 }, { productId: 'prod-adega-1', quantity: 1, source: 'campaign', campaignItemId: 'pci-1' }]);
    expect(o.subtotal).toBe(132.83);
    expect(o.items.map((i: any) => i.unitPrice).sort()).toEqual([62.93, 69.9]);
  });
  it('campanha expirada / inativa => pedido recusado (CAMPAIGN_ITEM_INVALID)', () => {
    const c = ds.promotionCarousels.find((x: any) => x.id === 'carousel-adega-1');
    c.items[0].endDate = '2000-01-01T00:00:00Z';
    expect(() => order(CAMP)).toThrow(/CAMPAIGN_ITEM_INVALID.*expirou/);
    delete c.items[0].endDate; c.isActive = false;
    expect(() => order(CAMP)).toThrow(/CAMPAIGN_ITEM_INVALID.*desativada/);
  });
  it('item de campanha de outro estabelecimento => recusado', () => {
    const otherItem = ds.promotionCarousels.filter((c: any) => c.tenantId !== adega.id).flatMap((c: any) => c.items)[0];
    const id = otherItem ? otherItem.id : 'pci-de-outra-loja';
    expect(() => order([{ productId: 'prod-adega-1', quantity: 1, source: 'campaign', campaignItemId: id }])).toThrow(/CAMPAIGN_ITEM_INVALID/);
    expect(burger).toBeTruthy();
  });
  it('campanha sem campaignItemId => recusada; preço extra no payload é ignorado', () => {
    expect(() => order([{ productId: 'prod-adega-1', quantity: 1, source: 'campaign' }])).toThrow(/CAMPAIGN_ITEM_INVALID/);
    const o = order([{ productId: 'prod-adega-1', quantity: 1, unitPrice: 0.01, price: 0.01 } as any]);
    expect(o.subtotal).toBe(69.9);
  });
});

describe('dataStore demo — decisões D1–D6', () => {
  // Atenção: no seed, Cabernet (89,90→69,90) e IPA (24,50→19,90) JÁ têm promoção própria no catálogo.
  // Item sem promoção para cupom: Gin 139,00.
  const GIN = { productId: 'prod-adega-3', quantity: 1 };
  it('D1: cupom não acumulável (PRIMEIRACOMPRA) na retirada, item com retirada => pedido recusado', () => {
    expect(() => ds.createPublicOrder('adega-premium', { ...base, fulfillmentType: 'PICKUP', items: [GIN], couponCode: 'PRIMEIRACOMPRA' }))
      .toThrow(/COUPON_NOT_STACKABLE_WITH_PICKUP/);
  });
  it('D1: cupom acumulável RETIRA10 na retirada => 139,00 − 20,85 − 11,82 = 106,33', () => {
    const o = ds.createPublicOrder('adega-premium', { ...base, fulfillmentType: 'PICKUP', items: [GIN], couponCode: 'RETIRA10' });
    expect(o.subtotal).toBe(139);
    expect(o.discount).toBe(32.67);
    expect(o.totalAmount).toBe(106.33);
  });
  it('D2: misto (Cabernet campanha 62,93 + Gin catálogo 139,00) com RETIRA10 no delivery => cupom só sobre o Gin; frete grátis', () => {
    const o = ds.createPublicOrder('adega-premium', { ...base, fulfillmentType: 'DELIVERY', items: [CAMP[0], GIN], couponCode: 'RETIRA10' });
    expect(o.subtotal).toBe(201.93);
    expect(o.discount).toBe(13.9);
    expect(o.deliveryFee).toBe(0);
    expect(o.totalAmount).toBe(188.03);
  });
  it('D2: itens com promoção própria do catálogo não recebem cupom genérico', () => {
    const o = ds.createPublicOrder('adega-premium', { ...base, fulfillmentType: 'DELIVERY', items: CAT, couponCode: 'RETIRA10' });
    expect(o.discount).toBe(0);
    expect(o.totalAmount).toBe(97.7);
  });
  it('D6: campanha 2×62,93 + 19,60 = 145,46 paga taxa; catálogo 159,70 tem frete grátis (preço de lista 204,30 nunca é usado)', () => {
    const camp = ds.createPublicOrder('adega-premium', { ...base, fulfillmentType: 'DELIVERY', items: [{ ...CAMP[0], quantity: 2 }, CAMP[1]] });
    expect(camp.subtotal).toBe(145.46);
    expect(camp.deliveryFee).toBe(7.9);
    expect(camp.totalAmount).toBe(153.36);
    const cat = ds.createPublicOrder('adega-premium', { ...base, fulfillmentType: 'DELIVERY', items: [{ ...CAT[0], quantity: 2 }, CAT[1]] });
    expect(cat.deliveryFee).toBe(0);
    expect(cat.totalAmount).toBe(159.7);
  });
  it('D3: checkout do card aceita o cupom vinculado e recusa cupom genérico', () => {
    const r = ds.processPromotionalCheckout('adega-premium', { ...base, offerId: 'off-adega-1', quantity: 1, fulfillmentType: 'DELIVERY', couponCode: 'VINHO5' });
    expect(r.order.subtotal).toBe(59.9);
    expect(r.order.discount).toBe(5);
    expect(() => ds.processPromotionalCheckout('adega-premium', { ...base, offerId: 'off-adega-1', quantity: 1, fulfillmentType: 'DELIVERY', couponCode: 'RETIRA10' }))
      .toThrow(/COUPON_NOT_LINKED_TO_OFFER/);
  });
  it('D4/D5: card sem restrição recebe retirada 15%; card antigo só DELIVERY recusa retirada', () => {
    const r = ds.processPromotionalCheckout('adega-premium', { ...base, offerId: 'off-adega-1', quantity: 1, fulfillmentType: 'PICKUP' });
    expect(r.order.pickupDiscount).toBe(8.99);
    expect(r.order.totalAmount).toBe(50.91);
    expect(() => ds.processPromotionalCheckout('adega-premium', { ...base, offerId: 'off-adega-2', quantity: 1, fulfillmentType: 'PICKUP' })).toThrow();
  });
});
