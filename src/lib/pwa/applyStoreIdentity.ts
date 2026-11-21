/**
 * Aplica, no <head>, a identidade instalável da loja ativa:
 * <link rel="manifest"> (preferencialmente /app/<slug>/manifest.webmanifest servido pelo servidor do app
 * via HTTPS, com ícones PNG; data: URL só como fallback quando o servidor não está disponível, ex.: vite puro), theme-color,
 * apple-mobile-web-app-title, apple-touch-icon e <title>.
 * Só é usado em rotas /app/<slug>. As demais rotas mantêm o manifesto global (/manifest.json).
 */
import { resolveSystemBars } from './systemBars';
import { buildStoreManifest, deriveShortName, storeAppId, storeIconVersion, fallbackIconSvg, manifestDataUrl, ManifestIcon, safeColor, FALLBACK_THEME_COLOR, StoreIdentityInput, storeDisplayName, svgDataUrl } from './storeManifest';

import { isOwnManifestHref } from './appIdentity';

const GLOBAL_MANIFEST_HREF = '/manifest.json';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('logo indisponível'));
    img.src = src;
  });
}

/** Rasteriza o logo em PNG quadrado; maskable recebe área de segurança (80%) sobre a cor de fundo. */
function renderPng(img: HTMLImageElement, size: number, maskable: boolean, bg: string): string {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas indisponível');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  const box = maskable ? size * 0.8 : size;
  const scale = Math.max(box / img.naturalWidth, box / img.naturalHeight); // cover
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect((size - box) / 2, (size - box) / 2, box, box);
  ctx.clip();
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  ctx.restore();
  return c.toDataURL('image/png'); // lança SecurityError se o logo não permitir CORS
}

export async function buildLogoIcons(logoUrl: string | undefined, bg: string): Promise<ManifestIcon[] | null> {
  if (!logoUrl || !/^(https?:|data:image\/|\/)/i.test(logoUrl)) return null;
  try {
    const img = await loadImage(logoUrl);
    if (!img.naturalWidth || !img.naturalHeight) return null;
    return [
      { src: renderPng(img, 192, false, bg), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: renderPng(img, 512, false, bg), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: renderPng(img, 512, true, bg), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ];
  } catch {
    return null; // fallback seguro: iniciais + cor da loja
  }
}

/** Versão do ícone (?v=): muda só quando a imagem do ícone muda (logo, ou nome/cor do ícone de iniciais). */
export function identityHash(store: StoreIdentityInput): string {
  return storeIconVersion(store);
}

/** <meta theme-color> + color-scheme: a barra de status/navegação segue a loja sem recarregar. */
export function applySystemBarMeta(statusColor: string, scheme: 'dark' | 'light') {
  meta('theme-color', statusColor);
  meta('color-scheme', scheme);
  document.documentElement.style.colorScheme = scheme;
}

function upsert(selector: string, create: () => HTMLElement): HTMLElement {
  let el = document.head.querySelector(selector) as HTMLElement | null;
  if (!el) { el = create(); document.head.appendChild(el); }
  return el;
}
function meta(name: string, content: string) {
  const el = upsert(`meta[name="${name}"]`, () => { const m = document.createElement('meta'); m.setAttribute('name', name); return m; });
  el.setAttribute('content', content);
}

/** Remove o vínculo com o manifesto global o mais cedo possível em rotas de loja. */
export function detachGlobalManifestForStoreRoute(pathname: string) {
  if (!pathname.startsWith('/app/') && !pathname.startsWith('/totem/')) return;
  document.head.querySelectorAll(`link[rel="manifest"][href="${GLOBAL_MANIFEST_HREF}"]`).forEach(l => l.remove());
}

export interface AppliedIdentity { manifestHref: string; usedFallbackIcon: boolean; served: boolean; }

interface ServedManifest { href: string; shortName: string; touchIcon: string; }

/**
 * Usa o manifesto servido pelo servidor do app quando ele existe E pertence a ESTA loja
 * (id termina em /app-id/<tenantId>); qualquer outra resposta => null (fallback data:).
 */
export async function fetchServedManifest(store: StoreIdentityInput, fetchImpl: typeof fetch = fetch): Promise<ServedManifest | null> {
  const href = `/app/${encodeURIComponent(store.slug)}/manifest.webmanifest`;
  try {
    const res = await fetchImpl(href, { cache: 'no-cache', headers: { Accept: 'application/manifest+json' } });
    if (!res.ok || !/manifest\+json/i.test(res.headers.get('content-type') || '')) return null;
    const m = await res.json();
    if (!m || typeof m.id !== 'string' || !m.id.endsWith(storeAppId(store.id))) return null;
    const icon = Array.isArray(m.icons) ? m.icons.find((i: { src?: string; type?: string }) => i?.type === 'image/png' && typeof i.src === 'string') : null;
    if (!icon) return null;
    return { href, shortName: String(m.short_name || ''), touchIcon: icon.src };
  } catch {
    return null;
  }
}

function urlOnlyIconVersion(store: StoreIdentityInput): string {
  return identityHash({ ...store, iconContentHash: undefined });
}

function iconPathOf(href: string): string {
  try { return new URL(href, 'http://local.invalid').pathname; }
  catch { return href.split('?')[0]; }
}

/** Ícone de atalho: prefere o ?v= verificado do manifesto/HTML do servidor (digest dos bytes). */
async function resolveTouchIcon(store: StoreIdentityInput): Promise<string> {
  const iconPath = `/app/${encodeURIComponent(store.slug)}/icons/icon-192.png`;
  const computed = `${iconPath}?v=${identityHash(store)}`;
  const served = await fetchServedManifest(store);
  if (served?.touchIcon) return served.touchIcon;
  const apple = document.head.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement | null;
  const fav = document.head.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  const el = apple || fav;
  const existing = el?.getAttribute('href') || '';
  const prevIdentity = el?.getAttribute('data-icon-identity') || '';
  const urlOnly = urlOnlyIconVersion(store);
  // Sem digest no runtime, não trocar um ?v= já verificado pelo servidor enquanto a logo/URL não mudar.
  if (existing && iconPathOf(existing) === iconPath && !store.iconContentHash && (!prevIdentity || prevIdentity === urlOnly)) {
    return existing;
  }
  return computed;
}

let applyGeneration = 0;

export async function applyStoreIdentity(store: StoreIdentityInput): Promise<AppliedIdentity> {
  const generation = ++applyGeneration;
  const name = storeDisplayName(store);
  const shortName = deriveShortName(name, store.theme?.shortName);
  const bars = resolveSystemBars({
    statusBarColor: store.theme?.statusBarColor, navBarColor: store.theme?.navBarColor,
    headerColor: store.theme?.headerColor, primaryColor: store.theme?.primaryColor, backgroundColor: store.theme?.backgroundColor,
  });
  const themeColor = bars.status;
  const commit = (apply: () => AppliedIdentity): AppliedIdentity | null => {
    if (generation !== applyGeneration) return null;
    applySystemBarMeta(bars.status, bars.colorScheme);
    return apply();
  };
  // Manifesto já injetado pelo servidor no HTML desta loja: manter URL estável (sem ?v= que quebre o WebAPK).
  const injected = document.head.querySelector('link[rel="manifest"][data-server-injected]') as HTMLLinkElement | null;
  const ownHref = `/app/${encodeURIComponent(store.slug)}/manifest.webmanifest`;
  // Experimento de identidade (só lojas de teste): o servidor pode injetar o manifesto da versão da logo
  // (/app/<slug>~<versão>/manifest.webmanifest); ele também é desta loja e fica como está.
  const injectedHref = injected?.getAttribute('href') || '';
  const versioned = injectedHref !== ownHref && injectedHref.split('?')[0] !== ownHref && isOwnManifestHref(injectedHref, store.slug);
  if (injected && versioned) {
    const touch = await resolveTouchIcon(store);
    return commit(() => {
      injected.setAttribute('data-store-id', store.id);
      applyHeadMeta(name, shortName, themeColor, touch, urlOnlyIconVersion(store));
      return { manifestHref: injectedHref, usedFallbackIcon: false, served: true };
    }) || { manifestHref: injectedHref, usedFallbackIcon: false, served: true };
  }
  if (injected && (injected.getAttribute('href') || '').split('?')[0] === ownHref) {
    const touch = await resolveTouchIcon(store);
    return commit(() => {
      injected.setAttribute('data-store-id', store.id);
      if (injected.getAttribute('href') !== ownHref) injected.setAttribute('href', ownHref);
      applyHeadMeta(name, shortName, themeColor, touch, urlOnlyIconVersion(store));
      return { manifestHref: ownHref, usedFallbackIcon: false, served: true };
    }) || { manifestHref: ownHref, usedFallbackIcon: false, served: true };
  }
  // Uma nova tentativa evita trocar o manifesto servido por um data: numa falha momentânea.
  const served = (await fetchServedManifest(store)) || (await fetchServedManifest(store));
  if (served) {
    return commit(() => {
      setManifestLink(served.href, store.id);
      applyHeadMeta(name, served.shortName || shortName, themeColor, served.touchIcon, urlOnlyIconVersion(store));
      return { manifestHref: served.href, usedFallbackIcon: false, served: true };
    }) || { manifestHref: served.href, usedFallbackIcon: false, served: true };
  }
  const logoIcons = await buildLogoIcons(store.theme?.logoUrl, '#ffffff');
  const manifest = buildStoreManifest(store, window.location.origin, logoIcons || undefined);
  const href = manifestDataUrl(manifest);
  const touch = logoIcons ? logoIcons[0].src : svgDataUrl(fallbackIconSvg(name, themeColor, 180));
  return commit(() => {
    setManifestLink(href, store.id);
    applyHeadMeta(name, manifest.short_name, themeColor, touch);
    return { manifestHref: href, usedFallbackIcon: !logoIcons, served: false };
  }) || { manifestHref: href, usedFallbackIcon: !logoIcons, served: false };
}

function setManifestLink(href: string, storeId: string) {
  document.head.querySelectorAll('link[rel="manifest"]').forEach(l => l.remove());
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = href;
  link.setAttribute('data-store-id', storeId);
  document.head.appendChild(link);
}

function applyHeadMeta(name: string, shortName: string, themeColor: string, touch: string, iconIdentity?: string) {
  meta('theme-color', themeColor);
  meta('apple-mobile-web-app-title', shortName);
  meta('application-name', name);
  meta('apple-mobile-web-app-capable', 'yes');
  meta('mobile-web-app-capable', 'yes');
  const apple = upsert('link[rel="apple-touch-icon"]', () => { const l = document.createElement('link'); l.rel = 'apple-touch-icon'; return l; }) as HTMLLinkElement;
  apple.setAttribute('href', touch);
  const fav = upsert('link[rel="icon"]', () => { const l = document.createElement('link'); l.rel = 'icon'; return l; }) as HTMLLinkElement;
  fav.setAttribute('href', touch);
  if (iconIdentity) {
    apple.setAttribute('data-icon-identity', iconIdentity);
    fav.setAttribute('data-icon-identity', iconIdentity);
  }
  document.title = name;
}

