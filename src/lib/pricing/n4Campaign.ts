/**
 * Mapeamento do esquema de campanhas N4 (20261006000400_n4_promotion_carousels_and_offer_columns.sql)
 * para o domínio do front. Referência técnica escolhida pelo fundador (13/10/2026) — NÃO usar o esquema 022.
 *
 * N4 promotion_carousel_items: discount_type IN (PERCENTAGE, FIXED_AMOUNT, PROMOTIONAL_PRICE, NONE),
 * discount_value, show_discount_badge, start_at, end_at, is_active, display_order.
 * Não há coluna promotional_price nem show_promotional_price (022): o preço da campanha é DERIVADO
 * de discount_type/discount_value sobre products.price — exatamente como o servidor calcula
 * (_campaign_item_price da proposta 20261013000300). Arredondamento: round(numeric, 2).
 *
 * N4 promotion_carousels: name, description, cover_asset_id, is_active, show_in_store, start_at, end_at, display_order
 * (sem image_url).
 */
import { roundMoney } from './fulfillmentPricing';

export type N4DiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'PROMOTIONAL_PRICE' | 'NONE';

/** Preço unitário da campanha conforme N4; null quando não há preço promocional válido (0 < preço < cheio). */
export function n4CampaignUnitPrice(productPrice: number, discountType: string, discountValue: number): number | null {
  const price = Number(productPrice);
  const v = Number(discountValue);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(v)) return null;
  let out: number;
  switch (discountType) {
    case 'PERCENTAGE': out = roundMoney(price * (1 - v / 100)); break;
    case 'FIXED_AMOUNT': out = roundMoney(price - v); break;
    case 'PROMOTIONAL_PRICE': out = roundMoney(v); break;
    default: return null;
  }
  return out > 0 && out < price ? out : null;
}

/** Linha N4 -> item de domínio (PromotionCarouselItem). */
export function mapN4CarouselItemRow(row: any, productPrice: number | null | undefined) {
  const price = Number(productPrice || 0);
  const unit = n4CampaignUnitPrice(price, row.discount_type, Number(row.discount_value));
  const promotionalPrice = unit ?? price;
  return {
    id: row.id as string,
    carouselId: row.carousel_id as string,
    productId: row.product_id as string,
    tenantId: row.tenant_id as string,
    discountType: (row.discount_type === 'NONE' ? 'PERCENTAGE' : row.discount_type) as 'PERCENTAGE' | 'FIXED_AMOUNT' | 'PROMOTIONAL_PRICE',
    discountValue: Number(row.discount_value || 0),
    promotionalPrice,
    calculatedDiscountPercentage: price > 0 && unit !== null ? Math.round(((price - unit) / price) * 100) : 0,
    showDiscountBadge: Boolean(row.show_discount_badge),
    // N4 não tem show_promotional_price: preço da campanha é sempre exibido quando válido.
    showPromotionalPrice: unit !== null,
    startDate: row.start_at || undefined,
    endDate: row.end_at || undefined,
    // discount_type NONE ou preço inválido => item não vende pela campanha.
    isActive: Boolean(row.is_active) && unit !== null,
    displayOrder: Number(row.display_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Atualização parcial de domínio -> colunas N4. Se o painel envia promotionalPrice, grava como
 * PROMOTIONAL_PRICE (valor exato que o lojista digitou); caso contrário usa discountType/discountValue.
 */
export function toN4CarouselItemUpdate(u: {
  discountType?: string; discountValue?: number; promotionalPrice?: number;
  showDiscountBadge?: boolean; startDate?: string | null; endDate?: string | null; isActive?: boolean;
}): Record<string, any> {
  const out: Record<string, any> = {};
  if (u.discountType === 'PROMOTIONAL_PRICE' || (u.promotionalPrice !== undefined && u.discountType === undefined)) {
    if (u.promotionalPrice !== undefined) {
      out.discount_type = 'PROMOTIONAL_PRICE';
      out.discount_value = roundMoney(Number(u.promotionalPrice));
    } else if (u.discountValue !== undefined) {
      out.discount_type = 'PROMOTIONAL_PRICE';
      out.discount_value = roundMoney(Number(u.discountValue));
    }
  } else if (u.discountType !== undefined) {
    out.discount_type = u.discountType;
    if (u.discountValue !== undefined) out.discount_value = Number(u.discountValue);
  } else if (u.discountValue !== undefined) {
    out.discount_value = Number(u.discountValue);
  }
  if (u.showDiscountBadge !== undefined) out.show_discount_badge = u.showDiscountBadge;
  if (u.startDate !== undefined) out.start_at = u.startDate || null;
  if (u.endDate !== undefined) out.end_at = u.endDate || null;
  if (u.isActive !== undefined) out.is_active = u.isActive;
  return out;
}
