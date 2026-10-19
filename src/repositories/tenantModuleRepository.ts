import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { isValidUuid } from '../lib/uuid';
import { BackendError, requireBackend, toBackendError } from '../lib/backend';
import { BUSINESS_TYPES, BusinessType, LEGACY_ENABLED_MODULES, MODULES, ModuleKey } from '../lib/modules';

export interface TenantModule {
  key: ModuleKey;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface ModuleSnapshot {
  available: boolean;
  modules: TenantModule[];
  businessType: BusinessType | null;
}

function isMissingModuleSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code || '');
}

function legacySnapshot(): ModuleSnapshot {
  return {
    available: false,
    modules: [...LEGACY_ENABLED_MODULES].map(key => ({ key, enabled: true, config: {} })),
    businessType: null,
  };
}

export const tenantModuleRepository = {
  async getForTenant(tenantId: string): Promise<ModuleSnapshot> {
    if (!isSupabaseConfigured || !isValidUuid(tenantId)) return legacySnapshot();
    const [moduleResult, tenantResult] = await Promise.all([
      supabase.from('tenant_modules').select('module_key, enabled, config').eq('tenant_id', tenantId),
      supabase.from('tenants').select('business_type').eq('id', tenantId).maybeSingle(),
    ]);
    if (isMissingModuleSchema(moduleResult.error) || isMissingModuleSchema(tenantResult.error)) return legacySnapshot();
    if (moduleResult.error) throw toBackendError(moduleResult.error, 'Falha ao carregar os módulos.');
    if (tenantResult.error) throw toBackendError(tenantResult.error, 'Falha ao carregar o segmento do estabelecimento.');
    const validTypes = new Set<string>(BUSINESS_TYPES.map(type => type.key));
    return {
      available: true,
      modules: (moduleResult.data || []).map(row => ({
        key: row.module_key as ModuleKey,
        enabled: Boolean(row.enabled),
        config: row.config && typeof row.config === 'object' ? row.config as Record<string, unknown> : {},
      })),
      businessType: validTypes.has(tenantResult.data?.business_type || '')
        ? tenantResult.data?.business_type as BusinessType
        : null,
    };
  },

  async getPublicEnabled(tenantId: string): Promise<ReadonlySet<ModuleKey> | null> {
    if (!isSupabaseConfigured || !isValidUuid(tenantId)) return null;
    const { data, error } = await supabase.rpc('get_public_modules', { p_tenant_id: tenantId });
    if (isMissingModuleSchema(error)) return null;
    if (error) throw toBackendError(error, 'Falha ao carregar os módulos públicos da loja.');
    const validKeys = new Set<string>(MODULES.map(module => module.key));
    return new Set((Array.isArray(data) ? data : []).filter((key): key is ModuleKey =>
      typeof key === 'string' && validKeys.has(key)
    ));
  },

  async setEnabled(tenantId: string, key: ModuleKey, enabled: boolean, config: Record<string, unknown> = {}): Promise<void> {
    requireBackend('módulos do estabelecimento');
    const { error } = await supabase.rpc('set_tenant_module', {
      p_tenant: tenantId,
      p_key: key,
      p_enabled: enabled,
      p_config: config,
    });
    if (error) {
      if (isMissingModuleSchema(error)) throw new BackendError('MODULES_UNAVAILABLE', 'A configuração de módulos ainda não está disponível neste ambiente.');
      throw toBackendError(error, 'Falha ao atualizar o módulo.');
    }
  },

  async applyPreset(tenantId: string, type: BusinessType): Promise<void> {
    requireBackend('predefinição de módulos');
    const { error } = await supabase.rpc('apply_business_preset', {
      p_tenant: tenantId,
      p_type: type,
    });
    if (error) {
      if (isMissingModuleSchema(error)) throw new BackendError('MODULES_UNAVAILABLE', 'A configuração de módulos ainda não está disponível neste ambiente.');
      throw toBackendError(error, 'Falha ao aplicar a predefinição.');
    }
  },
};
