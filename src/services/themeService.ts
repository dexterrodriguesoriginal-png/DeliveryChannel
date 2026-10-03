import { TenantTheme } from '../types';
import { SecurityContext } from './securityEngine';
import { tenantRepository } from '../repositories/tenantRepository';

const themesCache = new Map<string, TenantTheme>();

export const themeService = {
  getTheme(context: SecurityContext, tenantId: string): TenantTheme | undefined {
    return themesCache.get(tenantId);
  },

  updateTheme(context: SecurityContext, tenantId: string, theme: Partial<TenantTheme>): void {
    const current = themesCache.get(tenantId);
    if (current) {
      themesCache.set(tenantId, { ...current, ...theme });
    } else {
      themesCache.set(tenantId, theme as TenantTheme);
    }

    // Persiste exclusivamente no Supabase através do tenantRepository
    tenantRepository.updateTheme(context, tenantId, theme).catch(err => {
      console.warn('[themeService] Erro ao salvar tema no Supabase:', err);
    });
  }
};
