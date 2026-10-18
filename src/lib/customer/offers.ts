import type { Product, PromotionCarousel } from '../../types';
import { CATALOG_ORIGIN, PurchaseOrigin, catalogUnitPrice, validateCampaignItem } from '../pricing/purchaseOrigin';

export interface OfferListItem {
  key: string;
  product: Product;
  origin: PurchaseOrigin;
  originalPrice: number;
  offerPrice: number;
  discountPercent: number;
  /** Nome da campanha (carrossel) quando a oferta vem de campanha. */
  campaignName?: string;
  endsAt?: string;
  available: boolean;
}

export function discountPercent(original: number, price: number): number {
  if (!(original > 0) || !(price > 0) || price >= original) return 0;
  return Math.round(((original - price) / original) * 100);
}

const isAvailable = (p: Product) => (p.isAvailable !== undefined ? p.isAvailable : (p.stockQuantity ?? 1) > 0);

/**
 * Ofertas da loja: itens de campanha VÁLIDOS (mesma regra do preço do carrinho) + produtos do catálogo
 * com preço promocional próprio. Produto inativo ou de outra loja nunca entra. Ordena pelo maior desconto.
 */
export function buildOfferList(args: {
  products: Product[];
  carousels: PromotionCarousel[];
  tenantId: string;
  now?: Date;
}): OfferListItem[] {
  const now = args.now || new Date();
  const byId = new Map(args.products.filter(p => p.tenantId === args.tenantId && p.isActive !== false).map(p => [p.id, p]));
  const out: OfferListItem[] = [];
  for (const c of args.carousels || []) {
    for (const it of c.items || []) {
      const p = byId.get(it.productId);
      if (!p) continue;
      const v = validateCampaignItem({ campaigns: args.carousels, tenantId: args.tenantId, product: p, campaignItemId: it.id, now });
      if (!v.ok) continue;
      const price = Number(it.promotionalPrice);
      out.push({
        key: `c:${it.id}`,
        product: p,
        origin: { source: 'campaign', campaignItemId: it.id, carouselId: c.id },
        originalPrice: p.price,
        offerPrice: price,
        discountPercent: discountPercent(p.price, price),
        campaignName: c.name,
        endsAt: it.endDate || c.endDate || undefined,
        available: isAvailable(p),
      });
    }
  }
  for (const p of byId.values()) {
    const c = catalogUnitPrice(p);
    if (!c.isPromotional) continue;
    out.push({
      key: `p:${p.id}`,
      product: p,
      origin: CATALOG_ORIGIN,
      originalPrice: p.price,
      offerPrice: c.unitPrice,
      discountPercent: discountPercent(p.price, c.unitPrice),
      available: isAvailable(p),
    });
  }
  return out.sort((a, b) => Number(b.available) - Number(a.available) || b.discountPercent - a.discountPercent);
}
