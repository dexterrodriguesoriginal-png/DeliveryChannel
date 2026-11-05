import type { Order } from '../types';
import { orderRepository } from './orderRepository';

/** Same validated status gateway used by Pedidos; cashier roles must traverse both adjacent states. */
export async function acceptOrderForProduction(
  context: Parameters<typeof orderRepository.updateStatus>[0], tenantId: string,
  order: Pick<Order, 'id' | 'tenantId' | 'status'>,
): Promise<Order> {
  if (order.tenantId !== tenantId || !['PENDING', 'CONFIRMED'].includes(order.status)) {
    throw new Error('O pedido não está disponível para iniciar a produção.');
  }
  if (order.status === 'PENDING') {
    const accepted = await orderRepository.updateStatus(context, tenantId, order.id, 'CONFIRMED', undefined, 'PENDING');
    if (accepted.id !== order.id || accepted.tenantId !== tenantId || accepted.status !== 'CONFIRMED') {
      throw new Error('O pedido mudou. Atualize a lista antes de continuar.');
    }
  }
  return orderRepository.updateStatus(context, tenantId, order.id, 'PREPARING', undefined, 'CONFIRMED');
}

