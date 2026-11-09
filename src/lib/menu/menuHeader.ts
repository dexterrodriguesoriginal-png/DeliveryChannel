/**
 * Capa do cardápio (estilo Facebook/YouTube) e modo do menu lateral de categorias.
 * Somente dados visuais públicos; nenhuma cor aqui — as cores vêm do tema da loja.
 */
import { safeMenuImageUrl } from './premiumTotem.model';

export type CategoryMenuMode = 'ICON' | 'IMAGE';

export interface MenuHeaderSettings {
  /** URL pública HTTPS da capa; null = cabeçalho padrão. */
  coverUrl: string | null;
  /** ICON = ícone padrão por categoria; IMAGE = imagem própria cadastrada na categoria. */
  categoryMenuMode: CategoryMenuMode;
}

export const MENU_COVER_WIDTH = 1600;
export const MENU_COVER_HEIGHT = 500;
export const MENU_COVER_MAX_BYTES = 2 * 1024 * 1024;
export const MENU_COVER_SIZE_TEXT = '1600 x 500 px (proporção 16:5), JPG ou PNG, até 2 MB';

export const DEFAULT_MENU_HEADER: Readonly<MenuHeaderSettings> = Object.freeze({
  coverUrl: null,
  categoryMenuMode: 'ICON',
});

const isObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

/** Projeção explícita: descarta chaves desconhecidas e URLs não HTTPS. */
export function normalizeMenuHeader(raw: unknown): MenuHeaderSettings {
  const source = isObject(raw) ? raw : {};
  const cover = safeMenuImageUrl(source.coverUrl);
  return {
    coverUrl: cover || null,
    categoryMenuMode: source.categoryMenuMode === 'IMAGE' ? 'IMAGE' : 'ICON',
  };
}

/** Validação do arquivo antes do envio. Retorna a mensagem de erro ou null. */
export function menuCoverFileError(file: { type: string; size: number }): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Use uma imagem JPG ou PNG.';
  if (file.size === 0) return 'A imagem está vazia.';
  if (file.size > MENU_COVER_MAX_BYTES) return 'A capa passa de 2 MB. Envie uma versão mais leve.';
  return null;
}
