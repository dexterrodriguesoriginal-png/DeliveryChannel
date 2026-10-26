import type { TenantTheme } from '../../types';

/**
 * Ponte da prévia do Design do App: o editor embute o app REAL do cliente (/app/<slug>?preview=1)
 * num iframe e envia o tema em rascunho por postMessage. Nada é gravado no banco.
 * Segurança: só aceita mensagens da MESMA origem e vindas da janela pai.
 */
export const PREVIEW_THEME_MSG = 'dc-theme-preview';
export const PREVIEW_READY_MSG = 'dc-theme-preview-ready';

type Win = Pick<Window, 'location' | 'parent'>;

export function isEmbeddedPreview(w: Win): boolean {
  try {
    return new URLSearchParams(w.location.search).get('preview') === '1' && w.parent !== (w as unknown);
  } catch {
    return false;
  }
}

export function previewUrl(slug: string): string {
  return `/app/${encodeURIComponent(slug)}?preview=1`;
}

export function parsePreviewThemeMessage(
  ev: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  w: Win,
): Partial<TenantTheme> | null {
  if (ev.origin !== w.location.origin || ev.source !== (w.parent as unknown)) return null;
  const d = ev.data as { type?: unknown; theme?: unknown } | null;
  if (!d || d.type !== PREVIEW_THEME_MSG || !d.theme || typeof d.theme !== 'object' || Array.isArray(d.theme)) return null;
  return d.theme as Partial<TenantTheme>;
}

/** Lado do editor: só aceita o "pronto" do próprio iframe, mesma origem. */
export function isPreviewReadyMessage(ev: Pick<MessageEvent, 'origin' | 'source' | 'data'>, frame: Window | null, origin: string): boolean {
  return !!frame && ev.source === frame && ev.origin === origin && (ev.data as { type?: unknown })?.type === PREVIEW_READY_MSG;
}

export function sendPreviewTheme(frame: Window | null, theme: Partial<TenantTheme>, origin: string) {
  if (!frame) return;
  // Clone estruturado simples: só dados (sem funções), mesma origem.
  frame.postMessage({ type: PREVIEW_THEME_MSG, theme: JSON.parse(JSON.stringify(theme)) }, origin);
}
