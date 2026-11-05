import type { Order, OrderStatus } from '../../types';

/** The serving step is separate from delivery so table customers can follow the waiter. */
export function dineInNextAction(order: Pick<Order, 'status' | 'fulfillmentType'>): { to: OrderStatus; label: string } | null {
  if (order.fulfillmentType !== 'DINE_IN') return null;
  switch (order.status) {
    case 'PENDING': return { to: 'CONFIRMED', label: 'Aceitar Pedido' };
    case 'CONFIRMED': return { to: 'PREPARING', label: 'Iniciar Preparo' };
    case 'PREPARING': return { to: 'READY', label: 'Marcar como Pronto' };
    case 'READY': return { to: 'OUT_FOR_DELIVERY', label: 'Servir' };
    case 'OUT_FOR_DELIVERY': return { to: 'DELIVERED', label: 'Entregue na mesa' };
    default: return null;
  }
}

