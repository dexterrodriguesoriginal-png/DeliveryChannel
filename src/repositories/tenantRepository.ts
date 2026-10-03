import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Tenant, TenantTheme, TenantSettings } from '../types';
import { dataStore } from '../services/dataStore';
import { SecurityContext } from '../services/securityEngine';
import { publicStoreRepository } from './publicStoreRepository';
import { isValidUuid } from '../lib/uuid';

function mapRowToTenant(row: any, settingsRow?: any, themeRow?: any): Tenant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    legalName: row.legal_name || row.name,
    document: row.document || '00.000.000/0001-00',
    phone: row.phone || '(11) 99999-9999',
    email: row.email || 'contato@adegafood.com.br',
    category: row.category || 'ADEGA',
    status: row.status || 'ACTIVE',
    planTier: row.plan_tier || 'STANDARD',
    createdAt: row.created_at,
    gmvMonthly: 0,
    activeOrdersToday: 0,
    totalCustomers: 0,
    isDemo: false,
    settings: {
      isOpen: settingsRow?.is_open !== undefined ? Boolean(settingsRow.is_open) : true,
      minOrderValue: Number(settingsRow?.min_order_value ?? 0),
      deliveryFee: Number(settingsRow?.delivery_fee ?? 0),
      freeDeliveryThreshold: settingsRow?.free_delivery_threshold ? Number(settingsRow.free_delivery_threshold) : undefined,
      estimatedDeliveryTime: settingsRow?.estimated_delivery_time || '30-45 min',
      defaultPrepTimeMinutes: settingsRow?.default_prep_time_minutes !== undefined && settingsRow?.default_prep_time_minutes !== null
        ? Number(settingsRow.default_prep_time_minutes)
        : 30,
      address: settingsRow?.address || 'Av. Principal, 1000 - Centro',
      city: settingsRow?.city || 'São Paulo',
      phoneWhatsApp: settingsRow?.phone_whatsapp || '(11) 99999-9999',
      pixKey: settingsRow?.pix_key || 'adega@pix.com.br',
    },
    theme: {
      storeName: themeRow?.store_name || row.name,
      tagline: themeRow?.tagline || 'Bebidas Selecionadas & Conveniência Express',
      logoUrl: themeRow?.logo_url || 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=200&h=200&fit=crop',
      bannerUrl: themeRow?.banner_url || 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1200&h=400&fit=crop',
      primaryColor: themeRow?.primary_color || '#15803d',
      secondaryColor: themeRow?.secondary_color || '#166534',
      backgroundColor: themeRow?.background_color || '#f8fafc',
      cardColor: themeRow?.card_color || '#ffffff',
      buttonColor: themeRow?.button_color || '#15803d',
      textColor: themeRow?.text_color || '#0f172a',
      borderRadius: themeRow?.border_radius || '1rem',
      fontFamily: themeRow?.font_family || 'Inter',
    }
  };
}

export const tenantRepository = {
  async getTenants(context: SecurityContext): Promise<Tenant[]> {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('tenants')
          .select('*, tenant_settings(*), tenant_themes(*)')
          .order('name');

        if (!error && data && data.length > 0) {
          return data.map(row => 
            mapRowToTenant(
              row, 
              Array.isArray(row.tenant_settings) ? row.tenant_settings[0] : row.tenant_settings, 
              Array.isArray(row.tenant_themes) ? row.tenant_themes[0] : row.tenant_themes
            )
          );
        }
      } catch (err) {
        console.warn('[tenantRepository] Fallback para dataStore:', err);
      }
    }
    return dataStore.getTenants(context);
  },

  async getById(context: SecurityContext, tenantId: string): Promise<Tenant | undefined> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('tenants')
          .select('*, tenant_settings(*), tenant_themes(*)')
          .eq('id', tenantId)
          .single();

        if (!error && data) {
          return mapRowToTenant(
            data,
            Array.isArray(data.tenant_settings) ? data.tenant_settings[0] : data.tenant_settings,
            Array.isArray(data.tenant_themes) ? data.tenant_themes[0] : data.tenant_themes
          );
        }
      } catch (err) {
        console.warn('[tenantRepository] Erro ao buscar tenant por ID:', err);
      }
    }
    return dataStore.getTenantById(context, tenantId);
  },

  async getBySlug(slug: string): Promise<Tenant | undefined> {
    if (isSupabaseConfigured) {
      try {
        // Para visitantes anônimos e catálogo público seguro, utilizamos getPublicStore(slug)
        const store = await publicStoreRepository.getPublicStore(slug);
        if (store && store.tenant) {
          return {
            id: store.tenant.id,
            slug: store.tenant.slug,
            name: store.tenant.name,
            legalName: store.tenant.name,
            document: '00.000.000/0001-00',
            phone: store.tenant.phone,
            email: 'contato@adegafood.com.br',
            category: (store.tenant.category as any) || 'ADEGA',
            status: store.tenant.status as any,
            planTier: 'STANDARD',
            createdAt: new Date().toISOString(),
            gmvMonthly: 0,
            activeOrdersToday: 0,
            totalCustomers: 0,
            isDemo: false,
            settings: store.settings,
            theme: store.theme,
          };
        }
      } catch (err) {
        console.warn('[tenantRepository] Erro ao buscar tenant por slug no Supabase:', err);
      }
    }
    return dataStore.getTenantBySlug(slug);
  },

  async updateTheme(context: SecurityContext, tenantId: string, themeUpdates: Partial<TenantTheme>): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const dbTheme: any = { updated_at: new Date().toISOString() };
        if (themeUpdates.storeName !== undefined) dbTheme.store_name = themeUpdates.storeName;
        if (themeUpdates.tagline !== undefined) dbTheme.tagline = themeUpdates.tagline;
        if (themeUpdates.logoUrl !== undefined) dbTheme.logo_url = themeUpdates.logoUrl;
        if (themeUpdates.bannerUrl !== undefined) dbTheme.banner_url = themeUpdates.bannerUrl;
        if (themeUpdates.primaryColor !== undefined) dbTheme.primary_color = themeUpdates.primaryColor;
        if (themeUpdates.secondaryColor !== undefined) dbTheme.secondary_color = themeUpdates.secondaryColor;
        if (themeUpdates.backgroundColor !== undefined) dbTheme.background_color = themeUpdates.backgroundColor;
        if (themeUpdates.cardColor !== undefined) dbTheme.card_color = themeUpdates.cardColor;
        if (themeUpdates.buttonColor !== undefined) dbTheme.button_color = themeUpdates.buttonColor;
        if (themeUpdates.textColor !== undefined) dbTheme.text_color = themeUpdates.textColor;
        if (themeUpdates.borderRadius !== undefined) dbTheme.border_radius = themeUpdates.borderRadius;
        if (themeUpdates.fontFamily !== undefined) dbTheme.font_family = themeUpdates.fontFamily;

        // Upsert na tabela tenant_themes
        await supabase
          .from('tenant_themes')
          .upsert({ tenant_id: tenantId, ...dbTheme }, { onConflict: 'tenant_id' });
      } catch (err) {
        console.warn('[tenantRepository] Erro ao persistir tema no Supabase:', err);
      }
    }
    dataStore.updateTenantTheme(context, tenantId, themeUpdates);
  },

  async getSettings(context: SecurityContext, tenantId: string): Promise<TenantSettings | null> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('tenant_settings')
          .select('*')
          .eq('tenant_id', tenantId)
          .maybeSingle();

        if (!error && data) {
          return {
            isOpen: data.is_open !== undefined ? Boolean(data.is_open) : true,
            minOrderValue: Number(data.min_order_value ?? 0),
            deliveryFee: Number(data.delivery_fee ?? 0),
            freeDeliveryThreshold: data.free_delivery_threshold ? Number(data.free_delivery_threshold) : undefined,
            estimatedDeliveryTime: data.estimated_delivery_time || '30-45 min',
            defaultPrepTimeMinutes: data.default_prep_time_minutes !== undefined && data.default_prep_time_minutes !== null
              ? Number(data.default_prep_time_minutes)
              : 30,
            address: data.address || '',
            city: data.city || 'São Paulo',
            phoneWhatsApp: data.phone_whatsapp || '',
            pixKey: data.pix_key || undefined,
          };
        }
      } catch (err) {
        console.warn('[tenantRepository] Erro ao consultar tenant_settings no Supabase:', err);
      }
    }
    const tenant = dataStore.getTenantById(context, tenantId);
    return tenant?.settings || null;
  },

  async updateSettings(context: SecurityContext, tenantId: string, settingsUpdates: Partial<TenantSettings>): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const dbSettings: any = { updated_at: new Date().toISOString() };
        if (settingsUpdates.isOpen !== undefined) dbSettings.is_open = settingsUpdates.isOpen;
        if (settingsUpdates.minOrderValue !== undefined) dbSettings.min_order_value = settingsUpdates.minOrderValue;
        if (settingsUpdates.deliveryFee !== undefined) dbSettings.delivery_fee = settingsUpdates.deliveryFee;
        if (settingsUpdates.freeDeliveryThreshold !== undefined) dbSettings.free_delivery_threshold = settingsUpdates.freeDeliveryThreshold;
        if (settingsUpdates.estimatedDeliveryTime !== undefined) dbSettings.estimated_delivery_time = settingsUpdates.estimatedDeliveryTime;
        if (settingsUpdates.defaultPrepTimeMinutes !== undefined) dbSettings.default_prep_time_minutes = settingsUpdates.defaultPrepTimeMinutes;
        if (settingsUpdates.address !== undefined) dbSettings.address = settingsUpdates.address;
        if (settingsUpdates.city !== undefined) dbSettings.city = settingsUpdates.city;
        if (settingsUpdates.phoneWhatsApp !== undefined) dbSettings.phone_whatsapp = settingsUpdates.phoneWhatsApp;
        if (settingsUpdates.pixKey !== undefined) dbSettings.pix_key = settingsUpdates.pixKey;

        const { error: upsertError } = await supabase
          .from('tenant_settings')
          .upsert({ tenant_id: tenantId, ...dbSettings }, { onConflict: 'tenant_id' });

        if (upsertError) {
          console.error('[tenantRepository] Erro ao persistir configurações no Supabase:', upsertError.message);
          throw new Error(upsertError.message || 'Falha ao salvar configurações no servidor.');
        }
      } catch (err: any) {
        console.warn('[tenantRepository] Erro ao persistir configurações no Supabase:', err);
        throw err;
      }
    }
    dataStore.updateTenantSettings(context, tenantId, settingsUpdates);
  },

  /**
   * Remove com segurança apenas os registros marcados com is_demo = true no tenant
   */
  async removeDemoCatalog(tenantId: string): Promise<{ success: boolean; deletedOffers: number; deletedProducts: number; deletedCategories: number }> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase.rpc('remove_demo_catalog_for_current_tenant', {
          p_tenant_id: tenantId,
        });

        if (error) {
          console.error('[tenantRepository] Erro ao executar remove_demo_catalog_for_current_tenant:', error.message);
          throw new Error(`Falha ao remover catálogo de demonstração: ${error.message}`);
        }

        return data as { success: boolean; deletedOffers: number; deletedProducts: number; deletedCategories: number };
      } catch (err: any) {
        console.warn('[tenantRepository] Erro ao remover catálogo demo no Supabase:', err);
      }
    }
    return { success: true, deletedOffers: 0, deletedProducts: 0, deletedCategories: 0 };
  },

  /**
   * Semeia catálogo de demonstração no tenant
   */
  async seedDemoCatalog(tenantId: string): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { error } = await supabase.rpc('seed_tenant_demo_catalog', {
          p_tenant_id: tenantId,
        });
        if (error) {
          console.error('[tenantRepository] Erro ao semear catálogo demo:', error.message);
          throw new Error(`Falha ao carregar catálogo demo: ${error.message}`);
        }
      } catch (err: any) {
        console.warn('[tenantRepository] Erro ao semear catálogo demo:', err);
      }
    }
  }
};
