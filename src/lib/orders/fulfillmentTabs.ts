import type { Order } from '../../types';
import { checkIsPreparingDelayed } from '../../utils/orderStatusTheme';

/** Abas operacionais Entrega | Retirada | Salão no gestor de pedidos. */
export type FulfillmentTab = 'DELIVERY' | 'PICKUP' | 'DINE_IN';

export function tabOf(order: Pick<Order, 'fulfillmentType'>): FulfillmentTab {
  return order.fulfillmentType;
}

export function matchesFulfillmentTab(order: Pick<Order, 'fulfillmentType'>, tab: FulfillmentTab | 'ALL'): boolean {
  return tab === 'ALL' || order.fulfillmentType === tab;
}

export function dineInOrderLabel(order: Pick<Order, 'fulfillmentType' | 'tableLabel' | 'customerName' | 'roundNo'>): string {
  if (order.fulfillmentType !== 'DINE_IN') return order.customerName;
  const guest = order.customerName?.trim();
  const round = order.roundNo ? ` · rodada ${order.roundNo}` : '';
  return `Mesa ${order.tableLabel?.trim() || '—'}${guest ? ` – ${guest}` : ''}${round}`;
}

export function resolveDineInTableLabels(orders: Order[], labelsByOrderId: ReadonlyMap<string, string>): Order[] {
  return orders.map(order =>
    order.fulfillmentType === 'DINE_IN' && !order.tableLabel && labelsByOrderId.has(order.id)
      ? { ...order, tableLabel: labelsByOrderId.get(order.id) }
      : order
  );
}

export interface TabCounts {
  novo: number; preparo: number; pronto: number; rota: number; atrasado: number;
  /** Pedidos que pedem ação da loja (novo + preparo + pronto). */
  acionaveis: number;
}

export function tabCounts(orders: Order[], tab: FulfillmentTab, prepMinutes?: number | null): TabCounts {
  const c: TabCounts = { novo: 0, preparo: 0, pronto: 0, rota: 0, atrasado: 0, acionaveis: 0 };
  for (const o of orders) {
    if (tabOf(o) !== tab) continue;
    if (o.status === 'PENDING') c.novo++;
    else if (o.status === 'CONFIRMED' || o.status === 'PREPARING') {
      c.preparo++;
      if (checkIsPreparingDelayed(o.createdAt, o.status, prepMinutes)) c.atrasado++;
    } else if (o.status === 'READY' || o.status === 'WAITING_FOR_DRIVER') c.pronto++;
    else if (o.status === 'OUT_FOR_DELIVERY') c.rota++;
  }
  c.acionaveis = c.novo + c.preparo + c.pronto;
  return c;
}

/** Cor dominante da aba (padrão KDS): atrasado > novo > pronto > preparo > rota. */
export function tabTone(c: TabCounts): 'red' | 'amber' | 'green' | 'blue' | 'cyan' | 'neutral' {
  if (c.atrasado) return 'red';
  if (c.novo) return 'amber';
  if (c.pronto) return 'green';
  if (c.preparo) return 'blue';
  if (c.rota) return 'cyan';
  return 'neutral';
}

/** Rótulo do botão principal num pedido de RETIRADA (nunca "Despachar"/"Chamar entregador"). */
export function pickupActionLabel(status: Order['status']): string | null {
  switch (status) {
    case 'PENDING': return 'Aceitar';
    case 'CONFIRMED': return 'Iniciar preparo';
    case 'PREPARING': return 'Marcar como pronto';
    case 'READY': return 'Confirmar retirada';
    default: return null;
  }
}

/** Selo de pagamento claro para retirada. */
export function paymentBadge(order: Pick<Order, 'paymentStatus'>): { label: string; paid: boolean } {
  return order.paymentStatus === 'PAID'
    ? { label: 'Pago online', paid: true }
    : { label: 'Pagar na retirada', paid: false };
}

/** Minutos desde que o pedido de retirada ficou PRONTO (null se não está pronto). */
export function pickupWaitingMinutes(order: Pick<Order, 'status' | 'statusHistory' | 'updatedAt'>, now = Date.now()): number | null {
  if (order.status !== 'READY') return null;
  const h = [...(order.statusHistory || [])].reverse().find(x => x.status === 'READY');
  const t = new Date(h?.timestamp || order.updatedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 60000));
}

export function waitingText(min: number): string {
  return `aguardando cliente há ${min} min`;
}
