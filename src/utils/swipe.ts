/** Lógica pura de arraste horizontal do carrossel de cards promocionais. */
export const SWIPE_THRESHOLD_PX = 50;
/** Movimento mínimo para considerar "arraste" (e suprimir o clique no card). */
export const DRAG_CLICK_SUPPRESS_PX = 10;

export type SwipeIntent = 'pending' | 'horizontal' | 'vertical';

/** Decide a intenção do gesto: só vira horizontal se dx domina dy (não bloqueia rolagem vertical). */
export function detectSwipeIntent(dx: number, dy: number, slop = 8): SwipeIntent {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < slop && ay < slop) return 'pending';
  return ax > ay * 1.2 ? 'horizontal' : 'vertical';
}

/** Resultado ao soltar: arrastar para a esquerda => próximo; para a direita => anterior. */
export function swipeDirection(dx: number, dy: number, threshold = SWIPE_THRESHOLD_PX): 'next' | 'prev' | null {
  if (detectSwipeIntent(dx, dy) !== 'horizontal' || Math.abs(dx) < threshold) return null;
  return dx < 0 ? 'next' : 'prev';
}

export function wrapIndex(i: number, total: number): number {
  return total > 0 ? ((i % total) + total) % total : 0;
}
