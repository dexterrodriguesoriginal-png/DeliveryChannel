/**
 * Idade de pedidos em aberto no painel do dono (19/10).
 * Pedido ativo (não entregue nem cancelado) com 30 min ou mais ganha um selo "recebido há ...":
 * âmbar de 30 min a 24 h; vermelho a partir de 1 dia (provavelmente esquecido: conferir ou cancelar).
 * Pedidos novos continuam no topo (ordem por criação, mais recente primeiro).
 */
import type { Order, OrderStatus } from '../../types';

export const AGE_WARN_MS = 30 * 60 * 1000;
export const AGE_STALE_MS = 24 * 60 * 60 * 1000;

const FINAL: ReadonlySet<string> = new Set(['DELIVERED', 'CANCELLED']);

export type OrderAgeLevel = 'fresh' | 'warn' | 'stale';

export interface OrderAgeInfo {
  level: OrderAgeLevel;
  ageMs: number;
  /** "recebido há 3 dias" (vazio quando o selo não deve aparecer). */
  label: string;
  /** Mostrar o selo? Só para pedido ativo com 30 min ou mais. */
  show: boolean;
}

export function isActiveOrderStatus(status: OrderStatus | string | undefined | null): boolean {
  return !!status && !FINAL.has(String(status).toUpperCase());
}

/** "45 min", "1 h", "5 h", "1 dia", "3 dias". */
export function formatAgePtBR(ageMs: number): string {
  const min = Math.max(0, Math.floor(ageMs / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 dia' : `${d} dias`;
}

export function orderAgeInfo(
  order: Pick<Order, 'createdAt' | 'status'>,
  now: number = Date.now()
): OrderAgeInfo {
  const created = new Date(order.createdAt).getTime();
  const ageMs = Number.isFinite(created) ? Math.max(0, now - created) : 0;
  const level: OrderAgeLevel = ageMs >= AGE_STALE_MS ? 'stale' : ageMs >= AGE_WARN_MS ? 'warn' : 'fresh';
  const show = isActiveOrderStatus(order.status) && level !== 'fresh';
  return { level, ageMs, show, label: show ? `recebido há ${formatAgePtBR(ageMs)}` : '' };
}

/** Mais recente primeiro (pedido novo sempre no topo); empate pelo número do pedido. Não altera a lista original. */
export function sortOrdersNewestFirst<T extends Pick<Order, 'createdAt' | 'orderNumber'>>(orders: readonly T[]): T[] {
  const t = (o: T) => {
    const v = new Date(o.createdAt).getTime();
    return Number.isFinite(v) ? v : 0;
  };
  return [...orders].sort((a, b) => t(b) - t(a) || (Number(b.orderNumber) || 0) - (Number(a.orderNumber) || 0));
}

/** Quantos pedidos ativos estão parados há 1 dia ou mais (para o aviso no topo do painel). */
export function countStaleActiveOrders(orders: readonly Pick<Order, 'createdAt' | 'status'>[], now: number = Date.now()): number {
  return orders.filter(o => orderAgeInfo(o, now).level === 'stale' && isActiveOrderStatus(o.status)).length;
}
