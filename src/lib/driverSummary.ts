import { Order } from '../types';

function sameLocalDay(iso: string | undefined, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

/** Entregas concluídas hoje pelo próprio entregador e soma das taxas. */
export function computeDriverDailySummary(orders: Order[], driverId: string | undefined, now: Date = new Date()) {
  if (!driverId) return { deliveredCount: 0, feesTotal: 0 };
  const delivered = orders.filter(o => {
    if (o.status !== 'DELIVERED' || o.driverId !== driverId) return false;
    const deliveredAt = o.statusHistory?.slice().reverse().find(h => h.status === 'DELIVERED');
    return sameLocalDay(deliveredAt?.timestamp || o.updatedAt, now);
  });
  return {
    deliveredCount: delivered.length,
    feesTotal: delivered.reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0),
  };
}
