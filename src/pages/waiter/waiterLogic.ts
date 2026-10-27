// App do Garçom — regras puras (sem React/rede): quem pode usar, contadores e textos.
import type { CallLike } from '../../lib/salon/tableStatus';

/** Papéis da equipe que usam o App do Garçom (mesmos que o Salão aceita). */
export const WAITER_APP_ROLES = ['WAITER', 'OWNER', 'MANAGER', 'CASHIER'] as const;
export function canUseWaiterApp(role: string | null | undefined): boolean {
  return !!role && (WAITER_APP_ROLES as readonly string[]).includes(role);
}
/** Recusar / abrir mesa / pedir conta existem no banco só depois da migração de acesso (capabilities v2). */
export interface WaiterFeatures { reject: boolean; openTable: boolean; requestBill: boolean; holder: boolean }
export function waiterFeatures(tableAccess: boolean): WaiterFeatures {
  return { reject: tableAccess, openTable: tableAccess, requestBill: tableAccess, holder: tableAccess };
}

export type WaiterTab = 'MESAS' | 'LIBERAR' | 'CHAMADOS' | 'MAIS';

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
