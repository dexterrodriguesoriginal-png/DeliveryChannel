import type { StoreIdentityInput, StoreManifest } from './storeManifest';
import { buildStoreManifest, storeDisplayName } from './storeManifest';

export const TOTEM_MANIFEST_DISPLAY = 'fullscreen' as const;

export function isTotemRoute(path: string): boolean {
  return /^\/totem\/[^/]+/.test(path);
}

export function totemSlugFromPath(path: string): string | null {
  const match = /^\/totem\/([^/]+)(?:\/.*)?$/.exec(path);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

export function totemScope(slug: string): string {
  return `/totem/${encodeURIComponent(slug)}/`;
}

export function totemStartUrl(slug: string): string {
  return `${totemScope(slug)}?source=pwa`;
}

export function totemManifestPath(slug: string): string {
  return `/totem/${encodeURIComponent(slug)}/manifest.webmanifest`;
}

export type TotemStoreManifest = Omit<StoreManifest, 'display'> & { display: 'fullscreen' };

/** Manifesto do totem: display fullscreen (ou o dispositivo cai para standalone). */
export function buildTotemManifest(store: StoreIdentityInput, origin: string): TotemStoreManifest {
  const base = buildStoreManifest(store, origin);
  const o = origin.replace(/\/$/, '');
  const name = `${storeDisplayName(store)} — Totem`;
  return {
    ...base,
    name,
    short_name: 'Totem',
    description: `Totem do salão de ${storeDisplayName(store)}`.slice(0, 300),
    start_url: `${o}${totemStartUrl(store.slug)}`,
    scope: `${o}${totemScope(store.slug)}`,
    display: TOTEM_MANIFEST_DISPLAY,
    orientation: 'portrait',
    related_applications: [{ platform: 'webapp', url: `${o}${totemManifestPath(store.slug)}` }],
  };
}

export function injectTotemHead(html: string, slug: string, title = 'Totem do salão'): string {
  const enc = encodeURIComponent(slug);
  const safeTitle = title.replace(/[<>&]/g, '');
  return html
    .replace(/<link\b[^>]*rel=["']manifest["'][^>]*>\s*/gi, '')
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`)
    .replace(
      /<\/head>/i,
      `<link rel="manifest" href="/totem/${enc}/manifest.webmanifest" data-totem="1" />`
      + `<meta name="application-name" content="${safeTitle}" />`
      + `<meta name="mobile-web-app-capable" content="yes" />`
      + `<meta name="apple-mobile-web-app-capable" content="yes" /></head>`,
    );
}
