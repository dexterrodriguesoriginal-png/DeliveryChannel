import type { Order } from '../../types';

type ArchiveOrder = Pick<Order, 'status' | 'archivedAt'>;

export function canArchiveOrder(order: ArchiveOrder): boolean {
  return order.status === 'CANCELLED' || order.status === 'DELIVERED';
}

/** Exclusivo da tela Pedidos: relatórios e histórico continuam usando todos os registros. */
export function matchesOrderStatusTab(order: ArchiveOrder, tab: string): boolean {
  if (tab === 'ARCHIVED') return Boolean(order.archivedAt);
  if (order.archivedAt) return false;
  if (tab === 'ALL') return order.status !== 'CANCELLED';
  if (tab === 'READY') return order.status === 'READY' || order.status === 'WAITING_FOR_DRIVER';
  return order.status === tab;
}
