import React, { useState, useEffect } from 'react';
import { 
  ShoppingBag, 
  Clock, 
  User, 
  Bike, 
  Building2,
  Check, 
  CheckCircle2, 
  Truck, 
  Eye, 
  MoreVertical,
  ChevronRight,
  AlertTriangle,
  X
} from 'lucide-react';
import { Order, OrderStatus } from '../../types';
import { 
  ORDER_STATUS_THEME, 
  DELAYED_PREPARING_THEME, 
  checkIsPreparingDelayed, orderActionButtonStyle } from '../../utils/orderStatusTheme';
import { SlaTimerChip } from './SlaTimerChip';
import { OrderStatusChip } from './StatusIcon';
import { orderAgeInfo } from '../../lib/orders/orderAge';
import { OrderAgeBadge } from './OrderAgeBadge';
import { pickupActionLabel, paymentBadge, pickupWaitingMinutes, waitingText } from '../../lib/orders/fulfillmentTabs';
import { formatBRL } from '../../lib/pricing/money';

export type CardDensity = 'compact' | 'normal' | 'comfortable';

interface CompactOrderCardProps {
  order: Order;
  density: CardDensity;
  isSelected?: boolean;
  onSelectOrder: (order: Order) => void;
  onUpdateStatus: (orderId: string, newStatus: OrderStatus) => Promise<void>;
  onAssignDriverClick: (order: Order) => void;
  onCancelClick?: (order: Order) => void;
  /** Tempo de Preparo da loja (min); padrão 25. */
  prepMinutes?: number | null;
}

export const CompactOrderCard: React.FC<CompactOrderCardProps> = ({
  order,
  density,
  isSelected = false,
  onSelectOrder,
  onUpdateStatus,
  onAssignDriverClick,
  onCancelClick,
  prepMinutes,
}) => {
  const [elapsedSec, setElapsedSec] = useState<number>(() => {
    return Math.max(0, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 1000));
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [order.createdAt]);

  const formatElapsed = (sec: number) => {
    const minutes = Math.floor(sec / 60);
    const seconds = sec % 60;
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remMin = minutes % 60;
      return `${hours}h ${String(remMin).padStart(2, '0')}m`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const isPreparingDelayed = checkIsPreparingDelayed(order.createdAt, order.status, prepMinutes);
  const baseTheme = ORDER_STATUS_THEME[order.status] || ORDER_STATUS_THEME.PENDING;
  const theme = isPreparingDelayed ? DELAYED_PREPARING_THEME : baseTheme;

  const isPending = order.status === 'PENDING';
  const isConfirmed = order.status === 'CONFIRMED';
  const isPreparing = order.status === 'PREPARING';
  const isReady = order.status === 'READY' || order.status === 'WAITING_FOR_DRIVER';
  const isDelivery = order.status === 'OUT_FOR_DELIVERY';
  const isDelivered = order.status === 'DELIVERED';
  const isCancelled = order.status === 'CANCELLED';

  const totalItemsCount = order.items?.reduce((acc, it) => acc + (it.quantity || 1), 0) || order.items?.length || 0;
  const isPickup = order.fulfillmentType === 'PICKUP';

  // Resumo inteligente dos itens para leitura operacional rápida
  const itemsText = order.items && order.items.length > 0
    ? order.items.map(it => `${it.quantity}x ${it.productName}`).join(', ')
    : '';

  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPending) {
      onUpdateStatus(order.id, 'CONFIRMED');
    } else if (isConfirmed) {
      onUpdateStatus(order.id, 'PREPARING');
    } else if (isPreparing) {
      onUpdateStatus(order.id, 'READY');
    } else if (isReady && isPickup) {
      // Retirada: cliente buscou no balcão (mesma transição da faixa de alertas).
      onUpdateStatus(order.id, 'DELIVERED');
    } else if (isReady) {
      onAssignDriverClick(order);
    } else if (isDelivery) {
      onUpdateStatus(order.id, 'DELIVERED');
    } else {
      onSelectOrder(order);
    }
  };

  // Ajustes de densidade no padding (COMANDO 125 - 30% mais compacto)
  const paddingClass = density === 'compact' 
    ? 'p-0.5 sm:p-1 pl-1.5 sm:pl-2' 
    : density === 'comfortable' 
    ? 'p-1.5 sm:p-2 pl-2 sm:pl-2.5' 
    : 'p-1 sm:p-1.5 pl-2 sm:pl-2.5';

  return (
    <div
      onClick={() => onSelectOrder(order)}
      style={{
        backgroundColor: theme.bg,
        borderColor: isSelected ? theme.accent : theme.border,
      }}
      className={`relative rounded border transition-all duration-150 flex flex-col justify-between cursor-pointer group overflow-hidden ${
        isSelected ? 'ring-2 ring-emerald-500/50 shadow-2xs' : 'hover:shadow-2xs'
      } ${paddingClass}`}
    >
      {/* Barra de cor lateral de status (4px - 6px) para leitura periférica imediata */}
      <div 
        className="absolute left-0 top-0 bottom-0 w-1" 
        style={{ backgroundColor: theme.accent }} 
      />

      <div className="space-y-0.5">
        {isPickup && !isDelivered && !isCancelled && (() => {
          const pay = paymentBadge(order);
          const wait = pickupWaitingMinutes(order, Date.now());
          return (
            <div className="flex flex-wrap items-center gap-0.5" data-testid="pickup-badges">
              <span data-testid="pickup-payment" data-paid={pay.paid}
                className={`text-[7.5px] font-black px-1 rounded border ${pay.paid ? 'bg-green-50 text-green-800 border-green-300' : 'bg-amber-50 text-amber-900 border-amber-300'}`}>
                {pay.paid ? '✓ ' : '$ '}{pay.label}
              </span>
              {wait !== null && (
                <span data-testid="pickup-waiting" className={`text-[7.5px] font-bold px-1 rounded border ${wait >= 15 ? 'bg-red-50 text-red-800 border-red-300' : 'bg-white text-green-800 border-green-300'}`}>
                  ⏱ {waitingText(wait)}
                </span>
              )}
            </div>
          );
        })()}
        {/* LINHA 1 (TOPO): # Pedido + Status com Dot + Tipo de Entrega + Cronômetro */}
        <div className="flex items-center justify-between gap-1 min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <span className="font-mono font-black text-slate-950 text-[10px] tracking-tight shrink-0">
              #{order.orderNumber || order.id.slice(0, 6)}
            </span>

            {/* Status: ícone + texto (nunca só cor) */}
            <OrderStatusChip status={order.status} late={isPreparingDelayed} className="text-[7px] px-1 py-0" />

            {/* Tipo: Delivery ou Retirada (exibido no topo em telas amplas) */}
            <span className="hidden xl:inline-flex items-center gap-0.5 text-[7.5px] font-bold text-slate-700 bg-white/70 px-0.5 py-0 rounded border border-slate-200/60 shrink-0">
              {isPickup ? (
                <>
                  <Building2 className="w-1.5 h-1.5 text-slate-500" />
                  <span>Retirada</span>
                </>
              ) : (
                <>
                  <Bike className="w-1.5 h-1.5 text-slate-500" />
                  <span>Delivery</span>
                </>
              )}
            </span>
          </div>

          {/* Tempo Decorrido / Cronômetro */}
          <div className="flex items-center gap-0.5 shrink-0 ml-auto">
            <SlaTimerChip status={order.status} createdAt={order.createdAt} prepMinutes={prepMinutes}
              now={new Date(order.createdAt).getTime() + elapsedSec * 1000} label={formatElapsed(elapsedSec)} className="text-[7.5px] px-1 py-0" />

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectOrder(order);
              }}
              className="text-slate-400 hover:text-slate-700 p-0.2 rounded hover:bg-white/50 transition-colors"
              title="Ver detalhes do pedido"
            >
              <MoreVertical className="w-2 h-2" />
            </button>
          </div>
        </div>

        {/* 19/10: o cronômetro faz o semáforo; o selo só aparece para pedido esquecido (1 dia+) */}
        {orderAgeInfo(order, new Date(order.createdAt).getTime() + elapsedSec * 1000).level === 'stale' && (
          <OrderAgeBadge order={order} now={new Date(order.createdAt).getTime() + elapsedSec * 1000} />
        )}

        {/* LINHA 2 (CENTRAL): Cliente + Tipo (em telas compactas) + Resumo dos Itens */}
        <div className="space-y-0.2 min-w-0">
          <div className="flex items-center justify-between gap-1 min-w-0">
            <div className="flex items-center gap-1 min-w-0">
              <User className="w-2 h-2 text-slate-400 shrink-0" />
              <span className="font-bold text-slate-900 text-[9.5px] truncate">
                {order.customerName}
              </span>
            </div>
            {/* Tag compacta de entrega quando não couber no topo */}
            <span className="xl:hidden inline-flex items-center gap-0.5 text-[7px] font-semibold text-slate-600 shrink-0">
              {isPickup ? <Building2 className="w-1.5 h-1.5" /> : <Bike className="w-1.5 h-1.5" />}
              <span>{isPickup ? 'Retirada' : 'Delivery'}</span>
            </span>
          </div>

          {/* Resumo formatado dos itens com truncate limpo */}
          <div className="flex items-center gap-1 text-[8px] text-slate-600 min-w-0">
            <ShoppingBag className="w-1.5 h-1.5 text-slate-400 shrink-0" />
            <span className="font-medium text-slate-700 shrink-0 text-[8px]">
              {totalItemsCount} {totalItemsCount === 1 ? 'item' : 'itens'}
            </span>
            {itemsText && (
              <>
                <span className="text-slate-400">•</span>
                <span className="truncate text-slate-600 text-[8px] font-normal" title={itemsText}>
                  {itemsText}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* LINHA 3 (BASE): Valor Total em Destaque + Botão de Ação Rápida */}
      <div className="flex items-center justify-between gap-1 pt-0.5 mt-0.2 border-t border-slate-200/50">
        <div className="flex items-baseline gap-1">
          <span className="font-mono font-black text-slate-950 text-[10px]">
            {formatBRL(order.totalAmount)}
          </span>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {/* Botão Secundário: Recusar Pedido (Apenas se NOVO e handler existir) */}
          {isPending && onCancelClick && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCancelClick(order);
              }}
              className="py-0.1 px-1 rounded font-bold text-[8px] bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 shadow-2xs transition-all cursor-pointer active:scale-98"
              title="Recusar pedido"
            >
              Recusar
            </button>
          )}

          {order.status === 'READY' && order.fulfillmentType !== 'PICKUP' && (
            <button
              type="button"
              data-testid="card-call-driver"
              onClick={(e) => { e.stopPropagation(); onUpdateStatus(order.id, 'WAITING_FOR_DRIVER'); }}
              className="py-0.1 px-1 rounded font-bold text-[8.5px] bg-[#15803d] text-white flex items-center justify-center gap-0.5 shadow-2xs hover:bg-[#166534] cursor-pointer"
            >
              <Truck className="w-2 h-2" /><span className="truncate">Chamar motoboy</span>
            </button>
          )}
          {/* Botão Principal */}
          <button
            type="button"
            onClick={handleActionClick}
            style={orderActionButtonStyle(theme, order)}
            className="py-0.1 px-1 rounded font-bold text-[8.5px] flex items-center justify-center gap-0.5 shadow-2xs hover:opacity-90 transition-all cursor-pointer active:scale-98"
          >
            {isPending && <Check className="w-1.5 h-1.5 stroke-[3]" />}
            {isConfirmed && <CheckCircle2 className="w-1.5 h-1.5" />}
            {isPreparing && <Check className="w-1.5 h-1.5 stroke-[3]" />}
            {isReady && (isPickup ? <CheckCircle2 className="w-1.5 h-1.5" /> : <Truck className="w-1.5 h-1.5" />)}
            {isDelivery && <CheckCircle2 className="w-1.5 h-1.5" />}
            {(isDelivered || isCancelled) && <Eye className="w-1.5 h-1.5" />}
            <span>{(isPickup && pickupActionLabel(order.status)) || theme.buttonLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};


