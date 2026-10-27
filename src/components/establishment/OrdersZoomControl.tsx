import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from '../../lib/orders/ordersZoom';

/** Controle de zoom da toolbar de Pedidos: − / % (clique volta a 100%) / +. */
export const OrdersZoomControl: React.FC<{ zoom: number; onZoomIn: () => void; onZoomOut: () => void; onReset: () => void }> = ({ zoom, onZoomIn, onZoomOut, onReset }) => (
  <div role="group" aria-label="Zoom dos pedidos" data-testid="orders-zoom" className="orders-zoom-control">
    <button type="button" aria-label="Diminuir zoom" title="Diminuir (ver mais pedidos)" disabled={zoom <= ZOOM_MIN} onClick={onZoomOut} data-testid="orders-zoom-out"><Minus size={14} strokeWidth={2.4} /></button>
    <button type="button" className="orders-zoom-value" aria-label={`Zoom ${zoom}%. Clique para voltar a ${ZOOM_DEFAULT}%`} title={`Voltar a ${ZOOM_DEFAULT}%`} onClick={onReset} data-testid="orders-zoom-value" aria-live="polite">{zoom}%</button>
    <button type="button" aria-label="Aumentar zoom" title="Aumentar" disabled={zoom >= ZOOM_MAX} onClick={onZoomIn} data-testid="orders-zoom-in"><Plus size={14} strokeWidth={2.4} /></button>
  </div>
);
