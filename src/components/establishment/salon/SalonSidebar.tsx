import React, { useEffect, useRef } from 'react';
import { Bell, CheckCircle2, ChefHat, ChevronsRight, Clock, Receipt, Utensils, X } from 'lucide-react';
import { formatBRL } from '../../../lib/pricing/money';
import { callLabel, formatElapsed, TableStatusKind } from '../../../lib/salon/tableStatus';
import './salon.css';

export type SidebarTab = 'OPEN' | 'CLOSED' | 'ORDERS' | 'CALLS';

export interface SidebarOpenTab { tabId: string; tableId: string; tableLabel: string; kind: TableStatusKind; elapsedMinutes: number; totalCents: number; paidPercent: number; needsReview: boolean }
export interface SidebarClosedTab { tabId: string; tableLabel: string; totalCents: number; closedAt: string; needsReview: boolean }
export interface SidebarOrder { id: string; tableId: string; tableLabel: string; orderNumber: number; roundNo: number; status: string; subtotalCents: number; createdAt: string }
export interface SidebarCall { id: string; tableId: string; tableLabel: string; type: 'CALL' | 'BILL' | 'HELP'; createdAt: string }

export interface SalonSidebarProps {
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  openTabs: SidebarOpenTab[];
  closedToday: SidebarClosedTab[];
  orders: SidebarOrder[];
  calls: SidebarCall[];
  now: number;
  busyCallId: string | null;
  onSelectTable: (tableId: string) => void;
  onHandleCall: (callId: string) => void;
  /** desktop: collapse; mobile drawer: close */
  onClose: () => void;
  variant: 'panel' | 'drawer';
}

const money = (cents: number) => formatBRL(cents / 100);
const clock = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const ORDER_STATUS: Record<string, string> = { CONFIRMED: 'Recebido', PREPARING: 'Preparando', READY: 'Pronto', DELIVERED: 'Entregue', PENDING: 'Pendente' };
const KIND_DOT: Record<TableStatusKind, string> = { FREE: '#0f766e', OCCUPIED: '#a16207', LONG_STAY: '#b91c1c', BILL: '#6d28d9' };

const TABS: Array<{ id: SidebarTab; label: string; icon: React.ReactNode }> = [
  { id: 'OPEN', label: 'Abertas', icon: <Utensils className="h-3.5 w-3.5" /> },
  { id: 'CLOSED', label: 'Fechadas hoje', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  { id: 'ORDERS', label: 'Pedidos', icon: <ChefHat className="h-3.5 w-3.5" /> },
  { id: 'CALLS', label: 'Chamados', icon: <Bell className="h-3.5 w-3.5" /> },
];

const Empty: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-slate-500">
    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">{icon}</span>{text}
  </div>
);

export const SalonSidebar: React.FC<SalonSidebarProps> = ({ tab, onTabChange, openTabs, closedToday, orders, calls, now, busyCallId, onSelectTable, onHandleCall, onClose, variant }) => {
  const counts: Record<SidebarTab, number> = { OPEN: openTabs.length, CLOSED: closedToday.length, ORDERS: orders.length, CALLS: calls.length };
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (variant === 'drawer') closeRef.current?.focus(); }, [variant]);
  useEffect(() => {
    if (variant !== 'drawer') return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant, onClose]);

  const onTabKey = (event: React.KeyboardEvent) => {
    const index = TABS.findIndex(item => item.id === tab);
    if (event.key === 'ArrowRight') { event.preventDefault(); onTabChange(TABS[(index + 1) % TABS.length].id); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); onTabChange(TABS[(index + TABS.length - 1) % TABS.length].id); }
  };

  return (
    <aside className="salon-side h-full" aria-label="Painel lateral do salão" data-testid="salon-sidebar">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-black text-slate-900">Movimento do salão</h2>
        <button ref={closeRef} type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
          aria-label={variant === 'drawer' ? 'Fechar painel' : 'Recolher painel lateral'}>
          {variant === 'drawer' ? <X className="h-5 w-5" /> : <ChevronsRight className="h-5 w-5" />}
        </button>
      </div>
      <div role="tablist" aria-label="Seções do painel" className="flex border-b border-slate-100" onKeyDown={onTabKey}>
        {TABS.map(item => (
          <button key={item.id} type="button" role="tab" id={`salon-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="salon-side-panel" tabIndex={tab === item.id ? 0 : -1}
            className="salon-side-tab" onClick={() => onTabChange(item.id)}>
            <span className="inline-flex flex-col items-center gap-1">
              <span className="inline-flex items-center gap-1">{item.icon}{item.label}</span>
              <span className={`min-w-5 rounded-full px-1.5 text-[10px] font-black tabular-nums ${item.id === 'CALLS' && counts.CALLS > 0 ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{counts[item.id]}</span>
            </span>
          </button>
        ))}
      </div>
      <div id="salon-side-panel" role="tabpanel" aria-labelledby={`salon-tab-${tab}`} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {tab === 'OPEN' && (openTabs.length === 0 ? <Empty icon={<Utensils className="h-6 w-6" />} text="Nenhuma comanda aberta agora." /> : openTabs.map(item => (
          <button key={item.tabId} type="button" className="salon-row" onClick={() => onSelectTable(item.tableId)} data-testid={`salon-open-${item.tabId}`}>
            <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: KIND_DOT[item.kind] }} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><b className="truncate text-sm text-slate-900">{item.tableLabel}</b><b className="text-sm tabular-nums text-slate-900">{money(item.totalCents)}</b></span>
              <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden="true" />{formatElapsed(item.elapsedMinutes)}{item.kind === 'BILL' ? ' · conta pedida' : ''}</span>
                <span className="tabular-nums">{item.paidPercent}% pago</span>
              </span>
              {item.needsReview && <span className="mt-1 inline-block rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-900">PIX para conferir</span>}
            </span>
          </button>
        )))}
        {tab === 'CLOSED' && (closedToday.length === 0 ? <Empty icon={<Receipt className="h-6 w-6" />} text="Nenhuma conta fechada hoje." /> : closedToday.map(item => (
          <div key={item.tabId} className="salon-row cursor-default hover:translate-x-0" data-testid={`salon-closed-${item.tabId}`}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><b className="truncate text-sm text-slate-900">{item.tableLabel}</b><b className="text-sm tabular-nums text-slate-900">{money(item.totalCents)}</b></span>
              <span className="text-xs text-slate-600">Fechada às {clock(item.closedAt)} · 100% pago</span>
              {item.needsReview && <span className="mt-1 block rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-900">PIX recebido depois do fechamento — conferir</span>}
            </span>
          </div>
        )))}
        {tab === 'ORDERS' && (orders.length === 0 ? <Empty icon={<ChefHat className="h-6 w-6" />} text="Nenhum pedido em preparo nas mesas." /> : orders.map(item => (
          <button key={item.id} type="button" className="salon-row" onClick={() => onSelectTable(item.tableId)}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-xs font-black text-slate-800">#{item.orderNumber}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><b className="truncate text-sm text-slate-900">{item.tableLabel} · rodada {item.roundNo}</b><b className="text-sm tabular-nums text-slate-900">{money(item.subtotalCents)}</b></span>
              <span className="text-xs text-slate-600">{ORDER_STATUS[item.status] || item.status} · {clock(item.createdAt)}</span>
            </span>
          </button>
        )))}
        {tab === 'CALLS' && (calls.length === 0 ? <Empty icon={<Bell className="h-6 w-6" />} text="Nenhum chamado em aberto." /> : calls.map(item => (
          <div key={item.id} className="salon-row" data-testid={`salon-call-${item.id}`}>
            <button type="button" onClick={() => onSelectTable(item.tableId)} className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 rounded-lg">
              <b className="block truncate text-sm text-slate-900">{item.tableLabel}</b>
              <span className="text-xs text-slate-600">{callLabel(item.type)} · {formatElapsed(Math.max(0, Math.floor((now - Date.parse(item.createdAt)) / 60000)))}</span>
            </button>
            <button type="button" disabled={busyCallId === item.id} onClick={() => onHandleCall(item.id)}
              className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-emerald-700 px-3 text-xs font-extrabold text-white transition hover:bg-emerald-800 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />Atendido
            </button>
          </div>
        )))}
      </div>
    </aside>
  );
};
