import { describe, expect, it } from 'vitest';
import type { Campaign, CampaignCard, Offer } from '../../types';
import {
  buildStorefrontCards,
  campaignCardToPromoCard,
  getCardDisplayDurationMs,
  isCardLiveAt,
  sortCardsForDisplay,
} from '../storefrontCards';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T0 = Date.parse('2026-10-03T18:00:00Z'); // 15:00 BRT
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

function offer(partial: Partial<Offer> & { id: string }): Offer {
  return {
    tenantId: TENANT_A,
    title: partial.id,
    isActive: true,
    order: 0,
    mediaType: 'IMAGE',
    source: 'OFFER',
    ...partial,
  };
}

function card(partial: Partial<CampaignCard> & { id: string; campaignId: string }): CampaignCard {
  return {
    tenantId: TENANT_A,
    displayOrder: 0,
    model: 'FULL_MEDIA',
    mediaType: 'IMAGE',
    mediaUrl: `https://cdn.test/${partial.id}.jpg`,
    durationSeconds: 5,
    autoOverlay: false,
    destinationType: 'BANNER_ONLY',
    isActive: true,
    ...partial,
  };
}

function campaign(partial: Partial<Campaign> & { id: string }): Campaign {
  return {
    tenantId: TENANT_A,
    name: partial.id,
    status: 'ACTIVE',
    noEndDate: true,
    timezone: 'America/Sao_Paulo',
    isActive: true,
    displayOrder: 0,
    cards: [],
    ...partial,
  };
}

describe('isCardLiveAt — status + início/término (mesma regra do get_public_store)', () => {
  it('I/J: card desativado não aparece', () => {
    expect(isCardLiveAt(offer({ id: 'x', isActive: false }), T0)).toBe(false);
  });
  it('K/L: agendado para o futuro não aparece antes do início', () => {
    expect(isCardLiveAt(offer({ id: 'x', startAt: iso(T0 + 60 * MIN) }), T0)).toBe(false);
    expect(isCardLiveAt(offer({ id: 'x', startAt: iso(T0 + 60 * MIN) }), T0 + 60 * MIN - 1)).toBe(false);
  });
  it('M/N: aparece exatamente no horário de início e depois', () => {
    expect(isCardLiveAt(offer({ id: 'x', startAt: iso(T0 + 60 * MIN) }), T0 + 60 * MIN)).toBe(true);
    expect(isCardLiveAt(offer({ id: 'x', startAt: iso(T0 + 60 * MIN) }), T0 + 61 * MIN)).toBe(true);
  });
  it('O/P: some depois do horário final (término inclusivo)', () => {
    const c = offer({ id: 'x', startAt: iso(T0 - MIN), endAt: iso(T0 + 30 * MIN) });
    expect(isCardLiveAt(c, T0 + 30 * MIN)).toBe(true);
    expect(isCardLiveAt(c, T0 + 30 * MIN + 1)).toBe(false);
  });
  it('usa startDate/endDate legados quando startAt/endAt ausentes', () => {
    const c = offer({ id: 'x', startDate: iso(T0 + MIN), endDate: iso(T0 + 2 * MIN) });
    expect(isCardLiveAt(c, T0)).toBe(false);
    expect(isCardLiveAt(c, T0 + 90_000)).toBe(true);
    expect(isCardLiveAt(c, T0 + 3 * MIN)).toBe(false);
  });
  it('"sem data de término" mantém o card visível', () => {
    expect(isCardLiveAt(offer({ id: 'x', noEndDate: true, endAt: iso(T0 - MIN) }), T0)).toBe(true);
    expect(isCardLiveAt(offer({ id: 'x' }), T0)).toBe(true);
  });
});

describe('getCardDisplayDurationMs — duração real do vídeo / duração configurada da imagem', () => {
  it('R: vídeo usa a duração REAL detectada (videoDuration)', () => {
    expect(getCardDisplayDurationMs({ mediaType: 'VIDEO', videoDuration: 12.4, durationSeconds: 5 })).toBe(12400);
  });
  it('vídeo sem videoDuration usa durationSeconds; sem nenhum, 10 s', () => {
    expect(getCardDisplayDurationMs({ mediaType: 'VIDEO', durationSeconds: 7 })).toBe(7000);
    expect(getCardDisplayDurationMs({ mediaType: 'VIDEO' })).toBe(10000);
  });
  it('Q: imagem usa durationSeconds configurado; padrão 5 s; mínimo 1 s', () => {
    expect(getCardDisplayDurationMs({ mediaType: 'IMAGE', durationSeconds: 8 })).toBe(8000);
    expect(getCardDisplayDurationMs({ mediaType: 'IMAGE' })).toBe(5000);
    expect(getCardDisplayDurationMs({ mediaType: 'IMAGE', durationSeconds: 0.2 })).toBe(1000);
    expect(getCardDisplayDurationMs({ mediaType: 'IMAGE', durationSeconds: -3 })).toBe(5000);
  });
});

describe('sortCardsForDisplay — ordem estável', () => {
  it('ordena por order e preserva a ordem recebida em empates', () => {
    const list = [offer({ id: 'c', order: 2 }), offer({ id: 'a', order: 1 }), offer({ id: 'b', order: 1 })];
    expect(sortCardsForDisplay(list).map(o => o.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('campaignCardToPromoCard', () => {
  const cmp = campaign({ id: 'cmp1', startAt: iso(T0 - MIN) });
  it('card com produto do tenant abre o produto; sem checkout próprio', () => {
    const c = campaignCardToPromoCard(cmp, card({
      id: 'k1', campaignId: 'cmp1', destinationType: 'PRODUCT', productId: 'p1',
      product: { id: 'p1', name: 'Cerveja', price: 10, promotionalPrice: 8, isAvailable: true },
    }), 5);
    expect(c.destinationType).toBe('PRODUCT');
    expect(c.productId).toBe('p1');
    expect(c.hasPromoCheckout).toBe(false);
    expect(c.source).toBe('CAMPAIGN_CARD');
    expect(c.order).toBe(5);
  });
  it('CUSTOM_OFFER de campanha vira card visual (não existe RPC de checkout para campaign_cards)', () => {
    const c = campaignCardToPromoCard(cmp, card({
      id: 'k2', campaignId: 'cmp1', destinationType: 'CUSTOM_OFFER', customTitle: 'Combo', customPrice: 30, customPromotionalPrice: 20,
    }), 1);
    expect(c.destinationType).toBe('BANNER_ONLY');
    expect(c.hasPromoCheckout).toBe(false);
    expect(c.title).toBe('Combo');
    expect(c.promotionalPrice).toBe(20);
  });
  it('overlay on/off e vídeo preservados; agenda vem da campanha; cupom vira selo', () => {
    const c = campaignCardToPromoCard(campaign({ id: 'cmp2', startAt: iso(T0), endAt: iso(T0 + MIN), noEndDate: false }), card({
      id: 'k3', campaignId: 'cmp2', mediaType: 'VIDEO', videoDuration: 9.5, autoOverlay: true,
      coupon: { id: 'cp', code: 'FDS10', discountType: 'PERCENTAGE', discountValue: 10, timesUsed: 0 },
    }), 1);
    expect(c.mediaType).toBe('VIDEO');
    expect(c.videoDuration).toBe(9.5);
    expect(c.autoOverlay).toBe(true);
    expect(c.displayMode).toBe('EDITABLE_CARD');
    expect(c.startAt).toBe(iso(T0));
    expect(c.endAt).toBe(iso(T0 + MIN));
    expect(c.badge).toBe('Cupom FDS10');
  });
});

describe('buildStorefrontCards — lista final da vitrine', () => {
  const offers = [
    offer({ id: 'o2', order: 2 }),
    offer({ id: 'o1', order: 1, mediaType: 'VIDEO', videoDuration: 8 }),
    offer({ id: 'oFuture', order: 3, startAt: iso(T0 + 60 * MIN) }),
    offer({ id: 'oExpired', order: 4, endAt: iso(T0 - MIN) }),
    offer({ id: 'oOff', order: 5, isActive: false }),
    offer({ id: 'oB', order: 0, tenantId: TENANT_B }),
  ];
  const campaigns = [
    campaign({
      id: 'cmpLate', displayOrder: 2,
      cards: [card({ id: 'late1', campaignId: 'cmpLate' })],
    }),
    campaign({
      id: 'cmpMain', displayOrder: 1,
      cards: [
        card({ id: 'm3', campaignId: 'cmpMain', displayOrder: 3, mediaType: 'VIDEO', videoDuration: 6 }),
        card({ id: 'm1', campaignId: 'cmpMain', displayOrder: 1 }),
        card({ id: 'mOff', campaignId: 'cmpMain', displayOrder: 2, isActive: false }),
        card({ id: 'mB', campaignId: 'cmpMain', displayOrder: 0, tenantId: TENANT_B }),
      ],
    }),
    campaign({ id: 'cmpFuture', startAt: iso(T0 + 60 * MIN), cards: [card({ id: 'f1', campaignId: 'cmpFuture' })] }),
    campaign({ id: 'cmpB', tenantId: TENANT_B, cards: [card({ id: 'b1', campaignId: 'cmpB', tenantId: TENANT_B })] }),
  ];

  it('S/F: offers ordenados + múltiplos cards da mesma campanha ordenados; ocultos/expirados/futuros fora', () => {
    const ids = buildStorefrontCards(offers, campaigns, T0, TENANT_A).map(c => c.id);
    expect(ids).toEqual(['o1', 'o2', 'm1', 'm3', 'late1']);
  });

  it('T: isolamento — nada do tenant B aparece na vitrine do tenant A', () => {
    const list = buildStorefrontCards(offers, campaigns, T0, TENANT_A);
    expect(list.every(c => c.tenantId === TENANT_A)).toBe(true);
    expect(list.map(c => c.id)).not.toContain('oB');
    expect(list.map(c => c.id)).not.toContain('mB');
    expect(list.map(c => c.id)).not.toContain('b1');
  });

  it('K–N: card/campanha agendados aparecem a partir do início (relógio do servidor)', () => {
    const ids = buildStorefrontCards(offers, campaigns, T0 + 60 * MIN, TENANT_A).map(c => c.id);
    expect(ids).toContain('oFuture');
    expect(ids).toContain('f1');
  });

  it('a ordem final é preservada pelo sort do carrossel (campaign cards após os offers)', () => {
    const list = buildStorefrontCards(offers, campaigns, T0, TENANT_A);
    expect(sortCardsForDisplay(list).map(c => c.id)).toEqual(list.map(c => c.id));
  });

  it('remove ids repetidos', () => {
    const dup = [offer({ id: 'o1', order: 1 }), offer({ id: 'o1', order: 1 })];
    expect(buildStorefrontCards(dup, [], T0, TENANT_A)).toHaveLength(1);
  });
});
