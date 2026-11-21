/**
 * Tela inicial personalizada (painel, OWNER/MANAGER). A mídia passa pelo fluxo governado N3
 * (mediaRepository.uploadAndPublishCreative) e a escolha é gravada só via RPC SECURITY DEFINER,
 * que confere papel, tenant, publicação, tamanho e duração no servidor.
 */
import { supabase } from '../lib/supabase';
import { BackendError, requireBackend, toBackendError } from '../lib/backend';
import { isN1N6Backend, N1N6_ONLY_MESSAGE } from '../lib/backendSchema';
import { tenantModuleRepository } from './tenantModuleRepository';
import { classifyMediaFile, mediaRepository, readMediaDimensions } from './mediaRepository';
import {
  clampImageSeconds, presentationFileError, PRESENTATION_DEFAULT_IMAGE_SECONDS, PresentationMediaType,
} from '../lib/pwa/presentation';

export interface PresentationSettings {
  assetId: string;
  mediaType: PresentationMediaType;
  imageSeconds: number;
  oncePerDay: boolean;
  enabled: boolean;
  /** URL pública (marketing-public) para a prévia; ausente se a mídia foi despublicada. */
  url?: string;
}

function requireReady(): void {
  requireBackend('tela inicial personalizada');
  if (!isN1N6Backend()) throw new BackendError('N1N6_REQUIRED', `Tela inicial personalizada: ${N1N6_ONLY_MESSAGE}`);
}

/** Validação completa no navegador (formato, tamanho e, para vídeo, duração lida do arquivo). */
export async function validatePresentationFile(file: File): Promise<string | null> {
  let mediaType: PresentationMediaType;
  try { mediaType = classifyMediaFile(file).mediaType; } catch { return presentationFileError(file); }
  const quick = presentationFileError(file, mediaType === 'VIDEO' ? 1 : undefined);
  if (quick) return quick;
  if (mediaType === 'IMAGE') return null;
  const dims = await readMediaDimensions(file, 'VIDEO');
  return presentationFileError(file, dims.duration);
}

export const presentationRepository = {
  async requireModule(tenantId: string): Promise<void> {
    const snapshot = await tenantModuleRepository.getForTenant(tenantId);
    if (!snapshot.modules.some(m => m.key === 'store_presentation' && m.enabled)) throw new BackendError('MODULE_DISABLED', 'Habilite a ferramenta Abertura da loja antes de configurar.');
  },

  async get(tenantId: string): Promise<PresentationSettings | null> {
    requireReady();
    await this.requireModule(tenantId);
    const { data, error } = await supabase
      .from('tenant_presentation_screens')
      .select('asset_id, media_type, image_seconds, once_per_day, enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw toBackendError(error, 'Falha ao ler a tela inicial.');
    if (!data) return null;
    const url = await mediaRepository.getPublishedUrl(tenantId, data.asset_id);
    return {
      assetId: data.asset_id,
      mediaType: data.media_type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
      imageSeconds: clampImageSeconds(data.image_seconds),
      oncePerDay: Boolean(data.once_per_day),
      enabled: Boolean(data.enabled),
      url,
    };
  },

  /** Envia a mídia (validada aqui e no servidor), publica e define como tela inicial. */
  async upload(tenantId: string, file: File, opts: { imageSeconds?: number; oncePerDay?: boolean } = {}): Promise<PresentationSettings> {
    requireReady();
    await this.requireModule(tenantId);
    const invalid = await validatePresentationFile(file);
    if (invalid) throw new BackendError('PRESENTATION_FILE_INVALID', invalid);
    const media = await mediaRepository.uploadAndPublishCreative(tenantId, file);
    return this.save(tenantId, media.assetId, opts, media.publicUrl);
  },

  /** Grava a escolha (também usado para mudar o tempo da imagem ou o "1× por dia"). */
  async save(tenantId: string, assetId: string, opts: { imageSeconds?: number; oncePerDay?: boolean }, url?: string): Promise<PresentationSettings> {
    requireReady();
    await this.requireModule(tenantId);
    const imageSeconds = clampImageSeconds(opts.imageSeconds ?? PRESENTATION_DEFAULT_IMAGE_SECONDS);
    const { data, error } = await supabase.rpc('set_presentation_screen', {
      p_tenant_id: tenantId,
      p_asset_id: assetId,
      p_image_seconds: imageSeconds,
      p_once_per_day: Boolean(opts.oncePerDay),
    });
    if (error) throw toBackendError(error, 'O servidor recusou a tela inicial.');
    return {
      assetId,
      mediaType: data?.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
      imageSeconds: clampImageSeconds(data?.imageSeconds ?? imageSeconds),
      oncePerDay: Boolean(data?.oncePerDay ?? opts.oncePerDay),
      enabled: true,
      url,
    };
  },

  /** Remove a tela da loja: o app volta ao padrão do tema. A mídia continua na biblioteca. */
  async clear(tenantId: string): Promise<void> {
    requireReady();
    await this.requireModule(tenantId);
    const { error } = await supabase.rpc('clear_presentation_screen', { p_tenant_id: tenantId });
    if (error) throw toBackendError(error, 'Falha ao remover a tela inicial.');
  },
};
