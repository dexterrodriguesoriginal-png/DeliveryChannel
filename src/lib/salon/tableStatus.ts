// Pure logic for the Salão map (no React, no network): status, totals, filters, search.
// The closing/payment rules live in SQL (close_tab); nothing here decides money, it only displays it.
import { STATUS_COLORS, type StatusColorTokens } from '../orders/statusColors';

export type TableStatusKind = 'FREE' | 'OCCUPIED' | 'LONG_STAY' | 'NEW_ORDER' | 'PREPARING' | 'READY' | 'BILL' | 'AUTHORIZED' | 'AWAITING_PAYMENT';
export type TableFilter = 'ALL' | TableStatusKind | 'CALL';

export type DiningTabStatus = 'OPEN' | 'BILL_REQUESTED' | 'WAITER_AUTHORIZED' | 'AWAITING_PAYMENT' | 'CLOSED' | 'CANCELLED';
export const ACTIVE_DINING_TAB_STATUSES: DiningTabStatus[] = ['OPEN', 'BILL_REQUESTED', 'WAITER_AUTHORIZED', 'AWAITING_PAYMENT'];
export interface TabLike { id: string; table_id: string; status: DiningTabStatus; opened_at: string; service_fee_percent: number; service_fee_removed: boolean }
export interface CallLike {
  id: string;
  tab_id: string;
  type: 'CALL' | 'BILL' | 'HELP';
  status: string;
  created_at: string;
  route?: 'ALL' | 'ASSIGNED' | 'CENTRAL';
  assigned_to?: string | null;
  accepted_by?: string | null;
  accepted_at?: string | null;
  dispatched_by?: string | null;
  dispatched_at?: string | null;
  escalated_at?: string | null;
}
export interface SessionLike { id: string; tab_id: string; approved_at: string | null }
export interface RoundLike { id: string; tab_id: string; status: string; subtotal: number; created_at: string }
export interface TableLike { id: string; label: string; area: string | null; seats: number }

export const DEFAULT_LONG_STAY_MINUTES = 60;
export const MIN_LONG_STAY_MINUTES = 15;
export const MAX_LONG_STAY_MINUTES = 600;
export const ELAPSED_REFRESH_MS = 30_000;

export function normalizeLongStay(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_LONG_STAY_MINUTES;
  return Math.min(MAX_LONG_STAY_MINUTES, Math.max(MIN_LONG_STAY_MINUTES, n));
}

export function elapsedMinutes(openedAt: string, now: number): number {
  const opened = Date.parse(openedAt);
  if (!Number.isFinite(opened)) return 0;
  return Math.max(0, Math.floor((now - opened) / 60_000));
}

/** 7 min · 59 min · 1h05 · 12h */
export function formatElapsed(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60); const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h${String(rest).padStart(2, '0')}`;
}

export interface TabTotals { subtotalCents: number; feeCents: number; totalCents: number }
/** Same arithmetic as close_tab / get_my_tab: fee = round(subtotal × percent / 100) unless removed. */
export function tabTotals(tab: Pick<TabLike, 'service_fee_percent' | 'service_fee_removed'> | undefined | null, rounds: Pick<RoundLike, 'subtotal'>[]): TabTotals {
  const subtotalCents = rounds.reduce((sum, r) => sum + Math.round(Number(r.subtotal || 0) * 100), 0);
  const feeCents = tab && !tab.service_fee_removed ? Math.round(subtotalCents * Number(tab.service_fee_percent || 0) / 100) : 0;
  return { subtotalCents, feeCents, totalCents: subtotalCents + feeCents };
}

export function paidPercent(paidCents: number, totalCents: number): number {
  if (!(totalCents > 0) || !(paidCents > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((paidCents / totalCents) * 100)));
}

export interface TableStatusInfo {
  kind: TableStatusKind;
  label: string;
  tabId: string | null;
  elapsedMinutes: number | null;
  elapsedLabel: string | null;
  hasActiveCall: boolean;
  callCount: number;
  pendingRelease: boolean;
  guests: number;
  totalCents: number;
  paidCents: number;
  paidPercent: number;
  needsReview: boolean;
}

export const STATUS_LABEL: Record<TableStatusKind, string> = {
  FREE: 'Livre', OCCUPIED: 'Ocupada', LONG_STAY: 'Ocupada há muito tempo', BILL: 'Conta solicitada',
  NEW_ORDER: 'Pedido novo', PREPARING: 'Em preparo', READY: 'Pronto no balcão',
  AUTHORIZED: 'Garçom autorizado a fechar', AWAITING_PAYMENT: 'Aguardando PIX',
};

/**
 * Paleta sólida do Salão e do App do Garçom com contraste WCAG AA:
 * - Verde (#2DBE4E, texto #0F172A, 7.27:1): Livre
 * - Amarelo (#FFDD00, texto #0F172A, 13.23:1): Ocupada / Em preparo
 * - Azul (#1AB0F5, texto #0F172A, 7.26:1): Pedido novo / Pronto no balcão
 * - Vermelho (#FF5050, texto #0F172A, 5.52:1): Ocupada há muito tempo
 * - Marrom sólido (#8B5A2B, texto #FFFFFF, 5.85:1): Conta solicitada (piscando) e Aguardando PIX (piscando + borda vermelha #FF5050)
 * - Roxo (#9B4DE0, texto #FFFFFF, 4.64:1): Garçom autorizado a fechar
 */
export const SALON_TABLE_COLORS: Readonly<Record<TableStatusKind, Readonly<StatusColorTokens>>> = {
  FREE: STATUS_COLORS.FREE,
  OCCUPIED: STATUS_COLORS.OCCUPIED,
  PREPARING: { bg: '#FFDD00', fg: '#0F172A', border: '#CA8A04', solid: '#FFDD00' },
  NEW_ORDER: { bg: '#1AB0F5', fg: '#0F172A', border: '#0284C7', solid: '#1AB0F5' },
  READY: { bg: '#1AB0F5', fg: '#0F172A', border: '#0284C7', solid: '#1AB0F5' },
  LONG_STAY: STATUS_COLORS.LONG_STAY,
  BILL: STATUS_COLORS.BILL,
  AUTHORIZED: STATUS_COLORS.AUTHORIZED,
  AWAITING_PAYMENT: STATUS_COLORS.AWAITING_PAYMENT,
};

export function tableColorTokens(kind: TableStatusKind): Readonly<StatusColorTokens> {
  return SALON_TABLE_COLORS[kind] ?? SALON_TABLE_COLORS.OCCUPIED;
}

/** A pending PIX is occupied and must remain visually distinct from a free table. */
export const TABLE_STATUS_COLOR: Record<TableStatusKind, string> = {
  FREE: SALON_TABLE_COLORS.FREE.solid,
  OCCUPIED: SALON_TABLE_COLORS.OCCUPIED.solid,
  LONG_STAY: SALON_TABLE_COLORS.LONG_STAY.solid,
  NEW_ORDER: SALON_TABLE_COLORS.NEW_ORDER.solid,
  PREPARING: SALON_TABLE_COLORS.PREPARING.solid,
  READY: SALON_TABLE_COLORS.READY.solid,
  BILL: SALON_TABLE_COLORS.BILL.solid,
  AUTHORIZED: SALON_TABLE_COLORS.AUTHORIZED.solid,
  AWAITING_PAYMENT: SALON_TABLE_COLORS.AWAITING_PAYMENT.solid,
};

export interface DeriveInput {
  tab?: TabLike | null;
  calls?: CallLike[];
  sessions?: SessionLike[];
  rounds?: RoundLike[];
  paidCents?: number;
  needsReview?: boolean;
  now: number;
  longStayMinutes?: number;
}

export function deriveTableStatus(input: DeriveInput): TableStatusInfo {
  const { tab, now } = input;
  const long = normalizeLongStay(input.longStayMinutes ?? DEFAULT_LONG_STAY_MINUTES);
  if (!tab || tab.status === 'CLOSED' || tab.status === 'CANCELLED') {
    return { kind: 'FREE', label: STATUS_LABEL.FREE, tabId: null, elapsedMinutes: null, elapsedLabel: null, hasActiveCall: false, callCount: 0,
      pendingRelease: false, guests: 0, totalCents: 0, paidCents: 0, paidPercent: 0, needsReview: false };
  }
  const calls = (input.calls || []).filter(c => c.tab_id === tab.id && c.status === 'OPEN');
  const sessions = (input.sessions || []).filter(s => s.tab_id === tab.id);
  const rounds = (input.rounds || []).filter(r => r.tab_id === tab.id && r.status !== 'CANCELLED');
  const minutes = elapsedMinutes(tab.opened_at, now);
  const totals = tabTotals(tab, rounds);
  const paidCents = Math.max(0, Math.round(input.paidCents || 0));
  const kind: TableStatusKind = tab.status === 'AWAITING_PAYMENT' ? 'AWAITING_PAYMENT'
    : tab.status === 'WAITER_AUTHORIZED' ? 'AUTHORIZED'
    : tab.status === 'BILL_REQUESTED' ? 'BILL'
    : rounds.some(round => round.status === 'READY') ? 'READY'
    : rounds.some(round => round.status === 'PREPARING') ? 'PREPARING'
    : rounds.some(round => ['PENDING', 'CONFIRMED'].includes(round.status)) ? 'NEW_ORDER'
    : minutes >= long ? 'LONG_STAY' : 'OCCUPIED';
  const attention = calls.filter(c => c.type !== 'BILL').length;
  return {
    kind, label: STATUS_LABEL[kind], tabId: tab.id, elapsedMinutes: minutes, elapsedLabel: formatElapsed(minutes),
    hasActiveCall: attention > 0, callCount: calls.length, pendingRelease: sessions.some(s => !s.approved_at), guests: sessions.length,
    totalCents: totals.totalCents, paidCents, paidPercent: paidPercent(paidCents, totals.totalCents), needsReview: Boolean(input.needsReview),
  };
}

export type FilterCounts = Record<TableFilter, number>;
export function statusCounts(infos: Pick<TableStatusInfo, 'kind' | 'hasActiveCall' | 'pendingRelease'>[]): FilterCounts {
  const counts: FilterCounts = { ALL: infos.length, FREE: 0, OCCUPIED: 0, LONG_STAY: 0, BILL: 0, CALL: 0,
    NEW_ORDER: 0, PREPARING: 0, READY: 0, AUTHORIZED: 0, AWAITING_PAYMENT: 0 };
  for (const info of infos) {
    counts[info.kind] += 1;
    if (['NEW_ORDER', 'PREPARING', 'READY'].includes(info.kind)) counts.OCCUPIED += 1;
    if (['AUTHORIZED', 'AWAITING_PAYMENT'].includes(info.kind)) counts.BILL += 1;
    if (info.hasActiveCall || info.pendingRelease) counts.CALL += 1;
  }
  return counts;
}

const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function matchesSearch(table: Pick<TableLike, 'label' | 'area'>, query: string): boolean {
  const q = fold(query);
  if (!q) return true;
  const label = fold(table.label);
  const digits = q.replace(/\D/g, '');
  if (digits && digits === q) {
    // "5" must find "Mesa 5" and "5", but not "Mesa 15" ("05"/"005" also match "Mesa 5")
    const strip = (v: string) => v.replace(/^0+(?=\d)/, '');
    return label.split(/\D+/).filter(Boolean).some(part => strip(part) === strip(digits));
  }
  return label.includes(q) || fold(table.area || '').includes(q);
}

export function matchesFilter(info: Pick<TableStatusInfo, 'kind' | 'hasActiveCall' | 'pendingRelease'>, filter: TableFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'CALL') return info.hasActiveCall || info.pendingRelease;
  if (filter === 'OCCUPIED') return ['OCCUPIED', 'NEW_ORDER', 'PREPARING', 'READY'].includes(info.kind);
  if (filter === 'BILL') return ['BILL', 'AUTHORIZED', 'AWAITING_PAYMENT'].includes(info.kind);
  return info.kind === filter;
}

export function compareTables(a: Pick<TableLike, 'label'>, b: Pick<TableLike, 'label'>): number {
  return a.label.localeCompare(b.label, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

/** Big number for the card: first number in the name ("Mesa 07" → "7"), otherwise up to 3 initials. */
export function tableDisplayNumber(label: string): string {
  const number = label.match(/\d+/)?.[0];
  if (number) return String(Number(number));
  const initials = label.split(/\s+/).filter(Boolean).map(word => word[0]).join('').slice(0, 3).toUpperCase();
  return initials || '·';
}

export function callLabel(type: CallLike['type']): string {
  return type === 'BILL' ? 'Pediu a conta' : type === 'HELP' ? 'Precisa de ajuda' : 'Chamou o garçom';
}

/** localStorage-backed long-stay threshold, per store. Never throws. */
export function readLongStay(storage: Pick<Storage, 'getItem'> | undefined, tenantId: string): number {
  try { return normalizeLongStay(storage?.getItem(`salon_long_stay_${tenantId}`) ?? DEFAULT_LONG_STAY_MINUTES); } catch { return DEFAULT_LONG_STAY_MINUTES; }
}
export function writeLongStay(storage: Pick<Storage, 'setItem'> | undefined, tenantId: string, minutes: number): number {
  const value = normalizeLongStay(minutes);
  try { storage?.setItem(`salon_long_stay_${tenantId}`, String(value)); } catch { /* best effort */ }
  return value;
}
