import React from 'react';
import { Bell, X } from 'lucide-react';
import type { Order, RoleId } from '../../../types';
import { canAcceptOrders, itemsSummary } from '../../../lib/orders/orderAlerts';
import { formatTableLabel } from '../../../lib/orders/labels';

interface Props {
  orders: readonly Order[];
  role: RoleId | null | undefined;
  busyOrderId?: string | null;
  onAccept: (order: Order) => void;
  onView: (order: Order) => void;
  onDismiss: (id: string) => void;
}

/** Uma chegada por cartão, mais recente primeiro, sem expiração automática. */
export function NewOrderCards({ orders, role, busyOrderId, onAccept, onView, onDismiss }: Props) {
  if (!orders.length) return null;
  return <section aria-label="Pedidos que acabaram de chegar" aria-live="polite" className="space-y-2">
    {orders.slice(0, 3).map(order => <article key={order.id} data-testid="new-order-card" data-order-id={order.id}
      className="flex items-start gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 shadow-sm">
      <Bell className="mt-1 h-5 w-5 shrink-0 text-emerald-700" />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-slate-900">Novo pedido #{order.orderNumber}</p>
        <p className="truncate text-sm text-slate-600">{order.fulfillmentType === 'DINE_IN' ? formatTableLabel(order.tableLabel, 'Mesa') : order.customerName || 'Cliente'}</p>
        <p className="truncate text-xs text-slate-500">{itemsSummary(order)}</p>
        {order.fulfillmentType === 'DINE_IN' && order.status === 'CONFIRMED' && <p className="mt-1 text-xs font-semibold text-slate-600">Aguardando envio para produção</p>}
        <div className="mt-2 flex gap-2">
          {(order.status === 'PENDING' || (order.fulfillmentType === 'DINE_IN' && order.status === 'CONFIRMED')) && canAcceptOrders(role) && <button type="button" disabled={busyOrderId === order.id} onClick={() => onAccept(order)}
            className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-60">{busyOrderId === order.id ? 'Salvando…' : order.status === 'CONFIRMED' ? 'Enviar p/ produção' : 'Aceitar pedido'}</button>}
          <button type="button" onClick={() => onView(order)} className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-900">
            Ver pedido
          </button>
        </div>
      </div>
      <button type="button" aria-label={`Fechar aviso do pedido ${order.orderNumber}`} onClick={() => onDismiss(order.id)} className="rounded-lg p-1 text-slate-500 hover:bg-white"><X size={18} /></button>
    </article>)}
    {orders.length > 3 && <p data-testid="new-orders-more" className="text-sm font-semibold text-emerald-900">+{orders.length - 3} {orders.length - 3 === 1 ? 'pedido' : 'pedidos'}</p>}
  </section>;
}
