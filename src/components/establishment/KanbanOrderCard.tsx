import { OnlinePaymentBadge } from './OnlinePaymentBadge';
import React, { useState, useEffect } from 'react';
import { 
  Clock, 
  User, 
  Bike, 
  Building2, 
  ShoppingBag,
  Check, 
  CheckCircle2, 
  Truck, 
  Eye, 
  MoreVertical,
  GripVertical,
  AlertTriangle
} from 'lucide-react';
import { Order, OrderStatus } from '../../types';
import { 
  ORDER_STATUS_THEME, 
  DELAYED_PREPARING_THEME, 
  checkIsPreparingDelayed,
  orderActionButtonStyle,
} from '../../utils/orderStatusTheme';
import { SlaTimerChip } from './SlaTimerChip';
import { OrderStatusChip } from './StatusIcon';
import { orderAgeInfo } from '../../lib/orders/orderAge';
import { OrderAgeBadge } from './OrderAgeBadge';
import { pickupActionLabel, paymentBadge, pickupWaitingMinutes, waitingText } from '../../lib/orders/fulfillmentTabs';
import { formatBRL } from '../../lib/pricing/money';

interface KanbanOrderCardProps {
  order: Order;
  isSelected?: boolean;
  onSelectOrder: (order: Order) => void;
  onUpdateStatus: (orderId: string, newStatus: OrderStatus) => Promise<void>;
  onAssignDriverClick: (order: Order) => void;
  onCancelClick?: (order: Order) => void;
  /** Tempo de Preparo da loja (min); padrão 25. */
  prepMinutes?: number | null;
}

export const KanbanOrderCard: React.FC<KanbanOrderCardProps> = ({
  order,
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

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', order.id);
    e.dataTransfer.effectAllowed = 'move';
  };

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

  return (
    <div
      draggable={!isDelivered && !isCancelled}
      onDragStart={handleDragStart}
      onClick={() => onSelectOrder(order)}
      style={{
        backgroundColor: theme.bg,
        borderColor: isSelected ? theme.accent : theme.border,
      }}
      className={`relative rounded border p-1 sm:p-1.5 shadow-2xs hover:shadow-xs transition-all duration-150 cursor-grab active:cursor-grabbing flex flex-col justify-between overflow-hidden select-none ${
        isSelected ? 'ring-2 ring-emerald-500/60 shadow-2xs' : ''
      }`}
    >
      {/* Barra de status na lateral esquerda */}
      <div 
        className="absolute left-0 top-0 bottom-0 w-1" 
        style={{ backgroundColor: theme.accent }} 
      />

      <div className="pl-0.5 space-y-0.5">
        <OnlinePaymentBadge order={order} />
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
        {/* Linha 1: # Pedido + Indicador de Atraso + Tempo decorrido */}
        <div className="flex items-center justify-between gap-1 pb-0.2">
          <div className="flex items-center gap-0.5 min-w-0">
            <GripVertical className="w-2 h-2 text-slate-300 group-hover:text-slate-500 shrink-0" />
            <span className="font-mono font-black text-slate-950 text-[10px] sm:text-[10.5px]">
              #{order.orderNumber || order.id.slice(0, 6)}
            </span>
            <OrderStatusChip status={order.status} late={isPreparingDelayed} className="text-[7.5px] px-1 py-0" />
          </div>

          <SlaTimerChip status={order.status} createdAt={order.createdAt} prepMinutes={prepMinutes}
            now={new Date(order.createdAt).getTime() + elapsedSec * 1000} label={formatElapsed(elapsedSec)} className="text-[8px] px-1 py-0" />
        </div>

        {/* 19/10: o cronômetro faz o semáforo; o selo só aparece para pedido esquecido (1 dia+) */}
        {orderAgeInfo(order, new Date(order.createdAt).getTime() + elapsedSec * 1000).level === 'stale' && (
          <OrderAgeBadge order={order} now={new Date(order.createdAt).getTime() + elapsedSec * 1000} />
        )}

        {/* Linha 2: Cliente + Valor */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-0.5 min-w-0">
            <User className="w-2 h-2 text-slate-400 shrink-0" />
            <span className="font-bold text-slate-900 text-[9.5px] truncate">
              {order.customerName}
            </span>
          </div>

          <div className="font-mono font-black text-slate-950 text-[10px] shrink-0">
            {formatBRL(order.totalAmount)}
          </div>
        </div>

        {/* Linha 3: Itens + Atendimento (Delivery/Retirada) */}
        <div className="flex items-center justify-between text-[8px] text-slate-600 pt-0.2 pb-0.5 border-b border-slate-200/40">
          <div className="flex items-center gap-0.5">
            <ShoppingBag className="w-2 h-2 text-slate-400" />
            <span className="font-medium">{totalItemsCount} {totalItemsCount === 1 ? 'item' : 'itens'}</span>
          </div>

          <div className="flex items-center gap-0.5 font-semibold text-slate-700">
            {isPickup ? (
              <>
                <Building2 className="w-2 h-2 text-slate-400" />
                <span>Retirada</span>
              </>
            ) : (
              <>
                <Bike className="w-2 h-2 text-slate-400" />
                <span>Delivery</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Linha 4: Botões de Ação */}
      <div className="pt-1 flex items-center gap-0.5">
        {/* Botão Secundário: Recusar (Apenas se NOVO) */}
        {isPending && onCancelClick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCancelClick(order);
            }}
            className="py-0.5 px-1 rounded font-bold text-[8px] bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 shadow-2xs transition-all cursor-pointer active:scale-98 shrink-0"
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
            className="flex-1 py-0.5 px-1 rounded font-bold text-[8.5px] bg-[#15803d] text-white flex items-center justify-center gap-0.5 shadow-2xs hover:bg-[#166534] cursor-pointer"
          >
            <Truck className="w-2 h-2" /><span className="truncate">Chamar motoboy</span>
          </button>
        )}
        {/* Botão de Ação Primária */}
        <button
          type="button"
          onClick={handleActionClick}
          style={orderActionButtonStyle(theme, order)}
          className="flex-1 py-0.5 px-1 rounded font-bold text-[8.5px] flex items-center justify-center gap-0.5 shadow-2xs hover:opacity-90 transition-all cursor-pointer active:scale-98 truncate"
        >
          {isPending && <Check className="w-2 h-2 stroke-[3]" />}
          {isConfirmed && <CheckCircle2 className="w-2 h-2" />}
          {isPreparing && <Check className="w-2 h-2 stroke-[3]" />}
          {isReady && (isPickup ? <CheckCircle2 className="w-2 h-2" /> : <Truck className="w-2 h-2" />)}
          {isDelivery && <CheckCircle2 className="w-2 h-2" />}
          {(isDelivered || isCancelled) && <Eye className="w-2 h-2" />}
          <span className="truncate">{(isPickup && pickupActionLabel(order.status)) || theme.buttonLabel}</span>
        </button>
      </div>
    </div>
  );
};

