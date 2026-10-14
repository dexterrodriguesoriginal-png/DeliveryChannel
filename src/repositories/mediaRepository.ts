/**
 * Mídia de marketing governada (N3). Fluxo obrigatório, todo auditado no servidor:
 *   register_marketing_asset -> upload no bucket PRIVADO "marketing" (path definido pelo servidor)
 *   -> confirm_marketing_upload (servidor confere tamanho/mime em storage.objects)
 *   -> request_publish_marketing_asset -> cópia para "marketing-public" (path definido pelo servidor)
 *   -> confirm_publish_marketing_asset (PUBLISHED)
 *   Despublicar: unpublish_marketing_asset (motivo obrigatório) -> remoção do objeto público.
 * Somente OWNER/MANAGER (F2: CEO/SUPER_ADMIN sem acesso). Sem base64/localStorage como fallback.
 */
import { supabase } from '../lib/supabase';
import { BackendError, requireBackend, toBackendError } from '../lib/backend';

import { isN1N6Backend, N1N6_ONLY_MESSAGE } from '../lib/backendSchema';

/** N3/N5 só existem com VITE_BACKEND_SCHEMA=n1n6; em legacy-020 falha explicitamente (sem mock). */
function requireN1N6(feature: string): void {
  if (!isN1N6Backend()) throw new BackendError('N1N6_REQUIRED', `${feature}: ${N1N6_ONLY_MESSAGE}`);
}


export type MarketingMediaKind = 'CREATIVE' | 'SOURCE';

export interface PublishedMedia {
  assetId: string;
  publicPath: string;
  publicUrl: string;
  mediaType: 'IMAGE' | 'VIDEO';
  width?: number;
  height?: number;
  durationSeconds?: number;
}

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const VIDEO_EXT = ['mp4', 'webm'];

export function classifyMediaFile(file: { name: string; type: string }): { mediaType: 'IMAGE' | 'VIDEO'; extension: string } {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (IMAGE_EXT.includes(ext) && file.type.startsWith('image/')) return { mediaType: 'IMAGE', extension: ext };
  if (VIDEO_EXT.includes(ext) && file.type.startsWith('video/')) return { mediaType: 'VIDEO', extension: ext };
  throw new BackendError('MEDIA_TYPE_INVALID', 'Formato não suportado. Use JPG, PNG, WEBP, MP4 ou WEBM.');
}

function readDimensions(file: File, mediaType: 'IMAGE' | 'VIDEO'): Promise<{ width?: number; height?: number; duration?: number }> {
  return new Promise(resolve => {
    try {
      const url = URL.createObjectURL(file);
      if (mediaType === 'IMAGE') {
        const img = new Image();
        img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
        img.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
        img.src = url;
      } else {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => {
          resolve({ width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? Number(v.duration.toFixed(2)) : undefined });
          URL.revokeObjectURL(url);
        };
        v.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
        v.src = url;
      }
    } catch {
      resolve({});
    }
  });
}

export const mediaRepository = {
  /** Envia e publica um criativo; devolve o asset publicado (bucket marketing-public). */
  async uploadAndPublishCreative(tenantId: string, file: File): Promise<PublishedMedia> {
    requireBackend('mídia de marketing');
    requireN1N6('mídia de marketing');
    const { mediaType, extension } = classifyMediaFile(file);

    const { data: reg, error: regErr } = await supabase.rpc('register_marketing_asset', {
      p_tenant_id: tenantId,
      p_kind: 'CREATIVE',
      p_media_type: mediaType,
      p_extension: extension,
      p_declared_size: file.size,
    });
    if (regErr) throw toBackendError(regErr, 'Falha ao registrar a mídia.');
    if (file.size > Number(reg.max_bytes)) {
      throw new BackendError('MEDIA_TOO_LARGE', 'Arquivo acima do limite permitido.');
    }

    const { error: upErr } = await supabase.storage
      .from(reg.bucket)
      .upload(reg.path, file, { contentType: file.type, upsert: false, cacheControl: '3600' });
    if (upErr) throw toBackendError(upErr, 'Falha no envio do arquivo.');

    const dims = await readDimensions(file, mediaType);
    const { error: confErr } = await supabase.rpc('confirm_marketing_upload', {
      p_asset_id: reg.asset_id,
      p_width: dims.width ?? null,
      p_height: dims.height ?? null,
      p_duration: dims.duration ?? null,
    });
    if (confErr) throw toBackendError(confErr, 'O servidor recusou o arquivo enviado.');

    const { data: pub, error: pubErr } = await supabase.rpc('request_publish_marketing_asset', { p_asset_id: reg.asset_id });
    if (pubErr) throw toBackendError(pubErr, 'Falha ao solicitar a publicação.');

    const { error: cpErr } = await supabase.storage
      .from(pub.source_bucket)
      .copy(pub.source_path, pub.target_path, { destinationBucket: pub.target_bucket });
    if (cpErr) throw toBackendError(cpErr, 'Falha ao copiar a mídia para publicação.');

    const { data: done, error: doneErr } = await supabase.rpc('confirm_publish_marketing_asset', { p_asset_id: reg.asset_id });
    if (doneErr) throw toBackendError(doneErr, 'Falha ao confirmar a publicação.');
    if (done?.status !== 'PUBLISHED') {
      throw new BackendError('PUBLISH_FAILED', 'A publicação não foi confirmada pelo servidor.');
    }

    return {
      assetId: reg.asset_id,
      publicPath: done.public_path,
      publicUrl: supabase.storage.from('marketing-public').getPublicUrl(done.public_path).data.publicUrl,
      mediaType,
      width: dims.width,
      height: dims.height,
      durationSeconds: dims.duration,
    };
  },

  /** Despublica (motivo obrigatório, auditado) e remove o objeto público. */
  async unpublish(assetId: string, reason: string): Promise<void> {
    requireBackend('mídia de marketing');
    requireN1N6('mídia de marketing');
    if (!reason || !reason.trim()) throw new BackendError('REASON_REQUIRED', 'Informe o motivo da despublicação.');
    const { data, error } = await supabase.rpc('unpublish_marketing_asset', { p_asset_id: assetId, p_reason: reason.trim() });
    if (error) throw toBackendError(error, 'Falha ao despublicar.');
    if (data?.remove_path) {
      const { error: rmErr } = await supabase.storage.from(data.remove_bucket).remove([data.remove_path]);
      if (rmErr) throw toBackendError(rmErr, 'Despublicado, mas a remoção do arquivo público falhou.');
    }
  },

  async archive(assetId: string, reason: string): Promise<void> {
    requireBackend('mídia de marketing');
    requireN1N6('mídia de marketing');
    const { error } = await supabase.rpc('archive_marketing_asset', { p_asset_id: assetId, p_reason: reason?.trim() || null });
    if (error) throw toBackendError(error, 'Falha ao arquivar.');
  },

  /** URL pública de um asset publicado (para pré-visualização no painel). */
  async getPublishedUrl(tenantId: string, assetId: string): Promise<string | undefined> {
    requireBackend('mídia de marketing');
    requireN1N6('mídia de marketing');
    const { data, error } = await supabase
      .from('marketing_media_assets')
      .select('public_path, status')
      .eq('tenant_id', tenantId)
      .eq('id', assetId)
      .maybeSingle();
    if (error) throw toBackendError(error, 'Falha ao consultar a mídia.');
    if (!data || data.status !== 'PUBLISHED' || !data.public_path) return undefined;
    return supabase.storage.from('marketing-public').getPublicUrl(data.public_path).data.publicUrl;
  },
};
