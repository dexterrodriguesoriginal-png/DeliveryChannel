import { Campaign, CampaignCard, CardDestination, Offer } from '../types';

/**
 * Utilitários para exibição e agendamento de cards na vitrine (Storefront).
 * Consolida cards do painel (offers) e cards de campanhas ativas.
 */

/**
 * Verifica se um card promocional está vigente no instante `nowMs`.
 */
export function isCardLiveAt(card: Partial<Offer>, nowMs: number = Date.now()): boolean {
  if (card.isActive === false) {
    return false;
  }

  const startStr = card.startAt || card.startDate;
  if (startStr) {
    const startMs = new Date(startStr).getTime();
    if (!isNaN(startMs) && startMs > nowMs) {
      return false; // Ainda não iniciou
    }
  }

  const endStr = card.endAt || card.endDate;
  if (endStr && !card.noEndDate) {
    const endMs = new Date(endStr).getTime();
    if (!isNaN(endMs) && endMs < nowMs) {
      return false; // Já expirou
    }
  }

  return true;
}

/**
 * Retorna a duração em milissegundos para exibição do card no carrossel.
 * Vídeos utilizam a duração detectada do arquivo (ou mínimo 1s); imagens utilizam a configurada.
 */
export function getCardDisplayDurationMs(card: Partial<Offer>): number {
  if (card.mediaType === 'VIDEO' && typeof card.videoDuration === 'number' && card.videoDuration > 0) {
    return Math.max(1000, Math.round(card.videoDuration * 1000));
  }
  if (typeof card.durationSeconds === 'number' && card.durationSeconds > 0) {
    return Math.max(1000, Math.round(card.durationSeconds * 1000));
  }
  return 5000;
}

/**
 * Ordena os cards para exibição de forma estável por `order` / `displayOrder`.
 */
export function sortCardsForDisplay(cards: Offer[]): Offer[] {
  return [...cards].sort((a, b) => {
    const orderA = a.order ?? (a as { displayOrder?: number }).displayOrder ?? 0;
    const orderB = b.order ?? (b as { displayOrder?: number }).displayOrder ?? 0;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return (a.id || '').localeCompare(b.id || '');
  });
}

/**
 * Converte um CampaignCard em um Offer padronizado para consumo no carrossel da vitrine.
 */
export function campaignCardToOffer(card: CampaignCard, campaign: Campaign): Offer {
  const autoOverlay = card.autoOverlay ?? false;
  const mediaUrl = card.mediaUrl || '';

  return {
    id: card.id,
    tenantId: card.tenantId,
    source: 'CAMPAIGN_CARD',
    title: card.title || campaign.name || '',
    subtitle: card.subtitle,
    description: card.description || campaign.description,
    badge: card.badge,
    cardModel: card.model === 'FULL_MEDIA' ? 'HERO' : (card.model === 'PROMO_CARD' ? 'HIGHLIGHT' : 'ANIMATED'),
    cardFormat: 'HORIZONTAL',
    mediaType: card.mediaType || 'IMAGE',
    mediaUrl,
    imageUrl: mediaUrl,
    durationSeconds: card.durationSeconds ?? 5,
    videoDuration: card.videoDuration,
    autoOverlay,
    displayMode: autoOverlay ? 'EDITABLE_CARD' : 'FULL_MEDIA',
    destinationType: (card.destinationType as CardDestination) || 'BANNER_ONLY',
    productId: card.productId || card.product?.id,
    order: card.displayOrder ?? 0,
    backgroundColor: card.backgroundColor || '#15803d',
    accentColor: card.accentColor || '#ffffff',
    isActive: Boolean(card.isActive && campaign.isActive && campaign.status === 'ACTIVE'),
    startDate: campaign.startAt,
    endDate: campaign.endAt,
    startAt: campaign.startAt,
    endAt: campaign.endAt,
    noEndDate: campaign.noEndDate,
    hasPromoCheckout: card.destinationType === 'CUSTOM_OFFER',
    promoTitle: card.customTitle,
    promoDescription: card.customDescription,
    promoPrice: card.customPromotionalPrice ?? card.customPrice,
    promoOriginalPrice: card.customPrice,
    promoDiscountPercentage: card.customDiscountPercentage,
    promoUnit: card.customUnit || 'un',
    promoNotes: card.customNotes,
    promoCouponCode: card.coupon?.code,
    internalLink: card.productId ? `/produto/${card.productId}` : undefined,
    createdAt: card.createdAt || campaign.createdAt,
    updatedAt: card.updatedAt || campaign.updatedAt,
  };
}

/**
 * Constrói a lista completa de cards para a vitrine pública:
 * - Cards diretos do painel (offers), marcados com source: 'OFFER'
 * - Cards de campanhas ativas publicadas, convertidos com source: 'CAMPAIGN_CARD'
 * Filtrados por vigência temporal no relógio `nowMs` e pertencimento ao `tenantId`.
 */
export function buildStorefrontCards(
  offers: Offer[] = [],
  campaigns: Campaign[] = [],
  nowMs: number = Date.now(),
  tenantId?: string
): Offer[] {
  // 1. Cards do painel (offers)
  const targetOffers = offers.filter(o => !tenantId || o.tenantId === tenantId);
  const liveOffers: Offer[] = targetOffers
    .filter(o => isCardLiveAt(o, nowMs))
    .map(o => ({
      ...o,
      source: (o.source || 'OFFER') as 'OFFER' | 'CAMPAIGN_CARD',
    }));

  // 2. Cards de campanhas
  const targetCampaigns = campaigns.filter(c => !tenantId || c.tenantId === tenantId);
  const campaignOffers: Offer[] = [];

  for (const campaign of targetCampaigns) {
    if (!campaign.isActive || campaign.status !== 'ACTIVE') {
      continue;
    }
    if (campaign.startAt) {
      const startMs = new Date(campaign.startAt).getTime();
      if (!isNaN(startMs) && startMs > nowMs) {
        continue;
      }
    }
    if (!campaign.noEndDate && campaign.endAt) {
      const endMs = new Date(campaign.endAt).getTime();
      if (!isNaN(endMs) && endMs < nowMs) {
        continue;
      }
    }

    const cards = campaign.cards || [];
    for (const card of cards) {
      if (!card.isActive) continue;
      if (tenantId && card.tenantId !== tenantId) continue;
      campaignOffers.push(campaignCardToOffer(card, campaign));
    }
  }

  return [...liveOffers, ...campaignOffers];
}
