/**
 * Reescreve o <head> do index.html no servidor para rotas de loja (/app/<slug>...):
 * o Chrome lê o <link rel="manifest"> presente no carregamento; trocar por JS depois é tarde demais
 * (era a causa do "Instalar ADEGAFOOD Delivery & Pedidos"). Em /app/* nunca sai o manifesto global.
 */
import { FALLBACK_THEME_COLOR, safeColor, storeDisplayName, StoreIdentityInput } from '../../src/lib/pwa/storeManifest';
import { iconVersion } from './routes';

export const GLOBAL_MANIFEST_RE = /<link\b[^>]*rel=["']manifest["'][^>]*>\s*/gi;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** Extrai o slug de /app/<slug> ou /app/<slug>/...; null fora de rotas de loja. */
export function storeSlugFromPath(p: string): string | null {
  const m = /^\/app\/([^/]+)(?:\/.*)?$/.exec(p);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

function stripTag(html: string, re: RegExp) { return html.replace(re, ''); }

export function injectStoreHead(html: string, slug: string, store: StoreIdentityInput | null): string {
  const enc = encodeURIComponent(slug);
  let out = stripTag(html, GLOBAL_MANIFEST_RE);
  const tags: string[] = [`<link rel="manifest" href="/app/${enc}/manifest.webmanifest" data-server-injected="1" data-store-slug="${escapeHtml(slug)}" />`];
  if (store) {
    const name = escapeHtml(storeDisplayName(store));
    const color = escapeHtml(safeColor(store.theme?.primaryColor, FALLBACK_THEME_COLOR));
    const icon = `/app/${enc}/icons/icon-192.png?v=${iconVersion(store)}`;
    out = stripTag(out, /<meta\b[^>]*name=["'](theme-color|apple-mobile-web-app-title|application-name)["'][^>]*>\s*/gi);
    out = stripTag(out, /<link\b[^>]*rel=["']apple-touch-icon["'][^>]*>\s*/gi);
    out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${name}</title>`);
    tags.push(
      `<meta name="theme-color" content="${color}" />`,
      `<meta name="apple-mobile-web-app-title" content="${name}" />`,
      `<meta name="application-name" content="${name}" />`,
      `<link rel="apple-touch-icon" href="${icon}" />`,
    );
  }
  return out.replace(/<\/head>/i, `    ${tags.join('\n    ')}\n  </head>`);
}

export function withTimeout<T>(p: Promise<T>, ms: number, fb: T): Promise<T> {
  return Promise.race([p.catch(() => fb), new Promise<T>((r) => setTimeout(() => r(fb), ms))]);
}
