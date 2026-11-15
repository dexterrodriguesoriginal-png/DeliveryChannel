/**
 * Bug E2E: item de "Ofertas do Dia" (carrossel N4) adicionado à sacola comum travava o checkout com
 * "Itens de campanha devem ser comprados pelo checkout promocional do card.".
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false, ensureValidSession: async () => true }));
import { assertCartCampaignLinesSupported } from '../orderRepository';
import { toServerItems } from '../orderMappers';
import { toCheckoutItem, cartLineKey } from '../../lib/pricing/purchaseOrigin';

const REFRI = '11111111-1111-4111-8111-111111111111';
const AGUA = '22222222-2222-4222-8222-222222222222';
const campaignOrigin = { source: 'campaign' as const, campaignItemId: `c1:${REFRI}`, carouselId: 'c1' };
const cart = [
  { key: cartLineKey(REFRI, campaignOrigin), product: { id: REFRI }, quantity: 1, origin: campaignOrigin },
  { key: cartLineKey(AGUA, { source: 'catalog' }), product: { id: AGUA }, quantity: 2, origin: { source: 'catalog' as const } },
];

describe('checkout comum com item de oferta (carrossel)', () => {
  it('n1n6: não bloqueia; o servidor aplica o preço do carrossel (_effective_product_price)', () => {
    const items = cart.map(l => toCheckoutItem(l));
    expect(() => assertCartCampaignLinesSupported(items, true)).not.toThrow();
  });
  it('n1n6: o payload envia a referência da promoção sem enviar preço', () => {
    const payload = toServerItems(cart.map(l => toCheckoutItem(l)));
    expect(payload).toEqual([
      { productId: REFRI, quantity: 1, notes: null, source: 'campaign', campaignItemId: campaignOrigin.campaignItemId },
      { productId: AGUA, quantity: 2, notes: null },
    ]);
    for (const it of payload) { expect(it).not.toHaveProperty('price'); expect(it).not.toHaveProperty('unit_price'); }
  });
  it('legacy-020: recusa com código próprio (a vitrine converte a linha e mostra aviso fixo)', () => {
    const items = cart.map(l => toCheckoutItem(l));
    expect(() => assertCartCampaignLinesSupported(items, false)).toThrow(expect.objectContaining({ code: 'CAMPAIGN_SOURCE_UNAVAILABLE' }));
    expect(() => assertCartCampaignLinesSupported([{}], false)).not.toThrow();
  });
});
