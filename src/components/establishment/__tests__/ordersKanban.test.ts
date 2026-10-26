import { describe, expect, it } from 'vitest';
import type { Order } from '../../../types';
import { groupKanbanOrders, kanbanColumnForStatus, isDateInOrdersPeriod, matchesOrderSearch } from '../ordersKanban';

const order = (status: string, totalAmount = 10) => ({ status, totalAmount } as Order);
describe('apresentação do Kanban de Pedidos', () => {
  it.each([
    ['PENDING', 'waiting'], ['CONFIRMED', 'waiting'], ['PAID', 'waiting'],
    ['ACCEPTED', 'production'], ['PREPARING', 'production'],
    ['READY', 'ready'], ['WAITING_FOR_DRIVER', 'ready'], ['OUT_FOR_DELIVERY', 'ready'],
    ['DELIVERED', 'delivered'], ['SERVED', 'delivered'], ['COMPLETED', 'delivered'],
    ['CANCELLED', 'cancelled'], ['REJECTED', 'cancelled'], ['UNKNOWN_STATUS', 'waiting'],
  ])('%s aparece em %s sem alterar o status', (status, column) => {
    expect(kanbanColumnForStatus(status)).toBe(column);
  });

  it('agrupa todos os pedidos visíveis uma vez e soma os centavos de cada coluna', () => {
    const visible = [order('PENDING', 0.1), order('CONFIRMED', 0.2), order('PREPARING', 45.9),
      order('READY', 12.5), order('WAITING_FOR_DRIVER', 20), order('OUT_FOR_DELIVERY', 33.33),
      order('DELIVERED', 70), order('CANCELLED', 15), order('FUTURE_STATUS', 1)];
    const groups = groupKanbanOrders(visible);
    expect(Object.fromEntries(Object.entries(groups).map(([key, g]) => [key, [g.count, g.total]]))).toEqual({
      waiting: [3, 1.3], production: [1, 45.9], ready: [3, 65.83], delivered: [1, 70], cancelled: [1, 15],
    });
    expect(Object.values(groups).flatMap(g => g.orders)).toHaveLength(visible.length);
    expect(visible[4].status).toBe('WAITING_FOR_DRIVER');
  });

  it('mantém cinco grupos vazios para não esconder colunas', () => {
    expect(Object.values(groupKanbanOrders([])).map(g => [g.count, g.total])).toEqual(Array(5).fill([0, 0]));
  });
});

describe('filtros exclusivos da tela de Pedidos', () => {
  const sample = { orderNumber: 123, customerName: 'José Silva', customerPhone: '(11) 98765-4321' } as Order;
  it.each(['123', '#123', 'josé', 'SILVA', '1198765', '(11) 98765-4321', ''])('encontra número, nome ou telefone: %s', search => {
    expect(matchesOrderSearch(sample, search)).toBe(true);
  });
  it.each(['Maria', 'xyz', '888888', '#999', 'jose999'])('não aceita uma busca sem correspondência: %s', search => {
    expect(matchesOrderSearch(sample, search)).toBe(false);
  });
  it('aplica os limites de dia local, ontem, sete dias e todos', () => {
    const now = new Date(2026, 9, 26, 12);
    const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();
    expect(isDateInOrdersPeriod(at(26, 0), 'TODAY', now)).toBe(true);
    expect(isDateInOrdersPeriod(at(25, 23), 'TODAY', now)).toBe(false);
    expect(isDateInOrdersPeriod(at(25, 0), 'YESTERDAY', now)).toBe(true);
    expect(isDateInOrdersPeriod(at(26, 0), 'YESTERDAY', now)).toBe(false);
    expect(isDateInOrdersPeriod(at(20, 0), '7D', now)).toBe(true);
    expect(isDateInOrdersPeriod(at(19, 23), '7D', now)).toBe(false);
    expect(isDateInOrdersPeriod(at(27), '7D', now)).toBe(false);
    expect(isDateInOrdersPeriod(at(1), 'ALL', now)).toBe(true);
  });
});
