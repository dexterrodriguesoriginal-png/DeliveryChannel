import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { requireBackend } from '../lib/backend';
import type { SecurityContext } from '../services/securityEngine';
import { canManageMenuTheme } from './menuThemeRepository';
import { mediaRepository } from './mediaRepository';
import { classifyMediaFile, mediaSizeError, videoDurationError } from './mediaRepository';
import {
  DEFAULT_TOTEM_WELCOME,
  normalizeTotemWelcome,
  type TotemWelcomeSettings,
} from '../lib/menu/totemWelcome';

function authorize(context: SecurityContext, tenantId: string): void {
  if (!canManageMenuTheme(context, tenantId)) {
    throw new Error('Apenas o dono ou gerente desta loja pode editar a capa do totem.');
  }
  requireBackend('Capa do Totem');
}

export function totemMediaFileError(file: File): string | null {
  try {
    const { mediaType } = classifyMediaFile(file);
    return mediaSizeError(mediaType, file.size);
  } catch (reason) {
    return reason instanceof Error ? reason.message : 'Formato não suportado. Use JPG, PNG, WEBP, MP4 ou WEBM.';
  }
}

export const totemWelcomeRepository = {
  async load(context: SecurityContext, tenantId: string): Promise<TotemWelcomeSettings> {
    authorize(context, tenantId);
    const { data, error } = await supabase.rpc('get_totem_welcome', { p_tenant: tenantId });
    if (error) throw new Error('Não foi possível carregar a capa do totem. Tente novamente.');
    return normalizeTotemWelcome(data);
  },

  async save(context: SecurityContext, tenantId: string, settings: TotemWelcomeSettings): Promise<TotemWelcomeSettings> {
    authorize(context, tenantId);
    const clean = normalizeTotemWelcome(settings);
    const { data, error } = await supabase.rpc('set_totem_welcome', { p_tenant: tenantId, p_cfg: clean });
    if (error) throw new Error('Não foi possível salvar a capa do totem. Suas alterações continuam aqui.');
    return normalizeTotemWelcome(data ?? clean);
  },

  /** Público: somente a configuração visual da loja ACTIVE. Sem PII. */
  async loadPublic(slug: string): Promise<TotemWelcomeSettings> {
    if (!isSupabaseConfigured || !slug) return { ...DEFAULT_TOTEM_WELCOME, slides: [] };
    const { data, error } = await supabase.rpc('get_public_totem_welcome', { p_slug: slug });
    if (error) throw new Error('Não foi possível carregar a capa do totem.');
    return normalizeTotemWelcome(data);
  },

  /** Mesmo fluxo governado do outdoor/capa: marketing-public do próprio tenant. */
  async uploadSlide(context: SecurityContext, tenantId: string, file: File): Promise<{ url: string; kind: 'IMAGE' | 'VIDEO' }> {
    authorize(context, tenantId);
    const problem = totemMediaFileError(file);
    if (problem) throw new Error(problem);
    const published = await mediaRepository.uploadAndPublishCreative(tenantId, file);
    if (published.mediaType === 'VIDEO') {
      const durationError = videoDurationError(published.durationSeconds);
      if (durationError) throw new Error(durationError);
    }
    return { url: published.publicUrl, kind: published.mediaType };
  },
};
