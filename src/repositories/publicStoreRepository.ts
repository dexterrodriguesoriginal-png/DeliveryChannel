import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Product, Category, Offer, TenantTheme, TenantSettings } from '../types';
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
              imageUrl: o.imageUrl,
              internalLink: o.internalLink,
              order: o.order,
              backgroundColor: o.backgroundColor || '#15803d',
              accentColor: o.accentColor || '#ffffff',
              isActive: Boolean(o.isActive),
              isDemo: false,
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
