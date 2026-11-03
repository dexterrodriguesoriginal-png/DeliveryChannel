import { orderStatusColors } from '../../components/establishment/ordersKanban';

export interface DineInTrackedRound {
  orderId: string;
  orderNumber: number;
  roundNo: number;
  status: string;
  createdAt: string;
  confirmedAt?: string | null;
  preparingAt?: string | null;
  readyAt?: string | null;
  servedAt?: string | null;
  deliveredAt?: string | null;
  queuePosition?: number | null;
}

export function dineInStatus(status: string) {
  const colors = orderStatusColors(status);
  const labels: Record<string, string> = {
    PENDING: 'Aguardando', CONFIRMED: 'Pedido aceito', PREPARING: 'Preparando seu pedido',
    READY: 'Aguardando garçom', WAITING_FOR_DRIVER: 'Aguardando garçom',
    OUT_FOR_DELIVERY: 'Pedido indo até você', DELIVERED: 'Entregue', CANCELLED: 'Cancelado',
  };
  return {
    ...colors,
    label: labels[status] || 'Aguardando',
    ...(status === 'CANCELLED' ? { color: '#ef4444', tint: '#fdecec', ink: '#b91c1c' } : {}),
  };
}

export function trackingSteps(round: DineInTrackedRound) {
  return [
    { label: 'Pedido feito', at: round.createdAt },
    { label: 'Aceito', at: round.confirmedAt },
    { label: 'Preparo iniciado', at: round.preparingAt },
    { label: 'Pronto · aguardando garçom', at: round.readyAt },
    { label: 'Servido · indo até você', at: round.servedAt },
    { label: 'Entregue', at: round.deliveredAt },
  ];
}

export function elapsedMinutes(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null;
  const seconds = (Date.parse(end) - Date.parse(start)) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds < 60 ? 'menos de 1 min' : `${Math.floor(seconds / 60)} min`;
}

export function queuePositionLabel(position?: number | null) {
  return Number.isSafeInteger(position) && position! > 0 ? `Você é o ${position}º da fila` : null;
}
