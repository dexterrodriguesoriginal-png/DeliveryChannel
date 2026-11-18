import type { Offer, TenantTheme } from '../../types';
import { clampImageSeconds, isSafePresentationUrl, type StorePresentation } from '../pwa/presentation';

/**
 * Ponte da prévia do Design do App: o editor embute o app REAL do cliente (/app/<slug>?preview=1)
 * num iframe e envia o tema em rascunho por postMessage. Nada é gravado no banco.
 * Segurança: só aceita mensagens da MESMA origem e vindas da janela pai.
 */
export const PREVIEW_THEME_MSG = 'dc-theme-preview';
export const PREVIEW_READY_MSG = 'dc-theme-preview-ready';
export const PREVIEW_CARD_MSG = 'dc-card-preview';
export const PREVIEW_PRESENTATION_MSG = 'dc-presentation-preview';
/** Evento local do painel (card da tela inicial → PhonePreview), sem passar pela rede. */
export const PRESENTATION_PREVIEW_EVENT = 'dc:presentation-preview';

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

/** Card promocional em rascunho (editor de Marketing). `null` = sem rascunho. Só dados, mesma origem. */
export function parsePreviewCardMessage(
  ev: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  w: Win,
): { card: Partial<Offer> | null } | null {
  if (ev.origin !== w.location.origin || ev.source !== (w.parent as unknown)) return null;
  const d = ev.data as { type?: unknown; card?: unknown } | null;
  if (!d || d.type !== PREVIEW_CARD_MSG) return null;
  if (d.card === null) return { card: null };
  if (!d.card || typeof d.card !== 'object' || Array.isArray(d.card)) return null;
  return { card: d.card as Partial<Offer> };
}

export function sendPreviewCard(frame: Window | null, card: Partial<Offer> | null | undefined, origin: string) {
  if (!frame) return;
  frame.postMessage({ type: PREVIEW_CARD_MSG, card: card ? JSON.parse(JSON.stringify(card)) : null }, origin);
}

/** "Ver abertura" no painel: pede ao PhonePreview para tocar a abertura (null = padrão do tema). */
export function requestPresentationPreview(presentation: StorePresentation | null, w: Window | undefined = typeof window !== 'undefined' ? window : undefined) {
  w?.dispatchEvent(new CustomEvent(PRESENTATION_PREVIEW_EVENT, { detail: { presentation } }));
}

export function sendPreviewPresentation(frame: Window | null, presentation: StorePresentation | null, origin: string) {
  if (!frame) return;
  frame.postMessage({ type: PREVIEW_PRESENTATION_MSG, presentation: presentation ? JSON.parse(JSON.stringify(presentation)) : null }, origin);
}

/** Lado da prévia: só da janela pai, mesma origem; mídia com URL segura. */
export function parsePreviewPresentationMessage(
  ev: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  w: Win,
): { presentation: StorePresentation | null } | null {
  if (ev.origin !== w.location.origin || ev.source !== (w.parent as unknown)) return null;
  const d = ev.data as { type?: unknown; presentation?: unknown } | null;
  if (!d || d.type !== PREVIEW_PRESENTATION_MSG) return null;
  if (d.presentation === null) return { presentation: null };
  const p = d.presentation as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object' || !isSafePresentationUrl(p.url)) return null;
  return {
    presentation: {
      url: p.url as string,
      mediaType: p.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
      imageSeconds: clampImageSeconds(p.imageSeconds),
      oncePerDay: p.oncePerDay === true,
    },
  };
}
