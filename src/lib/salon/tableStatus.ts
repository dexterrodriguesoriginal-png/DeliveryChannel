// Pure logic for the Salão map (no React, no network): status, totals, filters, search.
// The closing/payment rules live in SQL (close_tab); nothing here decides money, it only displays it.

export type TableStatusKind = 'FREE' | 'OCCUPIED' | 'LONG_STAY' | 'BILL';
export type TableFilter = 'ALL' | TableStatusKind | 'CALL';

export interface TabLike { id: string; table_id: string; status: 'OPEN' | 'BILL_REQUESTED' | 'CLOSED' | 'CANCELLED'; opened_at: string; service_fee_percent: number; service_fee_removed: boolean }
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
  FREE: 'Livre', OCCUPIED: 'Ocupada', LONG_STAY: 'Ocupada há muito tempo', BILL: 'Conta pedida',
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
  const rounds = (input.rounds || []).filter(r => r.tab_id === tab.id);
  const minutes = elapsedMinutes(tab.opened_at, now);
  const totals = tabTotals(tab, rounds);
  const paidCents = Math.max(0, Math.round(input.paidCents || 0));
  const kind: TableStatusKind = tab.status === 'BILL_REQUESTED' ? 'BILL' : minutes >= long ? 'LONG_STAY' : 'OCCUPIED';
  const attention = calls.filter(c => c.type !== 'BILL').length;
  return {
    kind, label: STATUS_LABEL[kind], tabId: tab.id, elapsedMinutes: minutes, elapsedLabel: formatElapsed(minutes),
    hasActiveCall: attention > 0, callCount: calls.length, pendingRelease: sessions.some(s => !s.approved_at), guests: sessions.length,
    totalCents: totals.totalCents, paidCents, paidPercent: paidPercent(paidCents, totals.totalCents), needsReview: Boolean(input.needsReview),
  };
}

export type FilterCounts = Record<TableFilter, number>;
export function statusCounts(infos: Pick<TableStatusInfo, 'kind' | 'hasActiveCall' | 'pendingRelease'>[]): FilterCounts {
  const counts: FilterCounts = { ALL: infos.length, FREE: 0, OCCUPIED: 0, LONG_STAY: 0, BILL: 0, CALL: 0 };
  for (const info of infos) {
    counts[info.kind] += 1;
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
