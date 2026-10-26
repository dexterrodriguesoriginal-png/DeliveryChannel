/**
 * Carrosséis promocionais (N4) e cupons (N2) — tabelas que SÓ existem no N1–N6.
 * Em VITE_BACKEND_SCHEMA=legacy-020 (override): leituras devolvem lista vazia e escritas/validações
 * lançam N1N6_REQUIRED (sem cair para dataStore/localStorage).
 * — somente OWNER/MANAGER administram (RLS).
 * CASHIER apenas APLICA cupom no PDV (validate_coupon_pos / process_pos_sale_atomic).
 * DRIVER, OPERATOR, CUSTOMER e anon não administram cupons; CEO/SUPER_ADMIN não têm acesso (F2).
 *
 * Sem fallback local com Supabase configurado. O consumo de cupom acontece SOMENTE dentro
 * do checkout/PDV no servidor (atômico); o navegador nunca "resgata" cupom (redeemCoupon removido).
 */
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { PromotionCarousel, PromotionCarouselItem, Coupon, CouponPreview, ValidateCouponResult } from '../types';
import { isN1N6Backend, N1N6_ONLY_MESSAGE } from '../lib/backendSchema';
import { dataStore } from '../services/dataStore';
import { SecurityContext } from '../services/securityEngine';
import { isValidUuid } from '../lib/uuid';
import { BackendError, requireBackend, requireBackendOrLocalDemo, toBackendError } from '../lib/backend';
import { mapCouponPreview, toServerItems } from './orderMappers';

const CAROUSEL_SELECT = `*, items:promotion_carousel_items(*, product:products(id, name, description, image_url, price, unit, is_active, stock_quantity))`;

/** Preço promocional exibido no painel (prévia); a verdade é _effective_product_price no servidor. */
export function carouselItemPreviewPrice(basePrice: number, discountType: string, discountValue: number): number {
  let v = basePrice;
  if (discountType === 'PERCENTAGE') v = basePrice * (1 - discountValue / 100);
  else if (discountType === 'FIXED_AMOUNT') v = basePrice - discountValue;
  else if (discountType === 'PROMOTIONAL_PRICE') v = discountValue;
  v = Math.round(v * 100) / 100;
  return v > 0 && v < basePrice ? v : basePrice;
}

function mapCarousel(pc: any): PromotionCarousel {
  return {
    id: pc.id,
    tenantId: pc.tenant_id,
    name: pc.name,
    description: pc.description || undefined,
    isActive: Boolean(pc.is_active),
    showInStore: Boolean(pc.show_in_store),
    displayOrder: Number(pc.display_order ?? 0),
    createdAt: pc.created_at,
    updatedAt: pc.updated_at,
    items: (pc.items || [])
      .map((i: any): PromotionCarouselItem => {
        const base = Number(i.product?.price ?? 0);
        const promo = carouselItemPreviewPrice(base, i.discount_type, Number(i.discount_value));
        return {
          id: i.id,
          carouselId: i.carousel_id,
          productId: i.product_id,
          tenantId: i.tenant_id,
          discountType: i.discount_type === 'NONE' ? 'PERCENTAGE' : i.discount_type,
          discountValue: Number(i.discount_value),
          promotionalPrice: promo,
          calculatedDiscountPercentage: base > 0 && promo < base ? Math.round(((base - promo) / base) * 100) : 0,
          showDiscountBadge: Boolean(i.show_discount_badge),
          showPromotionalPrice: i.discount_type !== 'NONE',
          startDate: i.start_at || undefined,
          endDate: i.end_at || undefined,
          isActive: Boolean(i.is_active),
          displayOrder: Number(i.display_order ?? 0),
          createdAt: i.created_at,
          updatedAt: i.updated_at,
          product: i.product
            ? {
                id: i.product.id,
                tenantId: pc.tenant_id,
                categoryId: '',
                name: i.product.name,
                description: i.product.description || '',
                price: base,
                imageUrl: i.product.image_url || '',
                unit: i.product.unit || 'un',
                isActive: Boolean(i.product.is_active),
                isAvailable: Number(i.product.stock_quantity) > 0,
                stockQuantity: Number(i.product.stock_quantity ?? 0),
              }
            : undefined,
        };
      })
      .sort((a: PromotionCarouselItem, b: PromotionCarouselItem) => a.displayOrder - b.displayOrder),
  };
}

function mapCoupon(c: any): Coupon {
  return {
    id: c.id,
    tenantId: c.tenant_id,
    code: c.code,
    description: c.description || undefined,
    discountType: c.discount_type,
    discountValue: Number(c.discount_value),
    maxDiscountAmount: c.max_discount_amount !== null && c.max_discount_amount !== undefined ? Number(c.max_discount_amount) : undefined,
    minOrderValue: c.min_order_value !== null && c.min_order_value !== undefined ? Number(c.min_order_value) : undefined,
    usageLimit: c.usage_limit ?? undefined,
    usageLimitPerCustomer: c.usage_limit_per_customer ?? undefined,
    timesUsed: Number(c.times_used ?? 0),
    firstOrderOnly: Boolean(c.first_order_only),
    startDate: c.start_at || undefined,
    endDate: c.end_at || undefined,
    status: c.status,
    campaignId: c.campaign_id || undefined,
    isActive: c.status === 'ACTIVE',
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

/** Normaliza o código como o servidor (normalize_coupon_code): maiúsculas, sem espaços. */
export function normalizeCouponCode(code: string): string {
  return (code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function couponWritePayload(data: Partial<Coupon>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (data.code !== undefined) out.code = normalizeCouponCode(data.code);
  if (data.description !== undefined) out.description = data.description || null;
  if (data.discountType !== undefined) out.discount_type = data.discountType;
  if (data.discountValue !== undefined) out.discount_value = data.discountValue;
  if (data.maxDiscountAmount !== undefined) out.max_discount_amount = data.maxDiscountAmount || null;
  if (data.minOrderValue !== undefined) out.min_order_value = data.minOrderValue || 0;
  if (data.usageLimit !== undefined) out.usage_limit = data.usageLimit || null;
  if (data.usageLimitPerCustomer !== undefined) out.usage_limit_per_customer = data.usageLimitPerCustomer || null;
  if (data.firstOrderOnly !== undefined) out.first_order_only = Boolean(data.firstOrderOnly);
  if (data.startDate !== undefined) out.start_at = data.startDate || null;
  if (data.endDate !== undefined) out.end_at = data.endDate || null;
  if (data.status !== undefined) out.status = data.status;
  else if (data.isActive !== undefined) out.status = data.isActive ? 'ACTIVE' : 'PAUSED';
  if (data.campaignId !== undefined) out.campaign_id = data.campaignId || null;
  // times_used é contador do servidor: nunca enviado.
  return out;
}

function requireN1N6(feature: string): void {
  if (isSupabaseConfigured && !isN1N6Backend()) {
    throw new BackendError('N1N6_REQUIRED', `${feature}: ${N1N6_ONLY_MESSAGE}`);
  }
}

/**
 * Converte a prévia do servidor no formato usado pela calculadora de preço da vitrine.
 * O desconto vira valor fixo calculado pelo servidor para o carrinho enviado; o checkout
 * recalcula e consome o cupom atomicamente (o navegador nunca decide o valor final).
 */
export function previewToValidateResult(preview: CouponPreview): ValidateCouponResult {
  if (!preview.valid || !preview.code) {
    return { isValid: false, discountAmount: 0, message: preview.message || 'Cupom inválido.' };
  }
  return {
    isValid: true,
    discountAmount: preview.discount,
    message: preview.message || `Cupom "${preview.code}" aplicado.`,
    coupon: {
      id: `server-preview-${preview.code}`,
      tenantId: '',
      code: preview.code,
      discountType: 'FIXED_AMOUNT',
      discountValue: preview.discount,
      minOrderValue: 0,
      timesUsed: 0,
      isActive: true,
    },
  };
}

export const promotionRepository = {
  // ---------------------------------------------------------------- CARROSSÉIS (N4)
  async getCarousels(context: SecurityContext, tenantId: string): Promise<PromotionCarousel[]> {
    if (isSupabaseConfigured && !isN1N6Backend()) return [];
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('promotion_carousels')
        .select(CAROUSEL_SELECT)
        .eq('tenant_id', tenantId)
        .order('display_order', { ascending: true });
      if (error) throw toBackendError(error, 'Falha ao carregar carrosséis.');
      return (data || []).map(mapCarousel);
    }
    requireBackendOrLocalDemo('carrosséis');
    return dataStore.getPromotionCarousels(context, tenantId);
  },

  async getCarousel(tenantId: string, carouselId: string): Promise<PromotionCarousel> {
    requireN1N6('Carrosséis promocionais');
    const { data, error } = await supabase
      .from('promotion_carousels')
      .select(CAROUSEL_SELECT)
      .eq('tenant_id', tenantId)
      .eq('id', carouselId)
      .single();
    if (error) throw toBackendError(error, 'Carrossel não encontrado.');
    return mapCarousel(data);
  },

  async createCarousel(context: SecurityContext, tenantId: string, data: { name: string; description?: string; showInStore?: boolean }): Promise<PromotionCarousel> {
    requireBackend('carrosséis');
    requireN1N6('Carrosséis promocionais');
    const { data: inserted, error } = await supabase
      .from('promotion_carousels')
      .insert({
        tenant_id: tenantId,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        show_in_store: data.showInStore !== false,
        is_active: true,
      })
      .select(CAROUSEL_SELECT)
      .single();
    if (error) throw toBackendError(error, 'Falha ao criar carrossel.');
    return mapCarousel(inserted);
  },

  async updateCarousel(context: SecurityContext, tenantId: string, carouselId: string, updates: Partial<PromotionCarousel>): Promise<PromotionCarousel> {
    requireBackend('carrosséis');
    requireN1N6('Carrosséis promocionais');
    const db: Record<string, unknown> = {};
    if (updates.name !== undefined) db.name = updates.name.trim();
    if (updates.description !== undefined) db.description = updates.description || null;
    if (updates.isActive !== undefined) db.is_active = updates.isActive;
    if (updates.showInStore !== undefined) db.show_in_store = updates.showInStore;
    if (updates.displayOrder !== undefined) db.display_order = updates.displayOrder;
    const { data, error } = await supabase
      .from('promotion_carousels')
      .update(db)
      .eq('tenant_id', tenantId)
      .eq('id', carouselId)
      .select(CAROUSEL_SELECT)
      .single();
    if (error) throw toBackendError(error, 'Falha ao atualizar carrossel.');
    return mapCarousel(data);
  },

  async deleteCarousel(context: SecurityContext, tenantId: string, carouselId: string): Promise<void> {
    requireBackend('carrosséis');
    requireN1N6('Carrosséis promocionais');
    const { error } = await supabase.from('promotion_carousels').delete().eq('tenant_id', tenantId).eq('id', carouselId);
    if (error) throw toBackendError(error, 'Falha ao excluir carrossel.');
  },

  async addProductsToCarousel(context: SecurityContext, tenantId: string, carouselId: string, productIds: string[]): Promise<PromotionCarousel> {
    requireBackend('carrosséis');
    requireN1N6('Carrosséis promocionais');
    const rows = productIds.filter(isValidUuid).map((productId, idx) => ({
      tenant_id: tenantId,
      carousel_id: carouselId,
      product_id: productId,
      // Sem desconto até o lojista configurar (o preço continua o do catálogo).
      discount_type: 'NONE',
      discount_value: 0,
      display_order: idx,
    }));
    if (rows.length > 0) {
      const { error } = await supabase.from('promotion_carousel_items').insert(rows);
      if (error) throw toBackendError(error, 'Falha ao adicionar produtos ao carrossel.');
    }
    return this.getCarousel(tenantId, carouselId);
  },

  async updateCarouselItemPromotion(
    context: SecurityContext,
    tenantId: string,
    carouselId: string,
    itemId: string,
    promotionData: Partial<PromotionCarouselItem>
  ): Promise<PromotionCarousel> {
    requireBackend('carrosséis');
    requireN1N6('Carrosséis promocionais');
    const db: Record<string, unknown> = {};
    if (promotionData.discountType !== undefined) db.discount_type = promotionData.discountType;
    if (promotionData.discountType === 'PROMOTIONAL_PRICE' && promotionData.promotionalPrice !== undefined) {
      db.discount_value = promotionData.promotionalPrice;
    } else if (promotionData.discountValue !== undefined) {
      db.discount_value = promotionData.discountValue;
    }
    if (promotionData.showDiscountBadge !== undefined) db.show_discount_badge = promotionData.showDiscountBadge;
    if (promotionData.startDate !== undefined) db.start_at = promotionData.startDate || null;
    if (promotionData.endDate !== undefined) db.end_at = promotionData.endDate || null;
    if (promotionData.isActive !== undefined) db.is_active = promotionData.isActive;
    const { error } = await supabase
      .from('promotion_carousel_items')
      .update(db)
      .eq('tenant_id', tenantId)
      .eq('carousel_id', carouselId)
      .eq('id', itemId);
    if (error) throw toBackendError(error, 'Falha ao salvar a promoção do item.');
    return this.getCarousel(tenantId, carouselId);
  },

  async removeProductFromCarousel(context: SecurityContext, tenantId: string, carouselId: string, itemId: string): Promise<PromotionCarousel> {
    requireBackend('carrosséis');
    requireN1N6('Carrosséis promocionais');
    const { error } = await supabase
      .from('promotion_carousel_items')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('carousel_id', carouselId)
      .eq('id', itemId);
    if (error) throw toBackendError(error, 'Falha ao remover o produto.');
    return this.getCarousel(tenantId, carouselId);
  },

  async reorderCarouselItems(context: SecurityContext, tenantId: string, carouselId: string, itemIds: string[]): Promise<PromotionCarousel> {
    requireBackend('carrosséis');
    requireN1N6('Carrosséis promocionais');
    for (let i = 0; i < itemIds.length; i++) {
      if (!isValidUuid(itemIds[i])) continue;
      const { error } = await supabase
        .from('promotion_carousel_items')
        .update({ display_order: i })
        .eq('tenant_id', tenantId)
        .eq('id', itemIds[i]);
      if (error) throw toBackendError(error, 'Falha ao reordenar.');
    }
    return this.getCarousel(tenantId, carouselId);
  },

  async reorderCarousels(context: SecurityContext, tenantId: string, carouselIds: string[]): Promise<void> {
    requireBackend('carrosséis');
    requireN1N6('Carrosséis promocionais');
    for (let i = 0; i < carouselIds.length; i++) {
      if (!isValidUuid(carouselIds[i])) continue;
      const { error } = await supabase
        .from('promotion_carousels')
        .update({ display_order: i })
        .eq('tenant_id', tenantId)
        .eq('id', carouselIds[i]);
      if (error) throw toBackendError(error, 'Falha ao reordenar.');
    }
  },

  // ---------------------------------------------------------------- CUPONS (N2)
  async getCoupons(context: SecurityContext, tenantId: string): Promise<Coupon[]> {
    if (isSupabaseConfigured && !isN1N6Backend()) return [];
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('coupons')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw toBackendError(error, 'Falha ao carregar cupons.');
      return (data || []).map(mapCoupon);
    }
    requireBackendOrLocalDemo('cupons');
    return dataStore.getCoupons(context, tenantId);
  },

  async createCoupon(context: SecurityContext, tenantId: string, data: Partial<Coupon>): Promise<Coupon> {
    requireBackend('cupons');
    requireN1N6('Cupons');
    if (!data.code) throw new BackendError('COUPON_CODE_REQUIRED', 'Informe o código do cupom.');
    const { data: inserted, error } = await supabase
      .from('coupons')
      .insert({ tenant_id: tenantId, ...couponWritePayload({ discountType: 'PERCENTAGE', ...data }) })
      .select('*')
      .single();
    if (error) throw toBackendError(error, 'Falha ao criar cupom.');
    return mapCoupon(inserted);
  },

  async updateCoupon(context: SecurityContext, tenantId: string, couponId: string, updates: Partial<Coupon>): Promise<Coupon> {
    requireBackend('cupons');
    requireN1N6('Cupons');
    const { data, error } = await supabase
      .from('coupons')
      .update(couponWritePayload(updates))
      .eq('tenant_id', tenantId)
      .eq('id', couponId)
      .select('*')
      .single();
    if (error) throw toBackendError(error, 'Falha ao atualizar cupom.');
    return mapCoupon(data);
  },

  /**
   * Exclui o cupom; se já tiver usos (histórico de resgates), ele é ARQUIVADO para preservar
   * a auditoria (o histórico nunca é apagado).
   */
  async deleteCoupon(context: SecurityContext, tenantId: string, couponId: string): Promise<'DELETED' | 'ARCHIVED'> {
    requireBackend('cupons');
    requireN1N6('Cupons');
    const { count, error: cErr } = await supabase
      .from('coupon_redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('coupon_id', couponId);
    if (cErr) throw toBackendError(cErr, 'Falha ao verificar o histórico do cupom.');
    if ((count ?? 0) > 0) {
      await this.updateCoupon(context, tenantId, couponId, { status: 'ARCHIVED' });
      return 'ARCHIVED';
    }
    const { error } = await supabase.from('coupons').delete().eq('tenant_id', tenantId).eq('id', couponId);
    if (error) throw toBackendError(error, 'Falha ao excluir cupom.');
    return 'DELETED';
  },

  /** Prévia do cupom na vitrine (cliente autenticado). Não consome o cupom. */
  async validateCoupon(
    slug: string,
    code: string,
    items: Array<{ productId: string; quantity: number; options?: Array<{ groupId: string; optionId: string; qty: number; fraction?: number | null }> }>
  ): Promise<CouponPreview> {
    requireBackend('cupons');
    requireN1N6('Cupons');
    const { data, error } = await supabase.rpc('validate_coupon', {
      p_tenant_slug: slug,
      p_code: normalizeCouponCode(code),
      p_items: toServerItems(items),
    });
    if (error) throw toBackendError(error, 'Falha ao validar cupom.');
    return mapCouponPreview(data);
  },

  /** Prévia do cupom no PDV (OWNER/MANAGER/CASHIER). Não consome o cupom. */
  async validateCouponPos(
    tenantId: string,
    code: string,
    items: Array<{ productId: string; quantity: number; options?: Array<{ groupId: string; optionId: string; qty: number; fraction?: number | null }> }>,
    customerId?: string
  ): Promise<CouponPreview> {
    requireBackend('cupons');
    requireN1N6('Cupons');
    const { data, error } = await supabase.rpc('validate_coupon_pos', {
      p_tenant_id: tenantId,
      p_code: normalizeCouponCode(code),
      p_items: toServerItems(items),
      p_customer_id: customerId && isValidUuid(customerId) ? customerId : null,
    });
    if (error) throw toBackendError(error, 'Falha ao validar cupom.');
    return mapCouponPreview(data);
  },

  /** Compatibilidade da vitrine: prévia no servidor (validate_coupon) no formato da calculadora de preço. */
  async validatePublicCoupon(
    slug: string,
    code: string,
    items: Array<{ productId: string; quantity: number; options?: Array<{ groupId: string; optionId: string; qty: number; fraction?: number | null }> }>
  ): Promise<ValidateCouponResult> {
    return previewToValidateResult(await this.validateCoupon(slug, code, items));
  },
};
