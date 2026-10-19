import React from 'react';
import { Bell, ClipboardCheck, Flame, ShoppingBag, Bike, CheckCheck, CircleX, ClockAlert } from 'lucide-react';
import type { OrderStatus } from '../../types';
import { statusChip, type StatusIconKey } from '../../lib/orders/statusChip';

const ICONS: Record<StatusIconKey, React.ComponentType<{ className?: string }>> = {
  bell: Bell, confirmed: ClipboardCheck, flame: Flame, ready: ShoppingBag, bike: Bike,
  delivered: CheckCheck, cancelled: CircleX, late: ClockAlert,
};

export const StatusIconByKey: React.FC<{ icon: StatusIconKey; className?: string }> = ({ icon, className = 'w-3 h-3' }) => {
  const I = ICONS[icon];
  return <I className={`shrink-0 ${className}`} aria-hidden="true" />;
};

/** Selo de status do painel do dono: ícone + texto (nunca só cor). */
export const OrderStatusChip: React.FC<{ status: OrderStatus; late?: boolean; className?: string }> = ({ status, late, className = '' }) => {
  const c = statusChip(status, late);
  return (
    <span data-testid="order-status-chip" data-status={late ? 'LATE' : status}
      className={`inline-flex items-center gap-0.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${c.className} ${className}`}>
      <StatusIconByKey icon={c.icon} className="w-2.5 h-2.5" />{c.label}
    </span>
  );
};
