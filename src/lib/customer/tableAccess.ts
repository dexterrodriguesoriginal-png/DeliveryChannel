// Mesas e QR Code — modelo de acesso (Responsável / convidado). Funções puras, sem rede.
import { tableAppUrl } from '../salon/tableQr';

export type TableEntryState = 'RESPONSIBLE' | 'GUEST' | 'IN_USE';
export interface TableEntry {
  state: TableEntryState;
  sessionId?: string;
  tabId?: string;
  tableLabel?: string;
  approved?: boolean;
  storeName?: string;
}
export interface TabMember { sessionId: string; displayName: string; role: 'RESPONSIBLE' | 'GUEST'; approved: boolean; joinedVia?: string; since?: string }
export interface TabInvite { code: string; expiresAt: string; uses?: number }

export const INVITE_CODE_LENGTH = 6;
const INVITE_ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;

/** Uppercases and drops spaces/dashes the way people type codes; never longer than the code. */
export function normalizeInviteCode(value: string): string {
  return String(value || '').toUpperCase().replace(/[\s-]/g, '').slice(0, INVITE_CODE_LENGTH);
}
export function isInviteCodeComplete(value: string): boolean {
  const code = normalizeInviteCode(value);
  return code.length === INVITE_CODE_LENGTH && INVITE_ALPHABET.test(code);
}
/** "AB3 K7P" — easier to read aloud. */
export function formatInviteCode(code: string): string {
  const c = normalizeInviteCode(code);
  return c.length > 3 ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
}

/** Link of the invite: the table's own link plus &convite=<código>. Empty when slug/token are unusable. */
export function inviteUrl(origin: string, slug: string, token: string, code: string): string {
  const base = tableAppUrl(origin, slug, token);
  const clean = normalizeInviteCode(code);
  if (!base || !isInviteCodeComplete(clean)) return '';
  return `${base}&convite=${clean}`;
}
/** Reads ?convite= from a location.search string; only well-formed codes are accepted. */
export function readInviteParam(search: string): string | null {
  try {
    const value = normalizeInviteCode(new URLSearchParams(search).get('convite') || '');
    return isInviteCodeComplete(value) ? value : null;
  } catch { return null; }
}

/** Minutes left (rounded up, never negative). */
export function inviteMinutesLeft(expiresAt: string, now = Date.now()): number {
  const ms = Date.parse(expiresAt) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 60000) : 0;
}

export function parseTableEntry(data: unknown): TableEntry | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.state !== 'RESPONSIBLE' && d.state !== 'GUEST' && d.state !== 'IN_USE') return null;
  return {
    state: d.state,
    sessionId: typeof d.sessionId === 'string' ? d.sessionId : undefined,
    tabId: typeof d.tabId === 'string' ? d.tabId : undefined,
    tableLabel: typeof d.tableLabel === 'string' ? d.tableLabel : undefined,
    approved: d.approved === true,
    storeName: typeof d.storeName === 'string' ? d.storeName : undefined,
  };
}

/** Why a session ended, in words a customer understands. */
export function endedMessage(reason: string | null | undefined): string {
  switch (reason) {
    case 'TAB_CLOSED': return 'A conta desta mesa foi encerrada. Para pedir de novo, chame o garçom.';
    case 'REMOVED': return 'Você foi removido desta mesa pelo responsável. Se foi engano, peça um novo convite.';
    case 'REJECTED': return 'O garçom não liberou este acesso. Fale com a equipe se precisar de ajuda.';
    case 'STAFF_RESET':
    case 'RESET': return 'A equipe reiniciou o acesso desta mesa. Escaneie o QR Code novamente para continuar.';
    case 'TRANSFERRED': return 'A responsabilidade desta mesa foi passada para outra pessoa.';
    default: return 'Seu acesso a esta mesa terminou. Escaneie o QR Code novamente.';
  }
}

/** Pending-approval wording for the customer (no "aprovação do garçom" jargon). */
export const PENDING_APPROVAL_TITLE = 'Avisamos o garçom';
export const PENDING_APPROVAL_TEXT = 'Assim que ele liberar sua mesa, seu pedido segue para a cozinha automaticamente. Pode deixar esta tela aberta.';

/** The pending reminder after the QR was scanned and before any item was chosen. */
export const PENDING_TABLE_TEXT = 'Estamos avisando o garçom para liberar sua mesa. Você já pode escolher os itens.';

export function friendlyAccessError(message: string): string {
  if (/IDENTIFICATION_REQUIRED/i.test(message)) return 'Entre na sua conta para usar a mesa.';
  if (/RATE_LIMITED/i.test(message)) return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos ou chame um atendente.';
  if (/QR_PAUSED/i.test(message)) return 'O pedido pelo QR está pausado agora. Chame um atendente.';
  if (/STORE_CLOSED/i.test(message)) return 'O salão está fechado no momento.';
  if (/FORBIDDEN/i.test(message)) return 'Somente o responsável pela mesa pode fazer isso.';
  if (/TAB_CLOSED/i.test(message)) return 'A conta desta mesa já foi encerrada.';
  return message.replace(/^[A-Z_]{4,}:\s*/, '') || 'Não foi possível concluir. Tente novamente.';
}

// ── Cadastro pendente: depois do e-mail de confirmação o cliente cai em /app/<loja>; voltamos para a mesa dele.
export const PENDING_MESA_KEY = 'dc_pending_mesa';
const PENDING_MESA_TTL_MS = 3 * 60 * 60 * 1000;
type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function rememberPendingMesa(storage: KV | null | undefined, token: string, now = Date.now(), inviteCode?: string | null): void {
  if (!storage) return;
  const cleanInvite = inviteCode ? normalizeInviteCode(inviteCode) : undefined;
  try {
    storage.setItem(
      PENDING_MESA_KEY,
      JSON.stringify({ token, at: now, ...(cleanInvite && isInviteCodeComplete(cleanInvite) ? { inviteCode: cleanInvite } : {}) }),
    );
  } catch { /* storage unavailable */ }
}
export function readPendingMesaDetails(storage: KV | null | undefined, now = Date.now()): { token: string; inviteCode?: string } | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PENDING_MESA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown; at?: unknown; inviteCode?: unknown };
    if (typeof parsed.token !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(parsed.token)) return null;
    if (typeof parsed.at !== 'number' || now - parsed.at > PENDING_MESA_TTL_MS || parsed.at > now + 60000) { storage.removeItem(PENDING_MESA_KEY); return null; }
    const inviteCode = typeof parsed.inviteCode === 'string' && isInviteCodeComplete(parsed.inviteCode)
      ? normalizeInviteCode(parsed.inviteCode)
      : undefined;
    return { token: parsed.token, inviteCode };
  } catch { return null; }
}
export function readPendingMesa(storage: KV | null | undefined, now = Date.now()): string | null {
  return readPendingMesaDetails(storage, now)?.token ?? null;
}
export function clearPendingMesa(storage: KV | null | undefined): void {
  try { storage?.removeItem(PENDING_MESA_KEY); } catch { /* ignore */ }
}
