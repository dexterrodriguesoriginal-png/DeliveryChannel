import type { Order } from '../../types';

/** Tentativa que não virou pedido de fato: cancelado sem pagamento (ex.: PIX não pago / pagamento recusado). */
export function isFailedAttempt(o: Pick<Order, 'status' | 'paymentStatus'>): boolean {
  return o.status === 'CANCELLED' && o.paymentStatus !== 'PAID' && o.paymentStatus !== 'REFUNDED';
}

function itemsSignature(o: Pick<Order, 'items'>): string {
  return (o.items || [])
    .map(i => `${i.productId}x${i.quantity}`)
    .sort()
    .join('|');
}

export type HistoryEntry<O extends Order = Order> =
  | { kind: 'order'; order: O }
  | { kind: 'failedGroup'; orders: O[]; latest: O };

export interface HistoryDayGroup<O extends Order = Order> {
  dayKey: string;
  label: string;
  entries: HistoryEntry<O>[];
}

const TZ = 'America/Sao_Paulo';
const dayKeyOf = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });

export function dayLabel(dayKey: string, nowMs: number = Date.now()): string {
  const today = dayKeyOf(new Date(nowMs).toISOString());
  const yesterday = dayKeyOf(new Date(nowMs - 864e5).toISOString());
  if (dayKey === today) return 'Hoje';
  if (dayKey === yesterday) return 'Ontem';
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const s = dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long', timeZone: 'UTC' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Histórico por dia (mais recente primeiro). Tentativas falhas CONSECUTIVAS com os mesmos itens no mesmo dia
 * viram um único grupo ("3 tentativas de pagamento não concluídas") em vez de repetir o mesmo card.
 */
export function groupOrderHistory<O extends Order>(orders: O[], nowMs: number = Date.now()): HistoryDayGroup<O>[] {
  const sorted = [...orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const days: HistoryDayGroup<O>[] = [];
  for (const o of sorted) {
    const key = dayKeyOf(o.createdAt);
    let day = days[days.length - 1];
    if (!day || day.dayKey !== key) {
      day = { dayKey: key, label: dayLabel(key, nowMs), entries: [] };
      days.push(day);
    }
    const last = day.entries[day.entries.length - 1];
    if (isFailedAttempt(o) && last) {
      const lastOrder = last.kind === 'order' ? last.order : last.latest;
      if (isFailedAttempt(lastOrder) && itemsSignature(lastOrder) === itemsSignature(o)) {
        day.entries[day.entries.length - 1] = last.kind === 'order'
          ? { kind: 'failedGroup', orders: [last.order, o], latest: last.order }
          : { kind: 'failedGroup', orders: [...last.orders, o], latest: last.latest };
        continue;
      }
    }
    day.entries.push({ kind: 'order', order: o });
  }
  return days;
}
