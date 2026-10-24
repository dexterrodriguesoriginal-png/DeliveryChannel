import { analyticsAllowed } from '../lib/legal/cookies';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

/**
 * Com Supabase configurado (produção), a vitrine NUNCA cai em dados locais/demonstrativos: uma loja inexistente,
 * pendente ou inativa aparece como "não encontrada" e uma falha técnica aparece como erro.
 * Os dados locais (dataStore) só existem sem Supabase em desenvolvimento (isLocalDemoAllowed).
 *
 * Formato do get_public_store por esquema (src/lib/backendSchema.ts):
 *  - legacy-020: mapPublicStorePayload (formato 001–020);
 *  - n1n6:       mapN6PublicStore (N6: mídia publicada, carrosséis com preço do servidor, campanhas N5).
 */
import { dataStore } from '../services/dataStore';
import { mapPublicStorePayload, PublicStoreData, PublicStorePayloadError } from './publicStoreMapper';
import { mapN6PublicStore } from './publicStoreN6';
import { isN1N6Backend } from '../lib/backendSchema';
import { isLocalDemoAllowed } from '../lib/backend';

const resolvePublicMedia = (bucket: 'marketing-public', path: string): string =>
  supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;

export type { PublicStoreData, PublicStoreTenant } from './publicStoreMapper';

/** Resultado explícito do carregamento da vitrine: loja inexistente ≠ falha técnica. */
export type PublicStoreLoadResult =
  | { status: 'ok'; data: PublicStoreData }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

/** A RPC levanta 'Estabelecimento com slug "x" não encontrado ou inativo' para slug inexistente/inativo. */
function isNotFoundError(message: string | undefined): boolean {
  return Boolean(message && /não encontrado|nao encontrado|not found/i.test(message));
}

function loadLocalStore(slug: string): PublicStoreData | null {
  let localTenant = dataStore.getTenantBySlug(slug);

  // Se ainda não encontrou, tenta buscar os dados do estabelecimento ativo gravados no storage
  if (!localTenant && typeof window !== 'undefined') {
    try {
      const activeStr = localStorage.getItem('adegafood_active_tenant');
      if (activeStr) {
        const parsed = JSON.parse(activeStr);
        if (parsed && (parsed.slug === slug || !slug)) {
          localTenant = parsed;
        }
      }
    } catch {}
  }

  // Fallback seguro para o estabelecimento modelo (adega-premium)
  // Garante que o preview do catálogo NUNCA falhe ou exiba tela 404 em testes ou antes de publicação
  if (!localTenant) {
    localTenant = dataStore.getTenantBySlug('adega-premium') || dataStore.getTenantBySlug('burger-craft');
  }

  if (!localTenant) return null;
  const targetSlug = localTenant.slug;

  const categories = dataStore.getPublicCategories(targetSlug).length > 0
    ? dataStore.getPublicCategories(targetSlug)
    : dataStore.getPublicCategories('adega-premium');

  const products = dataStore.getPublicProducts(targetSlug).length > 0
    ? dataStore.getPublicProducts(targetSlug)
    : dataStore.getPublicProducts('adega-premium');

  const offers = dataStore.getPublicOffers(targetSlug).length > 0
    ? dataStore.getPublicOffers(targetSlug)
    : dataStore.getPublicOffers('adega-premium');

  const promotionCarousels = dataStore.getPublicPromotionCarousels(targetSlug).length > 0
    ? dataStore.getPublicPromotionCarousels(targetSlug)
    : dataStore.getPublicPromotionCarousels('adega-premium');

  return {
    tenant: {
      id: localTenant.id,
      slug: slug || localTenant.slug,
      name: localTenant.name,
      phone: localTenant.phone,
      email: localTenant.email,
      category: localTenant.category,
      status: localTenant.status || 'ACTIVE',
    },
    theme: localTenant.theme,
    settings: localTenant.settings,
    categories,
    products,
    offers,
    promotionCarousels,
    campaigns: [],
    serverTimeOffsetMs: 0,
  };
}

export const publicStoreRepository = {
  /**
   * Carrega a vitrine pública pela RPC SECURITY DEFINER `get_public_store(p_slug)`
   * e mapeia ESTRITAMENTE o formato real retornado (ver publicStoreMapper).
   * Diferencia "loja não encontrada" de erro técnico (ex.: RPC quebrada por migration),
   * para que uma falha de banco não seja apresentada ao cliente como "loja inexistente".
   */
  async loadPublicStore(slug: string): Promise<PublicStoreLoadResult> {
    if (!isSupabaseConfigured) {
      // Ambiente local/demonstração explícito (sem Supabase configurado, só em DEV).
      if (!isLocalDemoAllowed) return { status: 'error', message: 'Servidor não configurado.' };
      const local = loadLocalStore(slug);
      return local ? { status: 'ok', data: local } : { status: 'not_found' };
    }

    try {
      const { data, error } = await supabase.rpc('get_public_store', { p_slug: slug });
      if (error) {
        if (isNotFoundError(error.message)) return { status: 'not_found' };
        console.warn('[publicStoreRepository] RPC get_public_store retornou erro:', error.message);
        return { status: 'error', message: error.message };
      }
      if (data === null || data === undefined) return { status: 'not_found' };
      const mapped = isN1N6Backend()
        ? mapN6PublicStore(data, resolvePublicMedia, Date.now())
        : mapPublicStorePayload(data, Date.now());
      return { status: 'ok', data: mapped };
    } catch (err) {
      const message = err instanceof PublicStorePayloadError || err instanceof Error ? err.message : String(err);
      console.warn('[publicStoreRepository] Falha ao carregar a vitrine remota:', message);
      return { status: 'error', message };
    }
  },

  /**
   * Compatibilidade com chamadores existentes (categorias/produtos/tenant públicos):
   * retorna os dados ou null (não encontrado OU erro — o erro é registrado no console).
   */
  async getPublicStore(slug: string): Promise<PublicStoreData | null> {
    const result = await this.loadPublicStore(slug);
    return result.status === 'ok' ? result.data : null;
  },

  /**
   * Rastreia eventos públicos através da RPC `track_public_event`
   */
  async trackPublicEvent(slug: string, eventName: string, metadata: Record<string, any> = {}): Promise<void> {
    if (!analyticsAllowed()) return;
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
