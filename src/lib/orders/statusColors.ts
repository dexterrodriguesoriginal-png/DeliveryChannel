import type { OrderStatus } from '../../types';

export interface StatusColorTokens { bg: string; fg: string; border: string; solid: string }

// Canonical palette from the Pedidos Kanban. Borders are its 36% solid / 64%
// white sRGB mix, rounded to hex so every surface has exactly the same values.
const waiting = { bg: '#fdecec', fg: '#b91c1c', border: '#f9bcbc', solid: '#ef4444' } as const;
const production = { bg: '#fef1e7', fg: '#c2410c', border: '#fdcdab', solid: '#f97316' } as const;
const ready = { bg: '#f6eefe', fg: '#7e22ce', border: '#e0c2fc', solid: '#a855f7' } as const;
const delivered = { bg: '#e8f6ed', fg: '#15803d', border: '#abdebe', solid: '#16a34a' } as const;
const cancelled = { bg: '#f0f1f2', fg: '#374151', border: '#caccd1', solid: '#6b7280' } as const;
const bill = { bg: '#F3E9DF', fg: '#593820', border: '#8B5E3C', solid: '#8B5E3C' } as const;

export type StatusColorKey = OrderStatus | 'NEW_ORDER' | 'FREE' | 'OCCUPIED' | 'LONG_STAY' | 'BILL' | 'AUTHORIZED' | 'AWAITING_PAYMENT' | 'LATE';
export const STATUS_COLORS: Readonly<Record<StatusColorKey, Readonly<StatusColorTokens>>> = {
  PENDING: waiting, CONFIRMED: waiting, NEW_ORDER: waiting,
  PREPARING: production,
  READY: ready, WAITING_FOR_DRIVER: ready, OUT_FOR_DELIVERY: ready,
  DELIVERED: delivered, CANCELLED: cancelled,
  BILL: bill, AUTHORIZED: bill,
  AWAITING_PAYMENT: { bg: '#f0f9ff', fg: '#0c4a6e', border: '#7dd3fc', solid: '#0369a1' },
  FREE: { bg: '#f0fdfa', fg: '#134e4a', border: '#99f6e4', solid: '#0f766e' },
  OCCUPIED: { bg: '#fefce8', fg: '#422006', border: '#fde047', solid: '#a16207' },
  LONG_STAY: { bg: '#fef2f2', fg: '#7f1d1d', border: '#fca5a5', solid: '#b91c1c' },
  LATE: { bg: '#dc2626', fg: '#ffffff', border: '#b91c1c', solid: '#dc2626' },
};

export function statusColorTokens(status: string): Readonly<StatusColorTokens> {
  switch (status) {
    case 'ACCEPTED': return STATUS_COLORS.PREPARING;
    case 'SERVED': case 'COMPLETED': return STATUS_COLORS.DELIVERED;
    case 'REJECTED': return STATUS_COLORS.CANCELLED;
    default: return Object.prototype.hasOwnProperty.call(STATUS_COLORS, status)
      ? STATUS_COLORS[status as StatusColorKey] : STATUS_COLORS.PENDING;
  }
}

/** Inline styles keep canonical hex colors independent of Tailwind's palette. */
export function statusColorStyle(status: string | Readonly<StatusColorTokens>) {
  const colors = typeof status === 'string' ? statusColorTokens(status) : status;
  return { backgroundColor: colors.bg, color: colors.fg, borderColor: colors.border };
}
