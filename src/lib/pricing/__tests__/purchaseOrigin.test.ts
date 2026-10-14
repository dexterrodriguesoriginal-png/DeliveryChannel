/** Preço por ORIGEM DA COMPRA — lógica pura (front + demo). Não valida o backend real. */
import { describe, it, expect } from 'vitest';
import { computeFulfillmentPricing, normalizeFulfillmentSettings } from '../fulfillmentPricing';
import {
  addToOriginCart, cartLineKey, decrementOriginCart, hydrateOriginCart, priceLineByOrigin,
  revalidateOriginCart, toCheckoutItem, CATALOG_ORIGIN, OriginCampaign,
} from '../purchaseOrigin';

const T = 'tenant-adega-01';
const cab = { id: 'prod-adega-1', tenantId: T, price: 89.9, promotionalPrice: 69.9 };
const ipa = { id: 'prod-adega-2', tenantId: T, price: 24.5, promotionalPrice: 19.9 };
const mkCampaigns = (over: Partial<{ active: boolean; itemActive: boolean; end: string; tenant: string }> = {}): OriginCampaign[] => [{
  id: 'carousel-adega-1', tenantId: over.tenant || T, isActive: over.active ?? true, showInStore: true,
  items: [
    { id: 'pci-1', carouselId: 'carousel-adega-1', productId: cab.id, tenantId: over.tenant || T, promotionalPrice: 62.93, isActive: over.itemActive ?? true, endDate: over.end },
    { id: 'pci-2', carouselId: 'carousel-adega-1', productId: ipa.id, tenantId: over.tenant || T, promotionalPrice: 19.6, isActive: true },
  ],
}];
const camp = (id: string) => ({ source: 'campaign' as const, campaignItemId: id, carouselId: 'carousel-adega-1' });
const settings = (excl = false, extra: any = {}) => normalizeFulfillmentSettings({
  deliveryEnabled: true, pickupEnabled: true, deliveryFee: 7.9, freeDeliveryThreshold: 150,
  pickupDiscountEnabled: true, pickupDiscountPercent: 15, pickupDiscountExcludePromotional: excl, ...extra,
});
function lines(items: Array<[any, any]>, campaigns = mkCampaigns()) {
  return items.map(([p, o]) => {
    const r = priceLineByOrigin({ product: p, quantity: 1, origin: o, campaigns, tenantId: T });
    if (!r.ok) throw new Error(r.reason);
    return r.line;
  });
}
const quote = (ls: any[], mode: 'DELIVERY' | 'PICKUP', s = settings()) => computeFulfillmentPricing({ mode, lines: ls, settings: s });

const CATALOG = () => lines([[cab, CATALOG_ORIGIN], [ipa, CATALOG_ORIGIN]]);
const CAMPAIGN = () => lines([[cab, camp('pci-1')], [ipa, camp('pci-2')]]);
const MIXED = () => lines([[cab, camp('pci-1')], [ipa, CATALOG_ORIGIN]]);

describe('preço por origem — subtotais', () => {
  it('ambos pelo catálogo => 69,90 + 19,90 = 89,80', () => {
    const l = CATALOG();
    expect(l.map((x) => x.unitPrice)).toEqual([69.9, 19.9]);
    expect(quote(l, 'DELIVERY').subtotal).toBe(89.8);
  });
  it('ambos pela campanha => 62,93 + 19,60 = 82,53', () => {
    const l = CAMPAIGN();
    expect(l.map((x) => x.unitPrice)).toEqual([62.93, 19.6]);
    expect(quote(l, 'DELIVERY').subtotal).toBe(82.53);
  });
  it('misto (Cabernet campanha + IPA catálogo) => 62,93 + 19,90 = 82,83', () => {
    expect(quote(MIXED(), 'DELIVERY').subtotal).toBe(82.83);
  });
  it('nunca escolhe o menor automaticamente: catálogo não herda preço da campanha', () => {
    expect(lines([[cab, CATALOG_ORIGIN]])[0].unitPrice).toBe(69.9);
  });
});

describe('preço por origem — modalidades', () => {
  it('catálogo: delivery 97,70 (taxa 7,90) | retirada 15% = 76,33', () => {
    expect(quote(CATALOG(), 'DELIVERY').total).toBe(97.7);
    const p = quote(CATALOG(), 'PICKUP');
    expect([p.pickupDiscount, p.deliveryFee, p.total]).toEqual([13.47, 0, 76.33]);
  });
  it('campanha: delivery 90,43 | retirada 15% = 70,15', () => {
    expect(quote(CAMPAIGN(), 'DELIVERY').total).toBe(90.43);
    const p = quote(CAMPAIGN(), 'PICKUP');
    expect([p.pickupDiscount, p.total]).toEqual([12.38, 70.15]);
  });
  it('misto: retirada 15% => 82,83 − 12,42 = 70,41', () => {
    const p = quote(MIXED(), 'PICKUP');
    expect([p.pickupDiscount, p.total]).toEqual([12.42, 70.41]);
  });
  it('excluir itens em promoção marcado: catálogo (promo própria) e campanha ficam sem desconto', () => {
    expect(quote(CATALOG(), 'PICKUP', settings(true)).pickupDiscount).toBe(0);
    expect(quote(CAMPAIGN(), 'PICKUP', settings(true)).pickupDiscount).toBe(0);
    expect(quote(CAMPAIGN(), 'PICKUP', settings(true)).total).toBe(82.53);
    expect(quote(MIXED(), 'PICKUP', settings(true)).total).toBe(82.83);
  });
  it('item de campanha sempre conta como em promoção (isPromotional)', () => {
    expect(CAMPAIGN().every((l) => l.isPromotional)).toBe(true);
  });
  it('produto excluído do desconto (Cabernet) — catálogo e campanha', () => {
    const s = settings(false, { pickupDiscountExcludedProductIds: [cab.id] });
    expect(quote(CATALOG(), 'PICKUP', s).pickupDiscount).toBe(2.99); // 15% de 19,90
    expect(quote(CAMPAIGN(), 'PICKUP', s).pickupDiscount).toBe(2.94); // 15% de 19,60
  });
  it('exceção por oferta (campaignItemId) só exclui a linha de campanha', () => {
    const s = settings(false, { pickupDiscountExcludedOfferIds: ['pci-1'] });
    expect(quote(CAMPAIGN(), 'PICKUP', s).pickupDiscount).toBe(2.94);
    expect(quote(CATALOG(), 'PICKUP', s).pickupDiscount).toBe(13.47);
  });
});

describe('preço por origem — carrinho', () => {
  it('mudar quantidade preserva a origem da linha', () => {
    let c = addToOriginCart([], cab, camp('pci-1'));
    c = addToOriginCart(c, cab, camp('pci-1'));
    expect(c).toHaveLength(1);
    expect(c[0].quantity).toBe(2);
    c = decrementOriginCart(c, c[0].key);
    expect(c[0].quantity).toBe(1);
    expect(c[0].origin).toMatchObject({ source: 'campaign', campaignItemId: 'pci-1' });
  });
  it('mesmo produto de duas origens = 2 linhas', () => {
    let c = addToOriginCart([], cab, CATALOG_ORIGIN);
    c = addToOriginCart(c, cab, camp('pci-1'));
    expect(c).toHaveLength(2);
    expect(new Set(c.map((l) => l.key)).size).toBe(2);
    expect(cartLineKey(cab.id, CATALOG_ORIGIN)).not.toBe(cartLineKey(cab.id, camp('pci-1')));
  });
  it('carrinho salvo no formato antigo vira catálogo', () => {
    const c = hydrateOriginCart([{ product: cab, quantity: 2 }]);
    expect(c[0].origin.source).toBe('catalog');
  });
  it('payload do checkout não contém preço; origem só para itens de campanha', () => {
    const c = addToOriginCart(addToOriginCart([], cab, camp('pci-1')), ipa, CATALOG_ORIGIN);
    const items = c.map(toCheckoutItem);
    expect(items[0]).toEqual({ productId: cab.id, quantity: 1, notes: undefined, source: 'campaign', campaignItemId: 'pci-1' });
    expect(items[1]).toEqual({ productId: ipa.id, quantity: 1, notes: undefined });
    expect(JSON.stringify(items)).not.toMatch(/price/i);
  });
});

describe('preço por origem — campanha inválida', () => {
  const r = (campaigns: OriginCampaign[], id = 'pci-1', product: any = cab) =>
    priceLineByOrigin({ product, quantity: 1, origin: camp(id), campaigns, tenantId: T });
  it('expirada => recusada', () => expect(r(mkCampaigns({ end: '2000-01-01T00:00:00Z' }))).toEqual({ ok: false, reason: 'CAMPAIGN_EXPIRED' }));
  it('campanha inativa => recusada', () => expect(r(mkCampaigns({ active: false }))).toEqual({ ok: false, reason: 'CAMPAIGN_INACTIVE' }));
  it('item inativo => recusado', () => expect(r(mkCampaigns({ itemActive: false }))).toEqual({ ok: false, reason: 'CAMPAIGN_INACTIVE' }));
  it('outro estabelecimento => recusada', () => expect(r(mkCampaigns({ tenant: 'tenant-burger-02' }))).toEqual({ ok: false, reason: 'CAMPAIGN_OTHER_TENANT' }));
  it('item de campanha de outro produto => recusado', () => expect(r(mkCampaigns(), 'pci-2', cab)).toEqual({ ok: false, reason: 'CAMPAIGN_PRODUCT_MISMATCH' }));
  it('id inexistente => recusado', () => expect(r(mkCampaigns(), 'nao-existe')).toEqual({ ok: false, reason: 'CAMPAIGN_ITEM_NOT_FOUND' }));
  it('front: revalidação converte linha expirada para catálogo (preço 69,90) e reporta', () => {
    const c = addToOriginCart([], cab, camp('pci-1'));
    const { cart, converted } = revalidateOriginCart(c, mkCampaigns({ end: '2000-01-01T00:00:00Z' }), T);
    expect(converted).toEqual([{ productId: cab.id, reason: 'CAMPAIGN_EXPIRED' }]);
    expect(cart[0].origin.source).toBe('catalog');
    expect(lines([[cart[0].product, cart[0].origin]])[0].unitPrice).toBe(69.9);
  });
  it('front: conversão mescla com linha de catálogo existente do mesmo produto', () => {
    const c = addToOriginCart(addToOriginCart([], cab, CATALOG_ORIGIN), cab, camp('pci-1'));
    const { cart } = revalidateOriginCart(c, mkCampaigns({ active: false }), T);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
  });
  it('preço manipulado no produto do navegador não altera o preço da campanha', () => {
    const tampered = { ...cab, promotionalPrice: 0.01 };
    const l = r(mkCampaigns(), 'pci-1', tampered);
    expect(l.ok && l.line.unitPrice).toBe(62.93);
  });
});
