import React, { useState, useEffect } from 'react';
import { 
  Clock, 
  MapPin, 
  Phone, 
  User, 
  CheckCircle2, 
  ArrowRight, 
  Printer, 
  MessageSquare, 
  AlertTriangle,
  Flame,
  Truck,
  RotateCcw,
  Zap,
  ShoppingBag,
  ExternalLink,
  Bike
} from 'lucide-react';
import { Order, OrderStatus, Driver } from '../../types';

interface OrderCardProps {
  order: Order;
  drivers: Driver[];
  activeTenantName: string;
  onUpdateStatus: (orderId: string, newStatus: OrderStatus, note?: string) => Promise<void>;
  onSelectOrder: (order: Order) => void;
  onPrint: (order: Order) => void;
  onAssignDriverClick: (order: Order) => void;
  onCancelClick: (order: Order) => void;
}

export const OrderCard: React.FC<OrderCardProps> = ({
  order,
  drivers,
  activeTenantName,
  onUpdateStatus,
  onSelectOrder,
  onPrint,
  onAssignDriverClick,
  onCancelClick,
}) => {
  // Timer de SLA decorrido
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(() => {
    return Math.max(0, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 1000));
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [order.createdAt]);

  const formatElapsed = (sec: number) => {
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const isPending = order.status === 'PENDING';
  const isConfirmed = order.status === 'CONFIRMED';
  const isPreparing = order.status === 'PREPARING';
  const isReady = order.status === 'READY';
  const isDelivery = order.status === 'OUT_FOR_DELIVERY';
  const isDelivered = order.status === 'DELIVERED';
  const isCancelled = order.status === 'CANCELLED';

  const orderTimeStr = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isSlaExceeded = elapsedSeconds > 1800; // > 30 min
  const assignedDriver = drivers.find(d => d.userId === order.driverId || d.id === order.driverId);

  // Detecção de canal
  const channel = order.origin === 'marketplace' ? 'Marketplace' : order.origin === 'qr_code' ? 'QR Code' : 'iFood / Web';

  // Identificador de cliente recorrente (baseado em cadastro prévio ou histórico)
  const isRecorrente = Boolean(order.customerId || (order.orderNumber && order.orderNumber > 1));

  return (
    <div 
      onClick={() => onSelectOrder(order)}
      className="bg-white rounded-3xl border border-slate-200/90 shadow-sm hover:shadow-md transition-all p-5 flex flex-col justify-between relative cursor-pointer group"
    >
      <div>
        {/* ================================================================= */}
        {/* TOPO: NÚMERO DO PEDIDO + HORA + VALOR TOTAL EM DESTAQUE VERDE      */}
        {/* ================================================================= */}
        <div className="flex items-start justify-between gap-2 pb-2.5">
          <div>
            <div className="flex items-center gap-1.5">
              <ShoppingBag className="w-4 h-4 text-emerald-700 shrink-0" />
              <h3 className="font-extrabold text-base text-slate-900 tracking-tight">
                Pedido <span className="font-mono text-emerald-800">#{order.orderNumber || order.id.slice(0, 6)}</span>
              </h3>
            </div>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5">
              Às {orderTimeStr}
            </p>
          </div>

          <div className="bg-emerald-50 border border-emerald-200/80 px-3.5 py-1.5 rounded-xl text-right shrink-0">
            <span className="font-mono font-black text-lg text-emerald-800">
              R$ {order.totalAmount.toFixed(2)}
            </span>
          </div>
        </div>

        {/* TAGS DE PAGAMENTO, ATENDIMENTO & STATUS */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1 pb-3">
          <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 font-mono font-bold text-[10px] uppercase border border-emerald-200">
            {order.paymentMethod === 'CASH' ? 'DINHEIRO' : order.paymentMethod === 'PIX' ? 'PIX' : 'CARTÃO'}
          </span>
          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono font-bold text-[10px] uppercase border border-slate-200 flex items-center gap-1">
            {order.fulfillmentType === 'PICKUP' ? '🛍️ RETIRADA' : '🛵 DELIVERY'}
          </span>
          {isRecorrente && (
            <span className="px-2 py-0.5 rounded-md bg-teal-50 text-teal-800 font-mono font-bold text-[10px] uppercase border border-teal-200 flex items-center gap-1">
              <RotateCcw className="w-2.5 h-2.5" />
              RECORRENTE
            </span>
          )}
          <span className={`px-2 py-0.5 rounded-md font-mono font-bold text-[10px] uppercase border ${
            isPending ? 'bg-amber-50 text-amber-800 border-amber-300 animate-pulse' :
            isPreparing || isConfirmed ? 'bg-blue-50 text-blue-800 border-blue-200' :
            isDelivery ? 'bg-purple-50 text-purple-800 border-purple-200' :
            isDelivered ? 'bg-emerald-100 text-emerald-900 border-emerald-300' :
            'bg-rose-50 text-rose-800 border-rose-200'
          }`}>
            {isPending ? 'NOVO PEDIDO' :
             isConfirmed ? 'CONFIRMADO' :
             isPreparing ? 'EM PREPARO' :
             isReady ? 'PRONTO P/ DESPACHO' :
             isDelivery ? 'EM ROTA' :
             isDelivered ? 'CONCLUÍDO' : 'CANCELADO'}
          </span>
        </div>

        {/* ================================================================= */}
        {/* CARD DO CLIENTE (AVATAR, NOME, TELEFONE, CANAL, ENDEREÇO)         */}
        {/* ================================================================= */}
        <div className="bg-slate-50/90 border border-slate-200/80 rounded-2xl p-3 mb-3.5 space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-600 to-teal-700 text-white font-black text-xs flex items-center justify-center shadow-xs shrink-0">
              {order.customerName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-extrabold text-xs text-slate-900 truncate">
                {order.customerName}
              </h4>
              <p className="text-[11px] text-slate-500 font-mono flex items-center gap-1.5 mt-0.5">
                <span>{order.customerPhone}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                  Canal: <strong className="text-slate-700">{channel}</strong>
                </span>
              </p>
            </div>

            {/* WhatsApp Direto */}
            {order.customerPhone && (
              <a
                href={`https://wa.me/55${order.customerPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá ${order.customerName}! Estamos preparando seu pedido #${order.orderNumber || order.id.substring(0, 6)} na ${activeTenantName || 'adega'}.`)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-xl border border-emerald-200 text-emerald-700 hover:bg-emerald-100/80 transition-colors shadow-2xs"
                title="Chamar no WhatsApp"
              >
                <MessageSquare className="w-4 h-4" />
              </a>
            )}
          </div>

          {/* Endereço */}
          <div className="flex items-start gap-1.5 text-[11px] text-slate-600 pt-1 border-t border-slate-200/60">
            <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
            <span className="line-clamp-2 leading-relaxed font-medium">
              {order.fulfillmentType === 'PICKUP' ? 'Retirada no Balcão' : order.deliveryAddress}
            </span>
          </div>

          {/* Motorista Atribuído */}
          {(assignedDriver || order.driverName) && (
            <div className="flex items-center gap-1.5 text-[11px] text-purple-700 font-semibold pt-1 border-t border-purple-100">
              <Bike className="w-3.5 h-3.5 text-purple-600 shrink-0" />
              <span>Entregador: <strong className="text-purple-900">{order.driverName || assignedDriver?.name || 'Motoboy'}</strong></span>
            </div>
          )}
        </div>

        {/* ================================================================= */}
        {/* LISTA DE PRODUTOS COM QUANTIDADES E VALORES                       */}
        {/* ================================================================= */}
        <div className="bg-slate-50/60 border border-slate-200/80 rounded-2xl p-3 mb-3.5 space-y-1.5">
          <div className="flex justify-between items-center text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 pb-1 border-b border-slate-200/60">
            <span>PRODUTOS ({order.items.length})</span>
            <span>SUBTOTAL</span>
          </div>

          <div className="space-y-1 max-h-36 overflow-y-auto pr-0.5">
            {order.items.map((it, idx) => (
              <div key={idx} className="flex justify-between items-center text-xs">
                <span className="text-slate-800 font-medium truncate pr-2">
                  <strong className="text-emerald-700 font-mono mr-1.5">{it.quantity}x</strong>
                  {it.productName}
                </span>
                <span className="font-mono font-bold text-slate-700 shrink-0 tabular-nums">
                  R$ {it.totalPrice.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          {order.notes && (
            <p className="text-[11px] text-amber-700 italic pt-1 border-t border-slate-200/60 leading-tight">
              Obs: {order.notes}
            </p>
          )}
        </div>

        {/* ================================================================= */}
        {/* SLA DE PREPARO COM TEMPO REAL ESTIMADO E BARRA DE PROGRESSO       */}
        {/* ================================================================= */}
        <div className="bg-rose-50/60 border border-rose-200/80 rounded-2xl p-3 mb-3.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-rose-600" />
              SLA DE PREPARO
            </span>
            <div className="font-mono font-extrabold text-sm text-rose-700 flex items-center gap-1 bg-white px-2 py-0.5 rounded-lg border border-rose-200">
              <Clock className="w-3 h-3 text-rose-500 animate-spin" />
              <span>{formatElapsed(elapsedSeconds)}</span>
            </div>
          </div>

          <div className="flex justify-between text-[10px] text-slate-500 font-mono pt-1">
            <span>Tempo limite: 30m</span>
            <span>{Math.min(100, Math.round((elapsedSeconds / 1800) * 100))}%</span>
          </div>

          {/* Barra de Progresso do SLA */}
          <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ${isSlaExceeded ? 'bg-rose-600' : 'bg-amber-500'}`}
              style={{ width: `${Math.min(100, (elapsedSeconds / 1800) * 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between pt-0.5 text-[10px]">
            <span className="text-slate-500">Padrão Adegas.ai</span>
            {isSlaExceeded ? (
              <span className="text-rose-600 font-bold flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Tempo ideal excedido!
              </span>
            ) : (
              <span className="text-emerald-700 font-semibold">Dentro do tempo</span>
            )}
          </div>
        </div>

        {/* ================================================================= */}
        {/* PAGAMENTO E TOTAL LÍQUIDO                                         */}
        {/* ================================================================= */}
        <div className="space-y-1 pb-3 text-xs">
          <div className="flex justify-between text-slate-500">
            <span>Pagamento:</span>
            <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-mono font-bold text-[10px]">
              ✓ Pago ({order.paymentMethod})
            </span>
          </div>

          <div className="flex justify-between items-baseline pt-1 border-t border-slate-100">
            <span className="font-bold text-slate-700">Total Líquido:</span>
            <span className="font-mono font-black text-xl text-emerald-800">
              R$ {order.totalAmount.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* BOTÕES DE AÇÃO OPERACIONAL: ACEITAR / PREPARAR / DESPACHAR / COMANDA */}
      {/* ================================================================= */}
      <div className="pt-2 border-t border-slate-100 space-y-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPrint(order);
            }}
            className="flex-1 py-2 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>Imprimir Comanda</span>
          </button>
        </div>

        {isPending && (
          <div className="grid grid-cols-12 gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUpdateStatus(order.id, 'CONFIRMED');
              }}
              className="col-span-8 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer transition-transform active:scale-98"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Aceitar Pedido</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCancelClick(order);
              }}
              className="col-span-4 py-2.5 px-2 rounded-xl border border-rose-200 bg-rose-50/80 hover:bg-rose-100 text-rose-700 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              <span>✕ Recusar</span>
            </button>
          </div>
        )}

        {isConfirmed && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdateStatus(order.id, 'PREPARING');
            }}
            className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/20 cursor-pointer"
          >
            <Flame className="w-4 h-4" />
            <span>Iniciar Preparo / Freezer</span>
          </button>
        )}

        {isPreparing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAssignDriverClick(order);
            }}
            className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md shadow-purple-600/20 cursor-pointer"
          >
            <Truck className="w-4 h-4" />
            <span>Despachar com Motoboy</span>
          </button>
        )}

        {isReady && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAssignDriverClick(order);
            }}
            className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md shadow-purple-600/20 cursor-pointer"
          >
            <Truck className="w-4 h-4" />
            <span>Pronto • Despachar</span>
          </button>
        )}

        {isDelivery && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdateStatus(order.id, 'DELIVERED');
            }}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Confirmar Entrega Concluída</span>
          </button>
        )}

        {(isDelivered || isCancelled) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdateStatus(order.id, 'PREPARING');
            }}
            className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reabrir Pedido</span>
          </button>
        )}
      </div>
    </div>
  );
};
