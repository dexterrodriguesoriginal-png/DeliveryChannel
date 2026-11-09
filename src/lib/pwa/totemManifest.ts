import type { StoreIdentityInput, StoreManifest } from './storeManifest';
import { buildStoreManifest, storeDisplayName, storeIconVersion } from './storeManifest';

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

/** Identificador estável e distinto do app do cliente, para instalar como um app separado. */
export function totemAppId(tenantId: string): string {
  return `/totem-id/${encodeURIComponent(tenantId)}`;
}

/** Página do totem com o convite de instalação na abertura. */
export function totemInstallPath(slug: string): string {
  return `${totemScope(slug)}?install=1`;
}

export function isTotemInstallQuery(search: string): boolean {
  try {
    return new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get('install') === '1';
  } catch {
    return false;
  }
}

export type TotemStoreManifest = Omit<StoreManifest, 'display' | 'id'> & { display: 'fullscreen'; id: string };

/** Manifesto do totem: display fullscreen, id/escopo próprios (app separado do cardápio do cliente). */
export function buildTotemManifest(store: StoreIdentityInput, origin: string): TotemStoreManifest {
  const base = buildStoreManifest(store, origin);
  const o = origin.replace(/\/?$/, '');
  const name = `${storeDisplayName(store)} — Totem`;
  return {
    ...base,
    id: `${o}${totemAppId(store.id)}`,
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

export function injectTotemHead(
  html: string,
  slug: string,
  title = 'Totem do salão',
  store: StoreIdentityInput | null = null,
): string {
  const enc = encodeURIComponent(slug);
  const safeTitle = title.replace(/[<>&]/g, '');
  const icon = store
    ? `/app/${enc}/icons/icon-192.png?v=${storeIconVersion(store)}`
    : '';
  const iconTags = icon
    ? `<link rel="apple-touch-icon" href="${icon}" />`
      + `<link rel="icon" href="${icon}" />`
    : '';
  return html
    .replace(/<link\b[^>]*rel=["']manifest["'][^>]*>\s*/gi, '')
    .replace(/<link\b[^>]*rel=["'](apple-touch-icon|icon)["'][^>]*>\s*/gi, '')
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`)
    .replace(
      /<\/head>/i,
      `<link rel="manifest" href="/totem/${enc}/manifest.webmanifest" data-totem="1" data-server-injected="1" data-store-slug="${enc}" />`
      + `<meta name="application-name" content="${safeTitle}" />`
      + `<meta name="apple-mobile-web-app-title" content="${safeTitle}" />`
      + `<meta name="mobile-web-app-capable" content="yes" />`
      + `<meta name="apple-mobile-web-app-capable" content="yes" />`
      + iconTags
      + '</head>',
    );
}
