import React from 'react';
import type { Order } from '../../types';
export function OnlinePaymentBadge({ order }: { order: Order }) {
  if (!order.onlinePayment) return null;
  return <span className={`inline-block rounded-lg border px-2 py-1 text-[10px] font-bold ${order.onlinePayment.status === 'paid' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
    {order.onlinePayment.status === 'paid' ? 'Pago online' : 'Aguardando pagamento'}
  </span>;
}
