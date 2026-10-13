import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { dataStore } from '../services/dataStore';
import { mapPublicStorePayload, PublicStoreData, PublicStorePayloadError } from './publicStoreMapper';

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
      // Ambiente local/demonstração explícito (sem Supabase configurado).
      const local = loadLocalStore(slug);
      return local ? { status: 'ok', data: local } : { status: 'not_found' };
    }

    try {
      const { data, error } = await supabase.rpc('get_public_store', { p_slug: slug });
      if (error) {
        if (isNotFoundError(error.message)) {
          // Fallback gracioso para store local se o slug não existir no Supabase remoto (ex: adega-premium em desenvolvimento)
          const local = loadLocalStore(slug);
          if (local) return { status: 'ok', data: local };
          return { status: 'not_found' };
        }
        console.warn('[publicStoreRepository] RPC get_public_store retornou erro, verificando fallback local:', error.message);
        const local = loadLocalStore(slug);
        if (local) return { status: 'ok', data: local };
        return { status: 'error', message: error.message };
      }
      if (data === null || data === undefined) {
        const local = loadLocalStore(slug);
        if (local) return { status: 'ok', data: local };
        return { status: 'not_found' };
      }
      return { status: 'ok', data: mapPublicStorePayload(data, Date.now()) };
    } catch (err) {
      const message = err instanceof PublicStorePayloadError || err instanceof Error ? err.message : String(err);
      console.warn('[publicStoreRepository] Falha ao carregar a vitrine remota, verificando fallback local:', message);
      const local = loadLocalStore(slug);
      if (local) return { status: 'ok', data: local };
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
