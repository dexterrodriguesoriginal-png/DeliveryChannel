/** Intervalo de datas (dias locais, "AAAA-MM-DD") do filtro de período de Pedidos. */
export interface DateRange { from: string; to: string }
export type PeriodPreset = 'TODAY' | 'YESTERDAY' | '7D' | '30D' | 'MONTH' | 'ALL';

const pad = (n: number) => String(n).padStart(2, '0');
export const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseISODate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => { const r = startOfDay(d); r.setDate(r.getDate() + n); return r; };
export const sameDay = (a: Date, b: Date) => toISODate(a) === toISODate(b);

/** Faixa de dias de cada atalho (null = sem limite, "Todos"). */
export function presetRange(preset: PeriodPreset, now = new Date()): DateRange | null {
  const today = startOfDay(now);
  switch (preset) {
    case 'ALL': return null;
    case 'TODAY': return { from: toISODate(today), to: toISODate(today) };
    case 'YESTERDAY': { const y = addDays(today, -1); return { from: toISODate(y), to: toISODate(y) }; }
    case '7D': return { from: toISODate(addDays(today, -6)), to: toISODate(today) };
    case '30D': return { from: toISODate(addDays(today, -29)), to: toISODate(today) };
    case 'MONTH': return { from: toISODate(new Date(today.getFullYear(), today.getMonth(), 1)), to: toISODate(today) };
  }
}

/** Dois cliques: o primeiro define o início, o segundo o fim (inverte se vier antes). */
export function pickDay(current: { from: Date | null; to: Date | null }, day: Date): { from: Date | null; to: Date | null } {
  if (!current.from || current.to) return { from: day, to: null };
  return day < current.from ? { from: day, to: current.from } : { from: current.from, to: day };
}

export function inRange(dateStr: string, range: DateRange): boolean {
  const from = parseISODate(range.from), to = parseISODate(range.to);
  if (!from || !to) return false;
  const t = new Date(dateStr).getTime();
  const [a, b] = from <= to ? [from, to] : [to, from];
  return t >= a.getTime() && t < addDays(b, 1).getTime();
}

const dm = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
/** "12/10 – 20/10" (ou "12/10" para um dia). */
export function formatRangeLabel(range: DateRange): string {
  const from = parseISODate(range.from), to = parseISODate(range.to);
  if (!from || !to) return '';
  return sameDay(from, to) ? dm(from) : `${dm(from)} – ${dm(to)}`;
}

/** Semanas (domingo → sábado) do mês; dias fora do mês vêm como null. */
export function monthGrid(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1), last = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let d = 1; d <= last; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}
