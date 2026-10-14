import { describe, it, expect } from 'vitest';
import { filterAssignedDriverOrders } from '../driverOrders';
import { Order } from '../../types';

const DRV_A = '00000000-0000-4000-8000-00000000000a';
const DRV_B = '00000000-0000-4000-8000-00000000000b';
const o = (id: string, status: string, driverId?: string) => ({ id, status, driverId } as unknown as Order);
const orders = [
  o('1', 'OUT_FOR_DELIVERY', DRV_A),
  o('2', 'PREPARING', DRV_B),
  o('3', 'OUT_FOR_DELIVERY', DRV_B),
  o('4', 'PREPARING', undefined),
  o('5', 'PREPARING', DRV_A),
];

describe('filterAssignedDriverOrders', () => {
  it('driver A vê só os próprios pedidos', () => {
    expect(filterAssignedDriverOrders(orders, DRV_A).map(x => x.id)).toEqual(['1', '5']);
  });
  it('driver B vê só os próprios pedidos', () => {
    expect(filterAssignedDriverOrders(orders, DRV_B).map(x => x.id)).toEqual(['2', '3']);
  });
  it('pedidos sem entregador ou sem identidade não aparecem', () => {
    expect(filterAssignedDriverOrders(orders, undefined)).toEqual([]);
    expect(filterAssignedDriverOrders(orders, DRV_A).some(x => x.id === '4')).toBe(false);
  });
});

import { driverOrderHistory } from '../driverOrders';
describe('driverOrderHistory (fix PWA)', () => {
  const mk = (id: string, driverId: string | undefined, status: string, updatedAt: string) =>
    ({ id, driverId, status, updatedAt, createdAt: updatedAt } as any);
  it('só pedidos do próprio entregador, encerrados, mais recentes primeiro', () => {
    const orders = [
      mk('a', 'u1', 'DELIVERED', '2026-10-14T10:00:00Z'),
      mk('b', 'u2', 'DELIVERED', '2026-10-14T11:00:00Z'),
      mk('c', 'u1', 'OUT_FOR_DELIVERY', '2026-10-14T12:00:00Z'),
      mk('d', 'u1', 'CANCELLED', '2026-10-14T13:00:00Z'),
      mk('e', undefined, 'DELIVERED', '2026-10-14T14:00:00Z'),
    ];
    expect(driverOrderHistory(orders, 'u1').map(o => o.id)).toEqual(['d', 'a']);
    expect(driverOrderHistory(orders, undefined)).toEqual([]);
  });
});
