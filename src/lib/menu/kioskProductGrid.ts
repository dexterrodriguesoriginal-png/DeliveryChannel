/** Largura mínima de um card para nome, preço e o botão Adicionar caberem sem corte. */
export const KIOSK_PRODUCT_CARD_MIN_PX = 150;

/**
 * Grade responsiva do cardápio (totem e mesa).
 * No máximo `maxColumns` (configuração do dono), mas nunca mais estreita que
 * `minPx` — no telefone fino isso cai para 2 colunas; no totem 1080×1920, 3.
 */
export function kioskProductGridColumns(
  maxColumns: 1 | 2 | 3,
  minPx = KIOSK_PRODUCT_CARD_MIN_PX,
): string {
  const cols = maxColumns;
  const gap = 'var(--dc-kiosk-card-gap, 16px)';
  const minTrack = `min(100%, max(${minPx}px, calc((100% - (${cols} - 1) * ${gap}) / ${cols})))`;
  return `repeat(auto-fill, minmax(${minTrack}, 1fr))`;
}
