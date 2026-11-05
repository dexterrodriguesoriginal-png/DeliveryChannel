export interface DeliveryDispute {
  id: string;
  status: 'OPEN' | 'CONFIRMED_DELIVERED' | 'RESENT';
  createdAt: string;
  resolvedAt?: string | null;
}

export interface DeliveryState {
  status: string;
  deliveredAt?: string | null;
  deliveryDispute?: DeliveryDispute | null;
  canDisputeDelivery?: boolean;
  deliveryCode?: string | null;
  deliveryConfirmedWithCode?: boolean;
}

export const DELIVERY_DISPUTE_WINDOW_MS = 5 * 60 * 1000;

/** Server permission is mandatory; the local deadline only removes a stale action. */
export function canDisputeDelivery(round: DeliveryState, now = Date.now()): boolean {
  if (round.deliveryConfirmedWithCode) return false;
  const delivered = Date.parse(round.deliveredAt || '');
  return round.status === 'DELIVERED' && round.canDisputeDelivery === true && !round.deliveryDispute
    && Number.isFinite(delivered) && now < delivered + DELIVERY_DISPUTE_WINDOW_MS;
}

export function deliveryNoticeLabel(round: DeliveryState, now = Date.now()): string {
  if (round.deliveryConfirmedWithCode) return 'Entrega confirmada com código';
  if (round.deliveryDispute?.status === 'OPEN') return 'Entrega em verificação';
  if (round.deliveryDispute?.status === 'CONFIRMED_DELIVERED') return 'Entrega confirmada pela equipe';
  if (round.deliveryDispute?.status === 'RESENT' && round.status !== 'DELIVERED') return 'Pedido reenviado para produção';
  const delivered = Date.parse(round.deliveredAt || '');
  if (round.status === 'DELIVERED' && Number.isFinite(delivered) && now >= delivered + DELIVERY_DISPUTE_WINDOW_MS) return 'Pedido recebido';
  return 'Seu pedido foi entregue';
}

