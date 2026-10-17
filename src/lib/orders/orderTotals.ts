import type { Order } from '../../types';

export interface OrderMoneyBreakdown {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  /** Mostrar a linha "Taxa de entrega" (sempre na entrega; na retirada só se houver taxa). */
  showDeliveryFee: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Resumo financeiro do pedido para o painel do dono e o cupom térmico:
 * Subtotal (itens), Desconto, Taxa de entrega, Total.
 * - Subtotal: orders.subtotal; se vier zerado, soma dos itens.
 * - Taxa: orders.delivery_fee; se vier zerada num pedido de entrega cujo total não fecha
 *   (total > subtotal − desconto), mostra a diferença para o total sempre bater com as linhas.
 */
export function orderMoneyBreakdown(
  order: Pick<Order, 'subtotal' | 'discount' | 'deliveryFee' | 'totalAmount' | 'fulfillmentType' | 'items'>
): OrderMoneyBreakdown {
  const itemsSum = round2((order.items || []).reduce((acc, it) => acc + num(it?.totalPrice), 0));
  const subtotal = num(order.subtotal) > 0 ? round2(num(order.subtotal)) : itemsSum;
  const discount = Math.max(0, round2(num(order.discount)));
  const total = round2(num(order.totalAmount));
  let deliveryFee = Math.max(0, round2(num(order.deliveryFee)));
  const isDelivery = order.fulfillmentType !== 'PICKUP';
  if (deliveryFee === 0 && isDelivery) {
    const gap = round2(total - (subtotal - discount));
    if (gap > 0) deliveryFee = gap;
  }
  return { subtotal, discount, deliveryFee, total, showDeliveryFee: isDelivery || deliveryFee > 0 };
}
