import type { DriverRedeemResult } from '../repositories/driverRepository';
import type { DriverScreenVariant } from './membershipResolution';
import { INVITE_TOKEN_SESSION_KEY } from '../utils/inviteUrl';

export type RedeemOutcome =
  | { kind: 'INVALID' }
  | { kind: 'PENDING' }
  | { kind: 'GO_APP' }
  | { kind: 'STATUS'; variant: DriverScreenVariant };

/** Resposta do redeem → próxima tela. consumed:false nunca promete reabertura. */
export function redeemOutcome(r: DriverRedeemResult): RedeemOutcome {
  switch (r.status) {
    case 'PENDING': return { kind: 'PENDING' };
    case 'APPROVED': return { kind: 'GO_APP' };
    case 'SUSPENDED':
    case 'REJECTED':
    case 'REMOVED':
      return { kind: 'STATUS', variant: r.status };
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
