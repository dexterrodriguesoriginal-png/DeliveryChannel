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
  checkIsPreparingDelayed 
} from '../../utils/orderStatusTheme';

interface KanbanOrderCardProps {
  order: Order;
  isSelected?: boolean;
  onSelectOrder: (order: Order) => void;
  onUpdateStatus: (orderId: string, newStatus: OrderStatus) => Promise<void>;
  onAssignDriverClick: (order: Order) => void;
  onCancelClick?: (order: Order) => void;
}

// Mapeamento oficial de cores do botão de ação por status (COMANDO 133)
const getKanbanActionButtonColors = (status: OrderStatus) => {
  switch (status) {
    case 'PENDING':
      return {
        bg: '#EAB308', // 🟡 Amarelo/dourado
        text: '#0F172A', // Texto escuro de alto contraste
      };
    case 'CONFIRMED':
      return {
        bg: '#2563EB', // 🔵 Azul
        text: '#FFFFFF',
      };
    case 'PREPARING':
      return {
        bg: '#16A34A', // 🟢 Verde
        text: '#FFFFFF',
      };
    case 'READY':
    case 'WAITING_FOR_DRIVER':
      return {
        bg: '#7C3AED', // 🟣 Roxo
        text: '#FFFFFF',
      };
    case 'OUT_FOR_DELIVERY':
      return {
        bg: '#2563EB', // 🔵 Azul
        text: '#FFFFFF',
      };
    case 'DELIVERED':
      return {
        bg: '#E2E8F0', // 🟢 Verde/cinza neutro
        text: '#334155',
      };
    case 'CANCELLED':
      return {
        bg: '#DC2626', // 🔴 Vermelho
        text: '#FFFFFF',
      };
    default:
      return {
        bg: '#2563EB',
        text: '#FFFFFF',
      };
  }
};

export const KanbanOrderCard: React.FC<KanbanOrderCardProps> = ({
  order,
  isSelected = false,
  onSelectOrder,
  onUpdateStatus,
  onAssignDriverClick,
  onCancelClick,
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

  const isPreparingDelayed = checkIsPreparingDelayed(order.createdAt, order.status, 25);
  const baseTheme = ORDER_STATUS_THEME[order.status] || ORDER_STATUS_THEME.PENDING;
  const theme = isPreparingDelayed ? DELAYED_PREPARING_THEME : baseTheme;
  const actionButtonColors = getKanbanActionButtonColors(order.status);

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
        {/* Linha 1: # Pedido + Indicador de Atraso + Tempo decorrido */}
        <div className="flex items-center justify-between gap-1 pb-0.2">
          <div className="flex items-center gap-0.5 min-w-0">
            <GripVertical className="w-2 h-2 text-slate-300 group-hover:text-slate-500 shrink-0" />
            <span className="font-mono font-black text-slate-950 text-[10px] sm:text-[10.5px]">
              #{order.orderNumber || order.id.slice(0, 6)}
            </span>
            {isPending && (
              <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse shrink-0" title="Novo Pedido" />
            )}
            {isPreparingDelayed && (
              <span className="inline-flex items-center gap-0.5 text-[7px] font-bold text-red-700 bg-red-100 px-0.5 py-0 rounded border border-red-200">
                <AlertTriangle className="w-1.5 h-1.5" /> Atrasado
              </span>
            )}
          </div>

          <div className={`flex items-center gap-0.5 font-mono text-[8px] font-bold shrink-0 ${isPreparingDelayed ? 'text-red-700' : 'text-slate-700'}`}>
            <Clock className={`w-2 h-2 ${isPreparingDelayed ? 'text-red-600 animate-pulse' : 'text-rose-500'}`} />
            <span>{formatElapsed(elapsedSec)}</span>
          </div>
        </div>

        {/* Linha 2: Cliente + Valor */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-0.5 min-w-0">
            <User className="w-2 h-2 text-slate-400 shrink-0" />
            <span className="font-bold text-slate-900 text-[9.5px] truncate">
              {order.customerName}
            </span>
          </div>

          <div className="font-mono font-black text-slate-950 text-[10px] shrink-0">
            R$ {order.totalAmount.toFixed(2)}
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

        {/* Botão de Ação Primária */}
        <button
          type="button"
          onClick={handleActionClick}
          style={{
            backgroundColor: actionButtonColors.bg,
            color: actionButtonColors.text,
          }}
          className="flex-1 py-0.5 px-1 rounded font-bold text-[8.5px] flex items-center justify-center gap-0.5 shadow-2xs hover:opacity-90 transition-all cursor-pointer active:scale-98 truncate"
        >
          {isPending && <Check className="w-2 h-2 stroke-[3]" />}
          {isConfirmed && <CheckCircle2 className="w-2 h-2" />}
          {isPreparing && <Check className="w-2 h-2 stroke-[3]" />}
          {isReady && <Truck className="w-2 h-2" />}
          {isDelivery && <CheckCircle2 className="w-2 h-2" />}
          {(isDelivered || isCancelled) && <Eye className="w-2 h-2" />}
          <span className="truncate">{theme.buttonLabel}</span>
        </button>
      </div>
    </div>
  );
};

