import { describe, it, expect } from 'vitest';
import { mapN6Carousels } from '../publicStoreN6';
import { priceLineByOrigin, revalidateOriginCart, toCheckoutItem } from '../../lib/pricing/purchaseOrigin';
import { toServerItems } from '../orderMappers';

const now = new Date('2026-11-15T12:00:00Z');
const raw = [{ id: 'carousel', name: 'Promoções', items: [{
  id: 'item', productId: 'promo', price: 20, effectivePrice: 12, isAvailable: true, isPromotional: true,
  remainingUnits: 2, startDate: '2026-11-15T00:00:00Z', endDate: '2026-11-16T00:00:00Z',
  product: { id: 'promo', tenantId: 'loja', name: 'Kit', price: 20, imageUrl: 'https://example.com/foto.png', isActive: true, isAvailable: true, carouselOnly: true },
}] }];
const campaigns = mapN6Carousels(raw, 'loja', [], () => '');
const product = campaigns[0].items[0].product!;
const origin = { source: 'campaign' as const, campaignItemId: 'item', carouselId: 'carousel' };
const quote = (quantity = 1, at = now) => priceLineByOrigin({ product, quantity, origin, campaigns, tenantId: 'loja', now: at });

describe('produtos exclusivos do carrossel', () => {
  it('mapeia produto sem incluí-lo no catálogo e calcula desconto real', () => {
    expect(campaigns[0].items[0]).toMatchObject({ id: 'item', promotionalPrice: 12, calculatedDiscountPercentage: 40, remainingUnits: 2 });
    expect(product).toMatchObject({ carouselOnly: true, name: 'Kit', stockQuantity: 2 });
    expect(quote()).toMatchObject({ ok: true, line: { unitPrice: 12 } });
  });
  it('aceita preço sem preço de e não inventa selo de desconto', () => {
    const equal = mapN6Carousels([{ ...raw[0], items: [{ ...raw[0].items[0], price: 12, isPromotional: false, product: { ...raw[0].items[0].product, price: 12 } }] }], 'loja', [], () => '');
    expect(equal[0].items[0]).toMatchObject({ showDiscountBadge: false, calculatedDiscountPercentage: 0 });
    expect(priceLineByOrigin({ product: equal[0].items[0].product!, quantity: 1, origin, campaigns: equal, tenantId: 'loja', now })).toMatchObject({ ok: true, line: { unitPrice: 12 } });
  });
  it('valida início, fim exclusivo e limite de unidades', () => {
    expect(quote(1, new Date('2026-11-14'))).toMatchObject({ ok: false, reason: 'CAMPAIGN_NOT_STARTED' });
    expect(quote(1, new Date('2026-11-16'))).toMatchObject({ ok: false, reason: 'CAMPAIGN_EXPIRED' });
    expect(quote(3)).toMatchObject({ ok: false, reason: 'CAMPAIGN_UNITS_EXCEEDED' });
  });
  it('remove produto exclusivo vencido da sacola em vez de convertê-lo em catálogo', () => {
    const cart = [{ key: 'promo::campaign::item', product, quantity: 1, origin }];
    expect(revalidateOriginCart(cart, campaigns, 'loja', new Date('2026-11-16')).cart).toEqual([]);
  });
  it('preserva a origem no pedido e descarta qualquer preço adulterado', () => {
    const input = { ...toCheckoutItem({ product, quantity: 1, origin }), price: 0.01, unit_price: 0.01 };
    expect(toServerItems([input])).toEqual([{ productId: 'promo', quantity: 1, notes: null, source: 'campaign', campaignItemId: 'item' }]);
  });
});
