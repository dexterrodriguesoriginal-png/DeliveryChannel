import React, { useState } from 'react';
import { Bell, Clock, Bike, Package, MessageCircle, Eye, CheckCircle2, ChefHat, ShoppingBag, ArrowRight, X } from 'lucide-react';
import type { Order, RoleId } from '../../../types';
import { formatBRL } from '../../../lib/pricing/money';
import { paymentMethodLabel } from '../../../lib/orders/labels';
import { OrderAgeBadge } from '../OrderAgeBadge';
import {
  OrderAlerts, NextStep, AlertFilter, nextStepFor, waitingLabel, itemsSummary, addressLine, whatsappLink,
  alertCounts, alertList, shortPlace,
} from '../../../lib/orders/orderAlerts';

interface Props {
  alerts: OrderAlerts;
  role: RoleId | null | undefined;
  loading?: boolean;
  /** Pedidos que acabaram de chegar (destaque). */
  highlightIds?: ReadonlySet<string>;
  /** Pedido com ação em andamento (desabilita os botões dele). */
  busyOrderId?: string | null;
  lowStockCount?: number;
  prepMinutes?: number | null;
  onStep: (order: Order, step: NextStep) => void;
  /** Abre o pedido na tela Pedidos (lá ficam Recusar/Cancelar e os detalhes). */
  onView: (order: Order) => void;
  /** "Ver pedidos" / "+N pedidos". */
  onViewAll?: () => void;
  /** Chip "Estoque baixo" (só aparece quando o papel pode ver o estoque). */
  onGoInventory?: () => void;
  /** Linhas visíveis na faixa (padrão 3). */
  maxRows?: number;
}

const STEP_STYLE: Record<NextStep['kind'], string> = {
  accept: 'bg-[#15803d] hover:bg-emerald-800 text-white',
  start: 'bg-blue-600 hover:bg-blue-700 text-white',
  ready: 'bg-amber-500 hover:bg-amber-600 text-slate-950',
  call_driver: 'bg-purple-600 hover:bg-purple-700 text-white',
  pickup_done: 'bg-[#15803d] hover:bg-emerald-800 text-white',
};
const STEP_ICON: Record<NextStep['kind'], React.ReactNode> = {
  accept: <CheckCircle2 className="w-3.5 h-3.5" />, start: <ChefHat className="w-3.5 h-3.5" />, ready: <Package className="w-3.5 h-3.5" />,
  call_driver: <Bike className="w-3.5 h-3.5" />, pickup_done: <ShoppingBag className="w-3.5 h-3.5" />,
};

interface ChipDef { key: AlertFilter | 'estoque'; label: string; count: number; on: string }

/**
 * 19/10 (compacto): "Alertas de pedidos" numa faixa fina, da altura do cartão da loja.
 * Chips com contagem (clique filtra), e só quando há pedido em aberto uma lista de até 3 linhas
 * com o próximo passo. Recusar/Cancelar ficam na tela do pedido (olho).
 */
export const OrderAlertsCard: React.FC<Props> = ({
  alerts, role, loading, highlightIds, busyOrderId, lowStockCount = 0, prepMinutes,
  onStep, onView, onViewAll, onGoInventory, maxRows = 3,
}) => {
  const [filter, setFilter] = useState<AlertFilter | null>(null);
  const counts = alertCounts(alerts);
  const list = alertList(alerts, filter);
  const visible = list.slice(0, maxRows);
  const more = list.length - visible.length;
  const lateLimit = prepMinutes && prepMinutes > 0 ? `${prepMinutes} min` : '30 min';

  const chips: ChipDef[] = [
    { key: 'novos', label: 'Novos', count: counts.novos, on: 'bg-[#15803d] text-white border-[#15803d]' },
    { key: 'emPreparo', label: 'Em preparo', count: counts.emPreparo, on: 'bg-blue-50 text-blue-800 border-blue-300' },
    { key: 'prontos', label: 'Prontos', count: counts.prontos, on: 'bg-purple-50 text-purple-800 border-purple-300' },
    { key: 'atrasados', label: 'Atrasados', count: counts.atrasados, on: 'bg-rose-600 text-white border-rose-600' },
  ];
  if (onGoInventory) chips.push({ key: 'estoque', label: 'Estoque baixo', count: lowStockCount, on: 'bg-amber-100 text-amber-900 border-amber-300' });

  const renderChip = (c: ChipDef) => {
    const active = c.key !== 'estoque' && filter === c.key;
    const muted = c.count === 0;
    const onClick = c.key === 'estoque'
      ? onGoInventory
      : () => setFilter(prev => (prev === c.key ? null : (c.key as AlertFilter)));
    return (
      <button key={c.key} type="button" onClick={onClick} data-testid={`alert-chip-${c.key}`} data-count={c.count}
        aria-pressed={c.key === 'estoque' ? undefined : active}
        title={c.key === 'atrasados' ? `Aceitos ou em preparo há mais de ${lateLimit}` : c.key === 'estoque' ? 'Ver estoque' : `Filtrar: ${c.label}`}
        className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full border text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
          muted ? 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100' : c.on
        } ${active ? 'ring-2 ring-offset-1 ring-slate-900/70' : ''}`}>
        {c.label} <span className="font-mono font-black">{c.count}</span>
      </button>
    );
  };

  const renderRow = (o: Order) => {
    const step = nextStepFor(o, role);
    const busy = busyOrderId === o.id;
    const wa = whatsappLink(o.customerPhone);
    const hl = highlightIds?.has(o.id);
    const wait = step ? '' : waitingLabel(o);
    const late = alerts.atrasados.some(x => x.id === o.id);
    const pickup = o.fulfillmentType === 'PICKUP';
    return (
      <li key={o.id} data-testid="alert-order" data-order-id={o.id} data-status={o.status}
        title={itemsSummary(o) || undefined}
        className={`flex flex-col sm:flex-row sm:items-center gap-x-2 gap-y-1 min-h-11 px-2.5 py-1.5 rounded-xl border bg-white ${
          hl ? 'ring-2 ring-emerald-300 border-emerald-400 animate-pulse' : late ? 'border-rose-300' : 'border-slate-200'}`}>
        <div className="flex items-center gap-2 min-w-0 sm:flex-1">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="font-mono font-black text-slate-900 text-sm">#{o.orderNumber}</span>
          <span className="text-[11px] text-slate-500">{new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          <OrderAgeBadge order={o} />
          {hl && <span className="text-[9px] font-extrabold text-emerald-800 bg-emerald-100 px-1 rounded">NOVO</span>}
        </div>
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <span className="text-[13px] font-bold text-slate-900 truncate">{o.customerName || 'Cliente'}</span>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" data-testid="alert-whatsapp" aria-label={`WhatsApp de ${o.customerName || 'cliente'}`}
              title={o.customerPhone} className="shrink-0 p-0.5 rounded text-emerald-700 hover:bg-emerald-50">
              <MessageCircle className="w-3.5 h-3.5" />
            </a>
          )}
          <span title={addressLine(o)} data-testid="alert-place" className={`hidden sm:inline-block shrink-0 max-w-[9rem] truncate text-[10px] font-bold px-1.5 py-0.5 rounded ${
            pickup ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
            {pickup ? '🛍️ ' : '🛵 '}{shortPlace(o)}
          </span>
        </div>
        </div>
        <div className="flex items-center justify-end gap-2 min-w-0 sm:shrink-0">
          <span title={addressLine(o)} className={`sm:hidden mr-auto min-w-0 max-w-[9rem] truncate text-[10px] font-bold px-1.5 py-0.5 rounded ${
            pickup ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
            {pickup ? '🛍️ ' : '🛵 '}{shortPlace(o)}
          </span>
          <div className="text-right leading-tight whitespace-nowrap shrink-0">
            <div className="font-mono font-black text-slate-900 text-[13px]">{formatBRL(o.totalAmount)}</div>
            <div className="text-[9px] text-slate-500">{paymentMethodLabel(o.paymentMethod)}</div>
          </div>
          {step ? (
            <button type="button" disabled={busy} onClick={() => onStep(o, step)} data-testid="alert-next-step" data-step={step.kind}
              className={`shrink-0 h-8 px-3 rounded-lg text-xs font-extrabold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-60 ${STEP_STYLE[step.kind]}`}>
              {STEP_ICON[step.kind]} {busy ? 'Salvando…' : step.label}
            </button>
          ) : wait ? (
            <span className="h-8 px-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap">
              <Clock className="w-3.5 h-3.5" /> {wait}
            </span>
          ) : null}
          <button type="button" onClick={() => onView(o)} data-testid="alert-view" aria-label="Ver pedido" title="Ver pedido (detalhes, recusar ou cancelar)"
            className="shrink-0 h-8 w-8 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center cursor-pointer">
            <Eye className="w-4 h-4" />
          </button>
        </div>
      </li>
    );
  };

  const hasOrders = alerts.total > 0;
  return (
    <div data-testid="order-alerts-card" className={`rounded-2xl border p-3 shadow-xs ${hasOrders ? 'bg-amber-50/60 border-amber-300' : 'bg-white border-slate-200'}`}>
      <div className="flex flex-wrap lg:flex-nowrap items-center gap-2 lg:gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${alerts.novos.length ? 'bg-amber-100' : 'bg-slate-100'}`}>
            <Bell className={`w-4 h-4 ${alerts.novos.length ? 'text-amber-600 animate-bounce' : 'text-slate-400'}`} />
          </span>
          <div className="leading-tight">
            <h2 className="text-sm font-black text-slate-900">Alertas de pedidos</h2>
            {loading && !hasOrders ? (
              <p className="text-[11px] text-slate-500">Carregando pedidos…</p>
            ) : !hasOrders ? (
              <p data-testid="alerts-empty" className="text-[11px] text-slate-500">Nenhum pedido pendente</p>
            ) : null}
          </div>
        </div>
        <div className="order-3 w-full lg:order-none lg:w-auto flex flex-wrap items-center gap-1.5 lg:flex-1" role="group" aria-label="Filtrar alertas">
          {chips.map(renderChip)}
        </div>
        {onViewAll && (
          <button type="button" onClick={onViewAll} data-testid="alerts-view-all"
            className="ml-auto lg:ml-0 shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 cursor-pointer">
            Ver pedidos <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {hasOrders && (
        <div className="mt-2 space-y-1.5">
          {filter && (
            <div className="flex items-center gap-1 text-[11px] text-slate-600">
              Mostrando: <b>{chips.find(c => c.key === filter)?.label}</b>
              <button type="button" onClick={() => setFilter(null)} data-testid="alerts-clear-filter" aria-label="Limpar filtro"
                className="p-0.5 rounded hover:bg-slate-200 cursor-pointer"><X className="w-3 h-3" /></button>
            </div>
          )}
          {visible.length === 0 ? (
            <p data-testid="alerts-filter-empty" className="text-[11px] text-slate-500 pl-1">Nenhum pedido neste filtro.</p>
          ) : (
            <ul className="space-y-1.5">{visible.map(renderRow)}</ul>
          )}
          {more > 0 && (
            <button type="button" onClick={onViewAll} data-testid="alerts-more"
              className="text-[11px] font-bold text-emerald-800 hover:underline cursor-pointer pl-1">
              +{more} {more === 1 ? 'pedido' : 'pedidos'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
