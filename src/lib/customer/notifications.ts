import type { Order, OrderStatus } from '../../types';

export interface CustomerNotification {
  id: string;
  orderId: string;
  orderNumber: number;
  status: OrderStatus;
  title: string;
  body: string;
  at: string;
  unread: boolean;
}

const TEXT: Partial<Record<OrderStatus, { title: string; body: (n: number, pickup: boolean) => string }>> = {
  PENDING: { title: 'Pedido recebido', body: n => `Seu pedido #${n} chegou na loja. Aguarde a confirmação.` },
  CONFIRMED: { title: 'Pedido confirmado', body: n => `A loja confirmou o pedido #${n}.` },
  PREPARING: { title: 'Em preparo', body: n => `O pedido #${n} está sendo preparado.` },
  READY: { title: 'Pedido pronto', body: (n, pickup) => (pickup ? `O pedido #${n} está pronto para retirada.` : `O pedido #${n} está pronto e logo sai para entrega.`) },
  WAITING_FOR_DRIVER: { title: 'Chamando entregador', body: n => `Estamos chamando um entregador para o pedido #${n}.` },
  OUT_FOR_DELIVERY: { title: 'Saiu para entrega', body: n => `O pedido #${n} está a caminho. Tenha o código de entrega em mãos.` },
  DELIVERED: { title: 'Pedido entregue', body: n => `O pedido #${n} foi entregue. Bom apetite!` },
  CANCELLED: { title: 'Pedido cancelado', body: n => `O pedido #${n} foi cancelado. Fale com a loja se tiver dúvidas.` },
};

/**
 * Central de notificações a partir do histórico de status que o próprio cliente já pode ler
 * (RLS order_status_history_customer_select). Sem nota/autor da mudança. Mais recente primeiro.
 */
export function buildNotifications(orders: Order[], seenAtMs: number, limit = 50): CustomerNotification[] {
  const out: CustomerNotification[] = [];
  for (const o of orders) {
    const hist = o.statusHistory && o.statusHistory.length > 0
      ? o.statusHistory
      : [{ status: o.status, timestamp: o.updatedAt || o.createdAt, changedBy: '' }];
    const seen = new Set<string>();
    for (const h of hist) {
      const t = TEXT[h.status];
      if (!t || seen.has(h.status)) continue;
      seen.add(h.status);
      const at = h.timestamp || o.createdAt;
      const n = o.orderNumber || 0;
      out.push({
        id: `${o.id}:${h.status}`,
        orderId: o.id,
        orderNumber: n,
        status: h.status,
        title: t.title,
        body: t.body(n, o.fulfillmentType === 'PICKUP'),
        at,
        unread: new Date(at).getTime() > seenAtMs,
      });
    }
  }
  return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, limit);
}
