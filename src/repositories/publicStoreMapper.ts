/**
 * Mapeamento ESTRITO do retorno de `get_public_store(p_slug)` (versão final da migration 027)
 * para os tipos da vitrine. Função pura: sem Supabase, sem React — testável em Node.
 *
 * Formato real retornado pelo banco (jsonb):
 *   tenant      { id, slug, name, phone, email, category, status }
 *   theme       to_jsonb(tenant_themes)   → chaves snake_case (store_name, primary_color, ...)
 *   settings    to_jsonb(tenant_settings) → chaves snake_case (is_open, delivery_fee, ...)
 *   categories  [{ id, tenantId, name, description, imageUrl, order, isActive }]
 *   products    [{ id, tenantId, categoryId, name, description, imageUrl, price, promotionalPrice, unit, isAvailable, isActive, isFeatured }]
 *   offers      [cards do painel publicados agora — camelCase]
 *   promotionCarousels [...]
 *   campaigns   [{ id, tenantId, name, status, startAt, endAt, noEndDate, isActive, displayOrder, cards: [...] }]
 *   serverTime  timestamptz (ISO)
 *
 * Nada aqui usa `any` ou cast frouxo: cada campo é lido e validado; o que não pertence
 * ao tenant do slug é descartado (defesa em profundidade além do filtro do servidor).
 */
import {
  Campaign,
  CampaignCard,
  CampaignCardDestination,
  CampaignCardModel,
  CampaignStatus,
  CardDestination,
  CardFormat,
  CardMediaType,
  Category,
  Offer,
  Product,
  PromoCardModel,
  PromotionCarousel,
  PromotionCarouselItem,
  PromotionDiscountType,
  TenantSettings,
  TenantTheme,
} from '../types';

export interface PublicStoreTenant {
  id: string;
  slug: string;
  name: string;
  phone: string;
  email: string;
  category: string;
  status: string;
}

export interface PublicStoreData {
  tenant: PublicStoreTenant;
  theme: TenantTheme;
  settings: TenantSettings;
  categories: Category[];
  products: Product[];
  offers: Offer[];
  promotionCarousels: PromotionCarousel[];
  /** Campanhas publicadas (modelo campaigns/campaign_cards da migration 025). */
  campaigns: Campaign[];
  /** serverTime − relógio local no recebimento (ms). Usado para filtrar expiração com o relógio do servidor. */
  serverTimeOffsetMs: number;
}

export class PublicStorePayloadError extends Error {
  constructor(message: string) {
    super(`Resposta inválida de get_public_store: ${message}`);
    this.name = 'PublicStorePayloadError';
  }
}

// ---------------------------------------------------------------------------
// Leitores tipados de valores desconhecidos
// ---------------------------------------------------------------------------
type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function obj(v: unknown): Obj {
  return isObj(v) ? v : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
function posNum(v: unknown): number | undefined {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
}
function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
function listOf<T extends string>(v: unknown, allowed: readonly T[], fallback: readonly T[]): T[] {
  const list = arr(v).filter((x): x is T => typeof x === 'string' && (allowed as readonly string[]).includes(x));
  return list.length > 0 ? list : [...fallback];
}
/** Lê a primeira chave presente (camelCase ou snake_case). */
function pick(o: Obj, ...keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

const CARD_FORMATS: readonly CardFormat[] = ['HORIZONTAL', 'SQUARE', 'QUADRADO', 'VERTICAL'];
const MEDIA_TYPES: readonly CardMediaType[] = ['IMAGE', 'VIDEO'];
const CARD_MODELS: readonly PromoCardModel[] = ['HERO', 'HIGHLIGHT', 'ANIMATED'];
const DESTINATIONS: readonly CardDestination[] = ['BANNER_ONLY', 'PRODUCT', 'CUSTOM_OFFER'];
const FULFILLMENT = ['DELIVERY', 'PICKUP'] as const;
const PAYMENTS = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'] as const;
const CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'SOLD_OUT', 'ARCHIVED'];
const CAMPAIGN_MODELS: readonly CampaignCardModel[] = ['FULL_MEDIA', 'PROMO_CARD', 'OFFER_CARD'];
const CAMPAIGN_DESTINATIONS: readonly CampaignCardDestination[] = ['PRODUCT', 'BANNER_ONLY', 'CUSTOM_OFFER'];
const DISCOUNT_TYPES: readonly PromotionDiscountType[] = ['PERCENTAGE', 'FIXED_AMOUNT', 'PROMOTIONAL_PRICE'];

const DEFAULT_THEME: TenantTheme = {
  primaryColor: '#15803d',
  secondaryColor: '#166534',
  backgroundColor: '#f8fafc',
  cardColor: '#ffffff',
  buttonColor: '#15803d',
  textColor: '#0f172a',
  borderRadius: '1rem',
  fontFamily: 'Inter',
  storeName: '',
  tagline: '',
};

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------
export function mapTheme(raw: unknown, tenantName: string): TenantTheme {
  const t = obj(raw);
  return {
    primaryColor: str(pick(t, 'primaryColor', 'primary_color')) || DEFAULT_THEME.primaryColor,
    secondaryColor: str(pick(t, 'secondaryColor', 'secondary_color')) || DEFAULT_THEME.secondaryColor,
    backgroundColor: str(pick(t, 'backgroundColor', 'background_color')) || DEFAULT_THEME.backgroundColor,
    cardColor: str(pick(t, 'cardColor', 'card_color')) || DEFAULT_THEME.cardColor,
    buttonColor: str(pick(t, 'buttonColor', 'button_color')) || undefined,
    textColor: str(pick(t, 'textColor', 'text_color')) || DEFAULT_THEME.textColor,
    borderRadius: str(pick(t, 'borderRadius', 'border_radius')) || DEFAULT_THEME.borderRadius,
    fontFamily: str(pick(t, 'fontFamily', 'font_family')) || DEFAULT_THEME.fontFamily,
    bannerUrl: str(pick(t, 'bannerUrl', 'banner_url')),
    logoUrl: str(pick(t, 'logoUrl', 'logo_url')),
    storeName: str(pick(t, 'storeName', 'store_name')) || tenantName,
    tagline: str(pick(t, 'tagline')) || '',
  };
}

export function mapSettings(raw: unknown): TenantSettings {
  const s = obj(raw);
  return {
    isOpen: bool(pick(s, 'isOpen', 'is_open'), true),
    minOrderValue: num(pick(s, 'minOrderValue', 'min_order_value')) ?? 0,
    deliveryFee: num(pick(s, 'deliveryFee', 'delivery_fee')) ?? 0,
    freeDeliveryThreshold: num(pick(s, 'freeDeliveryThreshold', 'free_delivery_threshold')),
    estimatedDeliveryTime: str(pick(s, 'estimatedDeliveryTime', 'estimated_delivery_time')) || '30-45 min',
    defaultPrepTimeMinutes: num(pick(s, 'defaultPrepTimeMinutes', 'default_prep_time_minutes')) ?? 30,
    address: str(pick(s, 'address')) || '',
    city: str(pick(s, 'city')) || 'São Paulo',
    phoneWhatsApp: str(pick(s, 'phoneWhatsApp', 'phone_whatsapp')) || '',
    pixKey: str(pick(s, 'pixKey', 'pix_key')),
  };
}

function mapCategory(raw: unknown): Category | null {
  const c = obj(raw);
  const id = str(c.id);
  if (!id) return null;
  return {
    id,
    tenantId: str(c.tenantId) || '',
    name: str(c.name) || '',
    description: str(c.description),
    imageUrl: str(c.imageUrl),
    order: num(c.order) ?? 0,
    isActive: bool(c.isActive, true),
    isDemo: false,
  };
}

function mapProduct(raw: unknown): Product | null {
  const p = obj(raw);
  const id = str(p.id);
  if (!id) return null;
  const isAvailable = bool(p.isAvailable);
  return {
    id,
    tenantId: str(p.tenantId) || '',
    categoryId: str(p.categoryId) || '',
    name: str(p.name) || '',
    description: str(p.description) || '',
    imageUrl: str(p.imageUrl) || '',
    price: num(p.price) ?? 0,
    promotionalPrice: posNum(p.promotionalPrice),
    unit: str(p.unit) || 'un',
    // A RPC pública não expõe estoque real; apenas disponibilidade.
    stockQuantity: isAvailable ? 99 : 0,
    isAvailable,
    isActive: bool(p.isActive),
    isFeatured: bool(p.isFeatured),
    isDemo: false,
  };
}

export function mapOffer(raw: unknown): Offer | null {
  const o = obj(raw);
  const id = str(o.id);
  const tenantId = str(o.tenantId);
  if (!id || !tenantId) return null;

  const productId = str(o.productId);
  const mediaUrl = str(o.mediaUrl) || str(o.imageUrl);
  const autoOverlay = bool(o.autoOverlay, true);
  const startAt = str(o.startAt) || str(o.startDate);
  const endAt = str(o.endAt) || str(o.endDate);
  const promoUsageLimit = posNum(o.promoUsageLimit);
  const promoTimesUsed = num(o.promoTimesUsed) ?? 0;
  const remainingRaw = num(o.remainingUses);
  let destinationType = oneOf(o.destinationType, DESTINATIONS, productId ? 'PRODUCT' : 'BANNER_ONLY');
  if (destinationType === 'BANNER_ONLY' && productId) destinationType = 'PRODUCT';

  return {
    id,
    tenantId,
    source: 'OFFER',
    productId,
    title: str(o.title) || '',
    subtitle: str(o.subtitle),
    description: str(o.description) || '',
    badge: str(o.badge),
    discountPercentage: posNum(o.discountPercentage),
    originalPrice: posNum(o.originalPrice),
    promotionalPrice: posNum(o.promotionalPrice),
    mediaUrl,
    imageUrl: mediaUrl,
    mediaType: oneOf(o.mediaType, MEDIA_TYPES, 'IMAGE'),
    // displayMode NÃO é coluna: deriva de auto_overlay (o servidor envia o mesmo valor derivado).
    displayMode: autoOverlay ? 'EDITABLE_CARD' : 'FULL_MEDIA',
    autoOverlay,
    cardModel: oneOf(o.cardModel, CARD_MODELS, 'HERO'),
    cardFormat: oneOf(o.cardFormat, CARD_FORMATS, 'HORIZONTAL'),
    durationSeconds: posNum(o.durationSeconds) ?? 5,
    videoDuration: posNum(o.videoDuration),
    detectedWidth: posNum(o.detectedWidth),
    detectedHeight: posNum(o.detectedHeight),
    aspectRatio: str(o.aspectRatio) || '16:9',
    internalTitle: str(o.internalTitle),
    internalDescription: str(o.internalDescription),
    internalLink: str(o.internalLink),
    order: num(o.order) ?? 0,
    backgroundColor: str(o.backgroundColor) || '#15803d',
    accentColor: str(o.accentColor) || '#ffffff',
    startAt,
    startDate: startAt,
    endAt,
    endDate: endAt,
    noEndDate: bool(o.noEndDate, !endAt),
    isActive: bool(o.isActive),
    createdAt: str(o.createdAt),
    isDemo: false,

    destinationType,
    hasPromoCheckout: bool(o.hasPromoCheckout),
    promoTitle: str(o.promoTitle),
    promoDescription: str(o.promoDescription),
    promoPrice: posNum(o.promoPrice),
    promoOriginalPrice: posNum(o.promoOriginalPrice),
    promoDiscountPercentage: posNum(o.promoDiscountPercentage),
    promoUnit: str(o.promoUnit) || 'un',
    promoMinQuantity: posNum(o.promoMinQuantity) ?? 1,
    promoMaxQuantityPerCustomer: posNum(o.promoMaxQuantityPerCustomer) ?? 10,
    promoNotes: str(o.promoNotes),
    promoFulfillmentTypes: listOf(o.promoFulfillmentTypes, FULFILLMENT, FULFILLMENT),
    promoPaymentMethods: listOf(o.promoPaymentMethods, PAYMENTS, PAYMENTS),
    promoCouponCode: str(o.promoCouponCode),
    promoUsageLimit,
    promoTimesUsed,
    isExhausted: bool(o.isExhausted, Boolean(promoUsageLimit && promoTimesUsed >= promoUsageLimit)),
    remainingUses: remainingRaw !== undefined
      ? remainingRaw
      : (promoUsageLimit ? Math.max(0, promoUsageLimit - promoTimesUsed) : null),
  };
}

function mapCarouselItem(raw: unknown): PromotionCarouselItem | null {
  const i = obj(raw);
  const id = str(i.id);
  if (!id) return null;
  const product = i.product === undefined || i.product === null ? null : mapProduct(i.product);
  return {
    id,
    carouselId: str(i.carouselId) || '',
    productId: str(i.productId) || '',
    tenantId: str(i.tenantId) || '',
    product: product || undefined,
    discountType: oneOf(i.discountType, DISCOUNT_TYPES, 'PERCENTAGE'),
    discountValue: num(i.discountValue) ?? 0,
    promotionalPrice: num(i.promotionalPrice) ?? 0,
    calculatedDiscountPercentage: num(i.calculatedDiscountPercentage) ?? 0,
    showDiscountBadge: bool(i.showDiscountBadge, true),
    showPromotionalPrice: bool(i.showPromotionalPrice, true),
    startDate: str(i.startDate),
    endDate: str(i.endDate),
    isActive: bool(i.isActive, true),
    displayOrder: num(i.displayOrder) ?? 0,
  };
}

function mapCarousel(raw: unknown): PromotionCarousel | null {
  const c = obj(raw);
  const id = str(c.id);
  if (!id) return null;
  return {
    id,
    tenantId: str(c.tenantId) || '',
    name: str(c.name) || '',
    description: str(c.description),
    imageUrl: str(c.imageUrl),
    isActive: bool(c.isActive, true),
    showInStore: bool(c.showInStore, true),
    displayOrder: num(c.displayOrder) ?? 0,
    items: arr(c.items).map(mapCarouselItem).filter((x): x is PromotionCarouselItem => x !== null),
  };
}

export function mapCampaignCard(raw: unknown): CampaignCard | null {
  const c = obj(raw);
  const id = str(c.id);
  const campaignId = str(c.campaignId);
  const tenantId = str(c.tenantId);
  const mediaUrl = str(c.mediaUrl);
  if (!id || !campaignId || !tenantId || !mediaUrl) return null;

  const p = isObj(c.product) ? c.product : null;
  const productId = p ? str(p.id) : undefined;
  const cp = isObj(c.coupon) ? c.coupon : null;
  const couponId = cp ? str(cp.id) : undefined;
  const couponCode = cp ? str(cp.code) : undefined;

  return {
    id,
    campaignId,
    tenantId,
    displayOrder: num(c.displayOrder) ?? 0,
    model: oneOf(c.model, CAMPAIGN_MODELS, 'FULL_MEDIA'),
    mediaType: oneOf(c.mediaType, MEDIA_TYPES, 'IMAGE'),
    mediaUrl,
    storagePath: str(c.storagePath),
    durationSeconds: posNum(c.durationSeconds) ?? 5,
    videoDuration: posNum(c.videoDuration),
    title: str(c.title),
    subtitle: str(c.subtitle),
    description: str(c.description),
    badge: str(c.badge),
    ctaText: str(c.ctaText),
    autoOverlay: bool(c.autoOverlay, false),
    destinationType: oneOf(c.destinationType, CAMPAIGN_DESTINATIONS, 'BANNER_ONLY'),
    productId: str(c.productId),
    product: p && productId ? {
      id: productId,
      name: str(p.name) || '',
      imageUrl: str(p.imageUrl),
      price: num(p.price) ?? 0,
      promotionalPrice: posNum(p.promotionalPrice),
      unit: str(p.unit),
      isAvailable: bool(p.isAvailable),
    } : undefined,
    couponId: str(c.couponId),
    coupon: cp && couponId && couponCode ? {
      id: couponId,
      code: couponCode,
      discountType: oneOf(cp.discountType, ['PERCENTAGE', 'FIXED_AMOUNT'] as const, 'PERCENTAGE'),
      discountValue: num(cp.discountValue) ?? 0,
      usageLimit: posNum(cp.usageLimit),
      timesUsed: num(cp.timesUsed) ?? 0,
      remainingUses: num(cp.remainingUses) ?? null,
      isExhausted: bool(cp.isExhausted),
    } : undefined,
    customTitle: str(c.customTitle),
    customDescription: str(c.customDescription),
    customPrice: posNum(c.customPrice),
    customPromotionalPrice: posNum(c.customPromotionalPrice),
    customDiscountPercentage: posNum(c.customDiscountPercentage),
    customQuantityAvailable: posNum(c.customQuantityAvailable),
    customUnit: str(c.customUnit),
    customNotes: str(c.customNotes),
    backgroundColor: str(c.backgroundColor),
    accentColor: str(c.accentColor),
    isActive: bool(c.isActive),
  };
}

export function mapCampaign(raw: unknown, tenantId: string): Campaign | null {
  const c = obj(raw);
  const id = str(c.id);
  if (!id || str(c.tenantId) !== tenantId) return null;
  const endAt = str(c.endAt);
  const cards = arr(c.cards)
    .map(mapCampaignCard)
    .filter((card): card is CampaignCard => card !== null && card.tenantId === tenantId && card.campaignId === id);
  return {
    id,
    tenantId,
    name: str(c.name) || '',
    description: str(c.description),
    status: oneOf(c.status, CAMPAIGN_STATUSES, 'DRAFT'),
    startAt: str(c.startAt),
    endAt,
    noEndDate: bool(c.noEndDate, !endAt),
    timezone: str(c.timezone) || 'America/Sao_Paulo',
    isActive: bool(c.isActive),
    displayOrder: num(c.displayOrder) ?? 0,
    cards,
  };
}

/**
 * Converte o payload bruto do get_public_store em PublicStoreData.
 * @param raw         retorno da RPC (jsonb já desserializado)
 * @param receivedAtMs relógio local no momento do recebimento (para o offset do servidor)
 */
export function mapPublicStorePayload(raw: unknown, receivedAtMs: number = Date.now()): PublicStoreData {
  if (!isObj(raw)) throw new PublicStorePayloadError('payload não é um objeto');
  const t = obj(raw.tenant);
  const tenantId = str(t.id);
  const slug = str(t.slug);
  if (!tenantId || !slug) throw new PublicStorePayloadError('tenant ausente');

  const tenant: PublicStoreTenant = {
    id: tenantId,
    slug,
    name: str(t.name) || '',
    phone: str(t.phone) || '',
    email: str(t.email) || '',
    category: str(t.category) || 'ADEGA',
    status: str(t.status) || 'ACTIVE',
  };

  const sameTenant = <T extends { tenantId: string }>(x: T | null): x is T => x !== null && x.tenantId === tenantId;

  const serverMs = str(raw.serverTime) ? new Date(String(raw.serverTime)).getTime() : NaN;

  return {
    tenant,
    theme: mapTheme(raw.theme, tenant.name),
    settings: mapSettings(raw.settings),
    categories: arr(raw.categories).map(mapCategory).filter(sameTenant),
    products: arr(raw.products).map(mapProduct).filter(sameTenant),
    offers: arr(raw.offers).map(mapOffer).filter(sameTenant),
    promotionCarousels: arr(raw.promotionCarousels).map(mapCarousel).filter(sameTenant),
    campaigns: arr(raw.campaigns)
      .map(c => mapCampaign(c, tenantId))
      .filter((c): c is Campaign => c !== null),
    serverTimeOffsetMs: Number.isFinite(serverMs) ? serverMs - receivedAtMs : 0,
  };
}
