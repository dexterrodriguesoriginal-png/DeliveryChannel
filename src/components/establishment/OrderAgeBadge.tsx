import React from 'react';
import { Clock, AlertTriangle } from 'lucide-react';
import type { Order } from '../../types';
import { orderAgeInfo } from '../../lib/orders/orderAge';

interface Props {
  order: Pick<Order, 'createdAt' | 'status'>;
  now?: number;
  className?: string;
}

/** Selo "recebido há ..." para pedido em aberto há 30 min ou mais (âmbar) ou 1 dia ou mais (vermelho). */
export const OrderAgeBadge: React.FC<Props> = ({ order, now, className = '' }) => {
  const info = orderAgeInfo(order, now ?? Date.now());
  if (!info.show) return null;
  const stale = info.level === 'stale';
  return (
    <span
      data-testid="order-age-badge"
      data-level={info.level}
      title={stale ? 'Pedido em aberto há mais de 1 dia: confira se ainda é válido ou cancele.' : 'Pedido em aberto há mais de 30 minutos.'}
      className={`inline-flex items-center gap-0.5 px-1 py-px rounded border font-bold text-[8.5px] leading-tight whitespace-nowrap ${
        stale ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-amber-50 text-amber-800 border-amber-300'
      } ${className}`}
    >
      {stale ? <AlertTriangle className="w-2.5 h-2.5 shrink-0" /> : <Clock className="w-2.5 h-2.5 shrink-0" />}
      {info.label}
    </span>
  );
};
