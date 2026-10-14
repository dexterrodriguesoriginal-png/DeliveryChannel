/**
 * PWA white-label por estabelecimento.
 * Funções PURAS (testáveis sem DOM): montam o manifesto de instalação de UMA loja
 * a partir da identidade da própria loja (theme.storeName / name / logoUrl / cores).
 * Nunca usam nome ou ícone da plataforma.
 */

export interface StoreIdentityInput {
  id: string;
  slug: string;
  name: string;
  theme?: {
    storeName?: string;
    shortName?: string;
    logoUrl?: string;
    primaryColor?: string;
    backgroundColor?: string;
    tagline?: string;
  };
}

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: 'any' | 'maskable';
}

export interface StoreManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: 'standalone';
  orientation: 'portrait';
  background_color: string;
  theme_color: string;
  lang: string;
  icons: ManifestIcon[];
  /** Chrome: reutiliza a janela do app instalado ao abrir links da loja. */
  launch_handler: { client_mode: string[] };
  /** Chrome (link capturing): links do escopo abrem preferencialmente no app instalado. */
  handle_links: 'preferred';
  /** Auto-referência para navigator.getInstalledRelatedApps() detectar o app instalado. */
  related_applications: { platform: 'webapp'; url: string }[];
  prefer_related_applications: false;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const FALLBACK_THEME_COLOR = '#334155';
export const FALLBACK_BG_COLOR = '#ffffff';

export function safeColor(c: string | undefined, fallback: string): string {
  return c && HEX.test(c.trim()) ? c.trim() : fallback;
}

export function storeDisplayName(s: StoreIdentityInput): string {
  const n = (s.theme?.storeName || s.name || '').trim();
  return n || s.slug;
}

/**
 * Nome curto: theme.shortName configurado pela loja, se houver; senão o NOME COMPLETO.
 * Sem truncamento artificial (o launcher Android pode abreviar visualmente nomes longos).
 */
export function deriveShortName(fullName: string, explicit?: string): string {
  const ex = (explicit || '').trim();
  return ex || fullName.trim();
}

export function storeInitials(name: string): string {
  const stop = new Set(['de', 'da', 'do', 'das', 'dos', 'e', '&']);
  const words = name.trim().split(/\s+/).filter(w => !stop.has(w.toLowerCase()));
  const letters = words.slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
  return letters || '?';
}

/** Escopo e URL inicial da loja: /app/<slug>/ (o roteamento atual aceita barra final). */
export function storeScope(slug: string): string {
  return `/app/${encodeURIComponent(slug)}/`;
}
export function storeStartUrl(slug: string): string {
  return `${storeScope(slug)}?source=pwa`;
}
/** Caminho do manifesto servido pelo servidor da loja. */
export function storeManifestPath(slug: string): string {
  return `/app/${encodeURIComponent(slug)}/manifest.webmanifest`;
}
/** Identificador estável: derivado do ID interno do tenant (não muda se o nome mudar). */
export function storeAppId(tenantId: string): string {
  return `/app-id/${encodeURIComponent(tenantId)}`;
}

/** Ícone de fallback (SVG) com iniciais da loja e cor do tema — sem marca da plataforma. */
export function fallbackIconSvg(name: string, color: string, size = 512, maskable = false): string {
  const initials = storeInitials(name).replace(/[<>&"']/g, '');
  const r = maskable ? 0 : Math.round(size * 0.18);
  const fs = Math.round(size * (maskable ? 0.32 : 0.4));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${r}" fill="${color}"/>` +
    `<text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${fs}" fill="#ffffff">${initials}</text></svg>`;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function fallbackIcons(name: string, color: string): ManifestIcon[] {
  return [
    { src: svgDataUrl(fallbackIconSvg(name, color, 192)), sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
    { src: svgDataUrl(fallbackIconSvg(name, color, 512)), sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
    { src: svgDataUrl(fallbackIconSvg(name, color, 512, true)), sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
  ];
}

/**
 * Monta o manifesto da loja. `origin` torna todas as URLs absolutas — obrigatório quando
 * o manifesto é entregue como data:/blob: (URLs relativas resolveriam contra o próprio data:).
 * `icons` = PNGs gerados do logotipo; se ausentes, usa o fallback com iniciais.
 */
export function buildStoreManifest(store: StoreIdentityInput, origin: string, icons?: ManifestIcon[]): StoreManifest {
  const name = storeDisplayName(store);
  const theme = safeColor(store.theme?.primaryColor, FALLBACK_THEME_COLOR);
  const bg = safeColor(store.theme?.backgroundColor, FALLBACK_BG_COLOR);
  const o = origin.replace(/\/$/, '');
  return {
    id: `${o}${storeAppId(store.id)}`,
    name,
    short_name: deriveShortName(name, store.theme?.shortName),
    description: (store.theme?.tagline || `Peça online em ${name}`).slice(0, 300),
    start_url: `${o}${storeStartUrl(store.slug)}`,
    scope: `${o}${storeScope(store.slug)}`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: bg,
    theme_color: theme,
    lang: 'pt-BR',
    icons: icons && icons.length ? icons : fallbackIcons(name, theme),
    launch_handler: { client_mode: ['navigate-existing', 'auto'] },
    handle_links: 'preferred',
    related_applications: [{ platform: 'webapp', url: `${o}${storeManifestPath(store.slug)}` }],
    prefer_related_applications: false,
  };
}

export function manifestDataUrl(m: StoreManifest): string {
  return `data:application/manifest+json;charset=utf-8,${encodeURIComponent(JSON.stringify(m))}`;
}

/** Chave do carrinho isolada por tenant (ID interno, nunca slug/nome). */
export function cartStorageKey(tenantId: string): string {
  if (!tenantId) throw new Error('tenantId obrigatório para chave de carrinho');
  return `adegafood_cart_${tenantId}`;
}
