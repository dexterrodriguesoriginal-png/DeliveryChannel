import { describe, expect, it } from 'vitest';
import { formatRangeLabel, inRange, monthGrid, parseISODate, pickDay, presetRange, toISODate } from '../periodRange';
import { isDateInOrdersPeriod } from '../../../components/establishment/ordersKanban';

const now = new Date(2026, 9, 27, 10, 0); // 27/10/2026
const at = (d: number, h = 12, m = 10) => new Date(2026, m - 1, d, h).toISOString();
describe('intervalo de datas do filtro de período', () => {
  it('atalhos geram faixas de dias locais', () => {
    expect(presetRange('TODAY', now)).toEqual({ from: '2026-10-27', to: '2026-10-27' });
    expect(presetRange('YESTERDAY', now)).toEqual({ from: '2026-10-26', to: '2026-10-26' });
    expect(presetRange('7D', now)).toEqual({ from: '2026-10-21', to: '2026-10-27' });
    expect(presetRange('30D', now)).toEqual({ from: '2026-09-28', to: '2026-10-27' });
    expect(presetRange('MONTH', now)).toEqual({ from: '2026-10-01', to: '2026-10-27' });
    expect(presetRange('ALL', now)).toBeNull();
  });
  it('dois cliques escolhem início e fim (invertendo se necessário); terceiro recomeça', () => {
    const d = (n: number) => new Date(2026, 9, n);
    const one = pickDay({ from: null, to: null }, d(12));
    expect(one).toEqual({ from: d(12), to: null });
    expect(pickDay(one, d(20))).toEqual({ from: d(12), to: d(20) });
    expect(pickDay(one, d(5))).toEqual({ from: d(5), to: d(12) });
    expect(pickDay({ from: d(12), to: d(20) }, d(25))).toEqual({ from: d(25), to: null });
  });
  it('filtra pedidos pelo intervalo (inclusive o último dia) e mostra o rótulo', () => {
    const r = { from: '2026-10-12', to: '2026-10-20' };
    expect(isDateInOrdersPeriod(at(12, 0), 'CUSTOM', now, r)).toBe(true);
    expect(isDateInOrdersPeriod(at(20, 23), 'CUSTOM', now, r)).toBe(true);
    expect(isDateInOrdersPeriod(at(21, 0), 'CUSTOM', now, r)).toBe(false);
    expect(isDateInOrdersPeriod(at(11, 23), 'CUSTOM', now, r)).toBe(false);
    expect(inRange(at(15), { from: '2026-10-20', to: '2026-10-12' })).toBe(true);
    expect(isDateInOrdersPeriod(at(1, 0), 'MONTH', now)).toBe(true);
    expect(isDateInOrdersPeriod(at(30, 12, 9), 'MONTH', now)).toBe(false);
    expect(formatRangeLabel(r)).toBe('12/10 – 20/10');
    expect(formatRangeLabel({ from: '2026-10-05', to: '2026-10-05' })).toBe('05/10');
  });
  it('valida datas e monta a grade do mês (domingo a sábado)', () => {
    expect(parseISODate('2026-02-30')).toBeNull(); expect(toISODate(parseISODate('2026-10-27')!)).toBe('2026-10-27');
    const g = monthGrid(2026, 9);
    expect(g.every(w => w.length === 7)).toBe(true);
    expect(g[0][4]!.getDate()).toBe(1); // 1/10/2026 é quinta
    expect(g.flat().filter(Boolean)).toHaveLength(31);
  });
});
