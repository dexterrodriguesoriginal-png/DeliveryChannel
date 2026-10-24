/**
 * Lojas, configurações e tema. Sem fallback local com Supabase configurado (erro do servidor vira erro).
 * - tenant_settings: colunas explícitas por esquema (src/lib/dbColumns.ts). No N1–N6 pix_key não é legível.
 * - PIX: legacy-020 usa tenant_settings.pix_key (caminho atual); n1n6 usa tenant_payment_settings
 *   (leitura OWNER/MANAGER via RLS) + RPC upsert_tenant_payment_settings.
 * - Tempo de preparo: NULL = não configurado (sem default 30); coluna só existe no N1–N6.
 */
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Tenant, TenantTheme, TenantSettings, TenantPaymentSettings } from '../types';
import { BackendError, requireBackend, requireBackendOrLocalDemo, toBackendError } from '../lib/backend';
import { tenantSettingsColumns } from '../lib/dbColumns';
import { isN1N6Backend, N1N6_ONLY_MESSAGE } from '../lib/backendSchema';
import { dataStore } from '../services/dataStore';
import { SecurityContext } from '../services/securityEngine';
import { publicStoreRepository } from './publicStoreRepository';
import { isValidUuid } from '../lib/uuid';
import { fulfillmentFieldsFromRaw, fulfillmentFieldsToDb, validateFulfillmentSettingsUpdate } from '../lib/pricing/fulfillmentPricing';

function mapRowToTenant(row: any, settingsRow?: any, themeRow?: any): Tenant {
  return {
    id: row.id,
    businessType: row.business_type || null,
    slug: row.slug,
    name: row.name,
    legalName: row.legal_name || row.name,
    document: row.document || '',
    phone: row.phone || '',
    email: row.email || '',
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
        : undefined,
      address: settingsRow?.address || '',
      city: settingsRow?.city || '',
      phoneWhatsApp: settingsRow?.phone_whatsapp || '',
      pixKey: settingsRow?.pix_key || undefined,
      ...fulfillmentFieldsFromRaw(settingsRow || {}),
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
      tokens: themeRow?.theme_tokens || undefined,
    }
  };
}

const tenantSelect = () => `*, tenant_settings(${tenantSettingsColumns()}), tenant_themes(*)`;

export function maskPixKey(key?: string | null): string | undefined {
  if (!key) return undefined;
  const k = String(key);
  if (k.length <= 4) return '****';
  return `${k.slice(0, 2)}${'*'.repeat(Math.max(3, k.length - 4))}${k.slice(-2)}`;
}

/** Colunas de tenant_settings que o esquema ativo aceita gravar (N1 restringe UPDATE por coluna). */
export function settingsToDb(u: Partial<TenantSettings>, n1n6: boolean): Record<string, unknown> {
  const db: Record<string, unknown> = {};
  if (u.isOpen !== undefined) db.is_open = u.isOpen;
  if (u.minOrderValue !== undefined) db.min_order_value = u.minOrderValue;
  if (u.deliveryFee !== undefined) db.delivery_fee = u.deliveryFee;
  if (u.freeDeliveryThreshold !== undefined) db.free_delivery_threshold = u.freeDeliveryThreshold ?? null;
  if (u.estimatedDeliveryTime !== undefined) db.estimated_delivery_time = u.estimatedDeliveryTime;
  if (u.address !== undefined) db.address = u.address;
  if (u.city !== undefined) db.city = u.city;
  if (u.phoneWhatsApp !== undefined) db.phone_whatsapp = u.phoneWhatsApp;
  if (n1n6) {
    if (u.defaultPrepTimeMinutes !== undefined) db.default_prep_time_minutes = u.defaultPrepTimeMinutes ?? null;
  } else if (u.pixKey !== undefined) {
    db.pix_key = u.pixKey ? u.pixKey.trim() : null;
  }
  return db;
}

export const tenantRepository = {
  async getTenants(context: SecurityContext): Promise<Tenant[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('tenants').select(tenantSelect()).order('name');
      if (error) throw toBackendError(error, 'Falha ao carregar lojas.');
      return (data || []).map((row: any) =>
        mapRowToTenant(
          row,
          Array.isArray(row.tenant_settings) ? row.tenant_settings[0] : row.tenant_settings,
          Array.isArray(row.tenant_themes) ? row.tenant_themes[0] : row.tenant_themes
        )
      );
    }
    requireBackendOrLocalDemo('lojas');
    return dataStore.getTenants(context);
  },

  async getById(context: SecurityContext, tenantId: string): Promise<Tenant | undefined> {
    if (isSupabaseConfigured) {
      if (!isValidUuid(tenantId)) return undefined;
      const { data, error } = await supabase.from('tenants').select(tenantSelect()).eq('id', tenantId).maybeSingle();
      if (error) throw toBackendError(error, 'Falha ao carregar a loja.');
      if (!data) return undefined;
      const row: any = data;
      return mapRowToTenant(
        row,
        Array.isArray(row.tenant_settings) ? row.tenant_settings[0] : row.tenant_settings,
        Array.isArray(row.tenant_themes) ? row.tenant_themes[0] : row.tenant_themes
      );
    }
    requireBackendOrLocalDemo('lojas');
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
            document: '',
            phone: store.tenant.phone,
            email: '',
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
        return undefined;
      } catch (err) {
        console.warn('[tenantRepository] Erro ao buscar tenant por slug no Supabase:', err);
        throw toBackendError(err, 'Falha ao carregar a loja.');
      }
    }
    requireBackendOrLocalDemo('lojas');
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
        if (themeUpdates.tokens !== undefined) dbTheme.theme_tokens = themeUpdates.tokens;

        let { error } = await supabase
          .from('tenant_themes')
          .upsert({ tenant_id: tenantId, ...dbTheme }, { onConflict: 'tenant_id' });

        // Fallback defensivo: se a coluna theme_tokens ainda não existir no ambiente remoto
        if (error && (error.message?.includes('theme_tokens') || (error as any).code === '42703')) {
          const fallbackDbTheme = { ...dbTheme };
          delete fallbackDbTheme.theme_tokens;
          const retry = await supabase
            .from('tenant_themes')
            .upsert({ tenant_id: tenantId, ...fallbackDbTheme }, { onConflict: 'tenant_id' });
          error = retry.error;
        }

        if (error) throw toBackendError(error, 'Falha ao salvar o tema.');
      } catch (err) {
        throw toBackendError(err, 'Falha ao salvar o tema.');
      }
      return;
    }
    requireBackendOrLocalDemo('tema');
    dataStore.updateTenantTheme(context, tenantId, themeUpdates);
  },

  async getSettings(context: SecurityContext, tenantId: string): Promise<TenantSettings | null> {
    if (isSupabaseConfigured) {
      if (!isValidUuid(tenantId)) return null;
      const { data, error } = await supabase
        .from('tenant_settings')
        .select(tenantSettingsColumns())
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (error) throw toBackendError(error, 'Falha ao carregar configurações.');
      if (!data) return null;
      const row: any = data;
      return {
        isOpen: row.is_open !== undefined ? Boolean(row.is_open) : true,
        minOrderValue: Number(row.min_order_value ?? 0),
        deliveryFee: Number(row.delivery_fee ?? 0),
        freeDeliveryThreshold: row.free_delivery_threshold ? Number(row.free_delivery_threshold) : undefined,
        estimatedDeliveryTime: row.estimated_delivery_time || '30-45 min',
        defaultPrepTimeMinutes:
          row.default_prep_time_minutes !== undefined && row.default_prep_time_minutes !== null
            ? Number(row.default_prep_time_minutes)
            : undefined,
        address: row.address || '',
        city: row.city || '',
        phoneWhatsApp: row.phone_whatsapp || '',
        pixKey: row.pix_key || undefined,
        ...fulfillmentFieldsFromRaw(row),
      };
    }
    requireBackendOrLocalDemo('configurações');
    const tenant = dataStore.getTenantById(context, tenantId);
    return tenant?.settings || null;
  },

  async updateSettings(context: SecurityContext, tenantId: string, settingsUpdates: Partial<TenantSettings>): Promise<void> {
    const fulfillmentError = validateFulfillmentSettingsUpdate(settingsUpdates as Record<string, any>);
    if (fulfillmentError) throw new Error(fulfillmentError);
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const n1n6 = isN1N6Backend();
        const dbSettings: Record<string, unknown> = { ...settingsToDb(settingsUpdates, n1n6), updated_at: new Date().toISOString() };
        // N1: INSERT/colunas fora da lista são revogados — sempre UPDATE da linha existente.
        // legacy-020: mantém o upsert atual.
        // legacy-020: UPDATE da linha existente (atualização parcial não viola NOT NULL de colunas
        // ausentes); INSERT via upsert somente quando a loja ainda não tem linha de configurações.
        let upsertError: any = null;
        if (n1n6) {
          ({ error: upsertError } = await supabase.from('tenant_settings').update(dbSettings).eq('tenant_id', tenantId));
        } else {
          const upd = await supabase.from('tenant_settings').update(dbSettings).eq('tenant_id', tenantId).select('tenant_id');
          upsertError = upd.error;
          if (!upd.error && (!upd.data || upd.data.length === 0)) {
            ({ error: upsertError } = await supabase
              .from('tenant_settings')
              .upsert({ tenant_id: tenantId, ...dbSettings }, { onConflict: 'tenant_id' }));
          }
        }

        if (upsertError) {
          console.error('[tenantRepository] Erro ao persistir configurações no Supabase:', upsertError.message);
          throw toBackendError(upsertError, 'Falha ao salvar configurações no servidor.');
        }

        // Modalidades/desconto de retirada: colunas da PROPOSTA 20261013000100 (ainda não aplicada).
        // Gravação separada para não quebrar o salvamento das configurações existentes se as colunas não existirem.
        const fulfillmentDb = fulfillmentFieldsToDb(settingsUpdates as Record<string, any>);
        if (Object.keys(fulfillmentDb).length > 0) {
          const { error: fulfillmentErr } = await supabase
            .from('tenant_settings')
            .update(fulfillmentDb)
            .eq('tenant_id', tenantId);
          if (fulfillmentErr) {
            throw new Error(
              'As configurações de Delivery/Retirada ainda não estão disponíveis no banco (migration de modalidades pendente): ' +
              fulfillmentErr.message
            );
          }
        }
      } catch (err: any) {
        console.warn('[tenantRepository] Erro ao persistir configurações no Supabase:', err);
        throw err;
      }
      return;
    }
    requireBackendOrLocalDemo('configurações');
    dataStore.updateTenantSettings(context, tenantId, settingsUpdates);
  },

  /** Configuração PIX (n1n6; somente OWNER/MANAGER via RLS). Retorna null sem linha. */
  async getPaymentSettings(tenantId: string): Promise<TenantPaymentSettings | null> {
    requireBackend('configurações de pagamento');
    if (!isN1N6Backend()) throw new BackendError('N1N6_REQUIRED', N1N6_ONLY_MESSAGE);
    const { data, error } = await supabase
      .from('tenant_payment_settings')
      .select('tenant_id, pix_enabled, pix_key_type, pix_key, pix_merchant_name, pix_merchant_city, updated_at')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw toBackendError(error, 'Falha ao carregar configurações de pagamento.');
    if (!data) return null;
    return {
      tenantId: data.tenant_id,
      pixEnabled: Boolean(data.pix_enabled),
      pixKeyType: data.pix_key_type || undefined,
      pixKeyMasked: maskPixKey(data.pix_key),
      merchantName: data.pix_merchant_name || undefined,
      merchantCity: data.pix_merchant_city || undefined,
      updatedAt: data.updated_at,
    };
  },

  /** Salva a configuração PIX pelo servidor (n1n6; validação da chave no PostgreSQL; auditado). */
  async savePaymentSettings(
    tenantId: string,
    input: { pixEnabled: boolean; pixKeyType?: string; pixKey?: string; merchantName?: string; merchantCity?: string }
  ): Promise<TenantPaymentSettings> {
    requireBackend('configurações de pagamento');
    if (!isN1N6Backend()) throw new BackendError('N1N6_REQUIRED', N1N6_ONLY_MESSAGE);
    const { data, error } = await supabase.rpc('upsert_tenant_payment_settings', {
      p_tenant_id: tenantId,
      p_pix_enabled: input.pixEnabled,
      p_pix_key_type: input.pixKeyType || null,
      p_pix_key: input.pixKey?.trim() || null,
      p_merchant_name: input.merchantName?.trim() || null,
      p_merchant_city: input.merchantCity?.trim() || null,
    });
    if (error) throw toBackendError(error, 'Falha ao salvar a configuração PIX.');
    return {
      tenantId: data.tenant_id,
      pixEnabled: Boolean(data.pix_enabled),
      pixKeyType: data.pix_key_type || undefined,
      pixKeyMasked: data.pix_key_masked || undefined,
      merchantName: data.pix_merchant_name || undefined,
      merchantCity: data.pix_merchant_city || undefined,
    };
  },

};
