import { describe, it, expect } from 'vitest';
import { buildDeliveryCountByUserId, deliveryCountForDriver } from '../driverDeliveryCounts';

describe('driver delivery counts', () => {
  const deliveries = [{ driver_id: 'user-a' }, { driver_id: 'user-a' }, { driver_id: 'user-b' }, { driver_id: null }];
  const map = buildDeliveryCountByUserId(deliveries);

  it('keys by orders.driver_id (auth user id)', () => {
    expect(map).toEqual({ 'user-a': 2, 'user-b': 1 });
  });
  it('reads back by drivers.user_id, not drivers.id', () => {
    expect(deliveryCountForDriver(map, { user_id: 'user-a' })).toBe(2);
    expect(deliveryCountForDriver({ 'drv-row-1': 5 }, { user_id: 'user-a' })).toBe(0);
  });
  it('isolates drivers: no cross-count and missing user_id gives 0', () => {
    expect(deliveryCountForDriver(map, { user_id: 'user-c' })).toBe(0);
    expect(deliveryCountForDriver(map, { user_id: null })).toBe(0);
    expect(buildDeliveryCountByUserId(null)).toEqual({});
  });
});
