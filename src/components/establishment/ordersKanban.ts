import type { Order, OrderStatus } from '../../types';

/** Visual exclusivo de Pedidos; não altera temas globais nem transições de status. */
export const KANBAN_COLUMN_THEME = {
  waiting: { label: 'AGUARDANDO', color: '#ef4444', tint: '#fdecec', dropStatus: 'PENDING' },
  production: { label: 'EM PRODUÇÃO', color: '#f97316', tint: '#fef1e7', dropStatus: 'PREPARING' },
  ready: { label: 'SAIU / PRONTO', color: '#a855f7', tint: '#f6eefe', dropStatus: 'READY' },
  delivered: { label: 'ENTREGUE', color: '#16a34a', tint: '#e8f6ed', dropStatus: 'DELIVERED' },
  cancelled: { label: 'CANCELADO', color: '#6b7280', tint: '#f0f1f2', dropStatus: 'CANCELLED' },
} as const satisfies Record<string, { label: string; color: string; tint: string; dropStatus: OrderStatus }>;
export type KanbanColumn = keyof typeof KANBAN_COLUMN_THEME;
/** Tom escuro de cada cor (texto/ícones sobre o fundo suave), com contraste AA sobre a tinta da coluna. */
export const KANBAN_COLUMN_INK: Record<KanbanColumn, string> = {
  waiting: '#b91c1c', production: '#c2410c', ready: '#7e22ce', delivered: '#15803d', cancelled: '#374151',
};
export const KANBAN_COLUMNS = Object.keys(KANBAN_COLUMN_THEME) as KanbanColumn[];

/**
 * Status reais do main: PENDING/CONFIRMED → aguardando; PREPARING → produção;
 * READY/WAITING_FOR_DRIVER/OUT_FOR_DELIVERY → saiu/pronto; DELIVERED → entregue;
 * CANCELLED → cancelado. A oferta ativa mantém READY; o aceite aguarda o código
 * em WAITING_FOR_DRIVER, sem mudar o fluxo de despacho automático do PR #14.
 * Aliases defensivos: PAID → aguardando; ACCEPTED → produção;
 * SERVED/COMPLETED → entregue; REJECTED → cancelado. Desconhecidos ficam visíveis
 * em aguardando. O gate de pagamento e o arquivamento são aplicados pela página.
 */
export function kanbanColumnForStatus(status: string): KanbanColumn {
  switch (status) {
    case 'ACCEPTED': case 'PREPARING': return 'production';
    case 'READY': case 'WAITING_FOR_DRIVER': case 'OUT_FOR_DELIVERY': return 'ready';
    case 'DELIVERED': case 'SERVED': case 'COMPLETED': return 'delivered';
    case 'CANCELLED': case 'REJECTED': return 'cancelled';
    default: return 'waiting';
  }
}

/**
 * Mapa ÚNICO de cor por status, usado pelo Kanban (cabeçalhos/cards) e pela Lista (linha, barra e selo):
 * aguardando vermelho · em produção laranja · saiu/pronto roxo · entregue verde · cancelado cinza.
 */
export function orderStatusColors(status: string) {
  const column = kanbanColumnForStatus(status);
  const theme = KANBAN_COLUMN_THEME[column];
  return { column, label: theme.label, color: theme.color, tint: theme.tint, ink: KANBAN_COLUMN_INK[column] };
}

export function groupKanbanOrders(orders: readonly Order[]) {
  const groups = Object.fromEntries(KANBAN_COLUMNS.map(key => [key, { orders: [] as Order[], count: 0, total: 0 }])) as Record<KanbanColumn, { orders: Order[]; count: number; total: number }>;
  for (const order of orders) {
    const group = groups[kanbanColumnForStatus(order.status)];
    group.orders.push(order);
    group.count++;
    // Soma em centavos para evitar resíduos de ponto flutuante no total da coluna.
    group.total += Math.round((order.totalAmount || 0) * 100);
  }
  for (const group of Object.values(groups)) group.total /= 100;
  return groups;
}

export function matchesOrderSearch(order: Order, search: string) {
  const query = search.trim().toLocaleLowerCase('pt-BR');
  if (!query) return true;
  const digits = query.replace(/\D/g, '');
  return String(order.orderNumber ?? order.id).includes(query.replace(/^#/, ''))
    || (order.customerName || '').toLocaleLowerCase('pt-BR').includes(query)
    || (digits.length > 0 && /^[\d\s()+.\-]+$/.test(query) && (order.customerPhone || '').replace(/\D/g, '').includes(digits));
}

export type OrdersPeriod = 'ALL' | 'TODAY' | 'YESTERDAY' | '7D' | '30D';
export function isDateInOrdersPeriod(dateStr: string, period: OrdersPeriod, now = new Date()) {
  if (period === 'ALL') return true;
  const date = new Date(dateStr);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start); end.setDate(end.getDate() + 1);
  if (period === 'YESTERDAY') { end.setTime(start.getTime()); start.setDate(start.getDate() - 1); }
  if (period === '7D') start.setDate(start.getDate() - 6);
  if (period === '30D') start.setDate(start.getDate() - 29);
  return date >= start && date < end;
}
