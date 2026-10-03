import { Tenant } from '../types';
import { dataStore } from './dataStore';
import { SecurityContext } from './securityEngine';
import { tenantRepository } from '../repositories/tenantRepository';

export const tenantService = {
  getTenants(context: SecurityContext): Tenant[] {
    tenantRepository.getTenants(context).catch(() => {});
    return dataStore.getTenants(context);
  },

  getTenantById(context: SecurityContext, tenantId: string): Tenant | undefined {
    return dataStore.getTenantById(context, tenantId);
  },

  getTenantBySlug(slug: string): Tenant | undefined {
    return dataStore.getTenantBySlug(slug);
  },

  updateSettings(context: SecurityContext, tenantId: string, settings: Partial<Tenant['settings']>): void {
    tenantRepository.updateSettings(context, tenantId, settings).catch(err => {
      console.warn('[tenantService] Erro ao salvar configurações no Supabase:', err);
    });
    dataStore.updateTenantSettings(context, tenantId, settings);
  }
};
