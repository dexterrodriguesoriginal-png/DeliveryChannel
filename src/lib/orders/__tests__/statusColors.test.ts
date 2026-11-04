import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '../../../types';
import { STATUS_COLORS, statusColorStyle, statusColorTokens } from '../statusColors';
import { statusChip } from '../statusChip';
import { orderStatusColors } from '../../../components/establishment/ordersKanban';
import { SALON_TABLE_COLORS, TABLE_STATUS_COLOR, tableColorTokens } from '../../salon/tableStatus';
import { waiterOrderStatus } from '../../../pages/waiter/waiterLogic';
import { dineInStatus } from '../../customer/dineInTracking';

describe('tokens compartilhados de status', () => {
  it('preserva os hex reais do Kanban e distingue conta pedida, autorizado, PIX e Livre', () => {
    expect(Object.fromEntries(['PENDING', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED', 'BILL', 'AUTHORIZED', 'AWAITING_PAYMENT', 'FREE']
      .map(status => [status, statusColorTokens(status)]))).toMatchInlineSnapshot(`
        {
          "AUTHORIZED": {
            "bg": "#9B4DE0",
            "border": "#6B21A8",
            "fg": "#FFFFFF",
            "solid": "#9B4DE0",
          },
          "AWAITING_PAYMENT": {
            "bg": "#8B5A2B",
            "border": "#FF5050",
            "fg": "#FFFFFF",
            "solid": "#8B5A2B",
          },
          "BILL": {
            "bg": "#8B5A2B",
            "border": "#5C3A1B",
            "fg": "#FFFFFF",
            "solid": "#8B5A2B",
          },
          "CANCELLED": {
            "alertBg": "#e4e6e9",
            "bg": "#f0f1f2",
            "border": "#caccd1",
            "fg": "#374151",
            "solid": "#6b7280",
          },
          "DELIVERED": {
            "alertBg": "#d3efdd",
            "bg": "#e8f6ed",
            "border": "#abdebe",
            "fg": "#15803d",
            "solid": "#16a34a",
          },
          "FREE": {
            "bg": "#2DBE4E",
            "border": "#1E8E38",
            "fg": "#0F172A",
            "solid": "#2DBE4E",
          },
          "PENDING": {
            "alertBg": "#fbd5d5",
            "bg": "#fdecec",
            "border": "#f9bcbc",
            "fg": "#b91c1c",
            "solid": "#ef4444",
          },
          "PREPARING": {
            "alertBg": "#fee2cc",
            "bg": "#fef1e7",
            "border": "#fdcdab",
            "fg": "#c2410c",
            "solid": "#f97316",
          },
          "READY": {
            "alertBg": "#ecdcfc",
            "bg": "#f6eefe",
            "border": "#e0c2fc",
            "fg": "#7e22ce",
            "solid": "#a855f7",
          },
        }
      `);
    expect(STATUS_COLORS.AUTHORIZED.solid).toBe('#9B4DE0');
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

  it('mesas consomem a paleta sólida com contraste AA e aliases funcionam', () => {
    expect(TABLE_STATUS_COLOR.FREE).toBe('#2DBE4E');
    expect(TABLE_STATUS_COLOR.OCCUPIED).toBe('#FFDD00');
    // Entrega 1.5: mesas seguem as cores de Pedidos (fonte única STATUS_COLORS).
    expect(TABLE_STATUS_COLOR.NEW_ORDER).toBe(STATUS_COLORS.CONFIRMED.solid);
    expect(TABLE_STATUS_COLOR.NEW_ORDER).toBe('#ef4444');
    expect(TABLE_STATUS_COLOR.PREPARING).toBe(STATUS_COLORS.PREPARING.solid);
    expect(TABLE_STATUS_COLOR.PREPARING).toBe('#f97316');
    expect(TABLE_STATUS_COLOR.READY).toBe(STATUS_COLORS.READY.solid);
    expect(TABLE_STATUS_COLOR.READY).toBe('#a855f7');
    expect(TABLE_STATUS_COLOR.BILL).toBe('#8B5A2B');
    expect(TABLE_STATUS_COLOR.AUTHORIZED).toBe('#8B5A2B');
    expect(TABLE_STATUS_COLOR.LONG_STAY).toBe(TABLE_STATUS_COLOR.OCCUPIED); // ocupada é sempre amarela, só o tempo muda
    expect(TABLE_STATUS_COLOR.BILL).toBe('#8B5A2B');
    expect(TABLE_STATUS_COLOR.AUTHORIZED).toBe('#8B5A2B');
    expect(TABLE_STATUS_COLOR.AWAITING_PAYMENT).toBe('#8B5A2B');
    expect(tableColorTokens('AWAITING_PAYMENT').border).toBe('#FF5050');
    expect(SALON_TABLE_COLORS.FREE.fg).toBe('#0F172A');
    expect(SALON_TABLE_COLORS.BILL.fg).toBe('#FFFFFF');
    expect(SALON_TABLE_COLORS.AUTHORIZED.fg).toBe('#FFFFFF');
    expect(statusColorTokens('ACCEPTED')).toBe(STATUS_COLORS.PREPARING);
    expect(statusColorTokens('COMPLETED')).toBe(STATUS_COLORS.DELIVERED);
    expect(statusColorTokens('REJECTED')).toBe(STATUS_COLORS.CANCELLED);
    expect(statusColorTokens('toString')).toBe(STATUS_COLORS.PENDING);
  });
});
