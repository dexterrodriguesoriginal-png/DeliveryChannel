import React from 'react';
import type { Order } from '../../types';
import { orderMoneyBreakdown } from '../../lib/orders/orderTotals';
import { formatBRL } from '../../lib/pricing/money';

/** Subtotal, Desconto (se houver), Taxa de entrega e Total do pedido — painel de detalhes do dono. */
export const OrderTotalsLines: React.FC<{
  order: Pick<Order, 'subtotal' | 'discount' | 'deliveryFee' | 'totalAmount' | 'fulfillmentType' | 'items'>;
}> = ({ order }) => {
  const b = orderMoneyBreakdown(order);
  return (
    <div className="space-y-0.5 text-[8.5px] pt-0.5">
      <div className="flex justify-between text-slate-600" data-line="subtotal">
        <span>Subtotal</span>
        <span className="font-mono font-bold">{formatBRL(b.subtotal)}</span>
      </div>
      {b.discount > 0 && (
        <div className="flex justify-between text-emerald-700" data-line="discount">
          <span>Desconto</span>
          <span className="font-mono font-bold">- {formatBRL(b.discount)}</span>
        </div>
      )}
      {b.showDeliveryFee && (
        <div className="flex justify-between text-slate-600" data-line="delivery-fee">
          <span>Taxa de entrega</span>
          <span className="font-mono font-bold">{formatBRL(b.deliveryFee)}</span>
        </div>
      )}
      <div className="flex justify-between items-baseline border-t border-slate-200 pt-0.5" data-line="total">
        <span className="font-bold text-slate-800">Total</span>
        <span className="font-mono text-[11px] font-black text-slate-900">{formatBRL(b.total)}</span>
      </div>
    </div>
  );
};
