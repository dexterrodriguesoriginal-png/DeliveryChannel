import { requireBackend, toBackendError } from '../lib/backend';
import { supabase } from '../lib/supabase';

export interface DemoReviewItem {
  id: string;
  kind: 'category' | 'product' | 'offer';
  name: string;
  categoryId?: string | null;
  productId?: string | null;
}

export interface DemoPackReview {
  tenantId: string;
  reviewed: boolean;
  items: DemoReviewItem[];
}

export interface DemoRemovalResult {
  success: boolean;
  deletedOffers?: number;
  deletedProducts?: number;
  deletedCategories?: number;
  skippedOffers?: number;
  skippedProducts?: number;
  skippedCategories?: number;
}

/** O servidor resolve o estabelecimento pela membership do dono autenticado. */
export const demoPackService = {
  async seedDemoPack(segment: string): Promise<void> {
    requireBackend('catálogo de demonstração');
    const { error } = await supabase.rpc('seed_demo_pack', { p_segment: segment });
    if (error) throw toBackendError(error, 'Não foi possível preparar o catálogo de demonstração.');
  },

  async getReview(): Promise<DemoPackReview> {
    requireBackend('catálogo de demonstração');
    const { data, error } = await supabase.rpc('get_demo_pack_review');
    if (error) throw toBackendError(error, 'Não foi possível carregar os itens de demonstração.');
    if (!data || typeof data.tenantId !== 'string' || typeof data.reviewed !== 'boolean' || !Array.isArray(data.items)
      || data.items.some((item: DemoReviewItem) => !item || typeof item.id !== 'string' || typeof item.name !== 'string'
        || !['category', 'product', 'offer'].includes(item.kind))) {
      throw new Error('Não foi possível confirmar os itens de demonstração da sua loja.');
    }
    return data as DemoPackReview;
  },

  async keepDemoItems(): Promise<void> {
    requireBackend('catálogo de demonstração');
    const { error } = await supabase.rpc('keep_demo_items');
    if (error) throw toBackendError(error, 'Não foi possível manter os itens de demonstração.');
  },

  async removeDemoItems(ids: string[] | null = null): Promise<DemoRemovalResult> {
    requireBackend('catálogo de demonstração');
    const { data, error } = await supabase.rpc('remove_demo_items', { p_ids: ids });
    if (error) throw toBackendError(error, 'Não foi possível remover os itens de demonstração.');
    return data as DemoRemovalResult;
  },
};
