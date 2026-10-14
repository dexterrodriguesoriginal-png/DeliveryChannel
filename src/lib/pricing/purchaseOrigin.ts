/**
 * Preço por ORIGEM DA COMPRA (decisão do fundador, 13/10/2026).
 *
 *  - source 'catalog'  => preço vigente do produto no catálogo (inclui a promoção própria do produto).
 *  - source 'campaign' => preço do item de campanha (item de carrossel promocional) que o cliente selecionou,
 *                         somente se ativo, dentro da validade, do mesmo estabelecimento e do mesmo produto.
 *  - NUNCA escolhe automaticamente o menor preço entre as fontes.
 *  - Mesmo produto vindo de origens diferentes = linhas diferentes no carrinho (chave = produto + origem).
 *
 * Campanha inválida/expirada:
 *  - backend (demo e proposta SQL): RECUSA o pedido com erro claro (CAMPAIGN_ITEM_INVALID / CAMPAIGN_SOURCE_UNAVAILABLE);
 *  - front: revalida o carrinho e CONVERTE a linha para preço de catálogo, avisando o cliente.
 *
 * O navegador só envia { productId, quantity, notes, source, campaignItemId }. Preço nunca é enviado.
 */
import type { PricingLine } from './fulfillmentPricing';

export type PurchaseSource = 'catalog' | 'campaign';

export interface PurchaseOrigin {
  source: PurchaseSource;
  /** id do item de campanha (promotion_carousel_items.id) quando source = 'campaign'. */
  campaignItemId?: string | null;
  /** id da campanha/carrossel (apenas exibição/rastreio; a validação usa campaignItemId). */
  carouselId?: string | null;
}

export const CATALOG_ORIGIN: PurchaseOrigin = { source: 'catalog' };

export interface OriginProduct {
  id: string;
  tenantId?: string;
  price: number;
  promotionalPrice?: number | null;
  isActive?: boolean;
}

export interface OriginCampaignItem {
  id: string;
  carouselId: string;
  productId: string;
  tenantId: string;
  promotionalPrice: number;
  isActive: boolean;
  startDate?: string | null;
  endDate?: string | null;
}

export interface OriginCampaign {
  id: string;
  tenantId: string;
  isActive: boolean;
  showInStore?: boolean;
  /** N4: validade da campanha (carrossel). */
  startDate?: string | null;
  endDate?: string | null;
  items: OriginCampaignItem[];
}

export type CampaignInvalidReason =
  | 'CAMPAIGN_ITEM_NOT_FOUND'
  | 'CAMPAIGN_OTHER_TENANT'
  | 'CAMPAIGN_INACTIVE'
  | 'CAMPAIGN_NOT_STARTED'
  | 'CAMPAIGN_EXPIRED'
  | 'CAMPAIGN_PRODUCT_MISMATCH'
  | 'CAMPAIGN_PRICE_INVALID';

export const CAMPAIGN_REASON_TEXT: Record<CampaignInvalidReason, string> = {
  CAMPAIGN_ITEM_NOT_FOUND: 'a oferta selecionada não existe mais',
  CAMPAIGN_OTHER_TENANT: 'a oferta não pertence a este estabelecimento',
  CAMPAIGN_INACTIVE: 'a oferta foi desativada',
  CAMPAIGN_NOT_STARTED: 'a oferta ainda não começou',
  CAMPAIGN_EXPIRED: 'a oferta expirou',
  CAMPAIGN_PRODUCT_MISMATCH: 'a oferta não corresponde a este produto',
  CAMPAIGN_PRICE_INVALID: 'o preço da oferta é inválido',
};

export function normalizeOrigin(o: Partial<PurchaseOrigin> | null | undefined): PurchaseOrigin {
  if (o && o.source === 'campaign' && o.campaignItemId) {
    return { source: 'campaign', campaignItemId: o.campaignItemId, carouselId: o.carouselId || null };
  }
  return { source: 'catalog' };
}

/** Chave da linha do carrinho: produto + origem. Origens diferentes nunca se mesclam. */
export function cartLineKey(productId: string, origin?: Partial<PurchaseOrigin> | null): string {
  const o = normalizeOrigin(origin);
  return o.source === 'campaign' ? `${productId}::campaign::${o.campaignItemId}` : `${productId}::catalog`;
}

/** Preço vigente do produto no catálogo (regra N2: 0 < promo <= preço). */
export function catalogUnitPrice(p: OriginProduct): { unitPrice: number; isPromotional: boolean } {
  const promo = p.promotionalPrice;
  const has = promo !== undefined && promo !== null && promo > 0 && promo <= p.price;
  return { unitPrice: has ? (promo as number) : p.price, isPromotional: Boolean(has && (promo as number) < p.price) };
}

/** Localiza e valida o item de campanha exatamente referenciado (sem procurar "o menor"). */
export function validateCampaignItem(args: {
  campaigns: OriginCampaign[];
  tenantId: string;
  product: OriginProduct;
  campaignItemId: string;
  now?: Date;
}): { ok: true; item: OriginCampaignItem } | { ok: false; reason: CampaignInvalidReason } {
  const now = args.now || new Date();
  let found: { c: OriginCampaign; i: OriginCampaignItem } | null = null;
  for (const c of args.campaigns || []) {
    const i = (c.items || []).find((x) => x.id === args.campaignItemId);
    if (i) { found = { c, i }; break; }
  }
  if (!found) return { ok: false, reason: 'CAMPAIGN_ITEM_NOT_FOUND' };
  const { c, i } = found;
  if (c.tenantId !== args.tenantId || i.tenantId !== args.tenantId) return { ok: false, reason: 'CAMPAIGN_OTHER_TENANT' };
  if (args.product.tenantId && args.product.tenantId !== args.tenantId) return { ok: false, reason: 'CAMPAIGN_OTHER_TENANT' };
  if (i.productId !== args.product.id) return { ok: false, reason: 'CAMPAIGN_PRODUCT_MISMATCH' };
  if (!c.isActive || c.showInStore === false || !i.isActive) return { ok: false, reason: 'CAMPAIGN_INACTIVE' };
  if (c.startDate && new Date(c.startDate) > now) return { ok: false, reason: 'CAMPAIGN_NOT_STARTED' };
  if (c.endDate && new Date(c.endDate) <= now) return { ok: false, reason: 'CAMPAIGN_EXPIRED' };
  if (i.startDate && new Date(i.startDate) > now) return { ok: false, reason: 'CAMPAIGN_NOT_STARTED' };
  if (i.endDate && new Date(i.endDate) <= now) return { ok: false, reason: 'CAMPAIGN_EXPIRED' };
  const pp = Number(i.promotionalPrice);
  if (!Number.isFinite(pp) || pp <= 0 || pp >= args.product.price) return { ok: false, reason: 'CAMPAIGN_PRICE_INVALID' };
  return { ok: true, item: i };
}

export type OriginPriceResult =
  | { ok: true; line: PricingLine & { source: PurchaseSource; campaignItemId?: string | null } }
  | { ok: false; reason: CampaignInvalidReason };

/**
 * Preço autorizado de UMA linha conforme sua origem.
 * Item de campanha conta como "em promoção" (isPromotional = true) para 'excluir itens em promoção' e para o cupom (D2).
 * Exceções de retirada: productId (sempre) e offerId = campaignItemId (permite excluir uma campanha específica).
 */
export function priceLineByOrigin(args: {
  product: OriginProduct;
  quantity: number;
  origin?: Partial<PurchaseOrigin> | null;
  campaigns: OriginCampaign[];
  tenantId: string;
  now?: Date;
}): OriginPriceResult {
  const o = normalizeOrigin(args.origin);
  if (o.source === 'catalog') {
    const c = catalogUnitPrice(args.product);
    return { ok: true, line: { productId: args.product.id, quantity: args.quantity, unitPrice: c.unitPrice, isPromotional: c.isPromotional, source: 'catalog' } };
  }
  const v = validateCampaignItem({ campaigns: args.campaigns, tenantId: args.tenantId, product: args.product, campaignItemId: o.campaignItemId as string, now: args.now });
  if (!v.ok) return v;
  return {
    ok: true,
    line: {
      productId: args.product.id,
      offerId: v.item.id,
      quantity: args.quantity,
      unitPrice: Number(v.item.promotionalPrice),
      isPromotional: true,
      source: 'campaign',
      campaignItemId: v.item.id,
    },
  };
}

/** Linha genérica de carrinho com origem. */
export interface OriginCartLine<P extends OriginProduct = OriginProduct> {
  key: string;
  product: P;
  quantity: number;
  notes?: string;
  origin: PurchaseOrigin;
}

export function addToOriginCart<P extends OriginProduct>(cart: OriginCartLine<P>[], product: P, origin?: Partial<PurchaseOrigin> | null, qty = 1): OriginCartLine<P>[] {
  const o = normalizeOrigin(origin);
  const key = cartLineKey(product.id, o);
  if (cart.some((l) => l.key === key)) return cart.map((l) => (l.key === key ? { ...l, quantity: l.quantity + qty } : l));
  return [...cart, { key, product, quantity: qty, origin: o }];
}

export function decrementOriginCart<P extends OriginProduct>(cart: OriginCartLine<P>[], key: string): OriginCartLine<P>[] {
  const l = cart.find((x) => x.key === key);
  if (!l) return cart;
  if (l.quantity > 1) return cart.map((x) => (x.key === key ? { ...x, quantity: x.quantity - 1 } : x));
  return cart.filter((x) => x.key !== key);
}

/** Normaliza carrinho salvo (formato antigo sem origem => catálogo). */
export function hydrateOriginCart<P extends OriginProduct>(raw: any[]): OriginCartLine<P>[] {
  const out: OriginCartLine<P>[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || !r.product || !r.product.id) continue;
    const origin = normalizeOrigin(r.origin);
    const qty = Math.max(1, Math.floor(Number(r.quantity) || 1));
    const key = cartLineKey(r.product.id, origin);
    const ex = out.find((x) => x.key === key);
    if (ex) ex.quantity += qty;
    else out.push({ key, product: r.product, quantity: qty, notes: r.notes, origin });
  }
  return out;
}

/**
 * Revalida as linhas de campanha. Linhas inválidas viram catálogo (mesclando com uma linha de catálogo
 * já existente do mesmo produto) e são reportadas para o aviso ao cliente.
 */
export function revalidateOriginCart<P extends OriginProduct>(
  cart: OriginCartLine<P>[], campaigns: OriginCampaign[], tenantId: string, now?: Date,
): { cart: OriginCartLine<P>[]; converted: Array<{ productId: string; reason: CampaignInvalidReason }> } {
  const converted: Array<{ productId: string; reason: CampaignInvalidReason }> = [];
  let next: OriginCartLine<P>[] = [];
  for (const l of cart) {
    if (l.origin.source === 'campaign') {
      const v = validateCampaignItem({ campaigns, tenantId, product: l.product, campaignItemId: l.origin.campaignItemId as string, now });
      if (!v.ok) {
        converted.push({ productId: l.product.id, reason: v.reason });
        next = addToOriginCart(next, l.product, CATALOG_ORIGIN, l.quantity);
        continue;
      }
    }
    const ex = next.find((x) => x.key === l.key);
    if (ex) next = next.map((x) => (x.key === l.key ? { ...x, quantity: x.quantity + l.quantity } : x));
    else next.push(l);
  }
  return { cart: converted.length ? next : cart, converted };
}

/** Payload de item enviado ao backend (nunca contém preço). Campos de origem só para itens de campanha (compatível com N2). */
export function toCheckoutItem(l: { product: { id: string }; quantity: number; notes?: string; origin: PurchaseOrigin }) {
  const base: { productId: string; quantity: number; notes?: string; source?: 'campaign'; campaignItemId?: string } = {
    productId: l.product.id, quantity: l.quantity, notes: l.notes,
  };
  if (l.origin.source === 'campaign' && l.origin.campaignItemId) {
    base.source = 'campaign';
    base.campaignItemId = l.origin.campaignItemId;
  }
  return base;
}
