import type { OrderStatus } from '../../types';

export interface StatusColorTokens { bg: string; fg: string; border: string; solid: string }

// Canonical palette from the Pedidos Kanban. Borders are its 36% solid / 64%
// white sRGB mix, rounded to hex so every surface has exactly the same values.
const waiting = { bg: '#fdecec', fg: '#b91c1c', border: '#f9bcbc', solid: '#ef4444' } as const;
const production = { bg: '#fef1e7', fg: '#c2410c', border: '#fdcdab', solid: '#f97316' } as const;
const ready = { bg: '#f6eefe', fg: '#7e22ce', border: '#e0c2fc', solid: '#a855f7' } as const;
const delivered = { bg: '#e8f6ed', fg: '#15803d', border: '#abdebe', solid: '#16a34a' } as const;
const cancelled = { bg: '#f0f1f2', fg: '#374151', border: '#caccd1', solid: '#6b7280' } as const;
const bill = { bg: '#8B5A2B', fg: '#FFFFFF', border: '#5C3A1B', solid: '#8B5A2B' } as const;
const authorized = { bg: '#9B4DE0', fg: '#FFFFFF', border: '#6B21A8', solid: '#9B4DE0' } as const;
const awaitingPayment = { bg: '#8B5A2B', fg: '#FFFFFF', border: '#FF5050', solid: '#8B5A2B' } as const;

export type StatusColorKey = OrderStatus | 'NEW_ORDER' | 'FREE' | 'OCCUPIED' | 'LONG_STAY' | 'BILL' | 'AUTHORIZED' | 'AWAITING_PAYMENT' | 'LATE';
export const STATUS_COLORS: Readonly<Record<StatusColorKey, Readonly<StatusColorTokens>>> = {
  PENDING: waiting, CONFIRMED: waiting, NEW_ORDER: waiting,
  PREPARING: production,
  READY: ready, WAITING_FOR_DRIVER: ready, OUT_FOR_DELIVERY: ready,
  DELIVERED: delivered, CANCELLED: cancelled,
  BILL: bill, AUTHORIZED: authorized,
  AWAITING_PAYMENT: awaitingPayment,
  FREE: { bg: '#2DBE4E', fg: '#0F172A', border: '#1E8E38', solid: '#2DBE4E' },
  OCCUPIED: { bg: '#FFDD00', fg: '#0F172A', border: '#CA8A04', solid: '#FFDD00' },
  LONG_STAY: { bg: '#FF5050', fg: '#0F172A', border: '#B91C1C', solid: '#FF5050' },
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
