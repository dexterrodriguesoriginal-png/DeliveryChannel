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

export interface DineInModuleConfig {
  mode: 'TABLE' | 'INDIVIDUAL';
  release_required: boolean;
  round_limit: number;
  salon_open: boolean;
  close_roles: string[];
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
    if (moduleResult.error) throw toBackendError(moduleResult.error, 'Falha ao carregar as ferramentas.');
    if (tenantResult.error) throw toBackendError(tenantResult.error, 'Falha ao carregar o segmento do estabelecimento.');
    const validTypes = new Set<string>(BUSINESS_TYPES.map(type => type.key));
    const rows = moduleResult.data || [];
    let modules: TenantModule[];
    if (rows.length === 0) {
      let publicKeys: ReadonlySet<ModuleKey> | null = null;
      try {
        if (typeof supabase.rpc === 'function') {
          publicKeys = await this.getPublicEnabled(tenantId);
        }
      } catch {
        publicKeys = null;
      }
      modules = publicKeys && publicKeys.size > 0
        ? Array.from(publicKeys).map(key => ({ key, enabled: true, config: {} }))
        : legacySnapshot().modules;
    } else {
      modules = rows.map(row => ({
        key: row.module_key as ModuleKey,
        enabled: Boolean(row.enabled),
        config: row.config && typeof row.config === 'object' ? row.config as Record<string, unknown> : {},
      }));
    }
    return {
      available: true,
      modules,
      businessType: validTypes.has(tenantResult.data?.business_type || '')
        ? tenantResult.data?.business_type as BusinessType
        : null,
    };
  },

  async getPublicEnabled(tenantId: string): Promise<ReadonlySet<ModuleKey> | null> {
    if (!isSupabaseConfigured || !isValidUuid(tenantId)) return null;
    const { data, error } = await supabase.rpc('get_public_modules', { p_tenant_id: tenantId });
    if (isMissingModuleSchema(error)) return null;
    if (error) throw toBackendError(error, 'Falha ao carregar as ferramentas públicas da loja.');
    const validKeys = new Set<string>(MODULES.map(module => module.key));
    return new Set((Array.isArray(data) ? data : []).filter((key): key is ModuleKey =>
      typeof key === 'string' && validKeys.has(key)
    ));
  },

  async setEnabled(tenantId: string, key: ModuleKey, enabled: boolean, config: Record<string, unknown> = {}): Promise<void> {
    requireBackend('ferramentas do estabelecimento');
    const { error } = await supabase.rpc('set_tenant_module', {
      p_tenant: tenantId,
      p_key: key,
      p_enabled: enabled,
      p_config: config,
    });
    if (error) {
      if (isMissingModuleSchema(error)) throw new BackendError('MODULES_UNAVAILABLE', 'A configuração de ferramentas ainda não está disponível neste ambiente.');
      throw toBackendError(error, 'Falha ao atualizar a ferramenta.');
    }
  },

  async updateConfig(tenantId: string, key: ModuleKey, config: Record<string, unknown>): Promise<void> {
    const snapshot = await this.getForTenant(tenantId);
    const module = snapshot.modules.find(item => item.key === key);
    if (!module?.enabled) throw new BackendError('MODULE_DISABLED', 'Ative a ferramenta antes de configurar este recurso.');
    await this.setEnabled(tenantId, key, true, config);
  },

  async configureDineIn(
    tenantId: string,
    config: DineInModuleConfig,
    serviceFeeEnabled: boolean,
    serviceFeeConfig: Record<string, unknown>,
  ): Promise<void> {
    requireBackend('configuração do salão');
    const { error } = await supabase.rpc('configure_dine_in', {
      p_tenant: tenantId,
      p_config: config,
      p_service_fee_enabled: serviceFeeEnabled,
      p_service_fee_config: serviceFeeConfig,
    });
    if (error) {
      if (isMissingModuleSchema(error)) throw new BackendError('MODULES_UNAVAILABLE', 'A configuração do salão ainda não está disponível neste ambiente.');
      throw toBackendError(error, 'Falha ao salvar a configuração do salão.');
    }
  },

  async applyPreset(tenantId: string, type: BusinessType): Promise<void> {
    requireBackend('predefinição de ferramentas');
    const { error } = await supabase.rpc('apply_business_preset', {
      p_tenant: tenantId,
      p_type: type,
    });
    if (error) {
      if (isMissingModuleSchema(error)) throw new BackendError('MODULES_UNAVAILABLE', 'A configuração de ferramentas ainda não está disponível neste ambiente.');
      throw toBackendError(error, 'Falha ao aplicar a predefinição.');
    }
  },
};
