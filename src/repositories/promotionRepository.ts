import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { PromotionCarousel, PromotionCarouselItem, Coupon } from '../types';
import { SecurityContext } from '../services/securityEngine';
import { dataStore } from '../services/dataStore';
import { isValidUuid } from '../lib/uuid';

export const promotionRepository = {
  // --------------------------------------------------------------------------
  // CARROSSÉIS DE PROMOÇÃO
  // --------------------------------------------------------------------------
  async getCarousels(context: SecurityContext, tenantId: string): Promise<PromotionCarousel[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('promotion_carousels')
          .select(`
            *,
            items:promotion_carousel_items(
              *,
              product:products(id, name, description, image_url, price, unit, is_active, stock_quantity)
            )
          `)
          .eq('tenant_id', tenantId)
          .order('display_order', { ascending: true });

        if (!error && data) {
          return data.map((pc: any) => ({
            id: pc.id,
            tenantId: pc.tenant_id,
            name: pc.name,
            description: pc.description,
            imageUrl: pc.image_url,
            isActive: Boolean(pc.is_active),
            showInStore: Boolean(pc.show_in_store),
            displayOrder: pc.display_order,
            createdAt: pc.created_at,
            updatedAt: pc.updated_at,
            items: (pc.items || []).map((pci: any) => ({
              id: pci.id,
              carouselId: pci.carousel_id,
              productId: pci.product_id,
              tenantId: pci.tenant_id,
              discountType: pci.discount_type,
              discountValue: Number(pci.discount_value),
              promotionalPrice: Number(pci.promotional_price),
              calculatedDiscountPercentage: pci.product?.price 
                ? Math.round(((Number(pci.product.price) - Number(pci.promotional_price)) / Number(pci.product.price)) * 100)
                : 0,
              showDiscountBadge: Boolean(pci.show_discount_badge),
              showPromotionalPrice: Boolean(pci.show_promotional_price),
              startDate: pci.start_date,
              endDate: pci.end_date,
              isActive: Boolean(pci.is_active),
              displayOrder: pci.display_order,
              createdAt: pci.created_at,
              updatedAt: pci.updated_at,
              product: pci.product ? {
                id: pci.product.id,
                tenantId: pc.tenant_id,
                categoryId: '',
                name: pci.product.name,
                description: pci.product.description || '',
                price: Number(pci.product.price),
                imageUrl: pci.product.image_url,
                unit: pci.product.unit || 'un',
                isActive: Boolean(pci.product.is_active),
                isAvailable: pci.product.stock_quantity > 0,
                stockQuantity: pci.product.stock_quantity,
              } : undefined,
            })).sort((a: any, b: any) => a.displayOrder - b.displayOrder),
          }));
        }
      } catch (err) {
        console.warn('[promotionRepository] Fallback para dataStore getCarousels:', err);
      }
    }
    return dataStore.getPromotionCarousels(context, tenantId);
  },

  async createCarousel(context: SecurityContext, tenantId: string, data: { name: string; description?: string; showInStore?: boolean }): Promise<PromotionCarousel> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data: inserted, error } = await supabase
          .from('promotion_carousels')
          .insert({
            tenant_id: tenantId,
            name: data.name,
            description: data.description || null,
            show_in_store: data.showInStore ?? true,
            is_active: true,
            display_order: 99,
          })
          .select()
          .single();

        if (error) throw new Error(error.message);
        if (inserted) {
          dataStore.createPromotionCarousel(context, tenantId, data);
          return {
            id: inserted.id,
            tenantId: inserted.tenant_id,
            name: inserted.name,
            description: inserted.description,
            imageUrl: inserted.image_url,
            isActive: inserted.is_active,
            showInStore: inserted.show_in_store,
            displayOrder: inserted.display_order,
            items: [],
            createdAt: inserted.created_at,
            updatedAt: inserted.updated_at,
          };
        }
      } catch (err: any) {
        console.warn('[promotionRepository] Erro ao criar no Supabase, gravando em dataStore:', err);
      }
    }
    return dataStore.createPromotionCarousel(context, tenantId, data);
  },

  async updateCarousel(context: SecurityContext, tenantId: string, carouselId: string, updates: Partial<PromotionCarousel>): Promise<PromotionCarousel> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(carouselId)) {
      try {
        const dbUpdates: any = { updated_at: new Date().toISOString() };
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.description !== undefined) dbUpdates.description = updates.description;
        if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
        if (updates.showInStore !== undefined) dbUpdates.show_in_store = updates.showInStore;
        if (updates.displayOrder !== undefined) dbUpdates.display_order = updates.displayOrder;

        const { error } = await supabase
          .from('promotion_carousels')
          .update(dbUpdates)
          .eq('tenant_id', tenantId)
          .eq('id', carouselId);

        if (error) throw new Error(error.message);
      } catch (err) {
        console.warn('[promotionRepository] Erro ao atualizar carrossel no Supabase:', err);
      }
    }
    return dataStore.updatePromotionCarousel(context, tenantId, carouselId, updates);
  },

  async deleteCarousel(context: SecurityContext, tenantId: string, carouselId: string): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(carouselId)) {
      try {
        const { error } = await supabase
          .from('promotion_carousels')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('id', carouselId);

        if (error) throw new Error(error.message);
      } catch (err) {
        console.warn('[promotionRepository] Erro ao excluir carrossel no Supabase:', err);
      }
    }
    dataStore.deletePromotionCarousel(context, tenantId, carouselId);
  },

  async addProductsToCarousel(context: SecurityContext, tenantId: string, carouselId: string, productIds: string[]): Promise<PromotionCarousel> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(carouselId)) {
      try {
        for (const pId of productIds) {
          if (!isValidUuid(pId)) continue;
          // Busca preço do produto para cálculo inicial de 10%
          const { data: prod } = await supabase.from('products').select('price').eq('id', pId).single();
          const basePrice = prod ? Number(prod.price) : 10;
          const promoPrice = Math.max(0.01, Number((basePrice * 0.9).toFixed(2)));

          await supabase.from('promotion_carousel_items').upsert({
            carousel_id: carouselId,
            product_id: pId,
            tenant_id: tenantId,
            discount_type: 'PERCENTAGE',
            discount_value: 10,
            promotional_price: promoPrice,
            show_discount_badge: true,
            show_promotional_price: true,
            is_active: true,
            display_order: 99,
          }, { onConflict: 'carousel_id,product_id' });
        }
      } catch (err) {
        console.warn('[promotionRepository] Erro ao adicionar produtos no Supabase:', err);
      }
    }
    return dataStore.addProductsToCarousel(context, tenantId, carouselId, productIds);
  },

  async updateCarouselItemPromotion(
    context: SecurityContext, 
    tenantId: string, 
    carouselId: string, 
    itemId: string, 
    promotionData: Partial<PromotionCarouselItem>
  ): Promise<PromotionCarousel> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(itemId)) {
      try {
        const dbUpdates: any = { updated_at: new Date().toISOString() };
        if (promotionData.discountType !== undefined) dbUpdates.discount_type = promotionData.discountType;
        if (promotionData.discountValue !== undefined) dbUpdates.discount_value = promotionData.discountValue;
        if (promotionData.promotionalPrice !== undefined) dbUpdates.promotional_price = promotionData.promotionalPrice;
        if (promotionData.showDiscountBadge !== undefined) dbUpdates.show_discount_badge = promotionData.showDiscountBadge;
        if (promotionData.showPromotionalPrice !== undefined) dbUpdates.show_promotional_price = promotionData.showPromotionalPrice;
        if (promotionData.startDate !== undefined) dbUpdates.start_date = promotionData.startDate || null;
        if (promotionData.endDate !== undefined) dbUpdates.end_date = promotionData.endDate || null;
        if (promotionData.isActive !== undefined) dbUpdates.is_active = promotionData.isActive;

        await supabase
          .from('promotion_carousel_items')
          .update(dbUpdates)
          .eq('tenant_id', tenantId)
          .eq('id', itemId);
      } catch (err) {
        console.warn('[promotionRepository] Erro ao atualizar item no Supabase:', err);
      }
    }
    return dataStore.updateCarouselItemPromotion(context, tenantId, carouselId, itemId, promotionData);
  },

  async removeProductFromCarousel(context: SecurityContext, tenantId: string, carouselId: string, itemId: string): Promise<PromotionCarousel> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(itemId)) {
      try {
        await supabase
          .from('promotion_carousel_items')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('id', itemId);
      } catch (err) {
        console.warn('[promotionRepository] Erro ao remover item no Supabase:', err);
      }
    }
    return dataStore.removeProductFromCarousel(context, tenantId, carouselId, itemId);
  },

  async reorderCarouselItems(context: SecurityContext, tenantId: string, carouselId: string, itemIds: string[]): Promise<PromotionCarousel> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        for (let i = 0; i < itemIds.length; i++) {
          if (isValidUuid(itemIds[i])) {
            await supabase
              .from('promotion_carousel_items')
              .update({ display_order: i })
              .eq('tenant_id', tenantId)
              .eq('id', itemIds[i]);
          }
        }
      } catch (err) {
        console.warn('[promotionRepository] Erro ao reordenar itens no Supabase:', err);
      }
    }
    return dataStore.reorderCarouselItems(context, tenantId, carouselId, itemIds);
  },

  async reorderCarousels(context: SecurityContext, tenantId: string, carouselIds: string[]): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        for (let i = 0; i < carouselIds.length; i++) {
          if (isValidUuid(carouselIds[i])) {
            await supabase
              .from('promotion_carousels')
              .update({ display_order: i })
              .eq('tenant_id', tenantId)
              .eq('id', carouselIds[i]);
          }
        }
      } catch (err) {
        console.warn('[promotionRepository] Erro ao reordenar carrosséis no Supabase:', err);
      }
    }
    dataStore.reorderCarousels(context, tenantId, carouselIds);
  },

  // --------------------------------------------------------------------------
  // CUPONS DE DESCONTO
  // --------------------------------------------------------------------------
  async getCoupons(context: SecurityContext, tenantId: string): Promise<Coupon[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('coupons')
          .select('*, customer:customers(name)')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map((c: any) => ({
            id: c.id,
            tenantId: c.tenant_id,
            code: c.code,
            discountType: c.discount_type,
            discountValue: Number(c.discount_value),
            minOrderValue: c.min_order_value ? Number(c.min_order_value) : 0,
            usageLimit: c.usage_limit ? Number(c.usage_limit) : undefined,
            usageLimitPerCustomer: c.usage_limit_per_customer ? Number(c.usage_limit_per_customer) : 1,
            timesUsed: Number(c.times_used || 0),
            customerId: c.customer_id || undefined,
            customerName: c.customer?.name || undefined,
            startDate: c.start_date,
            endDate: c.end_date,
            isActive: Boolean(c.is_active),
            createdAt: c.created_at,
            updatedAt: c.updated_at,
          }));
        }
      } catch (err) {
        console.warn('[promotionRepository] Fallback getCoupons para dataStore:', err);
      }
    }
    return dataStore.getCoupons(context, tenantId);
  },

  async createCoupon(context: SecurityContext, tenantId: string, data: Partial<Coupon>): Promise<Coupon> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data: inserted, error } = await supabase
          .from('coupons')
          .insert({
            tenant_id: tenantId,
            code: data.code!.toUpperCase().trim(),
            discount_type: data.discountType || 'PERCENTAGE',
            discount_value: data.discountValue || 10,
            min_order_value: data.minOrderValue || 0,
            usage_limit: data.usageLimit || null,
            usage_limit_per_customer: data.usageLimitPerCustomer || 1,
            customer_id: (data.customerId && isValidUuid(data.customerId)) ? data.customerId : null,
            start_date: data.startDate || null,
            end_date: data.endDate || null,
            is_active: data.isActive ?? true,
          })
          .select()
          .single();

        if (error) throw new Error(error.message);
        if (inserted) {
          dataStore.createCoupon(context, tenantId, data);
          return {
            id: inserted.id,
            tenantId: inserted.tenant_id,
            code: inserted.code,
            discountType: inserted.discount_type,
            discountValue: Number(inserted.discount_value),
            minOrderValue: inserted.min_order_value ? Number(inserted.min_order_value) : 0,
            usageLimit: inserted.usage_limit ? Number(inserted.usage_limit) : undefined,
            usageLimitPerCustomer: inserted.usage_limit_per_customer ? Number(inserted.usage_limit_per_customer) : 1,
            timesUsed: Number(inserted.times_used || 0),
            customerId: inserted.customer_id || undefined,
            startDate: inserted.start_date,
            endDate: inserted.end_date,
            isActive: inserted.is_active,
            createdAt: inserted.created_at,
            updatedAt: inserted.updated_at,
          };
        }
      } catch (err: any) {
        console.warn('[promotionRepository] Erro ao criar cupom no Supabase:', err);
      }
    }
    return dataStore.createCoupon(context, tenantId, data);
  },

  async updateCoupon(context: SecurityContext, tenantId: string, couponId: string, updates: Partial<Coupon>): Promise<Coupon> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(couponId)) {
      try {
        const dbUpdates: any = { updated_at: new Date().toISOString() };
        if (updates.code) dbUpdates.code = updates.code.toUpperCase().trim();
        if (updates.discountType) dbUpdates.discount_type = updates.discountType;
        if (updates.discountValue !== undefined) dbUpdates.discount_value = updates.discountValue;
        if (updates.minOrderValue !== undefined) dbUpdates.min_order_value = updates.minOrderValue;
        if (updates.usageLimit !== undefined) dbUpdates.usage_limit = updates.usageLimit;
        if (updates.usageLimitPerCustomer !== undefined) dbUpdates.usage_limit_per_customer = updates.usageLimitPerCustomer;
        if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
        if (updates.startDate !== undefined) dbUpdates.start_date = updates.startDate || null;
        if (updates.endDate !== undefined) dbUpdates.end_date = updates.endDate || null;

        await supabase
          .from('coupons')
          .update(dbUpdates)
          .eq('tenant_id', tenantId)
          .eq('id', couponId);
      } catch (err) {
        console.warn('[promotionRepository] Erro ao atualizar cupom no Supabase:', err);
      }
    }
    return dataStore.updateCoupon(context, tenantId, couponId, updates);
  },

  async deleteCoupon(context: SecurityContext, tenantId: string, couponId: string): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(couponId)) {
      try {
        await supabase
          .from('coupons')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('id', couponId);
      } catch (err) {
        console.warn('[promotionRepository] Erro ao excluir cupom no Supabase:', err);
      }
    }
    dataStore.deleteCoupon(context, tenantId, couponId);
  },
};
