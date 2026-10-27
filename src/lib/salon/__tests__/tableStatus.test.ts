import { describe, expect, it } from 'vitest';
import {
  callLabel, compareTables, deriveTableStatus, elapsedMinutes, formatElapsed, matchesFilter, matchesSearch, normalizeLongStay, paidPercent,
  readLongStay, statusCounts, tabTotals, tableDisplayNumber, writeLongStay, TabLike,
} from '../tableStatus';

const NOW = Date.parse('2026-10-26T20:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const tab = (patch: Partial<TabLike> = {}): TabLike => ({ id: 'tab-1', table_id: 't1', status: 'OPEN', opened_at: minutesAgo(10), service_fee_percent: 10, service_fee_removed: false, ...patch });

describe('elapsed time', () => {
  it('floors minutes, never negative, tolerates garbage', () => {
    expect(elapsedMinutes(minutesAgo(10.9), NOW)).toBe(10);
    expect(elapsedMinutes(minutesAgo(-5), NOW)).toBe(0);
    expect(elapsedMinutes('nope', NOW)).toBe(0);
  });
  it('formats short and long stays', () => {
    expect([0, 7, 59, 60, 65, 125, 720].map(formatElapsed)).toEqual(['0 min', '7 min', '59 min', '1h', '1h05', '2h05', '12h']);
  });
});

describe('long-stay threshold', () => {
  it('defaults to 60 and clamps to a sane range', () => {
    expect(normalizeLongStay(undefined)).toBe(60);
    expect(normalizeLongStay('abc')).toBe(60);
    expect(normalizeLongStay(1)).toBe(15);
    expect(normalizeLongStay(99999)).toBe(600);
    expect(normalizeLongStay(90.4)).toBe(90);
  });
  it('persists per store and survives broken storage', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(readLongStay(storage, 'a')).toBe(60);
    expect(writeLongStay(storage, 'a', 45)).toBe(45);
    expect(readLongStay(storage, 'a')).toBe(45);
    expect(readLongStay(storage, 'b')).toBe(60);
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readLongStay(broken, 'a')).toBe(60);
    expect(() => writeLongStay(broken, 'a', 30)).not.toThrow();
    expect(readLongStay(undefined, 'a')).toBe(60);
  });
});

describe('totals', () => {
  it('sums rounds in cents and applies the service fee like close_tab', () => {
    expect(tabTotals(tab(), [{ subtotal: 30 }, { subtotal: 19.9 }])).toEqual({ subtotalCents: 4990, feeCents: 499, totalCents: 5489 });
    expect(tabTotals(tab({ service_fee_removed: true }), [{ subtotal: 30 }])).toEqual({ subtotalCents: 3000, feeCents: 0, totalCents: 3000 });
    expect(tabTotals(null, [{ subtotal: 12.34 }]).totalCents).toBe(1234);
    expect(tabTotals(tab(), [])).toEqual({ subtotalCents: 0, feeCents: 0, totalCents: 0 });
  });
  it('avoids float drift (0.1 + 0.2)', () => {
    expect(tabTotals(tab({ service_fee_percent: 0 }), [{ subtotal: 0.1 }, { subtotal: 0.2 }]).totalCents).toBe(30);
  });
  it('percent paid is bounded', () => {
    expect([paidPercent(0, 100), paidPercent(50, 100), paidPercent(150, 100), paidPercent(10, 0), paidPercent(-5, 100), paidPercent(1, 3)]).toEqual([0, 50, 100, 0, 0, 33]);
  });
});

describe('deriveTableStatus', () => {
  it('free when there is no open tab (or it is closed)', () => {
    expect(deriveTableStatus({ now: NOW }).kind).toBe('FREE');
    expect(deriveTableStatus({ tab: tab({ status: 'CLOSED' }), now: NOW }).kind).toBe('FREE');
    expect(deriveTableStatus({ tab: tab({ status: 'CANCELLED' }), now: NOW })).toMatchObject({ kind: 'FREE', elapsedLabel: null, totalCents: 0 });
  });
  it('occupied below the threshold, long stay at/after it, honouring a custom threshold', () => {
    expect(deriveTableStatus({ tab: tab({ opened_at: minutesAgo(59) }), now: NOW }).kind).toBe('OCCUPIED');
    expect(deriveTableStatus({ tab: tab({ opened_at: minutesAgo(60) }), now: NOW }).kind).toBe('LONG_STAY');
    expect(deriveTableStatus({ tab: tab({ opened_at: minutesAgo(61) }), now: NOW }).label).toBe('Ocupada há muito tempo');
    expect(deriveTableStatus({ tab: tab({ opened_at: minutesAgo(40) }), now: NOW, longStayMinutes: 30 }).kind).toBe('LONG_STAY');
    expect(deriveTableStatus({ tab: tab({ opened_at: minutesAgo(40) }), now: NOW, longStayMinutes: 5 }).kind).toBe('LONG_STAY'); // clamped to 15, still long
    expect(deriveTableStatus({ tab: tab({ opened_at: minutesAgo(10) }), now: NOW, longStayMinutes: 5 }).kind).toBe('OCCUPIED'); // clamp keeps 10 min below 15
  });
  it('bill requested wins over long stay', () => {
    expect(deriveTableStatus({ tab: tab({ status: 'BILL_REQUESTED', opened_at: minutesAgo(300) }), now: NOW }).kind).toBe('BILL');
  });
  it('active call = waiter/help call open on THIS tab; a bill call alone is not an attention call', () => {
    const calls = [
      { id: 'c1', tab_id: 'tab-1', type: 'CALL' as const, status: 'OPEN', created_at: minutesAgo(1) },
      { id: 'c2', tab_id: 'other', type: 'CALL' as const, status: 'OPEN', created_at: minutesAgo(1) },
      { id: 'c3', tab_id: 'tab-1', type: 'HELP' as const, status: 'HANDLED', created_at: minutesAgo(1) },
    ];
    expect(deriveTableStatus({ tab: tab(), calls, now: NOW })).toMatchObject({ hasActiveCall: true, callCount: 1 });
    expect(deriveTableStatus({ tab: tab(), calls: [calls[1], calls[2]], now: NOW })).toMatchObject({ hasActiveCall: false, callCount: 0 });
    expect(deriveTableStatus({ tab: tab({ status: 'BILL_REQUESTED' }), calls: [{ ...calls[0], type: 'BILL' }], now: NOW })).toMatchObject({ hasActiveCall: false, callCount: 1 });
  });
  it('only counts rounds and sessions of the tab; reports partial total and percent paid', () => {
    const info = deriveTableStatus({
      tab: tab(), now: NOW, paidCents: 1100,
      rounds: [{ id: 'r1', tab_id: 'tab-1', status: 'CONFIRMED', subtotal: 50, created_at: minutesAgo(5) }, { id: 'r2', tab_id: 'other', status: 'CONFIRMED', subtotal: 999, created_at: minutesAgo(5) }],
      sessions: [{ id: 's1', tab_id: 'tab-1', approved_at: null }, { id: 's2', tab_id: 'tab-1', approved_at: minutesAgo(3) }, { id: 's3', tab_id: 'other', approved_at: null }],
    });
    expect(info).toMatchObject({ totalCents: 5500, paidCents: 1100, paidPercent: 20, guests: 2, pendingRelease: true, elapsedLabel: '10 min' });
  });
});

describe('filters, counts and search', () => {
  const infos = [
    { kind: 'FREE' as const, hasActiveCall: false, pendingRelease: false },
    { kind: 'OCCUPIED' as const, hasActiveCall: true, pendingRelease: false },
    { kind: 'LONG_STAY' as const, hasActiveCall: false, pendingRelease: true },
    { kind: 'BILL' as const, hasActiveCall: false, pendingRelease: false },
    { kind: 'FREE' as const, hasActiveCall: false, pendingRelease: false },
  ];
  it('counts per status and calls (call = bell or waiting release)', () => {
    expect(statusCounts(infos)).toEqual({ ALL: 5, FREE: 2, OCCUPIED: 1, LONG_STAY: 1, BILL: 1, CALL: 2 });
    expect(statusCounts([])).toEqual({ ALL: 0, FREE: 0, OCCUPIED: 0, LONG_STAY: 0, BILL: 0, CALL: 0 });
  });
  it('filters match the counts', () => {
    for (const f of ['ALL', 'FREE', 'OCCUPIED', 'LONG_STAY', 'BILL', 'CALL'] as const) expect(infos.filter(i => matchesFilter(i, f)).length).toBe(statusCounts(infos)[f]);
  });
  it('searches by number, name and area, ignoring accents/case', () => {
    expect(matchesSearch({ label: 'Mesa 5', area: null }, '5')).toBe(true);
    expect(matchesSearch({ label: 'Mesa 15', area: null }, '5')).toBe(false);
    expect(matchesSearch({ label: 'Mesa 05', area: null }, '5')).toBe(true);
    expect(matchesSearch({ label: 'Mesa 5', area: null }, '05')).toBe(true);
    expect(matchesSearch({ label: 'Varanda', area: 'Área externa' }, 'AREA')).toBe(true);
    expect(matchesSearch({ label: 'Varanda', area: null }, 'vara')).toBe(true);
    expect(matchesSearch({ label: 'Varanda', area: null }, '')).toBe(true);
    expect(matchesSearch({ label: 'Varanda', area: null }, 'balcão')).toBe(false);
  });
  it('sorts naturally (Mesa 2 before Mesa 10)', () => {
    expect([{ label: 'Mesa 10' }, { label: 'Mesa 2' }, { label: 'Balcão' }].sort(compareTables).map(t => t.label)).toEqual(['Balcão', 'Mesa 2', 'Mesa 10']);
  });
  it('big number and labels', () => {
    expect([tableDisplayNumber('Mesa 07'), tableDisplayNumber('Varanda'), tableDisplayNumber('Área Vip Sul'), tableDisplayNumber('  ')]).toEqual(['7', 'V', 'ÁVS', '·']);
    expect([callLabel('CALL'), callLabel('BILL'), callLabel('HELP')]).toEqual(['Chamou o garçom', 'Pediu a conta', 'Precisa de ajuda']);
  });
});
