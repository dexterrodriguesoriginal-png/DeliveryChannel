/**
 * Tela "Delivery Channel apresenta" (#dc-boot): sai pronta no HTML do servidor (/app/<slug>/), antes de
 * qualquer JS. O WebAPK do Chrome tira a splash do sistema na primeira pintura "não vazia" (Blink conta
 * imagem > 32x32 px ou > 200 caracteres) — por isso a marca vai como <img> data: de 96 px.
 * Cor fixa do Delivery Channel (padrão da plataforma, não é cor de loja). O app da loja remove a tela
 * quando a vitrine carrega (hideBootScreen).
 */
import { DC_MARK_DATA_URI } from '../brand/dcMark';

export const DC_BOOT_SCREEN_ID = 'dc-boot';
/** Fundo padrão da apresentação do Delivery Channel (cinza escuro). Único lugar desta cor. */
export const DC_PRESENTS_BACKGROUND = '#121212';
export const DC_PRESENTS_TEXT_COLOR = '#f5f5f5';
export const DC_PRESENTS_TEXT = 'Delivery Channel apresenta';
export const DC_BOOT_MARK_SIZE_PX = 96;
export const DC_BOOT_FADE_MS = 200;
export const DC_BOOT_HIDE_CLASS = 'dc-boot-hide';
/** Teto da tela do servidor caso a vitrine nunca avise que carregou (a tela do React, idêntica, segue por baixo). */
export const BOOT_SCREEN_MAX_MS = 15000;

const FONT_STACK = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';

/** Marcação autocontida (estilo inline, imagem data:, sem requisições externas). */
export function bootScreenHtml(): string {
  const s = DC_BOOT_MARK_SIZE_PX;
  const css =
    `#${DC_BOOT_SCREEN_ID}{position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;` +
    `background:${DC_PRESENTS_BACKGROUND};color:${DC_PRESENTS_TEXT_COLOR};font:600 15px/1.3 ${FONT_STACK};letter-spacing:.02em;opacity:1;transition:opacity ${DC_BOOT_FADE_MS}ms ease}` +
    `#${DC_BOOT_SCREEN_ID}.${DC_BOOT_HIDE_CLASS}{opacity:0;pointer-events:none}` +
    `#${DC_BOOT_SCREEN_ID} img{width:${s}px;height:${s}px;display:block}`;
  return `<div id="${DC_BOOT_SCREEN_ID}" role="status" aria-label="${DC_PRESENTS_TEXT}"><style>${css}</style>` +
    `<img src="${DC_MARK_DATA_URI}" width="${s}" height="${s}" alt="" decoding="sync" /><span>${DC_PRESENTS_TEXT}</span></div>`;
}

/** Some com a tela do servidor (fade curto); sem efeito se ela não existir. */
export function hideBootScreen(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): void {
  const el = doc?.getElementById(DC_BOOT_SCREEN_ID);
  if (!el || el.classList.contains(DC_BOOT_HIDE_CLASS)) return;
  el.classList.add(DC_BOOT_HIDE_CLASS);
  setTimeout(() => el.remove(), DC_BOOT_FADE_MS + 50);
}
