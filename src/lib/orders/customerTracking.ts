/**
 * Linha do tempo do pedido para o CLIENTE ("Acompanhar Meus Pedidos").
 *
 * Fontes usadas (todas já legíveis pelo cliente, sem mudança de banco):
 *  - orders.status (RLS orders_customer_select);
 *  - order_status_history.status + created_at (RLS order_status_history_customer_select).
 *    Nunca note/changed_by (nome de funcionário/entregador).
 *
 * Etapas de motoboy:
 *  - Hoje assign_order_to_driver leva o pedido direto de READY/WAITING_FOR_DRIVER para OUT_FOR_DELIVERY,
 *    então "motoboy aceitou" e "indo retirar" ficam concluídas no mesmo instante do despacho.
 *  - Compatível com a proposta /workspace/proposals/tracking_cliente_etapas.md: se o histórico trouxer
 *    DRIVER_ACCEPTED/DRIVER_ASSIGNED (e DRIVER_RELEASED ao desatribuir) com o pedido ainda em WAITING_FOR_DRIVER,
 *    "Motoboy aceitou" conclui e "Motoboy indo retirar" fica em andamento até a retirada (OUT_FOR_DELIVERY).
 */
import type { Order } from '../../types';

export type TrackingStepKey =
  | 'received'
  | 'store_accepted'
  | 'preparing'
  | 'ready'
  | 'driver_accepted'
  | 'driver_to_store'
  | 'out_for_delivery'
  | 'delivered';

export type TrackingStepState = 'done' | 'current' | 'pending';

export interface TrackingStep {
  key: TrackingStepKey;
  label: string;
  state: TrackingStepState;
  /** ISO do momento em que a etapa foi alcançada (quando conhecido). */
  at?: string;
}

export interface CustomerTimeline {
  cancelled: boolean;
  cancelledAt?: string;
  delivered: boolean;
  steps: TrackingStep[];
  current?: TrackingStep;
  /** Frase curta do estado atual, para o selo do cartão. */
  headline: string;
}

const RANK: Record<string, number> = {
  PENDING: 0,
  CONFIRMED: 1,
  PREPARING: 2,
  READY: 3,
  WAITING_FOR_DRIVER: 4,
  OUT_FOR_DELIVERY: 5,
  DELIVERED: 6,
};

function rankOf(status: string | undefined | null): number {
  const r = RANK[String(status || '').toUpperCase()];
  return r === undefined ? -1 : r;
}

type HistoryLike = { status: string; timestamp: string };

function sortedHistory(order: Pick<Order, 'statusHistory'>): HistoryLike[] {
  return [...(order.statusHistory || [])]
    .filter(h => h && h.status && h.timestamp)
    .map(h => ({ status: String(h.status).toUpperCase(), timestamp: h.timestamp }))
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

/** Primeiro registro do histórico com rank >= minRank. */
function firstReached(history: HistoryLike[], minRank: number): string | undefined {
  return history.find(h => rankOf(h.status) >= minRank)?.timestamp;
}

function lastIndexOf(history: HistoryLike[], status: string): number {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].status === status) return i;
  return -1;
}

export function buildCustomerTimeline(
  order: Pick<Order, 'status' | 'fulfillmentType' | 'createdAt' | 'statusHistory'>
): CustomerTimeline {
  const status = String(order.status || 'PENDING').toUpperCase();
  const rank = rankOf(status);
  const history = sortedHistory(order);
  const isPickup = order.fulfillmentType === 'PICKUP';
  const cancelled = status === 'CANCELLED';
  const delivered = status === 'DELIVERED';

  // Rank efetivo para pedido cancelado: até onde chegou antes do cancelamento.
  const effectiveRank = cancelled
    ? history.reduce((m, h) => Math.max(m, rankOf(h.status)), 0)
    : Math.max(rank, 0);

  // Motoboy aceitou: pedido já saiu (rank >= OUT_FOR_DELIVERY) OU evento DRIVER_ACCEPTED não desfeito.
  const iAccepted = Math.max(lastIndexOf(history, 'DRIVER_ACCEPTED'), lastIndexOf(history, 'DRIVER_ASSIGNED'));
  const iReleased = lastIndexOf(history, 'DRIVER_RELEASED');
  const acceptedEvent = iAccepted >= 0 && iAccepted > iReleased && effectiveRank >= RANK.READY;
  const driverAccepted = effectiveRank >= RANK.OUT_FOR_DELIVERY || acceptedEvent;
  const driverAcceptedAt = acceptedEvent
    ? history[iAccepted].timestamp
    : firstReached(history, RANK.OUT_FOR_DELIVERY);

  type Def = { key: TrackingStepKey; label: string; done: boolean; at?: string };
  const defs: Def[] = [
    { key: 'received', label: 'Pedido recebido', done: true, at: order.createdAt || history[0]?.timestamp },
    { key: 'store_accepted', label: 'Loja aceitou', done: effectiveRank >= RANK.CONFIRMED, at: firstReached(history, RANK.CONFIRMED) },
    { key: 'preparing', label: 'Em preparo', done: effectiveRank >= RANK.PREPARING, at: firstReached(history, RANK.PREPARING) },
  ];

  if (isPickup) {
    defs.push(
      { key: 'ready', label: 'Pronto para retirada', done: effectiveRank >= RANK.READY, at: firstReached(history, RANK.READY) },
      { key: 'delivered', label: 'Retirado', done: effectiveRank >= RANK.DELIVERED, at: firstReached(history, RANK.DELIVERED) },
    );
  } else {
    defs.push(
      {
        key: 'ready',
        label: status === 'WAITING_FOR_DRIVER' && !driverAccepted ? 'Pronto • chamando motoboy' : 'Pronto',
        done: effectiveRank >= RANK.READY,
        at: firstReached(history, RANK.READY),
      },
      { key: 'driver_accepted', label: 'Motoboy aceitou', done: driverAccepted, at: driverAccepted ? driverAcceptedAt : undefined },
      {
        key: 'driver_to_store',
        label: 'Motoboy indo retirar',
        done: effectiveRank >= RANK.OUT_FOR_DELIVERY,
        at: driverAccepted ? driverAcceptedAt : undefined,
      },
      {
        key: 'out_for_delivery',
        label: 'A caminho de você (saiu para entrega)',
        done: effectiveRank >= RANK.OUT_FOR_DELIVERY,
        at: firstReached(history, RANK.OUT_FOR_DELIVERY),
      },
      { key: 'delivered', label: 'Entregue', done: effectiveRank >= RANK.DELIVERED, at: firstReached(history, RANK.DELIVERED) },
    );
  }

  // Etapa ATUAL ("agora") = a que corresponde ao status atual do pedido, ou seja, a última etapa já
  // alcançada (PREPARING → "Em preparo", READY → "Pronto", OUT_FOR_DELIVERY → "A caminho de você").
  // Nunca a próxima etapa ainda não alcançada. Caso especial: motoboy aceitou e ainda não retirou
  // → "Motoboy indo retirar" é o que está acontecendo agora.
  let currentIdx = -1;
  if (!cancelled && !delivered) {
    for (let i = defs.length - 1; i >= 0; i--) {
      if (defs[i].done) { currentIdx = i; break; }
    }
    if (!isPickup && acceptedEvent && effectiveRank < RANK.OUT_FOR_DELIVERY) {
      currentIdx = defs.findIndex(d => d.key === 'driver_to_store');
    }
  }

  const steps: TrackingStep[] = defs.map((d, i) => {
    let state: TrackingStepState = d.done ? 'done' : 'pending';
    if (i === currentIdx) state = 'current';
    return { key: d.key, label: d.label, state, at: d.done || i === currentIdx ? d.at : undefined };
  });
  const current = currentIdx >= 0 ? steps[currentIdx] : undefined;

  let headline: string;
  if (cancelled) headline = 'Pedido cancelado';
  else if (delivered) headline = isPickup ? 'Pedido retirado' : 'Pedido entregue';
  else if (status === 'PENDING') headline = 'Recebido • aguardando a loja aceitar';
  else if (current?.key === 'driver_to_store') headline = 'Motoboy a caminho da loja';
  else if (current?.key === 'out_for_delivery') headline = 'Motoboy a caminho de você';
  else if (current?.key === 'driver_accepted') headline = 'Motoboy aceitou';
  else if (current?.key === 'ready') {
    headline = isPickup ? 'Pronto para retirada' : status === 'WAITING_FOR_DRIVER' ? 'Procurando motoboy' : 'Pedido pronto';
  }
  else if (current?.key === 'preparing') headline = 'Em preparo';
  else if (current?.key === 'store_accepted') headline = 'Loja aceitou seu pedido';
  else headline = current?.label || 'Em andamento';

  const cancelledAt = cancelled ? [...history].reverse().find(h => h.status === 'CANCELLED')?.timestamp : undefined;

  return { cancelled, cancelledAt, delivered, steps, current, headline };
}
