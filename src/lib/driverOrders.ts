import { Order } from '../types';

/** Pedidos atribuídos ao entregador autenticado (orders.driver_id = auth.uid()). */
export function filterAssignedDriverOrders(orders: Order[], driverUserId: string | undefined): Order[] {
  if (!driverUserId) return [];
  return orders.filter(o => o.driverId === driverUserId);
}

/** Histórico do entregador: pedidos atribuídos a ele já encerrados (entregues ou cancelados), mais recentes primeiro. */
export function driverOrderHistory(orders: Order[], driverUserId: string | undefined): Order[] {
  return filterAssignedDriverOrders(orders, driverUserId)
    .filter(o => o.status === 'DELIVERED' || o.status === 'CANCELLED')
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}
