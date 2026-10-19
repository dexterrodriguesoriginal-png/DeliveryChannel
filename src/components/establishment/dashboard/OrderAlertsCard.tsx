import React from 'react';
import { Bell, Clock, Bike, Package, MessageCircle, Eye, CheckCircle2, ChefHat, ShoppingBag, XCircle, AlertTriangle } from 'lucide-react';
import type { Order, RoleId } from '../../../types';
import { formatBRL } from '../../../lib/pricing/money';
import { paymentMethodLabel } from '../../../lib/orders/labels';
import { OrderAgeBadge } from '../OrderAgeBadge';
import {
  OrderAlerts, NextStep, nextStepFor, canCancelOrder, cancelLabel, waitingLabel,
  itemsSummary, addressLine, whatsappLink,
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
  onCancel: (order: Order) => void;
  onView: (order: Order) => void;
  onGoInventory?: () => void;
}

const STEP_STYLE: Record<NextStep['kind'], string> = {
  accept: 'bg-[#15803d] hover:bg-emerald-800 text-white',
  start: 'bg-blue-600 hover:bg-blue-700 text-white',
  ready: 'bg-amber-500 hover:bg-amber-600 text-slate-950',
  call_driver: 'bg-purple-600 hover:bg-purple-700 text-white',
  pickup_done: 'bg-[#15803d] hover:bg-emerald-800 text-white',
};
const STEP_ICON: Record<NextStep['kind'], React.ReactNode> = {
  accept: <CheckCircle2 className="w-5 h-5" />, start: <ChefHat className="w-5 h-5" />, ready: <Package className="w-5 h-5" />,
  call_driver: <Bike className="w-5 h-5" />, pickup_done: <ShoppingBag className="w-5 h-5" />,
};

/** 19/10: "Alertas de pedidos" — o dono que faz tudo sozinho toca o pedido inteiro daqui (um botão por etapa). */
export const OrderAlertsCard: React.FC<Props> = ({
  alerts, role, loading, highlightIds, busyOrderId, lowStockCount = 0, prepMinutes, onStep, onCancel, onView, onGoInventory,
}) => {
  const renderOrder = (o: Order, tone: 'new' | 'late' | 'prep' | 'ready') => {
    const step = nextStepFor(o, role);
    const busy = busyOrderId === o.id;
    const wa = whatsappLink(o.customerPhone);
    const hl = highlightIds?.has(o.id);
    const wait = step ? '' : waitingLabel(o);
    return (
      <li key={o.id} data-testid="alert-order" data-order-id={o.id} data-status={o.status}
        className={`rounded-2xl border p-3 bg-white space-y-2 ${hl ? 'ring-4 ring-emerald-300 border-emerald-400 animate-pulse' : tone === 'late' ? 'border-rose-300' : 'border-slate-200'}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono font-black text-slate-900 text-sm">#{o.orderNumber}</span>
              <span className="text-[11px] text-slate-500">{new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
              <OrderAgeBadge order={o} />
              {hl && <span className="text-[10px] font-extrabold text-emerald-800 bg-emerald-100 px-1.5 rounded">NOVO</span>}
            </div>
            <div className="text-sm font-bold text-slate-900 truncate">{o.customerName || 'Cliente'}</div>
            {o.customerPhone && (
              <div className="text-[11px] text-slate-600 flex items-center gap-1">
                {o.customerPhone}
                {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-emerald-700 font-bold"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</a>}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono font-black text-slate-900">{formatBRL(o.totalAmount)}</div>
            <div className="text-[10px] text-slate-500">{paymentMethodLabel(o.paymentMethod)}</div>
          </div>
        </div>
        <div className="text-[11px] text-slate-700">
          <span className="font-semibold">{o.fulfillmentType === 'PICKUP' ? '🛍️ ' : '🛵 '}{addressLine(o)}</span>
          {itemsSummary(o) && <div className="text-slate-500 truncate">{itemsSummary(o)}</div>}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {step ? (
            <button type="button" disabled={busy} onClick={() => onStep(o, step)} data-testid="alert-next-step" data-step={step.kind}
              className={`flex-1 min-h-12 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 ${STEP_STYLE[step.kind]}`}>
              {STEP_ICON[step.kind]} {busy ? 'Salvando…' : step.label}
            </button>
          ) : wait ? (
            <div className="flex-1 min-h-12 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center gap-2">
              <Clock className="w-4 h-4" /> {wait}
            </div>
          ) : null}
          <div className="flex gap-2">
            {canCancelOrder(o, role) && (
              <button type="button" disabled={busy} onClick={() => onCancel(o)} data-testid="alert-cancel"
                className="flex-1 sm:flex-none min-h-12 px-4 rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-50 text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60">
                <XCircle className="w-4 h-4" /> {cancelLabel(o)}
              </button>
            )}
            <button type="button" onClick={() => onView(o)} data-testid="alert-view"
              className="flex-1 sm:flex-none min-h-12 px-4 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer">
              <Eye className="w-4 h-4" /> Ver pedido
            </button>
          </div>
        </div>
      </li>
    );
  };

  const section = (title: string, icon: React.ReactNode, list: Order[], tone: 'new' | 'late' | 'prep' | 'ready', empty: string, testid: string) => (
    <section data-testid={testid} className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-600">
        {icon} {title} <span className="ml-1 px-1.5 rounded-full bg-slate-100 text-slate-700">{list.length}</span>
      </h3>
      {list.length === 0 ? <p className="text-xs text-slate-400 pl-1">{empty}</p> : <ul className="space-y-2">{list.map(o => renderOrder(o, tone))}</ul>}
    </section>
  );

  const prontos = [...alerts.prontosAguardando, ...alerts.prontosRetirada];
  return (
    <div data-testid="order-alerts-card" className={`rounded-2xl border p-3 sm:p-4 space-y-4 ${alerts.total > 0 ? 'bg-amber-50/70 border-amber-300' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="flex items-center gap-2 text-sm font-black text-slate-900">
          <Bell className={`w-4 h-4 ${alerts.novos.length ? 'text-amber-600 animate-bounce' : 'text-slate-400'}`} /> Alertas de pedidos
        </h2>
        <div className="flex items-center gap-2 text-[11px] font-bold">
          {alerts.novos.length > 0 && <span className="px-2 py-0.5 rounded-full bg-[#15803d] text-white">{alerts.novos.length === 1 ? '1 pedido novo' : `${alerts.novos.length} pedidos novos`}</span>}
          {alerts.atrasados.length > 0 && <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white">{alerts.atrasados.length} atrasado{alerts.atrasados.length === 1 ? '' : 's'}</span>}
          {lowStockCount > 0 && (
            <button type="button" onClick={onGoInventory} data-testid="low-stock-chip" className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-950 cursor-pointer">
              {lowStockCount === 1 ? '1 produto acabando' : `${lowStockCount} produtos acabando`}
            </button>
          )}
        </div>
      </div>

      {loading && alerts.total === 0 ? (
        <p className="text-xs text-slate-500">Carregando pedidos…</p>
      ) : alerts.total === 0 ? (
        <div data-testid="alerts-empty" className="text-center py-4 space-y-1">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
          <p className="text-sm font-bold text-slate-800">Tudo em dia por aqui.</p>
          <p className="text-xs text-slate-500">Nenhum pedido esperando. Quando chegar um novo, ele aparece aqui com som.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {section('Novos', <Bell className="w-3.5 h-3.5 text-emerald-700" />, alerts.novos, 'new', 'Nenhum pedido novo.', 'alerts-new')}
          {alerts.atrasados.length > 0 && section(
            `Atrasados (mais de ${prepMinutes && prepMinutes > 0 ? `${prepMinutes} min` : '30 min'})`,
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />, alerts.atrasados, 'late', '', 'alerts-late')}
          {section('Em preparo', <ChefHat className="w-3.5 h-3.5 text-blue-600" />, alerts.emPreparo, 'prep', 'Nenhum pedido em preparo.', 'alerts-prep')}
          {section('Prontos', <Bike className="w-3.5 h-3.5 text-purple-600" />, prontos, 'ready', 'Nenhum pedido pronto aguardando entregador ou cliente.', 'alerts-ready')}
        </div>
      )}
    </div>
  );
};
