/**
 * Posição vertical do convite/barra "Instalar app" da vitrine: sempre ACIMA da navegação inferior
 * (Início/Sacola/Pedidos) e da barra flutuante "Ver Sacola", para nunca bloquear cliques nelas.
 */
/** Altura da navegação inferior do cliente (MobileNavigation type="customer", ~64 px) + folga. */
export const CUSTOMER_BOTTOM_NAV_PX = 64;
/** Barra flutuante "Ver Sacola de Compras" (bottom-16 + p-4 + cartão ~60 px). */
export const FLOATING_CART_BAR_PX = 92;
const GAP_PX = 8;

export function installHintBottomOffset(opts: { bottomNav: boolean; floatingCartBar: boolean }): number {
  let px = GAP_PX;
  if (opts.bottomNav) px += CUSTOMER_BOTTOM_NAV_PX;
  if (opts.bottomNav && opts.floatingCartBar) px += FLOATING_CART_BAR_PX;
  return px;
}
