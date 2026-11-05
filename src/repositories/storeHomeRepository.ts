import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { requireBackend } from '../lib/backend';
import type { SecurityContext } from '../services/securityEngine';
import { mediaRepository, MAX_IMAGE_BYTES } from './mediaRepository';
import {
  DEFAULT_HOME_DESIGN,
  normalizeHomeDesign,
  type StoreHomeDesign,
} from '../lib/storeHome/storeHome.model';

export interface PrivateHomeDesign {
  draft: StoreHomeDesign;
  published: StoreHomeDesign | null;
  revision: number;
}

export function canManageStoreHome(context: SecurityContext, tenantId: string): boolean {
  return Boolean(context.userId)
    && context.tenantId === tenantId
    && ['OWNER', 'MANAGER'].includes(context.userRole);
}

function authorize(context: SecurityContext, tenantId: string): void {
  if (!canManageStoreHome(context, tenantId)) {
    throw new Error('Apenas o dono ou gerente desta loja pode editar a tela inicial.');
  }
  requireBackend('Tela Inicial');
}

function requireConfigured(): void {
  if (!isSupabaseConfigured) {
    throw new Error(
      'A Tela Inicial precisa de um Supabase configurado para salvar ou publicar. A prévia continua disponível.',
    );
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

export const storeHomeRepository = {
  async loadPrivate(context: SecurityContext, tenantId: string): Promise<PrivateHomeDesign> {
    authorize(context, tenantId);
    requireConfigured();
    const { data, error } = await supabase.rpc('store_home_get_private', { p_tenant: tenantId });
    if (error) throw new Error(error.message || 'Não foi possível carregar o design da tela inicial.');
    const result = (data ?? {}) as { draft?: unknown; published?: unknown; revision?: number };
    const draftRaw = result.draft && typeof result.draft === 'object' && Object.keys(result.draft as object).length > 0
      ? result.draft
      : DEFAULT_HOME_DESIGN;
    return {
      draft: normalizeHomeDesign(draftRaw),
      published: result.published ? normalizeHomeDesign(result.published) : null,
      revision: Number(result.revision ?? 0),
    };
  },

  async saveDraft(
    context: SecurityContext,
    tenantId: string,
    design: StoreHomeDesign,
    revision: number,
  ): Promise<number> {
    authorize(context, tenantId);
    requireConfigured();
    const { data, error } = await supabase.rpc('store_home_save_draft', {
      p_tenant: tenantId,
      p_design: normalizeHomeDesign(design),
      p_expected_revision: revision,
    });
    if (error) throw new Error(error.message || 'Não foi possível salvar o rascunho.');
    return Number(data);
  },

  async publish(context: SecurityContext, tenantId: string, revision: number): Promise<StoreHomeDesign> {
    authorize(context, tenantId);
    requireConfigured();
    const { data, error } = await supabase.rpc('store_home_publish', {
      p_tenant: tenantId,
      p_expected_revision: revision,
    });
    if (error) throw new Error(error.message || 'Não foi possível publicar a tela inicial.');
    return normalizeHomeDesign(data);
  },

  async loadPublic(slug: string): Promise<StoreHomeDesign | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase.rpc('store_home_get_published', { p_slug: slug });
    if (error) throw new Error(error.message || 'Não foi possível carregar a tela inicial.');
    return data ? normalizeHomeDesign(data) : null;
  },

  /**
   * Upload via fluxo governado de marketing (mesmo do outdoor):
   * register → upload privado → confirm → publish → URL pública.
   * Somente imagens (JPG/PNG/WEBP) até 5 MB.
   */
  async uploadImage(context: SecurityContext, tenantId: string, file: File): Promise<string> {
    authorize(context, tenantId);
    requireConfigured();
    if (!file.type.startsWith('image/')) {
      throw new Error('Use uma imagem JPG, PNG ou WebP.');
    }
    if (file.size === 0) throw new Error('A imagem está vazia.');
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error('A imagem passa de 5 MB. Envie uma versão mais leve.');
    }
    try {
      const published = await mediaRepository.uploadAndPublishCreative(tenantId, file);
      if (published.mediaType !== 'IMAGE') {
        throw new Error('A tela inicial aceita apenas imagens.');
      }
      return published.publicUrl;
    } catch (error) {
      throw new Error(messageFrom(error));
    }
  },
};
