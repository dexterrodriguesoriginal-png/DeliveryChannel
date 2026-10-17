/**
 * Deep link do acompanhamento de pedidos na vitrine:
 *   /app/<slug>#pedidos          → abre a aba "Meus Pedidos"
 *   /app/<slug>?pedido=<uuid>    → abre a aba e destaca o pedido
 * Só lê e reescreve o próprio "#pedidos" / "?pedido="; outros hashes (ex.: retorno do OAuth) não são tocados.
 */
import { isValidUuid } from '../uuid';

export const TRACKING_HASH = '#pedidos';

export function readTrackingDeepLink(search: string, hash: string): { open: boolean; orderId?: string } {
  let orderId: string | undefined;
  try {
    const raw = new URLSearchParams(search || '').get('pedido');
    if (raw && isValidUuid(raw.trim())) orderId = raw.trim();
  } catch {
    orderId = undefined;
  }
  const open = Boolean(orderId) || String(hash || '').toLowerCase() === TRACKING_HASH;
  return { open, orderId };
}

/**
 * URL a gravar com history.replaceState ao trocar de aba. Retorna null quando não há nada a mudar.
 * - aba Pedidos: garante "#pedidos" (mantém ?pedido= se houver);
 * - outra aba: remove "#pedidos" e "?pedido=" (preserva os demais parâmetros).
 */
export function trackingUrlFor(href: string, ordersOpen: boolean): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const hasHash = url.hash.toLowerCase() === TRACKING_HASH;
  if (ordersOpen) {
    if (hasHash) return null;
    if (url.hash && !hasHash) return null; // outro hash em uso (ex.: tokens do OAuth): não mexe
    url.hash = TRACKING_HASH;
    return url.toString();
  }
  const hasParam = url.searchParams.has('pedido');
  if (!hasHash && !hasParam) return null;
  if (hasParam) url.searchParams.delete('pedido');
  if (hasHash) url.hash = '';
  return url.toString();
}
