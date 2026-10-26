import type { DriverRedeemResult } from '../repositories/driverRepository';
import type { MembershipRowLite } from './membershipResolution';
import type { DriverScreenVariant } from './membershipResolution';
import { INVITE_TOKEN_SESSION_KEY } from '../utils/inviteUrl';

export type RedeemOutcome =
  | { kind: 'INVALID' }
  | { kind: 'PENDING'; tenantId: string }
  | { kind: 'GO_APP'; tenantId: string }
  | { kind: 'STATUS'; variant: DriverScreenVariant; tenantId: string };

/** Resposta do redeem → próxima tela. consumed:false nunca promete reabertura. */
export function redeemOutcome(r: DriverRedeemResult): RedeemOutcome {
  if (!r.tenantId) return { kind: 'INVALID' };
  switch (r.status) {
    case 'PENDING': return { kind: 'PENDING', tenantId: r.tenantId };
    case 'APPROVED': return { kind: 'GO_APP', tenantId: r.tenantId };
    case 'SUSPENDED':
    case 'REJECTED':
    case 'REMOVED':
      return { kind: 'STATUS', variant: r.status, tenantId: r.tenantId };
    default:
      return { kind: 'INVALID' };
  }
}

/** Iniciais da loja para o placeholder do logo (store_logo hoje é sempre null). */
export function storeInitials(name: string | undefined | null): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

type StorageLike = Pick<Storage, 'setItem' | 'removeItem' | 'getItem'>;

/** Sem sessão: guarda o token SÓ em sessionStorage (nunca localStorage). */
export function rememberInviteToken(session: StorageLike, token: string): void {
  session.setItem(INVITE_TOKEN_SESSION_KEY, token);
}

/** Depois do redeem: apaga o token do sessionStorage e da barra de endereço. */
export function clearInviteToken(session: StorageLike, history?: Pick<History, 'replaceState'> | null): void {
  session.removeItem(INVITE_TOKEN_SESSION_KEY);
  history?.replaceState(null, '', '/entregador');
}

/** Aplica a loja retornada pelo servidor ANTES de permitir navegação/status. */
export async function applyDriverRedeem(result: DriverRedeemResult, switchTenant: (id: string) => Promise<boolean>): Promise<RedeemOutcome> {
  const outcome = redeemOutcome(result);
  if (outcome.kind !== 'INVALID' && !await switchTenant(outcome.tenantId)) {
    throw new Error('Não foi possível abrir esta loja. Tente novamente.');
  }
  return outcome;
}

/** Seleção explícita nunca autoriza acesso: só limita vínculos já retornados com RLS. */
export function membershipsForSelection<T extends MembershipRowLite>(rows: T[], tenantId?: string | null): T[] {
  const selected = rows.find(r => r.tenant_id === tenantId);
  // DRIVER pendente/inativo da loja selecionada não pode cair no ACTIVE de outra loja.
  if (selected?.role_id !== 'DRIVER') return rows;
  return selected.status === 'ACTIVE' ? [selected, ...rows.filter(r => r !== selected)] : [selected];
}

/** OAuth não leva o token no redirectTo; o convite fica apenas nesta aba. */
export const DRIVER_AUTH_RETURN_TO = '/convite-entregador';

export const driverGoogleOptions = { intent: 'driver', returnTo: DRIVER_AUTH_RETURN_TO } as const;
export async function startDriverGoogleAuth(session: StorageLike, token: string, signIn: (options: typeof driverGoogleOptions) => Promise<void>): Promise<void> {
  rememberInviteToken(session, token);
  await signIn(driverGoogleOptions);
}

/** Remove só o token do convite, preservando code/fragmento da autenticação Supabase. */
export function driverAuthReturnPath(search: string, hash: string): string {
  const params = new URLSearchParams(search);
  params.delete('token');
  return '/entregador/convite' + (params.size ? `?${params}` : '') + hash;
}

const INVITE_STORE_SESSION_KEY = 'deliverychannel_driver_invite_store';
/** Só identidade pública da loja, para mostrar o status mesmo quando RLS bloqueia dados operacionais. */
export function rememberInviteStore(session: StorageLike, tenantId?: string, storeName?: string): void {
  if (!tenantId || !storeName) return;
  try { session.setItem(INVITE_STORE_SESSION_KEY, JSON.stringify({ tenantId, storeName })); } catch { /* sem storage */ }
}
export function readInviteStore(session: StorageLike, tenantId: string): string | null {
  try {
    const value = JSON.parse(session.getItem(INVITE_STORE_SESSION_KEY) || 'null');
    return value?.tenantId === tenantId && typeof value.storeName === 'string' ? value.storeName : null;
  } catch { return null; }
}
