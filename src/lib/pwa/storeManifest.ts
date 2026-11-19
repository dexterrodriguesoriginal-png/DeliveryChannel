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
  updatedAt?: string;
  /** theme_tokens.meta.appBaseLogoUrl (ausente = loja nunca trocou a logo depois do fluxo de versão). Não entra no manifesto. */
  appBaseLogoUrl?: string;
  /** theme_tokens.meta.logoConfirmedUrl (logo definitiva confirmada; ausente = loja antiga). Não entra no manifesto. */
  logoConfirmedUrl?: string;
  theme?: {
    storeName?: string;
    shortName?: string;
    logoUrl?: string;
    primaryColor?: string;
    backgroundColor?: string;
    tagline?: string;
    /** Cor do cabeçalho (padrão das barras do sistema). */
    headerColor?: string;
    statusBarColor?: string;
    navBarColor?: string;
    updatedAt?: string;
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

import { resolveSystemBars } from './systemBars';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const FALLBACK_THEME_COLOR = '#334155';
export const FALLBACK_BG_COLOR = '#ffffff';

export function safeColor(c: string | undefined, fallback: string): string {
  return c && HEX.test(c.trim()) ? c.trim() : fallback;
}

/** Fundo de iniciais quando o logo não pode ser usado — nunca cinza, branco ou inválido. */
export const ICON_FALLBACK_COLOR = '#0f766e';

export function colorRgb(hex: string): { r: number; g: number; b: number } | null {
  const c = safeColor(hex, '');
  if (!c) return null;
  const h = c.slice(1);
  const full = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}

/** Cinza, quase branco ou cor inválida — não serve de fundo para o ícone com iniciais. */
export function isWeakIconColor(hex: string | undefined): boolean {
  if (!hex) return true;
  const rgb = colorRgb(hex);
  if (!rgb) return true;
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (max - min < 28) return true;
  if (luma > 230) return true;
  return false;
}

/** Prefere a cor do cabeçalho/tema; se a primária for cinza (ex.: #717179), usa a próxima cor viva. */
export function iconFallbackColor(theme?: StoreIdentityInput['theme']): string {
  const candidates = [
    theme?.headerColor,
    theme?.statusBarColor,
    theme?.primaryColor,
    theme?.navBarColor,
    theme?.backgroundColor,
  ];
  for (const c of candidates) {
    if (c && !isWeakIconColor(c)) return c.trim();
  }
  return ICON_FALLBACK_COLOR;
}

/** Primeira cor viva da lista; ignora cinza/quase branco (ex.: primary #717179 da loja). */
export function pickVividAccent(candidates: Array<string | undefined>, fallback = ICON_FALLBACK_COLOR): string {
  for (const c of candidates) {
    if (c && !isWeakIconColor(c)) return c.trim();
  }
  return fallback;
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

function shortHash(src: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 10);
}

/**
 * Versão do ÍCONE (?v= dos PNGs em manifesto, <link rel="icon">, apple-touch-icon e totem).
 * Depende só do que muda a imagem do ícone:
 *  - com logo: o endereço do logo (o upload do painel sempre grava um arquivo novo, com timestamp);
 *  - sem logo: o ícone de iniciais = nome exibido + cor usada para desenhá-lo (iconFallbackColor).
 * Cores de barras/tema e updatedAt NÃO entram: o Chrome procura o hash antigo do ícone do app instalado
 * pela URL; ?v= novo a cada troca de cor fazia cada mudança de cor parecer troca de ícone (atualizações
 * extras do app instalado, que o Chrome passa a espaçar).
 * Mesmo valor em serverManifest, storeHtml.ts (iconVersion), applyStoreIdentity (identityHash) e totem.
 */
export function storeIconVersion(store: StoreIdentityInput): string {
  const logo = (store.theme?.logoUrl || '').trim();
  const src = logo
    ? ['logo', store.id, logo]
    : ['initials', store.id, storeDisplayName(store), iconFallbackColor(store.theme)];
  return shortHash(src.join('|'));
}

/**
 * Versão da IDENTIDADE visível (nome, logo, cores, barras, updatedAt) para /api/pwa/version:
 * avisa o app aberto que a loja mudou. Não é usada em URLs de ícone.
 */
export function storeIdentityVersion(store: StoreIdentityInput): string {
  const t = store.theme || {};
  return shortHash([
    store.id,
    storeDisplayName(store),
    t.shortName || '',
    t.logoUrl || '',
    t.primaryColor || '',
    t.backgroundColor || '',
    t.headerColor || '',
    t.statusBarColor || '',
    t.navBarColor || '',
    t.tagline || '',
    t.updatedAt || store.updatedAt || '',
  ].join('|'));
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
  // App instalado (WebAPK): o Chrome pinta a barra de navegação do Android com o theme_color GRAVADO no app na
  // instalação/atualização (não lê o <meta theme-color> em tempo real). A barra de status, ao contrário, segue o
  // <meta theme-color> ao vivo. Por isso theme_color = cor da barra de NAVEGAÇÃO; a de status vem do meta.
  const bars = resolveSystemBars({
    statusBarColor: store.theme?.statusBarColor, navBarColor: store.theme?.navBarColor,
    headerColor: store.theme?.headerColor, primaryColor: store.theme?.primaryColor, backgroundColor: store.theme?.backgroundColor,
  });
  const theme = bars.nav;
  const bg = bars.nav;
  // Ícone de iniciais (loja sem logo) continua na cor de status: trocar o ícone faria o Android pedir confirmação.
  const iconColor = bars.status;
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
    icons: icons && icons.length ? icons : fallbackIcons(name, iconColor),
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

