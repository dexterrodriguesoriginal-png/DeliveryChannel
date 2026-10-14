/**
 * Aplica, no <head>, a identidade instalável da loja ativa:
 * <link rel="manifest"> (data: URL com manifesto da loja), theme-color,
 * apple-mobile-web-app-title, apple-touch-icon e <title>.
 * Só é usado em rotas /app/<slug>. As demais rotas mantêm o manifesto global (/manifest.json).
 */
import { buildStoreManifest, fallbackIconSvg, manifestDataUrl, ManifestIcon, safeColor, FALLBACK_THEME_COLOR, StoreIdentityInput, storeDisplayName, svgDataUrl } from './storeManifest';

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

export interface AppliedIdentity { manifestHref: string; usedFallbackIcon: boolean; }

export async function applyStoreIdentity(store: StoreIdentityInput): Promise<AppliedIdentity> {
  const name = storeDisplayName(store);
  const themeColor = safeColor(store.theme?.primaryColor, FALLBACK_THEME_COLOR);
  const logoIcons = await buildLogoIcons(store.theme?.logoUrl, '#ffffff');
  const manifest = buildStoreManifest(store, window.location.origin, logoIcons || undefined);
  const href = manifestDataUrl(manifest);

  document.head.querySelectorAll('link[rel="manifest"]').forEach(l => l.remove());
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = href;
  link.setAttribute('data-store-id', store.id);
  document.head.appendChild(link);

  meta('theme-color', themeColor);
  meta('apple-mobile-web-app-title', manifest.short_name);
  meta('application-name', name);
  meta('apple-mobile-web-app-capable', 'yes');
  meta('mobile-web-app-capable', 'yes');
  const touch = logoIcons ? logoIcons[0].src : svgDataUrl(fallbackIconSvg(name, themeColor, 180));
  const apple = upsert('link[rel="apple-touch-icon"]', () => { const l = document.createElement('link'); l.rel = 'apple-touch-icon'; return l; }) as HTMLLinkElement;
  apple.href = touch;
  const fav = upsert('link[rel="icon"]', () => { const l = document.createElement('link'); l.rel = 'icon'; return l; }) as HTMLLinkElement;
  fav.href = touch;
  document.title = name;
  return { manifestHref: href, usedFallbackIcon: !logoIcons };
}
