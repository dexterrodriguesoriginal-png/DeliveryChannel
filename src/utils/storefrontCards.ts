/**
 * Regras puras (sem React, sem Supabase) da vitrine de cards promocionais.
 *
 * Fonte dos dados: get_public_store (migration 027), que já devolve SOMENTE cards
 * publicados no instante da consulta (is_active, início <= agora, término >= agora)
 * e SOMENTE do tenant do slug. Estas funções reaplicam as mesmas regras no navegador
 * para que um card que EXPIRA com a página aberta suma sem recarregar, usando o
 * relógio do servidor (serverTime) corrigido pelo offset, e não o relógio do aparelho.
 */
import { Campaign, CampaignCard, Offer } from '../types';

export const DEFAULT_IMAGE_DURATION_SECONDS = 5;
export const DEFAULT_VIDEO_DURATION_SECONDS = 10;
export const MIN_SLIDE_DURATION_MS = 1000;

function parseTime(value?: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Card visível no instante `nowMs`? Mesma regra do servidor:
 * ativo AND (sem início OR início <= agora) AND (sem término OR término >= agora).
 */
export function isCardLiveAt(card: Pick<Offer, 'isActive' | 'startAt' | 'startDate' | 'endAt' | 'endDate' | 'noEndDate'>, nowMs: number): boolean {
  if (!card.isActive) return false;
  const start = parseTime(card.startAt || card.startDate);
  if (start !== null && start > nowMs) return false;
  if (card.noEndDate) return true;
  const end = parseTime(card.endAt || card.endDate);
  if (end !== null && end < nowMs) return false;
  return true;
}

/**
 * Duração de exibição do slide em ms.
 * - VÍDEO: duração real do arquivo (videoDuration detectada no upload); se ausente,
 *   durationSeconds; se ausente, 10 s. No carrossel o avanço real acontece no evento
 *   `ended` do vídeo; este valor serve para a barra de progresso e como referência.
 * - IMAGEM: durationSeconds configurado no painel (padrão 5 s).
 */
export function getCardDisplayDurationMs(card: Pick<Offer, 'mediaType' | 'videoDuration' | 'durationSeconds'>): number {
  const seconds = card.mediaType === 'VIDEO'
    ? (positive(card.videoDuration) ?? positive(card.durationSeconds) ?? DEFAULT_VIDEO_DURATION_SECONDS)
    : (positive(card.durationSeconds) ?? DEFAULT_IMAGE_DURATION_SECONDS);
  return Math.max(MIN_SLIDE_DURATION_MS, Math.round(seconds * 1000));
}

function positive(value?: number | null): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Ordenação estável por `order` (empate mantém a ordem recebida do servidor). */
export function sortCardsForDisplay<T extends Pick<Offer, 'order'>>(cards: T[]): T[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => (Number(a.card.order) || 0) - (Number(b.card.order) || 0) || a.index - b.index)
    .map(x => x.card);
}

/**
 * Converte um card de campanha (tabela campaign_cards, migration 025) no formato
 * de card da vitrine. O agendamento é o da CAMPANHA (campaign.startAt/endAt).
 *
 * Destino:
 * - PRODUCT com produto do mesmo tenant → abre o produto do catálogo;
 * - BANNER_ONLY → apenas visual;
 * - CUSTOM_OFFER → exibido como card visual (com preço informativo). Não existe RPC
 *   de checkout para campaign_cards (o checkout próprio é do card do painel, tabela
 *   offers); abrir o checkout com o id do campaign_card faria o pedido falhar.
 */
export function campaignCardToPromoCard(campaign: Campaign, card: CampaignCard, order: number): Offer {
  const productId = card.destinationType === 'PRODUCT' && card.product ? card.product.id : undefined;
  const isCustom = card.destinationType === 'CUSTOM_OFFER';
  const couponBadge = card.coupon && !card.coupon.isExhausted ? `Cupom ${card.coupon.code}` : undefined;

  return {
    id: card.id,
    tenantId: card.tenantId,
    source: 'CAMPAIGN_CARD',
    campaignId: campaign.id,
    title: (isCustom ? card.customTitle : undefined) || card.title || campaign.name,
    subtitle: (isCustom ? card.customDescription : undefined) || card.subtitle || undefined,
    description: card.description || '',
    badge: card.badge || couponBadge,
    ctaText: card.ctaText || undefined,
    mediaType: card.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
    mediaUrl: card.mediaUrl,
    imageUrl: card.mediaUrl,
    durationSeconds: card.durationSeconds,
    videoDuration: card.videoDuration,
    autoOverlay: card.autoOverlay,
    displayMode: card.autoOverlay ? 'EDITABLE_CARD' : 'FULL_MEDIA',
    cardFormat: 'HORIZONTAL',
    destinationType: productId ? 'PRODUCT' : 'BANNER_ONLY',
    productId,
    hasPromoCheckout: false,
    promotionalPrice: isCustom
      ? card.customPromotionalPrice
      : (productId ? card.product?.promotionalPrice : undefined),
    originalPrice: isCustom ? card.customPrice : (productId ? card.product?.price : undefined),
    discountPercentage: isCustom ? card.customDiscountPercentage : undefined,
    backgroundColor: card.backgroundColor,
    accentColor: card.accentColor,
    isActive: campaign.isActive && card.isActive,
    startAt: campaign.startAt,
    startDate: campaign.startAt,
    endAt: campaign.noEndDate ? undefined : campaign.endAt,
    endDate: campaign.noEndDate ? undefined : campaign.endAt,
    noEndDate: campaign.noEndDate,
    order,
  };
}

/**
 * Lista final da vitrine:
 *  1) cards do painel (offers) na ordem configurada (display_order);
 *  2) em seguida, cards das campanhas publicadas, na ordem da campanha e do card.
 * Filtra pelo instante `nowMs` (relógio do servidor), pelo tenant da loja e remove ids repetidos.
 */
export function buildStorefrontCards(
  offers: Offer[],
  campaigns: Campaign[],
  nowMs: number,
  tenantId?: string
): Offer[] {
  const sameTenant = (c: { tenantId: string }) => !tenantId || c.tenantId === tenantId;

  const offerCards = sortCardsForDisplay(offers.filter(sameTenant));
  const maxOfferOrder = offerCards.reduce((max, o) => Math.max(max, Number(o.order) || 0), 0);

  const campaignCards: Offer[] = [];
  const sortedCampaigns = [...campaigns]
    .map((c, index) => ({ c, index }))
    .sort((a, b) => (a.c.displayOrder || 0) - (b.c.displayOrder || 0) || a.index - b.index)
    .map(x => x.c);
  for (const campaign of sortedCampaigns) {
    if (!sameTenant(campaign)) continue;
    const cards = [...campaign.cards]
      .map((card, index) => ({ card, index }))
      .sort((a, b) => (a.card.displayOrder || 0) - (b.card.displayOrder || 0) || a.index - b.index)
      .map(x => x.card);
    for (const card of cards) {
      if (!sameTenant(card) || card.campaignId !== campaign.id) continue;
      campaignCards.push(campaignCardToPromoCard(campaign, card, maxOfferOrder + 1 + campaignCards.length));
    }
  }

  const seen = new Set<string>();
  return [...offerCards, ...campaignCards].filter(card => {
    const key = `${card.source || 'OFFER'}:${card.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return isCardLiveAt(card, nowMs);
  });
}
