import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '../../../types';
import { STATUS_COLORS, statusColorStyle, statusColorTokens } from '../statusColors';
import { statusChip } from '../statusChip';
import { orderStatusColors } from '../../../components/establishment/ordersKanban';
import { TABLE_STATUS_COLOR } from '../../salon/tableStatus';
import { waiterOrderStatus } from '../../../pages/waiter/waiterLogic';
import { dineInStatus } from '../../customer/dineInTracking';

describe('tokens compartilhados de status', () => {
  it('preserva os hex reais do Kanban e distingue conta pedida, PIX e Livre', () => {
    expect(Object.fromEntries(['PENDING', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED', 'BILL', 'AWAITING_PAYMENT', 'FREE']
      .map(status => [status, statusColorTokens(status)]))).toMatchInlineSnapshot(`
      {
        "AWAITING_PAYMENT": {
          "bg": "#f0f9ff",
          "border": "#7dd3fc",
          "fg": "#0c4a6e",
          "solid": "#0369a1",
        },
        "BILL": {
          "bg": "#F3E9DF",
          "border": "#8B5E3C",
          "fg": "#593820",
          "solid": "#8B5E3C",
        },
        "CANCELLED": {
          "bg": "#f0f1f2",
          "border": "#caccd1",
          "fg": "#374151",
          "solid": "#6b7280",
        },
        "DELIVERED": {
          "bg": "#e8f6ed",
          "border": "#abdebe",
          "fg": "#15803d",
          "solid": "#16a34a",
        },
        "FREE": {
          "bg": "#f0fdfa",
          "border": "#99f6e4",
          "fg": "#134e4a",
          "solid": "#0f766e",
        },
        "PENDING": {
          "bg": "#fdecec",
          "border": "#f9bcbc",
          "fg": "#b91c1c",
          "solid": "#ef4444",
        },
        "PREPARING": {
          "bg": "#fef1e7",
          "border": "#fdcdab",
          "fg": "#c2410c",
          "solid": "#f97316",
        },
        "READY": {
          "bg": "#f6eefe",
          "border": "#e0c2fc",
          "fg": "#7e22ce",
          "solid": "#a855f7",
        },
      }
    `);
    expect(STATUS_COLORS.AUTHORIZED).toBe(STATUS_COLORS.BILL);
    expect(STATUS_COLORS.AWAITING_PAYMENT.solid).not.toBe(STATUS_COLORS.FREE.solid);
  });

  it.each<OrderStatus>(['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'WAITING_FOR_DRIVER', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'])('%s é o mesmo token em selo, kanban, garçom e cliente', status => {
    const tokens = statusColorTokens(status);
    expect(statusChip(status).colors).toBe(tokens);
    expect(statusChip(status, false, 'DINE_IN').colors).toBe(tokens);
    expect(waiterOrderStatus(status).colors).toBe(tokens);
    expect(orderStatusColors(status)).toMatchObject({ color: tokens.solid, tint: tokens.bg, ink: tokens.fg, border: tokens.border });
    expect(dineInStatus(status)).toMatchObject({ color: tokens.solid, tint: tokens.bg, ink: tokens.fg });
    expect(statusColorStyle(status)).toEqual(statusColorStyle(tokens));
  });

  it('mesas e aliases consomem os tokens canônicos sem uma paleta concorrente', () => {
    expect(TABLE_STATUS_COLOR.NEW_ORDER).toBe(STATUS_COLORS.PENDING.solid);
    expect(TABLE_STATUS_COLOR.PREPARING).toBe(STATUS_COLORS.PREPARING.solid);
    expect(TABLE_STATUS_COLOR.READY).toBe(STATUS_COLORS.READY.solid);
    expect(TABLE_STATUS_COLOR.BILL).toBe(STATUS_COLORS.BILL.solid);
    expect(TABLE_STATUS_COLOR.AWAITING_PAYMENT).toBe(STATUS_COLORS.AWAITING_PAYMENT.solid);
    expect(statusColorTokens('ACCEPTED')).toBe(STATUS_COLORS.PREPARING);
    expect(statusColorTokens('COMPLETED')).toBe(STATUS_COLORS.DELIVERED);
    expect(statusColorTokens('REJECTED')).toBe(STATUS_COLORS.CANCELLED);
    expect(statusColorTokens('toString')).toBe(STATUS_COLORS.PENDING);
  });
});
