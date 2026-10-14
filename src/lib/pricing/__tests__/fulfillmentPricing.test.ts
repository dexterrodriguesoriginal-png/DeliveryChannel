import { describe, it, expect } from 'vitest';
import {
  computeFulfillmentPricing,
  normalizeFulfillmentSettings,
  resolveAvailableModes,
  isValidPickupDiscountPercent,
  validateFulfillmentSettingsUpdate,
  fulfillmentFieldsToDb,
  offerToPricingLine,
  productToPricingLine,
  roundMoney,
  DEFAULT_FULFILLMENT_SETTINGS,
  FulfillmentSettings,
} from '../fulfillmentPricing';

const S = (o: Partial<FulfillmentSettings> = {}): FulfillmentSettings => ({ ...DEFAULT_FULFILLMENT_SETTINGS, deliveryFee: 7.9, ...o });
const P = (id: string, price: number, qty = 1, isPromotional = false) => ({ productId: id, unitPrice: price, quantity: qty, isPromotional });

describe('modalidades disponíveis (cenários 1–4)', () => {
  it('(1) delivery e retirada habilitados', () => {
    expect(resolveAvailableModes(S()).modes).toEqual(['DELIVERY', 'PICKUP']);
  });
  it('(2) somente delivery', () => {
    expect(resolveAvailableModes(S({ pickupEnabled: false })).modes).toEqual(['DELIVERY']);
  });
  it('(3) somente retirada', () => {
    expect(resolveAvailableModes(S({ deliveryEnabled: false })).modes).toEqual(['PICKUP']);
  });
  it('(4) nenhuma: bloqueia com motivo', () => {
    const r = resolveAvailableModes(S({ deliveryEnabled: false, pickupEnabled: false }));
    expect(r.modes).toEqual([]);
    expect(r.blockedReason).toMatch(/não está aceitando/);
  });
  it('restrição antiga do card = interseção com a loja', () => {
    expect(resolveAvailableModes(S(), ['PICKUP']).modes).toEqual(['PICKUP']);
    const r = resolveAvailableModes(S({ pickupEnabled: false }), ['PICKUP']);
    expect(r.modes).toEqual([]);
    expect(r.blockedReason).toMatch(/oferta/);
    expect(resolveAvailableModes(S(), []).modes).toEqual(['DELIVERY', 'PICKUP']);
  });
  it('padrões seguros quando a loja não tem as colunas (antes da migration)', () => {
    const n = normalizeFulfillmentSettings({ delivery_fee: 5 });
    expect(n.deliveryEnabled).toBe(true);
    expect(n.pickupEnabled).toBe(true);
    expect(n.pickupDiscountEnabled).toBe(false);
    expect(n.pickupDiscountPercent).toBe(0);
  });
});

describe('desconto de retirada (cenários 5–7, 13, 14)', () => {
  it('(5) retirada com desconto desativado: sem desconto e sem taxa', () => {
    const r = computeFulfillmentPricing({ mode: 'PICKUP', lines: [P('a', 100)], settings: S({ pickupDiscountEnabled: false, pickupDiscountPercent: 15 }) });
    expect(r.pickupDiscount).toBe(0);
    expect(r.deliveryFee).toBe(0);
    expect(r.total).toBe(100);
  });
  it('(6) retirada 15%: elegível R$100 => desconto 15, total 85, taxa 0', () => {
    const r = computeFulfillmentPricing({ mode: 'PICKUP', lines: [P('a', 60), P('b', 20, 2)], settings: S({ pickupDiscountEnabled: true, pickupDiscountPercent: 15 }) });
    expect(r.subtotal).toBe(100);
    expect(r.pickupDiscount).toBe(15);
    expect(r.deliveryFee).toBe(0);
    expect(r.total).toBe(85);
  });
  it('(6b) delivery nunca recebe desconto de retirada', () => {
    const r = computeFulfillmentPricing({ mode: 'DELIVERY', lines: [P('a', 100)], settings: S({ pickupDiscountEnabled: true, pickupDiscountPercent: 15 }) });
    expect(r.pickupDiscount).toBe(0);
    expect(r.total).toBe(107.9);
  });
  it('(7) produto excluído fica fora da base', () => {
    const r = computeFulfillmentPricing({
      mode: 'PICKUP', lines: [P('a', 60), P('x', 40)],
      settings: S({ pickupDiscountEnabled: true, pickupDiscountPercent: 15, pickupDiscountExcludedProductIds: ['x'] }),
    });
    expect(r.pickupEligibleBase).toBe(60);
    expect(r.pickupDiscount).toBe(9);
    expect(r.total).toBe(91);
  });
  it('(7b) opção "excluir itens em promoção"', () => {
    const r = computeFulfillmentPricing({
      mode: 'PICKUP', lines: [P('a', 60), P('p', 40, 1, true)],
      settings: S({ pickupDiscountEnabled: true, pickupDiscountPercent: 10, pickupDiscountExcludePromotional: true }),
    });
    expect(r.pickupDiscount).toBe(6);
  });
  it('(13) delivery calcula a taxa da loja e respeita frete grátis', () => {
    expect(computeFulfillmentPricing({ mode: 'DELIVERY', lines: [P('a', 30)], settings: S({ deliveryFee: 7.9 }) }).deliveryFee).toBe(7.9);
    const free = computeFulfillmentPricing({ mode: 'DELIVERY', lines: [P('a', 120)], settings: S({ deliveryFee: 7.9, freeDeliveryThreshold: 100 }) });
    expect(free.deliveryFee).toBe(0);
    expect(free.isFreeDelivery).toBe(true);
  });
  it('(14) retirada nunca cobra taxa', () => {
    const r = computeFulfillmentPricing({ mode: 'PICKUP', lines: [P('a', 30)], settings: S({ deliveryFee: 12 }) });
    expect(r.deliveryFee).toBe(0);
    expect(r.total).toBe(30);
  });
  it('arredondamento em centavos (half-up) por grupo', () => {
    const r = computeFulfillmentPricing({ mode: 'PICKUP', lines: [P('a', 33.33)], settings: S({ pickupDiscountEnabled: true, pickupDiscountPercent: 15 }) });
    expect(r.pickupDiscount).toBe(5); // 4.9995 -> 5.00
    expect(roundMoney(0.125)).toBe(0.13);
  });
  it('percentual fora de 0–50 nunca é aplicado', () => {
    expect(isValidPickupDiscountPercent(51)).toBe(false);
    expect(isValidPickupDiscountPercent(-1)).toBe(false);
    expect(isValidPickupDiscountPercent(50)).toBe(true);
    const r = computeFulfillmentPricing({ mode: 'PICKUP', lines: [P('a', 100)], settings: { ...S(), pickupDiscountEnabled: true, pickupDiscountPercent: 90 } });
    expect(r.pickupDiscount).toBe(0);
    expect(normalizeFulfillmentSettings({ pickup_discount_percent: 99 }).pickupDiscountPercent).toBe(0);
    expect(validateFulfillmentSettingsUpdate({ pickupDiscountPercent: 60 })).toMatch(/0% e 50%/);
    expect(validateFulfillmentSettingsUpdate({ pickupDiscountEnabled: true, pickupDiscountPercent: 0 })).toMatch(/maior que 0/);
    expect(validateFulfillmentSettingsUpdate({ pickupDiscountEnabled: true, pickupDiscountPercent: 15 })).toBeNull();
  });
});

describe('oferta independente e cupom (cenários 8, 9)', () => {
  it('(8) oferta com preço próprio + retirada 10%', () => {
    const r = computeFulfillmentPricing({
      mode: 'PICKUP', lines: [offerToPricingLine({ id: 'o1' }, 44.9, 2)],
      settings: S({ pickupDiscountEnabled: true, pickupDiscountPercent: 10 }), couponBase: 'ALL',
    });
    expect(r.subtotal).toBe(89.8);
    expect(r.pickupDiscount).toBe(8.98);
    expect(r.total).toBe(80.82);
  });
  it('(8b) oferta na lista de exceções não recebe desconto', () => {
    const r = computeFulfillmentPricing({
      mode: 'PICKUP', lines: [offerToPricingLine({ id: 'o1' }, 44.9, 2)],
      settings: S({ pickupDiscountEnabled: true, pickupDiscountPercent: 10, pickupDiscountExcludedOfferIds: ['o1'] }), couponBase: 'ALL',
    });
    expect(r.pickupDiscount).toBe(0);
  });
  it('(9) cupom ACUMULÁVEL (D1) combinado com retirada: retirada primeiro, cupom sobre o restante (itens não promocionais)', () => {
    const r = computeFulfillmentPricing({
      mode: 'PICKUP', lines: [P('a', 100), P('p', 50, 1, true)],
      settings: S({ pickupDiscountEnabled: true, pickupDiscountPercent: 10 }),
      coupon: { code: 'C10', discountType: 'PERCENTAGE', discountValue: 10, stackWithPickupDiscount: true },
    });
    expect(r.pickupDiscount).toBe(15); // 10 + 5
    expect(r.couponBase).toBe(90); // 100 - 10 (só não promocional)
    expect(r.couponDiscount).toBe(9);
    expect(r.total).toBe(126);
  });
  it('(9b) cupom fixo nunca deixa total negativo', () => {
    const r = computeFulfillmentPricing({
      mode: 'PICKUP', lines: [P('a', 20)], settings: S({ pickupDiscountEnabled: true, pickupDiscountPercent: 50 }),
      coupon: { code: 'F', discountType: 'FIXED', discountValue: 999, stackWithPickupDiscount: true },
    });
    expect(r.couponDiscount).toBe(10);
    expect(r.total).toBe(0);
  });
  it('(9c) cupom só com itens em promoção é recusado no carrinho (regra N2)', () => {
    const r = computeFulfillmentPricing({ mode: 'DELIVERY', lines: [P('p', 50, 1, true)], settings: S(), coupon: { code: 'C', discountType: 'PERCENTAGE', discountValue: 10 } });
    expect(r.couponDiscount).toBe(0);
    expect(r.couponRejectedReason).toBe('COUPON_NO_ELIGIBLE_ITEMS');
  });
  it('produto com promotionalPrice inválido (> preço) usa o preço normal (regra N2 _effective_product_price)', () => {
    expect(productToPricingLine({ id: 'a', price: 10, promotionalPrice: 12 }, 1)).toMatchObject({ unitPrice: 10, isPromotional: false });
    expect(productToPricingLine({ id: 'a', price: 10, promotionalPrice: 8 }, 1)).toMatchObject({ unitPrice: 8, isPromotional: true });
  });
  it('mapeia camelCase -> colunas da proposta somente para campos presentes', () => {
    expect(fulfillmentFieldsToDb({ pickupEnabled: false, address: 'x' })).toEqual({ pickup_enabled: false });
  });
});
