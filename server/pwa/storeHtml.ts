/**
 * Reescreve o <head> do index.html no servidor para rotas de loja (/app/<slug>...):
 * o Chrome lê o <link rel="manifest"> presente no carregamento; trocar por JS depois é tarde demais
 * (era a causa do "Instalar ADEGAFOOD Delivery & Pedidos"). Em /app/* nunca sai o manifesto global.
 */
import { storeDisplayName, StoreIdentityInput } from '../../src/lib/pwa/storeManifest';
import { resolveSystemBars } from '../../src/lib/pwa/systemBars';
import { htmlWithViewportFitCover, navBarCanvasStyleTag } from '../../src/lib/pwa/edgeToEdge';
import { readMesaParam } from '../../src/lib/salon/tableQr';
import { bootScreenHtml } from '../../src/lib/pwa/bootScreen';
import { iconVersion, identityVersion } from './routes';
import { APP_IDENTITY_META } from '../../src/lib/pwa/appIdentity';

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

export interface StoreHeadOptions {
  /** Liga viewport-fit=cover (só o app de delivery da loja; o cardápio da mesa ainda não trata as áreas seguras). */
  edgeToEdge?: boolean;
  /** Tela "Delivery Channel apresenta" (#dc-boot) logo após <body>: só no app de delivery (fora da mesa e da prévia do painel). */
  bootScreen?: boolean;
  /** EXPERIMENTO de identidade (só lojas de teste): manifesto da versão da logo e meta com a versão atual. */
  manifestHref?: string;
  appIdentity?: string;
}

/** Edge-to-edge só no app de delivery: o QR da mesa (/app/<slug>?mesa=<token>) abre o DineInClientApp. */
export function storeHeadOptionsForUrl(originalUrl: string): StoreHeadOptions {
  const i = originalUrl.indexOf('?');
  const search = i >= 0 ? originalUrl.slice(i) : '';
  const delivery = !readMesaParam(search);
  let preview = false;
  try { preview = new URLSearchParams(search).get('preview') === '1'; } catch { preview = false; }
  return { edgeToEdge: delivery, bootScreen: delivery && !preview };
}

export function injectStoreHead(html: string, slug: string, store: StoreIdentityInput | null, opts: StoreHeadOptions = {}): string {
  const enc = encodeURIComponent(slug);
  // Edge-to-edge: sem viewport-fit=cover o Chrome não deixa a loja pintar a barra de navegação do Android.
  let out = stripTag(html, GLOBAL_MANIFEST_RE);
  if (opts.edgeToEdge) out = htmlWithViewportFitCover(out);
  // URL do manifesto SEMPRE estável (sem query string variável) para o Chrome/WebAPK detectar atualizações de ícone/nome.
  const manifestHref = opts.manifestHref || `/app/${enc}/manifest.webmanifest`;
  const tags: string[] = [`<link rel="manifest" href="${escapeHtml(manifestHref)}" data-server-injected="1" data-store-slug="${escapeHtml(slug)}" />`];
  if (opts.appIdentity) tags.push(`<meta name="${APP_IDENTITY_META}" content="${escapeHtml(opts.appIdentity)}" />`);
  if (store) {
    const name = escapeHtml(storeDisplayName(store));
    const bars = resolveSystemBars({
      statusBarColor: store.theme?.statusBarColor, navBarColor: store.theme?.navBarColor,
      headerColor: store.theme?.headerColor, primaryColor: store.theme?.primaryColor, backgroundColor: store.theme?.backgroundColor,
    });
    const color = escapeHtml(bars.status);
    const icon = `/app/${enc}/icons/icon-192.png?v=${iconVersion(store)}`;
    out = stripTag(out, /<meta\b[^>]*name=["'](theme-color|color-scheme|apple-mobile-web-app-title|application-name)["'][^>]*>\s*/gi);
    out = stripTag(out, /<link\b[^>]*rel=["'](apple-touch-icon|icon)["'][^>]*>\s*/gi);
    out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${name}</title>`);
    tags.push(
      `<meta name="theme-color" content="${color}" />`,
      `<meta name="color-scheme" content="${bars.colorScheme}" />`,
      `<meta name="apple-mobile-web-app-title" content="${name}" />`,
      `<meta name="application-name" content="${name}" />`,
      `<link rel="apple-touch-icon" href="${icon}" />`,
      `<link rel="icon" href="${icon}" />`,
    );
    // Aba do Chrome sem edge-to-edge (3 botões, tablet): a barra de navegação usa a cor de fundo da página.
    // bars.nav é sempre um hex normalizado (#rrggbb), seguro dentro do CSS.
    if (opts.edgeToEdge) tags.push(navBarCanvasStyleTag(bars.nav));
  }
  out = out.replace(/<\/head>/i, `    ${tags.join('\n    ')}\n  </head>`);
  // Também sem loja (falha/timeout da consulta): a apresentação é da plataforma, não depende da loja.
  if (opts.bootScreen) out = out.replace(/<body\b[^>]*>/i, (m) => `${m}\n    ${bootScreenHtml()}`);
  return out;
}

export function withTimeout<T>(p: Promise<T>, ms: number, fb: T): Promise<T> {
  return Promise.race([p.catch(() => fb), new Promise<T>((r) => setTimeout(() => r(fb), ms))]);
}

