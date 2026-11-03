// App do Garçom — regras puras (sem React/rede): quem pode usar, contadores e textos.
import type { CallLike } from '../../lib/salon/tableStatus';
import { TABLE_STATUS_COLOR } from '../../lib/salon/tableStatus';
import type { WaiterTab as TabRow, WaiterRound } from '../../repositories/salonStaffRepository';

/** Papéis da equipe que usam o App do Garçom (mesmos que o Salão aceita). */
export const WAITER_APP_ROLES = ['WAITER', 'OWNER', 'MANAGER', 'CASHIER'] as const;
export function canUseWaiterApp(role: string | null | undefined): boolean {
  return !!role && (WAITER_APP_ROLES as readonly string[]).includes(role);
}
/** Garçom nunca pede a conta; cliente ou caixa iniciam esse fluxo. */
export interface WaiterFeatures { reject: boolean; openTable: boolean; requestBill: boolean; holder: boolean }
export function waiterFeatures(tableAccess: boolean): WaiterFeatures {
  return { reject: tableAccess, openTable: tableAccess, requestBill: false, holder: tableAccess };
}

export type WaiterTab = 'MESAS' | 'PEDIDOS' | 'LIBERAR' | 'CHAMADOS' | 'MAIS';

export function openCalls(calls: readonly CallLike[]): CallLike[] {
  return calls.filter(call => call.status === 'OPEN');
}
/** Number shown in the bottom bar badge ("99+" past 99). */
export function badgeText(count: number): string {
  return count <= 0 ? '' : count > 99 ? '99+' : String(count);
}
export function callTitle(type: CallLike['type']): string {
  return type === 'BILL' ? 'Pediu a conta' : type === 'HELP' ? 'Precisa de ajuda' : 'Chamou o garçom';
}
export function greeting(date: Date): string {
  const h = date.getHours();
  return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** Ids de rodadas/pedidos da mesa que chegaram depois da leitura anterior (a primeira leitura nunca toca som). */
export function newRoundIds(previous: ReadonlySet<string> | null, current: readonly { id: string }[]): string[] {
  if (!previous) return [];
  return current.filter(round => !previous.has(round.id)).map(round => round.id);
}

/** Only tables actually assigned or attended by this waiter belong in "Meus pedidos". */
export function attendedTabIds(userId: string | undefined, tabs: readonly TabRow[], assignments: readonly { table_id: string; waiter_id: string }[], calls: readonly CallLike[], rounds: readonly WaiterRound[]): Set<string> {
  if (!userId) return new Set();
  return new Set(tabs.filter(tab => {
    const assigned = assignments.find(a => a.table_id === tab.table_id);
    if (assigned) return assigned.waiter_id === userId;
    return tab.waiter_id === userId || calls.some(c => c.tab_id === tab.id && c.accepted_by === userId)
      || rounds.some(r => r.tab_id === tab.id && r.waiter_id === userId);
  }).map(tab => tab.id));
}

export function newlyReadyRoundIds(previous: ReadonlyMap<string, string> | null, current: readonly { id: string; status: string }[]): string[] {
  if (!previous) return [];
  return current.filter(r => r.status === 'READY' && previous.has(r.id) && previous.get(r.id) !== 'READY').map(r => r.id);
}

export function waiterOrderStatus(status: string): { label: string; color: string } {
  switch (status) {
    case 'PENDING': case 'CONFIRMED': return { label: 'Pedido novo · aguardando preparo', color: TABLE_STATUS_COLOR.NEW_ORDER };
    case 'PREPARING': return { label: 'Preparando seu pedido', color: TABLE_STATUS_COLOR.PREPARING };
    case 'READY': case 'WAITING_FOR_DRIVER': return { label: 'Pronto no balcão · balcão chamando', color: TABLE_STATUS_COLOR.READY };
    case 'OUT_FOR_DELIVERY': return { label: 'Pedido indo até você', color: '#0891b2' };
    case 'DELIVERED': return { label: 'Entregue', color: '#059669' };
    case 'CANCELLED': return { label: 'Cancelado', color: '#dc2626' };
    default: return { label: 'Aguardando atualização', color: '#64748b' };
  }
}

/** Awaiting payment can only reopen the existing Pix; it is never a manual confirmation. */
export function canCollectTab(status: string | undefined, role: string | null | undefined, attendsTable: boolean): boolean {
  if (role === 'OWNER' || role === 'MANAGER' || role === 'CASHIER') return !!status && !['CLOSED', 'CANCELLED'].includes(status);
  return role === 'WAITER' && attendsTable && (status === 'WAITER_AUTHORIZED' || status === 'AWAITING_PAYMENT');
}
