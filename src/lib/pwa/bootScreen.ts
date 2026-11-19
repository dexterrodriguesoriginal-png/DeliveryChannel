/**
 * Tela de abertura da LOJA (#store-boot): sai pronta no HTML do servidor (/app/<slug>/), antes de qualquer JS.
 * Só a logo da loja (o mesmo ícone do app instalado) no fundo da loja (= background_color do manifesto, a cor
 * da splash do sistema): a splash do Android emenda nela sem "piscar" e sem marca do Delivery Channel.
 * O WebAPK do Chrome tira a splash do sistema na primeira pintura "não vazia" (Blink conta imagem > 32x32 px),
 * então a logo vai como <img> de 96 px. O app da loja remove a tela quando a vitrine carrega (hideBootScreen).
 */
import { normalizeBarColor } from './systemBars';

export const STORE_BOOT_SCREEN_ID = 'store-boot';
export const STORE_BOOT_LOGO_SIZE_PX = 96;
export const STORE_BOOT_FADE_MS = 200;
export const STORE_BOOT_HIDE_CLASS = 'store-boot-hide';
/** Teto da tela do servidor caso a vitrine nunca avise que carregou. */
export const BOOT_SCREEN_MAX_MS = 15000;

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export interface StoreBootInput {
  /** Cor de fundo do tema da loja (hex). Inválida = sem tela (nunca cor fixa). */
  background: string;
  /** Ícone da loja no mesmo endereço do app (/app/<slug>/icons/icon-192.png?v=...). */
  iconUrl: string;
  /** Nome da loja (só leitor de tela). */
  name: string;
}

/** Marcação autocontida (estilo inline, sem script). Fundo inválido ou ícone fora do app = string vazia. */
export function storeBootScreenHtml(i: StoreBootInput): string {
  const bg = normalizeBarColor(i.background);
  if (!bg || !i.iconUrl.startsWith('/app/')) return '';
  const s = STORE_BOOT_LOGO_SIZE_PX;
  const css =
    `#${STORE_BOOT_SCREEN_ID}{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;` +
    `background:${bg};opacity:1;transition:opacity ${STORE_BOOT_FADE_MS}ms ease}` +
    `#${STORE_BOOT_SCREEN_ID}.${STORE_BOOT_HIDE_CLASS}{opacity:0;pointer-events:none}` +
    `#${STORE_BOOT_SCREEN_ID} img{width:${s}px;height:${s}px;display:block;border-radius:22%}`;
  return `<div id="${STORE_BOOT_SCREEN_ID}" role="status" aria-label="${escapeAttr(i.name)}"><style>${css}</style>` +
    `<img src="${escapeAttr(i.iconUrl)}" width="${s}" height="${s}" alt="" decoding="sync" fetchpriority="high" /></div>`;
}

/** Some com a tela do servidor (fade curto); sem efeito se ela não existir. */
export function hideBootScreen(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): void {
  const el = doc?.getElementById(STORE_BOOT_SCREEN_ID);
  if (!el || el.classList.contains(STORE_BOOT_HIDE_CLASS)) return;
  el.classList.add(STORE_BOOT_HIDE_CLASS);
  setTimeout(() => el.remove(), STORE_BOOT_FADE_MS + 50);
}
