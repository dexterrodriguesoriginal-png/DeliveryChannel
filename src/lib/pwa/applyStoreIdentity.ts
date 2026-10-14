/**
 * Aplica, no <head>, a identidade instalável da loja ativa:
 * <link rel="manifest"> (preferencialmente /app/<slug>/manifest.webmanifest servido pelo servidor do app
 * via HTTPS, com ícones PNG; data: URL só como fallback quando o servidor não está disponível, ex.: vite puro), theme-color,
 * apple-mobile-web-app-title, apple-touch-icon e <title>.
 * Só é usado em rotas /app/<slug>. As demais rotas mantêm o manifesto global (/manifest.json).
 */
import { buildStoreManifest, storeAppId, fallbackIconSvg, manifestDataUrl, ManifestIcon, safeColor, FALLBACK_THEME_COLOR, StoreIdentityInput, storeDisplayName, svgDataUrl } from './storeManifest';

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
  if (!pathname.startsWith('/app/')) return;
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

export async function applyStoreIdentity(store: StoreIdentityInput): Promise<AppliedIdentity> {
  const name = storeDisplayName(store);
  const themeColor = safeColor(store.theme?.primaryColor, FALLBACK_THEME_COLOR);
  const served = await fetchServedManifest(store);
  if (served) {
    setManifestLink(served.href, store.id);
    applyHeadMeta(name, served.shortName || name, themeColor, served.touchIcon);
    return { manifestHref: served.href, usedFallbackIcon: false, served: true };
  }
  const logoIcons = await buildLogoIcons(store.theme?.logoUrl, '#ffffff');
  const manifest = buildStoreManifest(store, window.location.origin, logoIcons || undefined);
  const href = manifestDataUrl(manifest);

  setManifestLink(href, store.id);
  const touch = logoIcons ? logoIcons[0].src : svgDataUrl(fallbackIconSvg(name, themeColor, 180));
  applyHeadMeta(name, manifest.short_name, themeColor, touch);
  return { manifestHref: href, usedFallbackIcon: !logoIcons, served: false };
}

function setManifestLink(href: string, storeId: string) {
  document.head.querySelectorAll('link[rel="manifest"]').forEach(l => l.remove());
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = href;
  link.setAttribute('data-store-id', storeId);
  document.head.appendChild(link);
}

function applyHeadMeta(name: string, shortName: string, themeColor: string, touch: string) {
  meta('theme-color', themeColor);
  meta('apple-mobile-web-app-title', shortName);
  meta('application-name', name);
  meta('apple-mobile-web-app-capable', 'yes');
  meta('mobile-web-app-capable', 'yes');
  const apple = upsert('link[rel="apple-touch-icon"]', () => { const l = document.createElement('link'); l.rel = 'apple-touch-icon'; return l; }) as HTMLLinkElement;
  apple.href = touch;
  const fav = upsert('link[rel="icon"]', () => { const l = document.createElement('link'); l.rel = 'icon'; return l; }) as HTMLLinkElement;
  fav.href = touch;
  document.title = name;
}
