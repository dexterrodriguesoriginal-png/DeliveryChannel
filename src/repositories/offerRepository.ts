import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Offer } from '../types';
import { dataStore } from '../services/dataStore';
import { SecurityContext } from '../services/securityEngine';
import { publicStoreRepository } from './publicStoreRepository';
import { isValidUuid } from '../lib/uuid';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mapRowToOffer(row: any): Offer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id || undefined,
    title: row.title,
    subtitle: row.subtitle || undefined,
    description: row.description || '',
    badge: row.badge || undefined,
    discountPercentage: row.discount_percentage ? Number(row.discount_percentage) : undefined,
    originalPrice: row.original_price ? Number(row.original_price) : undefined,
    promotionalPrice: row.promotional_price ? Number(row.promotional_price) : undefined,
    imageUrl: row.image_url,
    internalLink: row.internal_link || undefined,
    order: Number(row.display_order ?? 0),
    startDate: row.start_date || undefined,
    endDate: row.end_date || undefined,
    backgroundColor: row.background_color || '#15803d',
    accentColor: row.accent_color || '#ffffff',
    isActive: Boolean(row.is_active),
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
            discount_percentage: data.discountPercentage && data.discountPercentage > 0 ? data.discountPercentage : null,
            original_price: data.originalPrice && data.originalPrice > 0 ? data.originalPrice : null,
            promotional_price: data.promotionalPrice && data.promotionalPrice > 0 ? data.promotionalPrice : null,
            image_url: data.imageUrl,
            internal_link: data.internalLink || null,
            display_order: data.order ?? 0,
            start_date: data.startDate || null,
            end_date: data.endDate || null,
            background_color: data.backgroundColor || null,
            accent_color: data.accentColor || null,
            is_active: data.isActive !== undefined ? data.isActive : true,
            is_demo: data.isDemo ?? false,
          })
          .select()
          .single();

        if (error) {
          console.warn('[offerRepository] Erro ao cadastrar oferta no Supabase:', error.message);
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
        if (updates.discountPercentage !== undefined) {
          dbUpdates.discount_percentage = updates.discountPercentage > 0 ? updates.discountPercentage : null;
        }
        if (updates.originalPrice !== undefined) {
          dbUpdates.original_price = updates.originalPrice > 0 ? updates.originalPrice : null;
        }
        if (updates.promotionalPrice !== undefined) {
          dbUpdates.promotional_price = updates.promotionalPrice > 0 ? updates.promotionalPrice : null;
        }
        if (updates.imageUrl !== undefined) dbUpdates.image_url = updates.imageUrl;
        if (updates.internalLink !== undefined) dbUpdates.internal_link = updates.internalLink;
        if (updates.order !== undefined) dbUpdates.display_order = updates.order;
        if (updates.startDate !== undefined) dbUpdates.start_date = updates.startDate || null;
        if (updates.endDate !== undefined) dbUpdates.end_date = updates.endDate || null;
        if (updates.backgroundColor !== undefined) dbUpdates.background_color = updates.backgroundColor;
        if (updates.accentColor !== undefined) dbUpdates.accent_color = updates.accentColor;
        if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
        if (updates.productId !== undefined) {
          dbUpdates.product_id = await this.validateProductBelongsToTenant(tenantId, updates.productId);
        }

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
  }
};
