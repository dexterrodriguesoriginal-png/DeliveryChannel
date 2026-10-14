/**
 * Mapeamento do get_public_store da N6 (VITE_BACKEND_SCHEMA=n1n6) para os tipos da vitrine.
 * Função pura (testável em Node). Diferenças em relação ao formato antigo:
 *  - mídia vem como { bucket: 'marketing-public', path, mediaType, ... } (só mídia PUBLICADA);
 *  - carrosséis vêm em `carousels` com preço efetivo calculado no servidor;
 *  - campanhas N5 (campaign_cards) viram cards da vitrine com campaignCardId/campaignId, e o
 *    checkout promocional envia p_card_id (a cadeia tenant→campanha→card→oferta→produto é do servidor);
 *  - sem e-mail, PIX, custo, estoque, contadores ou limites internos.
 */
import { Offer, Product, PromotionCarousel } from '../types';
import { mapPublicStorePayload, PublicStoreData, PublicStorePayloadError } from './publicStoreMapper';

export type MediaUrlResolver = (bucket: 'marketing-public', path: string) => string;

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const n = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};
const s = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

export interface N6Media {
  url: string;
  mediaType: 'IMAGE' | 'VIDEO';
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export function mapN6Media(raw: unknown, resolve: MediaUrlResolver): N6Media | undefined {
  if (!isObj(raw) || raw.bucket !== 'marketing-public' || !s(raw.path)) return undefined;
  return {
    url: resolve('marketing-public', raw.path),
    mediaType: raw.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
    width: n(raw.width),
    height: n(raw.height),
    durationSeconds: n(raw.durationSeconds),
  };
}

function fulfillmentTypes(f: unknown): ('DELIVERY' | 'PICKUP')[] {
  return f === 'DELIVERY' ? ['DELIVERY'] : f === 'PICKUP' ? ['PICKUP'] : ['DELIVERY', 'PICKUP'];
}
function fulfillmentOf(f: unknown): 'DELIVERY' | 'PICKUP' | 'BOTH' | undefined {
  return f === 'DELIVERY' || f === 'PICKUP' || f === 'BOTH' ? f : undefined;
}

export function mapN6Offer(o: Obj, tenantId: string, resolve: MediaUrlResolver): Offer | null {
  if (!s(o.id) || o.tenantId !== tenantId) return null;
  const media = mapN6Media(o.media, resolve);
  const hasPromo = Boolean(o.hasPromoCheckout);
  const fulfillment = fulfillmentOf(o.promoFulfillment);
  const mediaUrl = media ? media.url : s(o.imageUrl);
  return {
    id: o.id,
    tenantId,
    source: 'OFFER',
    productId: s(o.productId),
    title: s(o.title) || '',
    subtitle: s(o.subtitle),
    description: s(o.description) || '',
    badge: s(o.badge),
    discountPercentage: n(o.discountPercentage),
    originalPrice: n(o.originalPrice),
    promotionalPrice: n(o.promotionalPrice),
    mediaUrl,
    imageUrl: media && media.mediaType === 'IMAGE' ? media.url : s(o.imageUrl),
    mediaType: media ? media.mediaType : 'IMAGE',
    detectedWidth: media?.width,
    detectedHeight: media?.height,
    videoDuration: media?.mediaType === 'VIDEO' ? media.durationSeconds : undefined,
    autoOverlay: o.autoOverlay !== false,
    displayMode: o.autoOverlay !== false ? 'EDITABLE_CARD' : 'FULL_MEDIA',
    cardModel: 'HERO',
    cardFormat: 'HORIZONTAL',
    durationSeconds: 5,
    internalLink: s(o.internalLink),
    order: n(o.order) ?? 0,
    backgroundColor: s(o.backgroundColor) || '#15803d',
    accentColor: s(o.accentColor) || '#ffffff',
    isActive: Boolean(o.isActive),
    noEndDate: true,
    destinationType: hasPromo ? 'CUSTOM_OFFER' : s(o.productId) ? 'PRODUCT' : 'BANNER_ONLY',
    hasPromoCheckout: hasPromo,
    promoPrice: n(o.promoPrice),
    promoUnit: 'un',
    promoMinQuantity: 1,
    promoMaxQuantityPerCustomer: n(o.promoMaxQtyPerOrder) ?? 10,
    promoMaxQtyPerOrder: n(o.promoMaxQtyPerOrder),
    promoFulfillment: fulfillment,
    promoFulfillmentTypes: fulfillmentTypes(o.promoFulfillment),
    promoPaymentMethods: ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'],
    promoAvailable: Boolean(o.promoAvailable),
    isExhausted: hasPromo && !o.promoAvailable,
    remainingUses: null,
    isDemo: false,
  };
}

/** Card de campanha N6 → card da vitrine. BANNER_ONLY nunca compra; os demais compram por p_card_id. */
export function mapN6CampaignCard(c: Obj, k: Obj, tenantId: string, resolve: MediaUrlResolver): Offer | null {
  if (!s(c.id) || !s(c.campaignId) || c.campaignId !== k.id) return null;
  const mode = ['OFFER', 'PRODUCT', 'CUSTOM', 'BANNER_ONLY'].includes(c.mode) ? c.mode : 'BANNER_ONLY';
  const media = mapN6Media(c.media, resolve);
  const purchasable = mode !== 'BANNER_ONLY' && Boolean(c.purchasable);
  const fulfillment = fulfillmentOf(c.fulfillment);
  return {
    id: c.id,
    tenantId,
    source: 'CAMPAIGN_CARD',
    campaignId: k.id,
    campaignCardId: c.id,
    productId: s(c.productId),
    title: s(c.title) || s(c.customName) || s(k.title) || '',
    subtitle: s(c.subtitle),
    description: '',
    ctaText: s(c.ctaLabel),
    mediaUrl: media?.url,
    imageUrl: media && media.mediaType === 'IMAGE' ? media.url : undefined,
    mediaType: media ? media.mediaType : 'IMAGE',
    videoDuration: media?.mediaType === 'VIDEO' ? media.durationSeconds : undefined,
    autoOverlay: c.autoOverlay !== false,
    displayMode: c.autoOverlay !== false ? 'EDITABLE_CARD' : 'FULL_MEDIA',
    cardModel: 'HERO',
    cardFormat: 'HORIZONTAL',
    durationSeconds: 5,
    order: (n(k.order) ?? 0) * 1000 + (n(c.order) ?? 0),
    backgroundColor: '#15803d',
    accentColor: '#ffffff',
    isActive: true,
    noEndDate: true,
    destinationType: purchasable ? 'CUSTOM_OFFER' : s(c.productId) ? 'PRODUCT' : 'BANNER_ONLY',
    hasPromoCheckout: purchasable,
    promoTitle: s(c.customName),
    promoPrice: n(c.price),
    promoOriginalPrice: n(c.originalPrice),
    originalPrice: n(c.originalPrice),
    promotionalPrice: n(c.price),
    promoUnit: 'un',
    promoMinQuantity: 1,
    promoMaxQuantityPerCustomer: n(c.maxQtyPerOrder) ?? 10,
    promoMaxQtyPerOrder: n(c.maxQtyPerOrder),
    promoFulfillment: fulfillment,
    promoFulfillmentTypes: fulfillmentTypes(c.fulfillment),
    promoPaymentMethods: ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'],
    promoCouponCode: s(c.couponCode),
    promoAvailable: purchasable,
    isExhausted: false,
    remainingUses: null,
    isDemo: false,
  };
}

export function mapN6Carousels(raw: unknown, tenantId: string, products: Product[], resolve: MediaUrlResolver): PromotionCarousel[] {
  const byId = new Map(products.map(p => [p.id, p]));
  return (Array.isArray(raw) ? raw : []).filter(isObj).map((c: Obj): PromotionCarousel => {
    const cover = mapN6Media(c.cover, resolve);
    return {
      id: c.id,
      tenantId,
      name: s(c.name) || '',
      description: s(c.description),
      imageUrl: cover?.url,
      isActive: true,
      showInStore: true,
      displayOrder: n(c.order) ?? 0,
      items: (Array.isArray(c.items) ? c.items : [])
        .map((i: Obj, idx: number) => {
          const product = byId.get(i.productId);
          if (!product) return null;
          const price = n(i.price) ?? product.price;
          const eff = n(i.effectivePrice) ?? price;
          return {
            id: `${c.id}:${i.productId}`,
            carouselId: c.id,
            productId: i.productId,
            tenantId,
            product: { ...product, isAvailable: Boolean(i.isAvailable) && product.isAvailable },
            discountType: 'PROMOTIONAL_PRICE' as const,
            discountValue: eff,
            promotionalPrice: eff,
            calculatedDiscountPercentage: price > 0 && eff < price ? Math.round(((price - eff) / price) * 100) : 0,
            showDiscountBadge: Boolean(i.isPromotional),
            showPromotionalPrice: Boolean(i.isPromotional),
            isActive: true,
            displayOrder: n(i.order) ?? idx,
          };
        })
        .filter(Boolean) as PromotionCarousel['items'],
    };
  });
}

/** get_public_store (N6) → PublicStoreData. */
export function mapN6PublicStore(raw: unknown, resolve: MediaUrlResolver, receivedAtMs: number = Date.now()): PublicStoreData {
  if (!isObj(raw)) throw new PublicStorePayloadError('payload não é um objeto');
  // tenant/tema/configurações/categorias/produtos têm o mesmo formato: reaproveita o mapeador estrito.
  const base = mapPublicStorePayload({ ...raw, offers: [], promotionCarousels: [], campaigns: [] }, receivedAtMs);
  const tenantId = base.tenant.id;
  const offers = (Array.isArray(raw.offers) ? raw.offers : [])
    .filter(isObj)
    .map(o => mapN6Offer(o, tenantId, resolve))
    .filter((o): o is Offer => o !== null);
  const campaignCards: Offer[] = [];
  for (const k of Array.isArray(raw.campaigns) ? raw.campaigns : []) {
    if (!isObj(k) || !s(k.id)) continue;
    for (const c of Array.isArray(k.cards) ? k.cards : []) {
      if (!isObj(c)) continue;
      const card = mapN6CampaignCard(c, k, tenantId, resolve);
      if (card) campaignCards.push(card);
    }
  }
  return {
    ...base,
    settings: { ...base.settings, pixKey: undefined },
    offers: [...offers, ...campaignCards],
    promotionCarousels: mapN6Carousels(raw.carousels, tenantId, base.products, resolve),
    campaigns: [],
  };
}
