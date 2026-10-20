/**
 * Serviço de Gerenciamento e Isolamento de Temas Visuais por Estabelecimento
 * Persistência segura em tenantRepository e cache isolado por tenantId.
 */

import { TenantTheme } from '../types';
import { SecurityContext } from './securityEngine';
import { tenantRepository } from '../repositories/tenantRepository';
import { DEFAULT_DELIVERY_CHANNEL_THEME, createDefaultThemeTokens } from '../lib/theme/themeEngine';

const themesCache = new Map<string, TenantTheme>();

export const themeService = {
  getTheme(context: SecurityContext, tenantId: string): TenantTheme | undefined {
    return themesCache.get(tenantId);
  },

  setCache(tenantId: string, theme: TenantTheme): void {
    themesCache.set(tenantId, theme);
  },

  clearCache(tenantId?: string): void {
    if (tenantId) {
      themesCache.delete(tenantId);
    } else {
      themesCache.clear();
    }
  },

  async updateTheme(context: SecurityContext, tenantId: string, theme: Partial<TenantTheme>): Promise<TenantTheme> {
    const current = themesCache.get(tenantId);
    const updated: TenantTheme = current
      ? { ...current, ...theme }
      : (theme as TenantTheme);

    themesCache.set(tenantId, updated);

    // Persiste no Supabase através do tenantRepository
    await tenantRepository.updateTheme(context, tenantId, theme);
    return updated;
  },

  async resetToDeliveryChannelDefault(
    context: SecurityContext,
    tenantId: string,
    identity: { storeName: string; tagline?: string; logoUrl?: string; bannerUrl?: string }
  ): Promise<TenantTheme> {
    const defaultTokens = createDefaultThemeTokens(DEFAULT_DELIVERY_CHANNEL_THEME);
    const restoredTheme: TenantTheme = {
      ...DEFAULT_DELIVERY_CHANNEL_THEME,
      storeName: identity.storeName,
      tagline: identity.tagline || DEFAULT_DELIVERY_CHANNEL_THEME.tagline,
      logoUrl: identity.logoUrl || '',
      bannerUrl: identity.bannerUrl || '',
      tokens: defaultTokens,
    };

    themesCache.set(tenantId, restoredTheme);
    await tenantRepository.updateTheme(context, tenantId, restoredTheme);
    return restoredTheme;
  },
};
