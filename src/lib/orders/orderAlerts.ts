/**
 * "Alertas de pedidos" do Dashboard do dono (19/10). Mesmos dados reais da tela Pedidos
 * (orderRepository.getOrders + realtime + polling); aqui só a classificação, pura e testável.
 *
 *  - Novos: PENDING, mais recente primeiro.
 *  - Atrasados: CONFIRMED/PREPARING há mais tempo que o preparo da loja (settings.defaultPrepTimeMinutes);
 *    sem preparo configurado usa 30 min (mesmo limite do selo âmbar da tela Pedidos).
 *  - Prontos aguardando entregador: entrega (DELIVERY) em READY ou WAITING_FOR_DRIVER, ainda sem entregador.
 * Permissões espelham update_order_status (o servidor continua sendo quem decide).
 */
import type { Order, RoleId } from '../../types';
import { sortOrdersNewestFirst, AGE_WARN_MS } from './orderAge';

export interface OrderAlerts {
  novos: Order[];
  atrasados: Order[];
  /** CONFIRMED/PREPARING dentro do prazo (o dono que faz tudo sozinho toca a próxima etapa daqui). */
  emPreparo: Order[];
  prontosAguardando: Order[];
  /** Retirada no local já pronta, esperando o cliente. */
  prontosRetirada: Order[];
  total: number;
}

export function lateThresholdMs(prepMinutes?: number | null): number {
  const m = Number(prepMinutes);
  return Number.isFinite(m) && m > 0 ? m * 60000 : AGE_WARN_MS;
}

export function buildOrderAlerts(orders: readonly Order[], opts: { prepMinutes?: number | null; now?: number } = {}): OrderAlerts {
  const now = opts.now ?? Date.now();
  const limit = lateThresholdMs(opts.prepMinutes);
  const sorted = sortOrdersNewestFirst(orders);
  const age = (o: Order) => now - new Date(o.createdAt).getTime();
  const novos = sorted.filter(o => o.status === 'PENDING');
  const atrasados = sorted
    .filter(o => (o.status === 'CONFIRMED' || o.status === 'PREPARING') && age(o) > limit)
    .sort((a, b) => age(b) - age(a)); // mais atrasado primeiro
  const lateIds = new Set(atrasados.map(o => o.id));
  const emPreparo = sorted.filter(o => (o.status === 'CONFIRMED' || o.status === 'PREPARING') && !lateIds.has(o.id));
  const prontosAguardando = sorted.filter(o =>
    o.fulfillmentType !== 'PICKUP' && (o.status === 'READY' || o.status === 'WAITING_FOR_DRIVER') && !o.driverId);
  const prontosRetirada = sorted.filter(o => o.fulfillmentType === 'PICKUP' && o.status === 'READY');
  return {
    novos, atrasados, emPreparo, prontosAguardando, prontosRetirada,
    total: novos.length + atrasados.length + emPreparo.length + prontosAguardando.length + prontosRetirada.length,
  };
}

/** PENDING -> CONFIRMED (update_order_status: OWNER/MANAGER/OPERATOR/CASHIER). */
export function canAcceptOrders(role: RoleId | string | null | undefined): boolean {
  return role === 'OWNER' || role === 'MANAGER' || role === 'OPERATOR' || role === 'CASHIER';
}

/** READY -> WAITING_FOR_DRIVER em entrega (mesmos papéis). DELIVERY_MANAGER não chama. */
export function canCallDriverRole(role: RoleId | string | null | undefined): boolean {
  return canAcceptOrders(role);
}

/** "2x Picanha, 1x Coca 2L" (corta em maxChars). */
export function itemsSummary(order: Pick<Order, 'items'>, maxChars = 90): string {
  const s = (order.items || []).map(it => `${it.quantity}x ${it.productName}`).join(', ');
  return s.length > maxChars ? s.slice(0, maxChars - 1).trimEnd() + '…' : s;
}

/** Endereço curto ou "Retirada no local". */
export function addressLine(order: Pick<Order, 'fulfillmentType' | 'deliveryAddress'>): string {
  if (order.fulfillmentType === 'PICKUP') return 'Retirada no local';
  return (order.deliveryAddress || '').trim() || 'Endereço não informado';
}

/** Link do WhatsApp (Brasil) ou null quando o telefone não serve. */
export function whatsappLink(phone?: string | null): string | null {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  return `https://wa.me/${d.startsWith('55') && d.length >= 12 ? d : '55' + d}`;
}

/** IDs de pedidos novos que chegaram desde a última leitura (para som + destaque). Primeira leitura não toca. */
export function newPendingIds(prevIds: ReadonlySet<string> | null, orders: readonly Pick<Order, 'id' | 'status'>[]): string[] {
  if (!prevIds) return [];
  return orders.filter(o => o.status === 'PENDING' && !prevIds.has(o.id)).map(o => o.id);
}

/** Pedido que a tela Pedidos deve abrir selecionado ao vir do Dashboard ("Ver pedido"). */
export const FOCUS_ORDER_KEY = 'dc_focus_order_id';

export type NextStepKind = 'accept' | 'start' | 'ready' | 'call_driver' | 'pickup_done';
export interface NextStep {
  kind: NextStepKind;
  label: string;
  /** Status enviado ao update_order_status (o mesmo da tela Pedidos). */
  to: 'CONFIRMED' | 'PREPARING' | 'READY' | 'WAITING_FOR_DRIVER' | 'DELIVERED';
  note?: string;
}

/**
 * Único botão de próxima etapa para o estado atual (fluxo inteiro pelo Dashboard):
 * Aceitar -> Iniciar preparo -> Marcar como pronto -> Chamar entregador (entrega) / Confirmar retirada (retirada).
 * null = nada a fazer pela loja agora (aguardando entregador, em rota, final) ou papel sem permissão.
 */
export function nextStepFor(order: Pick<Order, 'status' | 'fulfillmentType' | 'driverId'>, role: RoleId | string | null | undefined): NextStep | null {
  if (!canAcceptOrders(role)) return null;
  const pickup = order.fulfillmentType === 'PICKUP';
  switch (order.status) {
    case 'PENDING': return { kind: 'accept', label: 'Aceitar', to: 'CONFIRMED' };
    case 'CONFIRMED': return { kind: 'start', label: 'Iniciar preparo', to: 'PREPARING' };
    case 'PREPARING': return { kind: 'ready', label: 'Marcar como pronto', to: 'READY' };
    case 'READY':
      if (pickup) return { kind: 'pickup_done', label: 'Confirmar retirada', to: 'DELIVERED' };
      if (order.driverId) return null;
      return { kind: 'call_driver', label: 'Chamar entregador', to: 'WAITING_FOR_DRIVER', note: 'Chamando motoboy' };
    default: return null;
  }
}

/** Recusar/Cancelar como no servidor: dono/gerente sempre (até a entrega); operador/caixa só em PENDING/CONFIRMED. */
export function canCancelOrder(order: Pick<Order, 'status'>, role: RoleId | string | null | undefined): boolean {
  if (order.status === 'CANCELLED' || order.status === 'DELIVERED') return false;
  if (role === 'OWNER' || role === 'MANAGER') return true;
  if (role === 'OPERATOR' || role === 'CASHIER') return order.status === 'PENDING' || order.status === 'CONFIRMED';
  return false;
}

/** "Recusar" para pedido novo; "Cancelar" depois de aceito. */
export function cancelLabel(order: Pick<Order, 'status'>): string {
  return order.status === 'PENDING' ? 'Recusar' : 'Cancelar';
}

/** Situação mostrada quando não há botão (ex.: aguardando entregador aceitar). */
export function waitingLabel(order: Pick<Order, 'status' | 'fulfillmentType' | 'driverId'>): string {
  if (order.status === 'WAITING_FOR_DRIVER') return order.driverId ? 'Entregador a caminho da loja' : 'Aguardando um entregador aceitar';
  if (order.status === 'READY' && order.driverId) return 'Entregador designado';
  if (order.status === 'OUT_FOR_DELIVERY') return 'Em rota de entrega';
  return '';
}
