import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { OrdersPeriod } from './ordersKanban';
import { addDays, formatRangeLabel, monthGrid, parseISODate, pickDay, presetRange, sameDay, startOfDay, toISODate, type DateRange, type PeriodPreset } from '../../lib/orders/periodRange';
import './periodPicker.css';

const PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: 'TODAY', label: 'Hoje' }, { id: 'YESTERDAY', label: 'Ontem' }, { id: '7D', label: '7 dias' },
  { id: '30D', label: '30 dias' }, { id: 'MONTH', label: 'Este mês' }, { id: 'ALL', label: 'Todos' },
];
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
type Draft = { preset: PeriodPreset | 'CUSTOM'; from: Date | null; to: Date | null };

const draftFrom = (period: OrdersPeriod, range: DateRange | null, now: Date): Draft => {
  if (period === 'CUSTOM' && range) return { preset: 'CUSTOM', from: parseISODate(range.from), to: parseISODate(range.to) };
  const preset = (PRESETS.some(p => p.id === period) ? period : 'TODAY') as PeriodPreset;
  const r = presetRange(preset, now);
  return { preset, from: r ? parseISODate(r.from) : null, to: r ? parseISODate(r.to) : null };
};

/** Rótulo do botão "Mais": mostra o período escolhido quando não é um dos atalhos fixos (Hoje/Ontem/7 dias). */
export function periodButtonLabel(period: OrdersPeriod, range: DateRange | null): string | null {
  if (period === 'CUSTOM' && range) return formatRangeLabel(range);
  if (period === '30D') return '30 dias';
  if (period === 'MONTH') return 'Este mês';
  if (period === 'ALL') return 'Todos';
  return null;
}

export function PeriodPicker({ period, range, onApply, now = new Date() }: { period: OrdersPeriod; range: DateRange | null; onApply: (period: OrdersPeriod, range: DateRange | null) => void; now?: Date }) {
  const today = startOfDay(now);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(period, range, now));
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [hover, setHover] = useState<Date | null>(null);
  const [focusDay, setFocusDay] = useState<Date>(today);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const label = periodButtonLabel(period, range);
  const active = label !== null;

  const openPicker = () => {
    const d = draftFrom(period, range, now);
    setDraft(d); setHover(null);
    const anchor = d.to || d.from || today;
    setView({ y: anchor.getFullYear(), m: anchor.getMonth() }); setFocusDay(anchor); setOpen(true);
  };
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [open]);
  useEffect(() => { if (open) dialog.current?.querySelector<HTMLElement>('[data-day][tabindex="0"]')?.focus({ preventScroll: true }); }, [open]);

  const weeks = useMemo(() => monthGrid(view.y, view.m), [view]);
  const rawCaption = new Date(view.y, view.m, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const caption = rawCaption.charAt(0).toUpperCase() + rawCaption.slice(1);
  const shift = (n: number) => setView(v => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const canNext = view.y < today.getFullYear() || (view.y === today.getFullYear() && view.m < today.getMonth());

  const choosePreset = (id: PeriodPreset) => {
    const r = presetRange(id, now);
    setDraft({ preset: id, from: r ? parseISODate(r.from) : null, to: r ? parseISODate(r.to) : null });
    const anchor = (r && parseISODate(r.to)) || today;
    setView({ y: anchor.getFullYear(), m: anchor.getMonth() }); setFocusDay(anchor);
  };
  const pick = (day: Date) => { if (day > today) return; setDraft(d => ({ preset: 'CUSTOM', ...pickDay({ from: d.from, to: d.to }, day) })); setFocusDay(day); };
  const moveFocus = (next: Date) => {
    const n = next > today ? today : next;
    setFocusDay(n); setView({ y: n.getFullYear(), m: n.getMonth() });
    requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>(`[data-day="${toISODate(n)}"]`)?.focus());
  };
  const onGridKey = (e: React.KeyboardEvent) => {
    const k = e.key; const f = focusDay;
    const map: Record<string, Date> = { ArrowLeft: addDays(f, -1), ArrowRight: addDays(f, 1), ArrowUp: addDays(f, -7), ArrowDown: addDays(f, 7), Home: addDays(f, -f.getDay()), End: addDays(f, 6 - f.getDay()), PageUp: new Date(f.getFullYear(), f.getMonth() - 1, f.getDate()), PageDown: new Date(f.getFullYear(), f.getMonth() + 1, f.getDate()) };
    if (map[k]) { e.preventDefault(); moveFocus(map[k]); }
  };

  const previewTo = draft.from && !draft.to ? hover : draft.to;
  const lo = draft.from && previewTo ? (previewTo < draft.from ? previewTo : draft.from) : draft.from;
  const hi = draft.from && previewTo ? (previewTo < draft.from ? draft.from : previewTo) : draft.from;
  const pending = !!draft.from && !draft.to;
  const canApply = draft.preset === 'ALL' || !!draft.from;
  const summary = draft.preset === 'ALL' ? 'Todos os períodos'
    : draft.from ? formatRangeLabel({ from: toISODate(draft.from), to: toISODate(draft.to || draft.from) }) + (pending ? ' · escolha o último dia (ou aplique só este dia)' : '')
    : 'Escolha um dia ou um intervalo';
  const apply = () => {
    if (!canApply) return;
    if (draft.preset !== 'CUSTOM') onApply(draft.preset, null);
    else onApply('CUSTOM', { from: toISODate(draft.from!), to: toISODate(draft.to || draft.from!) });
    close();
  };
  const clear = () => { onApply('TODAY', null); close(); };

  return <div ref={root} className="relative">
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} data-testid="period-more" onClick={() => (open ? close(false) : openPicker())}
      className={`flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors ${active ? 'bg-[#dc2626] text-white' : 'text-slate-500 hover:bg-white'}`}>
      {active && <CalendarDays size={12} />}{label ?? 'Mais'}<ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <>
      <div className="fixed inset-0 z-[65] bg-slate-900/30 sm:hidden" aria-hidden="true" onClick={() => close(false)} />
      <div ref={dialog} role="dialog" aria-label="Selecionar período" data-testid="period-popover"
        className="period-popover fixed inset-x-2 bottom-2 z-[70] flex max-h-[88vh] flex-col overflow-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_24px_60px_-12px_rgba(15,23,42,.35)] sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[540px] sm:max-w-[calc(100vw-24px)]">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div role="group" aria-label="Atalhos" className="grid grid-cols-3 gap-1.5 sm:w-[132px] sm:shrink-0 sm:grid-cols-1">
            {PRESETS.map(p => <button key={p.id} type="button" aria-pressed={draft.preset === p.id} onClick={() => choosePreset(p.id)}
              className={`rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors ${draft.preset === p.id ? 'bg-red-50 text-[#dc2626] ring-1 ring-red-200' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>{p.label}</button>)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" aria-label="Mês anterior" onClick={() => shift(-1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><ChevronLeft size={16} /></button>
              <p aria-live="polite" className="text-sm font-semibold text-slate-800">{caption}</p>
              <button type="button" aria-label="Próximo mês" disabled={!canNext} onClick={() => shift(1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"><ChevronRight size={16} /></button>
            </div>
            <div role="grid" aria-label={caption} onKeyDown={onGridKey} onMouseLeave={() => setHover(null)}>
              <div role="row" className="grid grid-cols-7 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">{WEEKDAYS.map(w => <span key={w} role="columnheader" className="py-1">{w}</span>)}</div>
              {weeks.map((week, wi) => <div role="row" key={wi} className="grid grid-cols-7">{week.map((day, di) => {
                if (!day) return <span key={di} role="gridcell" aria-hidden="true" />;
                const iso = toISODate(day), future = day > today;
                const selStart = !!draft.from && sameDay(day, draft.from), selEnd = !!draft.to && sameDay(day, draft.to) || (!draft.to && !!hover && !!draft.from && sameDay(day, hover));
                const inside = !!lo && !!hi && day >= lo && day <= hi;
                const edge = selStart || (!!hi && sameDay(day, hi) && !!draft.from && (!!draft.to || !!hover));
                return <span key={di} role="gridcell" aria-selected={inside} className={`period-cell ${inside ? 'period-cell-in' : ''} ${lo && sameDay(day, lo) && hi && !sameDay(lo, hi) ? 'period-cell-first' : ''} ${hi && sameDay(day, hi) && lo && !sameDay(lo, hi) ? 'period-cell-last' : ''}`}>
                  <button type="button" data-day={iso} disabled={future} tabIndex={sameDay(day, focusDay) ? 0 : -1} aria-label={day.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} aria-pressed={edge || selEnd}
                    onClick={() => pick(day)} onMouseEnter={() => setHover(day)} onFocus={() => setFocusDay(day)}
                    className={`period-day ${edge || selEnd ? 'period-day-edge' : ''} ${sameDay(day, today) ? 'period-day-today' : ''}`}>{day.getDate()}</button>
                </span>;
              })}</div>)}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <p className="min-w-0 flex-1 text-xs font-medium text-slate-500" aria-live="polite">{summary}</p>
          <button type="button" onClick={clear} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100">Limpar</button>
          <button type="button" onClick={apply} disabled={!canApply} className="rounded-lg bg-[#dc2626] px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-40">Aplicar</button>
        </div>
      </div>
    </>}
  </div>;
}
