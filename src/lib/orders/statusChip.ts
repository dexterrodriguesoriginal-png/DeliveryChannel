import type { FulfillmentType, OrderStatus } from '../../types';
import { STATUS_COLORS, statusColorTokens, type StatusColorTokens } from './statusColors';

/** Every order surface uses the Pedidos Kanban palette, with icon and text. */
export type StatusIconKey = 'bell' | 'confirmed' | 'flame' | 'ready' | 'bike' | 'delivered' | 'cancelled' | 'late';
export interface StatusChip { label: string; className: string; icon: StatusIconKey; colors: Readonly<StatusColorTokens> }
const COLOR_CLASS = 'order-status-colors';
const chip = (status: OrderStatus, label: string, icon: StatusIconKey): StatusChip => ({
  label, icon, className: COLOR_CLASS, colors: statusColorTokens(status),
});
const CHIP: Record<OrderStatus, StatusChip> = {
  PENDING: chip('PENDING', 'NOVO', 'bell'),
  CONFIRMED: chip('CONFIRMED', 'CONFIRMADO', 'confirmed'),
  PREPARING: chip('PREPARING', 'EM PREPARO', 'flame'),
  READY: chip('READY', 'PRONTO', 'ready'),
  WAITING_FOR_DRIVER: chip('WAITING_FOR_DRIVER', 'PRONTO', 'ready'),
  OUT_FOR_DELIVERY: chip('OUT_FOR_DELIVERY', 'EM ROTA', 'bike'),
  DELIVERED: chip('DELIVERED', 'ENTREGUE', 'delivered'),
  CANCELLED: chip('CANCELLED', 'CANCELADO', 'cancelled'),
};
export const LATE_CHIP: StatusChip = { label: 'ATRASADO', icon: 'late', className: COLOR_CLASS, colors: STATUS_COLORS.LATE };
const DINE_IN_CHIP: Partial<Record<OrderStatus, StatusChip>> = {
  PENDING: chip('PENDING', 'AGUARDANDO', 'bell'),
  CONFIRMED: chip('CONFIRMED', 'ACEITO', 'confirmed'),
  READY: chip('READY', 'AGUARDANDO GARÇOM', 'ready'),
  OUT_FOR_DELIVERY: chip('OUT_FOR_DELIVERY', 'INDO ATÉ A MESA', 'ready'),
};

export function statusChip(status: OrderStatus, late = false, fulfillmentType?: FulfillmentType): StatusChip {
  if (late) return LATE_CHIP;
  if (fulfillmentType === 'DINE_IN' && DINE_IN_CHIP[status]) return DINE_IN_CHIP[status]!;
  return CHIP[status] ?? CHIP.PENDING;
}

/** Kept for callers' layout classes; colors come from the matching shared token. */
export const FILTER_CHIP_CLASS = {
  novos: COLOR_CLASS, emPreparo: COLOR_CLASS, prontos: COLOR_CLASS, atrasados: COLOR_CLASS,
  estoque: 'bg-orange-50 text-orange-800 border-orange-300',
} as const;
export const FILTER_CHIP_COLORS = {
  novos: STATUS_COLORS.PENDING, emPreparo: STATUS_COLORS.PREPARING, prontos: STATUS_COLORS.READY,
  atrasados: STATUS_COLORS.LATE, estoque: STATUS_COLORS.PREPARING,
} as const;
