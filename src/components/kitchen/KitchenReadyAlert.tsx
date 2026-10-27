import React from 'react';
import { BellRing, Bike, MapPin, UtensilsCrossed, X } from 'lucide-react';
import type { Order } from '../../types';
import { formatTableLabel } from '../../lib/orders/labels';
import { ORDER_STATUS_THEME, BRAND_ACTION } from '../../utils/orderStatusTheme';

/** 19/10: aviso no painel quando a cozinha marca "Pronto": entrega → Chamar entregador; retirada → fila de chegada; mesa → Abrir mesa. */
export const KitchenReadyAlert: React.FC<{
  orders: Order[]; busyId?: string | null; onCallDriver: (o: Order) => void; onOpenPickup: (o: Order) => void; onOpenTable?: (o: Order) => void; onDismiss: (id: string) => void;
}> = ({ orders, busyId, onCallDriver, onOpenPickup, onOpenTable, onDismiss }) => {
  if (orders.length === 0) return null;
  const t = ORDER_STATUS_THEME.READY;
  return (
    <div className="rounded-2xl p-3 space-y-2 shadow-sm" style={{ backgroundColor: t.bg, border: `2px solid ${t.border}` }} role="alert" data-testid="kitchen-ready-alert">
      <div className="flex items-center gap-2 font-black" style={{ color: t.text }}><BellRing className="w-5 h-5 animate-pulse" />Cozinha: pedido pronto</div>
      {orders.map(o => {
        const pickup = o.fulfillmentType === 'PICKUP';
        const dineIn = o.fulfillmentType === 'DINE_IN';
        const placeLabel = dineIn ? `${formatTableLabel(o.tableLabel, 'Mesa')} · Salão` : pickup ? 'Retirada' : 'Entrega';
        return (
          <div key={o.id} className="bg-white rounded-xl px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="font-bold text-gray-950">Pedido #{o.orderNumber} pronto <span className="text-xs font-semibold text-gray-500">· {placeLabel}</span></div>
            <div className="flex items-center gap-2">
              {dineIn ? (
                <button type="button" onClick={() => (onOpenTable || onOpenPickup)(o)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold" style={{ backgroundColor: BRAND_ACTION.bg, color: BRAND_ACTION.text }}><UtensilsCrossed className="w-4 h-4" />Abrir mesa</button>
              ) : pickup ? (
                <button type="button" onClick={() => onOpenPickup(o)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold" style={{ backgroundColor: BRAND_ACTION.bg, color: BRAND_ACTION.text }}><MapPin className="w-4 h-4" />Fila de chegada</button>
              ) : (
                <button type="button" disabled={busyId === o.id} onClick={() => onCallDriver(o)} data-testid="ready-call-driver" className="flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold disabled:opacity-60" style={{ backgroundColor: BRAND_ACTION.bg, color: BRAND_ACTION.text }}><Bike className="w-4 h-4" />Chamar entregador</button>
              )}
              <button type="button" onClick={() => onDismiss(o.id)} aria-label="Dispensar" className="p-1 text-gray-500"><X className="w-4 h-4" /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
