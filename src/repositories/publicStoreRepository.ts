import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Product, Category, Offer, TenantTheme, TenantSettings, PromotionCarousel } from '../types';
import { dataStore } from '../services/dataStore';

export interface PublicStoreData {
  tenant: {
    id: string;
    slug: string;
    name: string;
    phone: string;
    email: string;
    category: string;
    status: string;
  };
  theme: TenantTheme;
  settings: TenantSettings;
  categories: Category[];
  products: Product[];
  offers: Offer[];
  promotionCarousels: PromotionCarousel[];
}

export const publicStoreRepository = {
  /**
   * Obtém catálogo público seguro através da RPC SECURITY DEFINER `get_public_store(p_slug)`.
   * Não expõe dados privados (custo de produtos, estoque interno detalhado, clientes, pedidos, audit_logs).
   */
  async getPublicStore(slug: string): Promise<PublicStoreData | null> {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.rpc('get_public_store', { p_slug: slug });

        if (!error && data && data.tenant) {
          return {
            tenant: data.tenant,
            theme: data.theme,
            settings: {
              isOpen: data.settings?.isOpen ?? data.settings?.is_open ?? true,
              minOrderValue: Number(data.settings?.minOrderValue ?? data.settings?.min_order_value ?? 0),
              deliveryFee: Number(data.settings?.deliveryFee ?? data.settings?.delivery_fee ?? 0),
              freeDeliveryThreshold: data.settings?.freeDeliveryThreshold !== undefined 
                ? Number(data.settings.freeDeliveryThreshold) 
                : (data.settings?.free_delivery_threshold ? Number(data.settings.free_delivery_threshold) : undefined),
              estimatedDeliveryTime: data.settings?.estimatedDeliveryTime || data.settings?.estimated_delivery_time || '30-45 min',
              defaultPrepTimeMinutes: data.settings?.defaultPrepTimeMinutes !== undefined
                ? Number(data.settings.defaultPrepTimeMinutes)
                : (data.settings?.default_prep_time_minutes !== undefined && data.settings?.default_prep_time_minutes !== null
                    ? Number(data.settings.default_prep_time_minutes)
                    : 30),
              address: data.settings?.address || '',
              city: data.settings?.city || 'São Paulo',
              phoneWhatsApp: data.settings?.phoneWhatsApp || data.settings?.phone_whatsapp || '',
              pixKey: data.settings?.pixKey || data.settings?.pix_key || undefined,
            },
            categories: (data.categories || []).map((c: any) => ({
              id: c.id,
              tenantId: c.tenantId,
              name: c.name,
              description: c.description,
              imageUrl: c.imageUrl,
              order: c.order,
              isActive: c.isActive,
              isDemo: false,
            })),
            products: (data.products || []).map((p: any) => ({
              id: p.id,
              tenantId: p.tenantId,
              categoryId: p.categoryId,
              name: p.name,
              description: p.description,
              imageUrl: p.imageUrl,
              price: Number(p.price),
              promotionalPrice: p.promotionalPrice ? Number(p.promotionalPrice) : undefined,
              unit: p.unit || 'un',
              stockQuantity: p.isAvailable ? 99 : 0,
              isAvailable: Boolean(p.isAvailable),
              isActive: Boolean(p.isActive),
              isFeatured: Boolean(p.isFeatured),
              isDemo: false,
            })),
            offers: (data.offers || []).map((o: any) => ({
              id: o.id,
              tenantId: o.tenantId,
              productId: o.productId,
              title: o.title,
              subtitle: o.subtitle,
              description: o.description,
              badge: o.badge,
              discountPercentage: o.discountPercentage,
              originalPrice: o.originalPrice ? Number(o.originalPrice) : undefined,
              promotionalPrice: o.promotionalPrice ? Number(o.promotionalPrice) : undefined,
              imageUrl: o.imageUrl || o.mediaUrl || o.media_url,
              mediaUrl: o.mediaUrl || o.media_url || o.imageUrl,
              mediaType: o.mediaType || o.media_type || 'IMAGE',
              displayMode: (o.displayMode || o.display_mode || 'EDITABLE_CARD'),
              cardFormat: o.cardFormat || o.card_format || 'HORIZONTAL',
              durationSeconds: Number(o.durationSeconds ?? o.duration_seconds ?? 5.0),
              videoDuration: o.videoDuration ? Number(o.videoDuration) : (o.video_duration ? Number(o.video_duration) : undefined),
              detectedWidth: o.detectedWidth ? Number(o.detectedWidth) : (o.detected_width ? Number(o.detected_width) : undefined),
              detectedHeight: o.detectedHeight ? Number(o.detectedHeight) : (o.detected_height ? Number(o.detected_height) : undefined),
              aspectRatio: o.aspectRatio || o.aspect_ratio || '16:9',
              internalTitle: o.internalTitle || o.internal_title,
              internalDescription: o.internalDescription || o.internal_description,
              internalLink: o.internalLink,
              order: o.order,
              backgroundColor: o.backgroundColor || '#15803d',
              accentColor: o.accentColor || '#ffffff',
              startDate: o.startDate || o.start_date || o.startAt || o.start_at || undefined,
              endDate: o.endDate || o.end_date || o.endAt || o.end_at || undefined,
              startAt: o.startAt || o.start_at || o.startDate || o.start_date || undefined,
              endAt: o.endAt || o.end_at || o.endDate || o.end_date || undefined,
              isActive: Boolean(o.isActive),
              isDemo: false,

              // Checkout Promocional Próprio e Destino
              destinationType: o.destinationType || (o.productId ? 'PRODUCT' : 'BANNER_ONLY'),
              hasPromoCheckout: Boolean(o.hasPromoCheckout),
              promoTitle: o.promoTitle,
              promoDescription: o.promoDescription,
              promoPrice: o.promoPrice ? Number(o.promoPrice) : undefined,
              promoOriginalPrice: o.promoOriginalPrice ? Number(o.promoOriginalPrice) : undefined,
              promoDiscountPercentage: o.promoDiscountPercentage ? Number(o.promoDiscountPercentage) : undefined,
              promoUnit: o.promoUnit || 'un',
              promoMinQuantity: o.promoMinQuantity ? Number(o.promoMinQuantity) : 1,
              promoMaxQuantityPerCustomer: o.promoMaxQuantityPerCustomer ? Number(o.promoMaxQuantityPerCustomer) : 10,
              promoNotes: o.promoNotes,
              promoFulfillmentTypes: o.promoFulfillmentTypes || ['DELIVERY', 'PICKUP'],
              promoPaymentMethods: o.promoPaymentMethods || ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'],
              promoCouponCode: o.promoCouponCode,
              promoUsageLimit: o.promoUsageLimit ? Number(o.promoUsageLimit) : undefined,
              promoTimesUsed: Number(o.promoTimesUsed ?? 0),
              isExhausted: Boolean(o.isExhausted || (o.promoUsageLimit && Number(o.promoTimesUsed ?? 0) >= o.promoUsageLimit)),
              remainingUses: o.remainingUses !== undefined ? o.remainingUses : (o.promoUsageLimit ? Math.max(0, o.promoUsageLimit - Number(o.promoTimesUsed ?? 0)) : null),
              autoOverlay: o.autoOverlay !== undefined ? Boolean(o.autoOverlay) : true,
              cardModel: o.cardModel || 'HERO',
            })),
            promotionCarousels: (data.promotionCarousels || []).map((pc: any) => ({
              id: pc.id,
              tenantId: pc.tenantId || pc.tenant_id,
              name: pc.name,
              description: pc.description,
              imageUrl: pc.imageUrl || pc.image_url,
              isActive: Boolean(pc.isActive ?? pc.is_active ?? true),
              showInStore: Boolean(pc.showInStore ?? pc.show_in_store ?? true),
              displayOrder: pc.displayOrder ?? pc.display_order ?? 0,
              items: (pc.items || []).map((pci: any) => ({
                id: pci.id,
                carouselId: pci.carouselId || pci.carousel_id,
                productId: pci.productId || pci.product_id,
                tenantId: pci.tenantId || pci.tenant_id,
                discountType: pci.discountType || pci.discount_type || 'PERCENTAGE',
                discountValue: Number(pci.discountValue ?? pci.discount_value ?? 0),
                promotionalPrice: Number(pci.promotionalPrice ?? pci.promotional_price ?? 0),
                calculatedDiscountPercentage: Number(pci.calculatedDiscountPercentage ?? pci.calculated_discount_percentage ?? 0),
                showDiscountBadge: Boolean(pci.showDiscountBadge ?? pci.show_discount_badge ?? true),
                showPromotionalPrice: Boolean(pci.showPromotionalPrice ?? pci.show_promotional_price ?? true),
                startDate: pci.startDate || pci.start_date,
                endDate: pci.endDate || pci.end_date,
                isActive: Boolean(pci.isActive ?? pci.is_active ?? true),
                displayOrder: pci.displayOrder ?? pci.display_order ?? 0,
                product: pci.product ? {
                  ...pci.product,
                  price: Number(pci.product.price),
                } : undefined,
              })),
            })),
          };
        } else if (error) {
          console.warn('[publicStoreRepository] RPC get_public_store retornou erro:', error.message);
          return null;
        }
      } catch (err) {
        console.warn('[publicStoreRepository] Erro ao buscar catálogo no Supabase:', err);
        return null;
      }
    }

    // Apenas se Supabase não estiver configurado (ambiente de desenvolvimento local/demo isolado)
    if (!isSupabaseConfigured) {
      const localTenant = dataStore.getTenantBySlug(slug);
      if (!localTenant) return null;

      return {
        tenant: {
          id: localTenant.id,
          slug: localTenant.slug,
          name: localTenant.name,
          phone: localTenant.phone,
          email: localTenant.email,
          category: localTenant.category,
          status: localTenant.status,
        },
        theme: localTenant.theme,
        settings: localTenant.settings,
        categories: dataStore.getPublicCategories(slug),
        products: dataStore.getPublicProducts(slug),
        offers: dataStore.getPublicOffers(slug),
        promotionCarousels: dataStore.getPublicPromotionCarousels(slug),
      };
    }

    return null;
  },

  /**
   * Rastreia eventos públicos através da RPC `track_public_event`
   */
  async trackPublicEvent(slug: string, eventName: string, metadata: Record<string, any> = {}): Promise<void> {
    if (isSupabaseConfigured) {
      try {
        await supabase.rpc('track_public_event', {
          p_tenant_slug: slug,
          p_event_name: eventName,
          p_metadata: metadata,
        });
      } catch (err) {
        console.warn('[publicStoreRepository] Erro ao registrar evento no Supabase:', err);
      }
    }
  }
};
