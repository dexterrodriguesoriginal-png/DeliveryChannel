import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { requireBackend } from '../lib/backend';
import type { SecurityContext } from '../services/securityEngine';
import { canManageMenuTheme } from './menuThemeRepository';
import { mediaRepository } from './mediaRepository';
import {
  DEFAULT_MENU_HEADER,
  menuCoverFileError,
  normalizeMenuHeader,
  type MenuHeaderSettings,
} from '../lib/menu/menuHeader';

function authorize(context: SecurityContext, tenantId: string): void {
  if (!canManageMenuTheme(context, tenantId)) throw new Error('Apenas o dono ou gerente desta loja pode editar a capa do cardápio.');
  requireBackend('Capa do Cardápio');
}

export const menuHeaderRepository = {
  async load(context: SecurityContext, tenantId: string): Promise<MenuHeaderSettings> {
    authorize(context, tenantId);
    const { data, error } = await supabase.rpc('get_menu_header', { p_tenant: tenantId });
    if (error) throw new Error('Não foi possível carregar a capa do cardápio. Tente novamente.');
    return normalizeMenuHeader(data);
  },

  async save(context: SecurityContext, tenantId: string, settings: MenuHeaderSettings): Promise<MenuHeaderSettings> {
    authorize(context, tenantId);
    const clean = normalizeMenuHeader(settings);
    const { data, error } = await supabase.rpc('set_menu_header', {
      p_tenant: tenantId,
      p_cover_url: clean.coverUrl,
      p_category_mode: clean.categoryMenuMode,
    });
    if (error) throw new Error('Não foi possível salvar a capa do cardápio. Suas alterações continuam aqui.');
    return normalizeMenuHeader(data);
  },

  /** Público: capa e modo do menu da loja ACTIVE. Sem PII. */
  async loadPublic(slug: string): Promise<MenuHeaderSettings> {
    if (!isSupabaseConfigured || !slug) return { ...DEFAULT_MENU_HEADER };
    const { data, error } = await supabase.rpc('get_public_menu_header', { p_slug: slug });
    if (error) throw new Error('Não foi possível carregar a capa do cardápio.');
    return normalizeMenuHeader(data);
  },

  /** Mesmo fluxo governado do outdoor/Tela Inicial: marketing-public do próprio tenant. */
  async uploadCover(context: SecurityContext, tenantId: string, file: File): Promise<string> {
    authorize(context, tenantId);
    const problem = menuCoverFileError(file);
    if (problem) throw new Error(problem);
    const published = await mediaRepository.uploadAndPublishCreative(tenantId, file);
    if (published.mediaType !== 'IMAGE') throw new Error('A capa aceita apenas imagens.');
    return published.publicUrl;
  },
};
