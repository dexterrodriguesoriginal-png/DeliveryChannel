import { Order } from '../types';

/** Pedidos atribuídos ao entregador autenticado (orders.driver_id = auth.uid()). */
export function filterAssignedDriverOrders(orders: Order[], driverUserId: string | undefined): Order[] {
  if (!driverUserId) return [];
  return orders.filter(o => o.driverId === driverUserId);
}
