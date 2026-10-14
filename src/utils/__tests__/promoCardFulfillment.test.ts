import { describe, it, expect, vi } from 'vitest';

// Node < 22 não tem WebSocket nativo; o cliente Supabase não é usado nestes testes (função pura de mapeamento).
vi.mock('../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false, ensureValidSession: async () => null }));
import { initialPromoFulfillmentTypes, promoFulfillmentTypesForSave } from '../promoCardFulfillment';
import { mapRowToOffer } from '../../repositories/offerRepository';

describe('(15) reabrir card existente preserva dados de modalidade', () => {
  it('card antigo restrito a PICKUP reabre e salva com PICKUP (nada apagado)', () => {
    const card = { promoFulfillmentTypes: ['PICKUP'] as ('DELIVERY' | 'PICKUP')[] };
    const loaded = initialPromoFulfillmentTypes(card);
    expect(loaded).toEqual(['PICKUP']);
    expect(promoFulfillmentTypesForSave('CUSTOM_OFFER', loaded, card)).toEqual(['PICKUP']);
  });
  it('card novo grava ambas (sem restrição)', () => {
    expect(promoFulfillmentTypesForSave('CUSTOM_OFFER', initialPromoFulfillmentTypes(null), null)).toEqual(['DELIVERY', 'PICKUP']);
  });
  it('card que troca para visual/produto mantém o valor antigo gravado', () => {
    expect(promoFulfillmentTypesForSave('BANNER_ONLY', ['DELIVERY', 'PICKUP'], { promoFulfillmentTypes: ['DELIVERY'] })).toEqual(['DELIVERY']);
  });
  it('linha do banco com promo_fulfillment_types é lida sem perda', () => {
    const o = mapRowToOffer({ id: 'c1', tenant_id: 't', title: 'x', destination_type: 'CUSTOM_OFFER', promo_fulfillment_types: ['PICKUP'] } as any);
    expect(o.promoFulfillmentTypes).toEqual(['PICKUP']);
  });
});

describe('(16) três tipos de card preservados', () => {
  it.each([
    ['BANNER_ONLY', null, 'BANNER_ONLY'],
    ['PRODUCT', 'prod-1', 'PRODUCT'],
    ['CUSTOM_OFFER', null, 'CUSTOM_OFFER'],
  ])('%s', (dest, productId, expected) => {
    const o = mapRowToOffer({ id: 'c', tenant_id: 't', title: 'x', destination_type: dest, product_id: productId } as any);
    expect(o.destinationType).toBe(expected);
  });
});
