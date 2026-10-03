import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Offer } from '../types';
import { dataStore } from '../services/dataStore';
import { SecurityContext } from '../services/securityEngine';
import { publicStoreRepository } from './publicStoreRepository';
import { isValidUuid } from '../lib/uuid';
import { calculatePromoCardStatus } from '../utils/promoCardDateUtils';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mapRowToOffer(row: any): Offer {
  const cardFormat = row.card_format || row.cardFormat || 'HORIZONTAL';
  const mediaType = row.media_type || row.mediaType || 'IMAGE';
  const mediaUrl = row.media_url || row.mediaUrl || row.image_url;
  const imageUrl = row.image_url || row.media_url || row.mediaUrl;
  const durationSeconds = Number(row.duration_seconds ?? row.durationSeconds ?? 5);
  const displayMode = (row.display_mode === 'FULL_MEDIA' || row.displayMode === 'FULL_MEDIA' || row.display_mode === 'MEDIA_COMPLETA')
    ? 'FULL_MEDIA'
    : 'EDITABLE_CARD';

  const isActive = Boolean(row.is_active);
  const startDate = row.start_at || row.start_date || row.startDate || row.startAt || undefined;
  const endDate = row.end_at || row.end_date || row.endDate || row.endAt || undefined;
  const computedStatus = calculatePromoCardStatus({ isActive, startDate, endDate });

  const promoUsageLimit = row.promo_usage_limit ? Number(row.promo_usage_limit) : undefined;
  const promoTimesUsed = Number(row.promo_times_used ?? 0);
  const isExhausted = Boolean(promoUsageLimit && promoTimesUsed >= promoUsageLimit);
  const remainingUses = promoUsageLimit ? Math.max(0, promoUsageLimit - promoTimesUsed) : null;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id || undefined,
    title: row.title,
    subtitle: row.subtitle || undefined,
    description: row.description || '',
    badge: row.badge || undefined,
    cardFormat,
    mediaType,
    displayMode,
    cardModel: row.card_model || 'HERO',
    autoOverlay: row.auto_overlay !== undefined ? Boolean(row.auto_overlay) : true,
    destinationType: row.destination_type || (row.product_id ? 'PRODUCT' : 'BANNER_ONLY'),
    mediaUrl,
    imageUrl,
    durationSeconds,
    videoDuration: row.video_duration ? Number(row.video_duration) : (row.videoDuration ? Number(row.videoDuration) : undefined),
    detectedWidth: row.detected_width ? Number(row.detected_width) : (row.detectedWidth ? Number(row.detectedWidth) : undefined),
    detectedHeight: row.detected_height ? Number(row.detected_height) : (row.detectedHeight ? Number(row.detectedHeight) : undefined),
    aspectRatio: row.aspect_ratio || row.aspectRatio || '16:9',
    discountPercentage: row.discount_percentage ? Number(row.discount_percentage) : undefined,
    originalPrice: row.original_price ? Number(row.original_price) : undefined,
    promotionalPrice: row.promotional_price ? Number(row.promotional_price) : undefined,
    internalLink: row.internal_link || undefined,
    order: Number(row.display_order ?? 0),
    startDate,
    endDate,
    startAt: startDate,
    endAt: endDate,
    backgroundColor: row.background_color || '#15803d',
    accentColor: row.accent_color || '#ffffff',
    isActive,
    computedStatus,

    // Checkout Promocional Próprio
    hasPromoCheckout: Boolean(row.has_promo_checkout),
    promoTitle: row.promo_title || undefined,
    promoDescription: row.promo_description || undefined,
    promoPrice: row.promo_price ? Number(row.promo_price) : undefined,
    promoOriginalPrice: row.promo_original_price ? Number(row.promo_original_price) : undefined,
    promoDiscountPercentage: row.promo_discount_percentage ? Number(row.promo_discount_percentage) : undefined,
    promoUnit: row.promo_unit || 'un',
    promoMinQuantity: row.promo_min_quantity ? Number(row.promo_min_quantity) : 1,
    promoMaxQuantityPerCustomer: row.promo_max_quantity_per_customer ? Number(row.promo_max_quantity_per_customer) : 10,
    promoNotes: row.promo_notes || undefined,
    promoFulfillmentTypes: row.promo_fulfillment_types || ['DELIVERY', 'PICKUP'],
    promoPaymentMethods: row.promo_payment_methods || ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'],
    promoCouponCode: row.promo_coupon_code || undefined,
    promoUsageLimit,
    promoTimesUsed,
    isExhausted,
    remainingUses,

    createdAt: row.created_at,
    isDemo: Boolean(row.is_demo),
  };
}

export const offerRepository = {
  /**
   * Obtém lista de ofertas do estabelecimento a partir do Supabase.
   */
  async getOffers(context: SecurityContext, tenantId: string): Promise<Offer[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('offers')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('display_order', { ascending: true });

        if (error) {
          console.warn('[offerRepository] Erro ao buscar ofertas do Supabase:', error.message);
          return dataStore.getOffers(context, tenantId);
        }

        return (data || []).map(mapRowToOffer);
      } catch (err) {
        console.warn('[offerRepository] Falha ao consultar ofertas no Supabase:', err);
        return dataStore.getOffers(context, tenantId);
      }
    }
    return dataStore.getOffers(context, tenantId);
  },

  /**
   * Obtém ofertas públicas através da RPC segura.
   */
  async getPublicOffers(slug: string): Promise<Offer[]> {
    if (isSupabaseConfigured) {
      const store = await publicStoreRepository.getPublicStore(slug);
      if (store) {
        return store.offers;
      }
      return [];
    }
    return dataStore.getPublicOffers(slug);
  },

  /**
   * Valida se o productId é UUID legítimo e pertence ao tenant especificado.
   */
  async validateProductBelongsToTenant(tenantId: string, productId?: string | null): Promise<string | null> {
    if (!productId || !productId.trim()) return null;
    const cleanId = productId.trim();

    if (!UUID_REGEX.test(cleanId)) {
      return null;
    }

    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('products')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('id', cleanId)
        .maybeSingle();

      if (error || !data) {
        return null;
      }
      return cleanId;
    }

    return cleanId;
  },

  /**
   * Cria nova oferta promocional no Supabase.
   */
  async create(
    context: SecurityContext, 
    tenantId: string, 
    data: Omit<Offer, 'id' | 'tenantId' | 'createdAt'>
  ): Promise<Offer> {
    const mediaUrl = data.mediaUrl || data.imageUrl;
    const imageUrl = data.imageUrl || data.mediaUrl;
    const cardFormat = data.cardFormat || 'HORIZONTAL';
    const mediaType = data.mediaType || 'IMAGE';
    const durationSeconds = Number(data.durationSeconds ?? 5);

    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const validatedProductId = await this.validateProductBelongsToTenant(tenantId, data.productId);

        const { data: inserted, error } = await supabase
          .from('offers')
          .insert({
            tenant_id: tenantId,
            product_id: validatedProductId,
            title: data.title.trim(),
            subtitle: data.subtitle ? data.subtitle.trim() : null,
            description: data.description ? data.description.trim() : '',
            badge: data.badge ? data.badge.trim() : null,
            card_format: cardFormat,
            media_type: mediaType,
            display_mode: data.displayMode || 'EDITABLE_CARD',
            media_url: mediaUrl,
            image_url: imageUrl,
            duration_seconds: durationSeconds,
            video_duration: data.videoDuration || null,
            detected_width: data.detectedWidth || null,
            detected_height: data.detectedHeight || null,
            aspect_ratio: data.aspectRatio || '16:9',
            discount_percentage: data.discountPercentage && data.discountPercentage > 0 ? data.discountPercentage : null,
            original_price: data.originalPrice && data.originalPrice > 0 ? data.originalPrice : null,
            promotional_price: data.promotionalPrice && data.promotionalPrice > 0 ? data.promotionalPrice : null,
            internal_link: data.internalLink || null,
            display_order: data.order ?? 0,
            start_date: data.startDate || data.startAt || null,
            end_date: data.endDate || data.endAt || null,
            start_at: data.startAt || data.startDate || null,
            end_at: data.endAt || data.endDate || null,
            background_color: data.backgroundColor || null,
            accent_color: data.accentColor || null,
            is_active: data.isActive !== undefined ? data.isActive : true,
            is_demo: data.isDemo ?? false,

            // Campos do Checkout Promocional Próprio
            destination_type: data.destinationType || (validatedProductId ? 'PRODUCT' : 'BANNER_ONLY'),
            has_promo_checkout: Boolean(data.hasPromoCheckout),
            promo_title: data.promoTitle || null,
            promo_description: data.promoDescription || null,
            promo_price: data.promoPrice && data.promoPrice > 0 ? data.promoPrice : null,
            promo_original_price: data.promoOriginalPrice && data.promoOriginalPrice > 0 ? data.promoOriginalPrice : null,
            promo_discount_percentage: data.promoDiscountPercentage || null,
            promo_unit: data.promoUnit || 'un',
            promo_min_quantity: data.promoMinQuantity || 1,
            promo_max_quantity_per_customer: data.promoMaxQuantityPerCustomer || 10,
            promo_notes: data.promoNotes || null,
            promo_fulfillment_types: data.promoFulfillmentTypes || ['DELIVERY', 'PICKUP'],
            promo_payment_methods: data.promoPaymentMethods || ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'],
            promo_coupon_code: data.promoCouponCode || null,
            promo_usage_limit: data.promoUsageLimit && data.promoUsageLimit > 0 ? data.promoUsageLimit : null,
            promo_times_used: data.promoTimesUsed || 0,
            auto_overlay: data.autoOverlay !== undefined ? data.autoOverlay : true,
            card_model: data.cardModel || 'HERO',
          })
          .select()
          .single();

        if (error) {
          console.warn('[offerRepository] Erro ao cadastrar oferta no Supabase (usando fallback dataStore):', error.message);
          return dataStore.createOffer(context, tenantId, data);
        }

        return mapRowToOffer(inserted);
      } catch (err) {
        console.warn('[offerRepository] Falha ao criar oferta no Supabase:', err);
        return dataStore.createOffer(context, tenantId, data);
      }
    }
    return dataStore.createOffer(context, tenantId, data);
  },

  /**
   * Atualiza dados de oferta existente no Supabase.
   */
  async update(
    context: SecurityContext, 
    tenantId: string, 
    offerId: string, 
    updates: Partial<Offer>
  ): Promise<Offer> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(offerId)) {
      try {
        const dbUpdates: any = { updated_at: new Date().toISOString() };
        if (updates.title !== undefined) dbUpdates.title = updates.title.trim();
        if (updates.subtitle !== undefined) dbUpdates.subtitle = updates.subtitle.trim();
        if (updates.description !== undefined) dbUpdates.description = updates.description.trim();
        if (updates.badge !== undefined) dbUpdates.badge = updates.badge.trim();
        if (updates.cardFormat !== undefined) dbUpdates.card_format = updates.cardFormat;
        if (updates.mediaType !== undefined) dbUpdates.media_type = updates.mediaType;
        if (updates.displayMode !== undefined) dbUpdates.display_mode = updates.displayMode;
        if (updates.mediaUrl !== undefined) {
          dbUpdates.media_url = updates.mediaUrl;
          dbUpdates.image_url = updates.imageUrl || updates.mediaUrl;
        } else if (updates.imageUrl !== undefined) {
          dbUpdates.image_url = updates.imageUrl;
          dbUpdates.media_url = updates.mediaUrl || updates.imageUrl;
        }
        if (updates.durationSeconds !== undefined) dbUpdates.duration_seconds = updates.durationSeconds;
        if (updates.videoDuration !== undefined) dbUpdates.video_duration = updates.videoDuration;
        if (updates.detectedWidth !== undefined) dbUpdates.detected_width = updates.detectedWidth;
        if (updates.detectedHeight !== undefined) dbUpdates.detected_height = updates.detectedHeight;
        if (updates.aspectRatio !== undefined) dbUpdates.aspect_ratio = updates.aspectRatio;
        if (updates.discountPercentage !== undefined) {
          dbUpdates.discount_percentage = updates.discountPercentage > 0 ? updates.discountPercentage : null;
        }
        if (updates.originalPrice !== undefined) {
          dbUpdates.original_price = updates.originalPrice > 0 ? updates.originalPrice : null;
        }
        if (updates.promotionalPrice !== undefined) {
          dbUpdates.promotional_price = updates.promotionalPrice > 0 ? updates.promotionalPrice : null;
        }
        if (updates.internalLink !== undefined) dbUpdates.internal_link = updates.internalLink;
        if (updates.order !== undefined) dbUpdates.display_order = updates.order;
        if (updates.startDate !== undefined || updates.startAt !== undefined) {
          const s = updates.startAt || updates.startDate || null;
          dbUpdates.start_date = s;
          dbUpdates.start_at = s;
        }
        if (updates.endDate !== undefined || updates.endAt !== undefined) {
          const e = updates.endAt || updates.endDate || null;
          dbUpdates.end_date = e;
          dbUpdates.end_at = e;
        }
        if (updates.backgroundColor !== undefined) dbUpdates.background_color = updates.backgroundColor;
        if (updates.accentColor !== undefined) dbUpdates.accent_color = updates.accentColor;
        if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
        if (updates.productId !== undefined) {
          dbUpdates.product_id = updates.productId ? await this.validateProductBelongsToTenant(tenantId, updates.productId) : null;
        }
        if (updates.destinationType !== undefined) dbUpdates.destination_type = updates.destinationType;
        if (updates.hasPromoCheckout !== undefined) dbUpdates.has_promo_checkout = updates.hasPromoCheckout;
        if (updates.promoTitle !== undefined) dbUpdates.promo_title = updates.promoTitle ? updates.promoTitle.trim() : null;
        if (updates.promoDescription !== undefined) dbUpdates.promo_description = updates.promoDescription ? updates.promoDescription.trim() : null;
        if (updates.promoPrice !== undefined) dbUpdates.promo_price = updates.promoPrice > 0 ? updates.promoPrice : null;
        if (updates.promoOriginalPrice !== undefined) dbUpdates.promo_original_price = updates.promoOriginalPrice > 0 ? updates.promoOriginalPrice : null;
        if (updates.promoDiscountPercentage !== undefined) dbUpdates.promo_discount_percentage = updates.promoDiscountPercentage;
        if (updates.promoUnit !== undefined) dbUpdates.promo_unit = updates.promoUnit;
        if (updates.promoMinQuantity !== undefined) dbUpdates.promo_min_quantity = updates.promoMinQuantity;
        if (updates.promoMaxQuantityPerCustomer !== undefined) dbUpdates.promo_max_quantity_per_customer = updates.promoMaxQuantityPerCustomer;
        if (updates.promoNotes !== undefined) dbUpdates.promo_notes = updates.promoNotes ? updates.promoNotes.trim() : null;
        if (updates.promoFulfillmentTypes !== undefined) dbUpdates.promo_fulfillment_types = updates.promoFulfillmentTypes;
        if (updates.promoPaymentMethods !== undefined) dbUpdates.promo_payment_methods = updates.promoPaymentMethods;
        if (updates.promoCouponCode !== undefined) dbUpdates.promo_coupon_code = updates.promoCouponCode ? updates.promoCouponCode.trim().toUpperCase() : null;
        if (updates.promoUsageLimit !== undefined) dbUpdates.promo_usage_limit = updates.promoUsageLimit > 0 ? updates.promoUsageLimit : null;
        if (updates.promoTimesUsed !== undefined) dbUpdates.promo_times_used = updates.promoTimesUsed;
        if (updates.autoOverlay !== undefined) dbUpdates.auto_overlay = updates.autoOverlay;
        if (updates.cardModel !== undefined) dbUpdates.card_model = updates.cardModel;

        const { data: updated, error } = await supabase
          .from('offers')
          .update(dbUpdates)
          .eq('tenant_id', tenantId)
          .eq('id', offerId)
          .select()
          .single();

        if (error) {
          console.warn('[offerRepository] Erro ao atualizar oferta no Supabase:', error.message);
          return dataStore.updateOffer(context, tenantId, offerId, updates);
        }

        return mapRowToOffer(updated);
      } catch (err) {
        console.warn('[offerRepository] Falha ao atualizar oferta no Supabase:', err);
        return dataStore.updateOffer(context, tenantId, offerId, updates);
      }
    }
    return dataStore.updateOffer(context, tenantId, offerId, updates);
  },

  /**
   * Reordena lista de ofertas.
   */
  async reorderOffers(context: SecurityContext, tenantId: string, offerIds: string[]): Promise<Offer[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        for (let i = 0; i < offerIds.length; i++) {
          if (isValidUuid(offerIds[i])) {
            await supabase
              .from('offers')
              .update({ display_order: i + 1 })
              .eq('tenant_id', tenantId)
              .eq('id', offerIds[i]);
          }
        }
      } catch (err) {
        console.warn('[offerRepository] Erro ao salvar ordem no Supabase:', err);
      }
    }
    return dataStore.reorderOffers(context, tenantId, offerIds);
  },

  /**
   * Upload de mídia promocional com isolamento multi-tenant:
   * marketing/{tenant_id}/cards/{card_id}/{filename}
   */
  async uploadMedia(tenantId: string, cardId: string, file: File): Promise<string> {
    const ext = file.name.split('.').pop()?.toLowerCase() || (file.type.startsWith('video') ? 'mp4' : 'jpg');
    const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'webm'].includes(ext) ? ext : 'webp';
    const cleanCardId = cardId || crypto.randomUUID();
    const filePath = `marketing/${tenantId}/cards/${cleanCardId}/${Date.now()}.${safeExt}`;

    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { error: uploadErr } = await supabase.storage
          .from('catalog')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: true,
            contentType: file.type,
          });

        if (!uploadErr) {
          const { data } = supabase.storage.from('catalog').getPublicUrl(filePath);
          if (data?.publicUrl) {
            return data.publicUrl;
          }
        } else {
          console.warn('[offerRepository] Erro no upload Supabase Storage, caindo para base64:', uploadErr.message);
        }
      } catch (err) {
        console.warn('[offerRepository] Exceção no upload para Supabase Storage:', err);
      }
    }

    // Fallback: conversão para Base64 Data URL persistente
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Erro ao converter arquivo local.'));
      reader.readAsDataURL(file);
    });
  },

  /**
   * Remove oferta do Supabase.
   */
  async delete(context: SecurityContext, tenantId: string, offerId: string): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(offerId)) {
      try {
        const { error } = await supabase
          .from('offers')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('id', offerId);

        if (error) {
          console.warn('[offerRepository] Erro ao excluir oferta no Supabase:', error.message);
        }
      } catch (err) {
        console.warn('[offerRepository] Falha ao excluir oferta no Supabase:', err);
      }
    }
    dataStore.deleteOffer(context, tenantId, offerId);
  },

  /**
   * Alterna status da oferta no Supabase.
   */
  async toggleStatus(context: SecurityContext, tenantId: string, offerId: string): Promise<boolean> {
    const list = await this.getOffers(context, tenantId);
    const offer = list.find(o => o.id === offerId);
    if (!offer) throw new Error('Oferta não encontrada');
    const newStatus = !offer.isActive;
    await this.update(context, tenantId, offerId, { isActive: newStatus });
    return newStatus;
  },

  /**
   * Duplica um card promocional existente.
   */
  async duplicate(context: SecurityContext, tenantId: string, offerId: string): Promise<Offer> {
    const list = await this.getOffers(context, tenantId);
    const source = list.find(o => o.id === offerId);
    if (!source) throw new Error('Card original não encontrado para duplicação.');

    const payload: Omit<Offer, 'id' | 'tenantId' | 'createdAt'> = {
      title: `${source.title} (Cópia)`,
      subtitle: source.subtitle,
      description: source.description,
      badge: source.badge,
      cardFormat: source.cardFormat,
      mediaType: source.mediaType,
      displayMode: source.displayMode,
      mediaUrl: source.mediaUrl,
      imageUrl: source.imageUrl,
      durationSeconds: source.durationSeconds,
      videoDuration: source.videoDuration,
      detectedWidth: source.detectedWidth,
      detectedHeight: source.detectedHeight,
      aspectRatio: source.aspectRatio,
      productId: source.productId,
      internalLink: source.internalLink,
      originalPrice: source.originalPrice,
      promotionalPrice: source.promotionalPrice,
      discountPercentage: source.discountPercentage,
      startDate: source.startDate,
      endDate: source.endDate,
      startAt: source.startAt,
      endAt: source.endAt,
      backgroundColor: source.backgroundColor,
      accentColor: source.accentColor,
      isActive: source.isActive,
      order: list.length + 1,

      // Configuração de Destino e Checkout Promocional Próprio
      destinationType: source.destinationType || 'BANNER_ONLY',
      cardModel: source.cardModel || 'HERO',
      autoOverlay: source.autoOverlay !== undefined ? source.autoOverlay : true,
      hasPromoCheckout: source.hasPromoCheckout,
      promoTitle: source.promoTitle,
      promoDescription: source.promoDescription,
      promoPrice: source.promoPrice,
      promoOriginalPrice: source.promoOriginalPrice,
      promoDiscountPercentage: source.promoDiscountPercentage,
      promoUnit: source.promoUnit || 'un',
      promoMinQuantity: source.promoMinQuantity || 1,
      promoMaxQuantityPerCustomer: source.promoMaxQuantityPerCustomer || 10,
      promoNotes: source.promoNotes,
      promoFulfillmentTypes: source.promoFulfillmentTypes,
      promoPaymentMethods: source.promoPaymentMethods,
      promoCouponCode: source.promoCouponCode,
      promoUsageLimit: source.promoUsageLimit,
      promoTimesUsed: 0, // Não copia contagem de uso conforme especificação
    };

    return this.create(context, tenantId, payload);
  },

  /**
   * Processa o Checkout Promocional Próprio de forma atômica no banco de dados.
   * Não confia em valores do navegador: valida preço, validade e limite no PostgreSQL.
   */
  async processPromotionalCheckout(
    slug: string,
    payload: {
      offerId: string;
      quantity: number;
      customerName: string;
      customerPhone: string;
      customerEmail?: string;
      deliveryAddress?: string;
      addressDetails?: any;
      paymentMethod: string;
      fulfillmentType?: 'DELIVERY' | 'PICKUP';
      notes?: string;
      couponCode?: string;
    }
  ): Promise<{
    orderId: string;
    redemptionNumber?: number;
    celebrationMessage?: string;
    totalAmount: number;
    isExhausted?: boolean;
  }> {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.rpc('process_promotional_checkout_atomic', {
          p_tenant_slug: slug,
          p_offer_id: payload.offerId,
          p_quantity: payload.quantity,
          p_customer_name: payload.customerName,
          p_customer_phone: payload.customerPhone,
          p_customer_email: payload.customerEmail || null,
          p_delivery_address: payload.deliveryAddress || (payload.fulfillmentType === 'PICKUP' ? 'Retirada no Balcão' : ''),
          p_address_details: payload.addressDetails || {},
          p_payment_method: payload.paymentMethod,
          p_fulfillment_type: payload.fulfillmentType || 'DELIVERY',
          p_notes: payload.notes || null,
          p_coupon_code: payload.couponCode || null,
        });

        if (error) {
          console.error('[offerRepository] Erro no RPC process_promotional_checkout_atomic:', error.message);
          throw new Error(error.message);
        }

        if (data && data.success) {
          return {
            orderId: data.order_id,
            redemptionNumber: data.redemption_number,
            celebrationMessage: data.celebration_message,
            totalAmount: Number(data.total_amount),
            isExhausted: Boolean(data.is_exhausted),
          };
        }
      } catch (err: any) {
        console.warn('[offerRepository] Falha ao processar checkout promocional no Supabase, caindo para dataStore:', err.message);
        throw err;
      }
    }

    return dataStore.processPromotionalCheckout(slug, payload);
  },
};
