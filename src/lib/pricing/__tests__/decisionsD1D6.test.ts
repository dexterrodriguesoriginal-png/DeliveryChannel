/**
 * Decisões comerciais D1–D6 (fundador, 13/10/2026) + esquema de campanha N4.
 * Cenário base: Cabernet 69,90 (campanha 62,93) + IPA 19,90 (campanha 19,60); taxa 7,90; frete grátis >= 150; retirada 15%.
 */
import { describe, it, expect } from 'vitest';
import { computeFulfillmentPricing, resolveAvailableModes, DEFAULT_FULFILLMENT_SETTINGS, FulfillmentSettings, offerToPricingLine } from '../fulfillmentPricing';
import { priceLineByOrigin, OriginCampaign } from '../purchaseOrigin';
import { n4CampaignUnitPrice, mapN4CarouselItemRow, toN4CarouselItemUpdate } from '../n4Campaign';

const S = (o: Partial<FulfillmentSettings> = {}): FulfillmentSettings => ({
  ...DEFAULT_FULFILLMENT_SETTINGS, deliveryFee: 7.9, freeDeliveryThreshold: 150,
  pickupDiscountEnabled: true, pickupDiscountPercent: 15, ...o,
});
const T = 't1';
const cab = { id: 'cab', tenantId: T, price: 69.9 };
const ipa = { id: 'ipa', tenantId: T, price: 19.9 };
const camp: OriginCampaign[] = [{
  id: 'c1', tenantId: T, isActive: true, showInStore: true,
  items: [
    { id: 'ci-cab', carouselId: 'c1', productId: 'cab', tenantId: T, promotionalPrice: 62.93, isActive: true },
    { id: 'ci-ipa', carouselId: 'c1', productId: 'ipa', tenantId: T, promotionalPrice: 19.6, isActive: true },
  ],
}];
const line = (p: any, qty: number, campaignItemId?: string) => {
  const r = priceLineByOrigin({ product: p, quantity: qty, origin: campaignItemId ? { source: 'campaign', campaignItemId } : null, campaigns: camp, tenantId: T });
  if (!r.ok) throw new Error(r.reason);
  return r.line;
};
const C10 = { code: 'C10', discountType: 'PERCENTAGE', discountValue: 10 };

describe('D1 — retirada primeiro, cupom só acumula se a regra do cupom permitir', () => {
  it('cupom NÃO acumulável: não incide sobre item que recebeu retirada (recusado se não sobra item)', () => {
    const r = computeFulfillmentPricing({ mode: 'PICKUP', lines: [line(cab, 1), line(ipa, 1)], settings: S(), coupon: C10 });
    expect(r.subtotal).toBe(89.8);
    expect(r.pickupDiscount).toBe(13.47);
    expect(r.couponDiscount).toBe(0);
    expect(r.couponRejectedReason).toBe('COUPON_NOT_STACKABLE_WITH_PICKUP');
    expect(r.total).toBe(76.33);
  });
  it('cupom NÃO acumulável incide só em itens excluídos da retirada (sem duplicidade)', () => {
    const r = computeFulfillmentPricing({ mode: 'PICKUP', lines: [line(cab, 1), line(ipa, 1)], settings: S({ pickupDiscountExcludedProductIds: ['ipa'] }), coupon: C10 });
    expect(r.pickupDiscount).toBe(10.49); // 15% de 69,90 = 10,485
    expect(r.couponBase).toBe(19.9);
    expect(r.couponDiscount).toBe(1.99);
    expect(r.total).toBe(77.32);
  });
  it('cupom ACUMULÁVEL: base = não promocionais líquidos da retirada', () => {
    const r = computeFulfillmentPricing({ mode: 'PICKUP', lines: [line(cab, 1), line(ipa, 1)], settings: S(), coupon: { ...C10, stackWithPickupDiscount: true } });
    expect(r.couponBase).toBe(76.33);
    expect(r.couponDiscount).toBe(7.63);
    expect(r.total).toBe(68.7);
  });
  it('no delivery o cupom não acumulável vale normalmente (não há retirada)', () => {
    const r = computeFulfillmentPricing({ mode: 'DELIVERY', lines: [line(cab, 1), line(ipa, 1)], settings: S(), coupon: C10 });
    expect(r.couponDiscount).toBe(8.98);
    expect(r.deliveryFee).toBe(7.9);
    expect(r.total).toBe(88.72);
  });
});

describe('D2 — cupom genérico não se aplica a itens com desconto próprio/campanha', () => {
  it('itens de campanha ficam fora da base do cupom', () => {
    const r = computeFulfillmentPricing({ mode: 'DELIVERY', lines: [line(cab, 1, 'ci-cab'), line(ipa, 1)], settings: S(), coupon: C10 });
    expect(r.subtotal).toBe(82.83);
    expect(r.couponBase).toBe(19.9);
    expect(r.couponDiscount).toBe(1.99);
  });
  it('produto com promoção própria no catálogo também fica fora', () => {
    const l = line({ id: 'x', tenantId: T, price: 50, promotionalPrice: 40 }, 1);
    expect(l.isPromotional).toBe(true);
    const r = computeFulfillmentPricing({ mode: 'DELIVERY', lines: [l], settings: S(), coupon: C10 });
    expect(r.couponRejectedReason).toBe('COUPON_NO_ELIGIBLE_ITEMS');
  });
  it('desconto de retirada sozinho NÃO torna o item promocional', () => {
    const l = line(cab, 1);
    expect(l.isPromotional).toBe(false);
    const r = computeFulfillmentPricing({ mode: 'PICKUP', lines: [l], settings: S(), coupon: { ...C10, stackWithPickupDiscount: true } });
    expect(r.couponDiscount).toBe(5.94); // 10% de (69,90 − 10,49)
  });
});

describe('D3 — checkout promocional independente: só o cupom vinculado à oferta', () => {
  const offerLine = offerToPricingLine({ id: 'o1' }, 44.9, 2);
  it('cupom vinculado é aceito sobre o preço da oferta', () => {
    const r = computeFulfillmentPricing({ mode: 'DELIVERY', lines: [offerLine], settings: S(), coupon: { code: 'OFERTA5', discountType: 'FIXED_AMOUNT', discountValue: 5 }, couponBase: 'LINKED_OFFER', linkedCouponCode: 'oferta5' });
    expect(r.couponDiscount).toBe(5);
    expect(r.total).toBe(84.8 + 7.9);
  });
  it('cupom genérico (não vinculado) é recusado', () => {
    const r = computeFulfillmentPricing({ mode: 'DELIVERY', lines: [offerLine], settings: S(), coupon: C10, couponBase: 'LINKED_OFFER', linkedCouponCode: 'OFERTA5' });
    expect(r.couponDiscount).toBe(0);
    expect(r.couponRejectedReason).toBe('COUPON_NOT_LINKED_TO_OFFER');
  });
  it('oferta sem cupom vinculado: nenhum cupom é aceito', () => {
    const r = computeFulfillmentPricing({ mode: 'DELIVERY', lines: [offerLine], settings: S(), coupon: C10, couponBase: 'LINKED_OFFER', linkedCouponCode: null });
    expect(r.couponRejectedReason).toBe('COUPON_NOT_LINKED_TO_OFFER');
  });
  it('cupom vinculado na retirada respeita D1 (não acumulável => recusado)', () => {
    const r = computeFulfillmentPricing({ mode: 'PICKUP', lines: [offerLine], settings: S(), coupon: { code: 'OFERTA5', discountType: 'FIXED_AMOUNT', discountValue: 5 }, couponBase: 'LINKED_OFFER', linkedCouponCode: 'OFERTA5' });
    expect(r.couponRejectedReason).toBe('COUPON_NOT_STACKABLE_WITH_PICKUP');
    expect(r.pickupDiscount).toBe(13.47);
  });
});

describe('D4 — ofertas independentes elegíveis à retirada por padrão', () => {
  const offerLine = offerToPricingLine({ id: 'o1' }, 44.9, 2);
  it('padrão: recebe o desconto', () => {
    expect(computeFulfillmentPricing({ mode: 'PICKUP', lines: [offerLine], settings: S(), couponBase: 'LINKED_OFFER' }).pickupDiscount).toBe(13.47);
  });
  it('exceção por oferta e "excluir itens promocionais" removem o desconto', () => {
    expect(computeFulfillmentPricing({ mode: 'PICKUP', lines: [offerLine], settings: S({ pickupDiscountExcludedOfferIds: ['o1'] }) }).pickupDiscount).toBe(0);
    expect(computeFulfillmentPricing({ mode: 'PICKUP', lines: [offerLine], settings: S({ pickupDiscountExcludePromotional: true }) }).pickupDiscount).toBe(0);
  });
  it('configuração geral desativada => nada', () => {
    expect(computeFulfillmentPricing({ mode: 'PICKUP', lines: [offerLine], settings: S({ pickupDiscountEnabled: false }) }).pickupDiscount).toBe(0);
  });
});

describe('D5 — cards antigos: interseção loja ∩ card; sem restrição herda a loja', () => {
  it('interseções', () => {
    expect(resolveAvailableModes(S(), ['DELIVERY']).modes).toEqual(['DELIVERY']);
    expect(resolveAvailableModes(S({ deliveryEnabled: false }), ['DELIVERY', 'PICKUP']).modes).toEqual(['PICKUP']);
    expect(resolveAvailableModes(S({ deliveryEnabled: false }), null).modes).toEqual(['PICKUP']);
    expect(resolveAvailableModes(S({ pickupEnabled: false }), ['PICKUP']).modes).toEqual([]);
  });
});

describe('D6 — frete grátis pelo subtotal efetivo da origem, antes de retirada/cupom', () => {
  it('catálogo 2× Cabernet 139,80 + IPA 19,90 = 159,70 => frete grátis', () => {
    const r = computeFulfillmentPricing({ mode: 'DELIVERY', lines: [line(cab, 2), line(ipa, 1)], settings: S() });
    expect(r.subtotal).toBe(159.7);
    expect(r.isFreeDelivery).toBe(true);
  });
  it('campanha 2× 62,93 + 19,60 = 145,46 < 150 => cobra taxa (preço de lista não libera)', () => {
    const r = computeFulfillmentPricing({ mode: 'DELIVERY', lines: [line(cab, 2, 'ci-cab'), line(ipa, 1, 'ci-ipa')], settings: S() });
    expect(r.subtotal).toBe(145.46);
    expect(r.isFreeDelivery).toBe(false);
    expect(r.deliveryFee).toBe(7.9);
    expect(r.total).toBe(153.36);
  });
  it('cupom não reduz a base do frete grátis', () => {
    const r = computeFulfillmentPricing({ mode: 'DELIVERY', lines: [line(cab, 2), line(ipa, 1)], settings: S(), coupon: C10 });
    expect(r.couponDiscount).toBe(15.97);
    expect(r.isFreeDelivery).toBe(true);
    expect(r.total).toBe(143.73);
  });
});

describe('N4 — preço derivado de discount_type/discount_value', () => {
  it('tipos', () => {
    expect(n4CampaignUnitPrice(69.9, 'PERCENTAGE', 10)).toBe(62.91);
    expect(n4CampaignUnitPrice(69.9, 'FIXED_AMOUNT', 6.97)).toBe(62.93);
    expect(n4CampaignUnitPrice(69.9, 'PROMOTIONAL_PRICE', 62.93)).toBe(62.93);
    expect(n4CampaignUnitPrice(69.9, 'NONE', 0)).toBeNull();
    expect(n4CampaignUnitPrice(69.9, 'PROMOTIONAL_PRICE', 70)).toBeNull();
    expect(n4CampaignUnitPrice(69.9, 'FIXED_AMOUNT', 69.9)).toBeNull();
  });
  it('mapeamento de linha N4 e atualização', () => {
    const m = mapN4CarouselItemRow({ id: 'i', carousel_id: 'c', product_id: 'p', tenant_id: T, discount_type: 'PROMOTIONAL_PRICE', discount_value: '62.93', is_active: true, start_at: null, end_at: '2026-12-31T00:00:00Z', display_order: 1, show_discount_badge: true }, 69.9);
    expect(m.promotionalPrice).toBe(62.93);
    expect(m.calculatedDiscountPercentage).toBe(10);
    expect(m.endDate).toBe('2026-12-31T00:00:00Z');
    expect(mapN4CarouselItemRow({ discount_type: 'NONE', discount_value: 0, is_active: true }, 10).isActive).toBe(false);
    expect(toN4CarouselItemUpdate({ promotionalPrice: 62.93, startDate: '', endDate: 'x' })).toEqual({ discount_type: 'PROMOTIONAL_PRICE', discount_value: 62.93, start_at: null, end_at: 'x' });
    expect(toN4CarouselItemUpdate({ discountType: 'PERCENTAGE', discountValue: 10 })).toEqual({ discount_type: 'PERCENTAGE', discount_value: 10 });
  });
  it('campanha (carrossel) fora da validade invalida o item', () => {
    const c2: OriginCampaign[] = [{ ...camp[0], endDate: '2020-01-01T00:00:00Z' }];
    const r = priceLineByOrigin({ product: cab, quantity: 1, origin: { source: 'campaign', campaignItemId: 'ci-cab' }, campaigns: c2, tenantId: T });
    expect(r.ok).toBe(false);
  });
});
