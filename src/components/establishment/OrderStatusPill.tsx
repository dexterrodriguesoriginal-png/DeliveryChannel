import React from 'react';
import type { OrderStatus } from '../../types';
import { statusChip, LATE_CHIP } from '../../lib/orders/statusChip';
import { StatusIconByKey } from './StatusIcon';
import { orderStatusColors } from './ordersKanban';

/** Selo de status da Lista: mesma cor dos cabeçalhos do Kanban (mapa único), com ícone + texto. */
export const OrderStatusPill: React.FC<{ status: OrderStatus; late?: boolean; className?: string }> = ({ status, late, className = '' }) => {
  const colors = orderStatusColors(status);
  const chip = statusChip(status, late);
  const style = late ? { backgroundColor: '#991b1b', color: '#fff' } : { backgroundColor: colors.color, color: '#fff' };
  return (
    <span data-testid="order-status-chip" data-status={late ? 'LATE' : status} data-column={colors.column} title={late ? LATE_CHIP.label : colors.label}
      className={`orders-status-pill ${className}`} style={style}>
      <StatusIconByKey icon={chip.icon} className="h-3.5 w-3.5" />{chip.label}
    </span>
  );
};
