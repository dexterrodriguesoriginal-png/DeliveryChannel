/**
 * Validação e Configuração de Upload de Imagens no Design do App (DeliveryChannel)
 * Regras estritas de tipo, tamanho, dimensões recomendadas e geração de caminhos no Supabase Storage.
 */

import { safeImageUrl } from './themeEngine';

export type ThemeImageType = 'logo' | 'banner' | 'background';

export interface ThemeImageConfig {
  type: ThemeImageType;
  label: string;
  maxSizeBytes: number;
  maxSizeMb: number;
  recommendedDimensions: string;
  recommendedAspect: string;
  allowedMimeTypes: string[];
  allowedExtensions: string[];
}

export const THEME_STORAGE_BUCKET = 'catalog';

export const THEME_IMAGE_CONFIGS: Record<ThemeImageType, ThemeImageConfig> = {
  logo: {
    type: 'logo',
    label: 'Logotipo Oficial',
    maxSizeBytes: 2 * 1024 * 1024, // 2 MB
    maxSizeMb: 2,
    recommendedDimensions: '512 × 512 px',
    recommendedAspect: '1:1 (Quadrado)',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
  },
  banner: {
    type: 'banner',
    label: 'Capa / Banner Superior',
    maxSizeBytes: 5 * 1024 * 1024, // 5 MB
    maxSizeMb: 5,
    recommendedDimensions: '1200 × 400 px',
    recommendedAspect: '3:1 (Panorâmico)',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
  },
  background: {
    type: 'background',
    label: 'Imagem de Fundo',
    maxSizeBytes: 5 * 1024 * 1024, // 5 MB
    maxSizeMb: 5,
    recommendedDimensions: '1080 × 1920 px',
    recommendedAspect: '9:16 (Vertical Mobile)',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
  },
};

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Valida o arquivo de imagem antes de iniciar o upload para o Supabase Storage.
 * Garante tipo MIME e limite máximo de tamanho em bytes conforme a especificação.
 */
export function validateThemeImageFile(
  file: { name: string; type: string; size: number },
  imageType: ThemeImageType
): ValidationResult {
  const config = THEME_IMAGE_CONFIGS[imageType];
  if (!config) {
    return { valid: false, error: 'Tipo de imagem desconhecido.' };
  }

  // 1. Validação de formato / MIME type
  const normalizedMime = (file.type || '').toLowerCase().trim();
  const ext = (file.name.split('.').pop() || '').toLowerCase().trim();

  const isMimeAllowed = config.allowedMimeTypes.includes(normalizedMime);
  const isExtAllowed = config.allowedExtensions.includes(ext);

  if (!isMimeAllowed && !isExtAllowed) {
    return {
      valid: false,
      error: 'Formato não suportado. Utilize apenas arquivos PNG, JPG ou WEBP.',
    };
  }

  // 2. Validação de tamanho
  if (file.size > config.maxSizeBytes) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `Arquivo muito grande (${sizeMb} MB). O limite máximo para ${config.label.toLowerCase()} é de ${config.maxSizeMb} MB.`,
    };
  }

  if (file.size <= 0) {
    return {
      valid: false,
      error: 'O arquivo selecionado está vazio (0 bytes).',
    };
  }

  return { valid: true };
}

/**
 * Gera o caminho estruturado do arquivo no Supabase Storage:
 * <tenantId>/theme/<tipo>-<timestamp>.<ext>
 */
export function buildThemeStoragePath(
  tenantId: string,
  imageType: ThemeImageType,
  filename: string,
  timestamp: number = Date.now()
): string {
  const rawExt = (filename.split('.').pop() || 'webp').toLowerCase().trim();
  const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(rawExt) ? rawExt : 'webp';
  return `${tenantId}/theme/${imageType}-${timestamp}.${safeExt}`;
}

/**
 * Valida e higieniza a URL de imagem antes de salvar no tema.
 * Reutiliza safeImageUrl para mitigar injeção de URL em CSS ou scripts.
 */
export function validateAndSanitizeThemeImageUrl(url?: string | null): string {
  if (!url) return '';
  const sanitized = safeImageUrl(url);
  return sanitized ?? '';
}
