import React, { useState, useEffect } from 'react';
import { Bike, ShoppingBag, UtensilsCrossed, Check, CheckCircle2, Truck, Eye, Clock, MessageSquare, ReceiptText, Archive, Store, Smartphone, CreditCard } from 'lucide-react';
import { DriverOfferStatus, useOrderOffer } from '../dispatch/DriverOfferStatus';
import { OnlinePaymentBadge } from './OnlinePaymentBadge';
import type { Order, OrderStatus } from '../../types';
import { ORDER_STATUS_THEME } from '../../utils/orderStatusTheme';
import { orderAgeInfo } from '../../lib/orders/orderAge';
import { OrderAgeBadge } from './OrderAgeBadge';
import { pickupActionLabel, paymentBadge, pickupWaitingMinutes, waitingText } from '../../lib/orders/fulfillmentTabs';
import { paymentMethodShortLabel } from '../../lib/orders/labels';
import { formatBRL } from '../../lib/pricing/money';
import { KANBAN_COLUMN_THEME, kanbanColumnForStatus } from './ordersKanban';
import './ordersKanban.css';

interface KanbanOrderCardProps {
  order: Order;
  isSelected?: boolean;
  onSelectOrder: (order: Order) => void;
  onUpdateStatus: (orderId: string, newStatus: OrderStatus) => Promise<void>;
  onAssignDriverClick: (order: Order) => void;
  onCancelClick?: (order: Order) => void;
  onPrint?: (order: Order) => void;
  onOpenChat?: (order: Order) => void;
  onArchive?: (order: Order) => void;
  archiveBusy?: boolean;
  unreadChat?: boolean;
  prepMinutes?: number | null;
}

export const KanbanOrderCard: React.FC<KanbanOrderCardProps> = ({
  order, isSelected = false, onSelectOrder, onUpdateStatus, onAssignDriverClick,
  onCancelClick, onPrint, onOpenChat, onArchive, archiveBusy, unreadChat,
}) => {
  const { live, last } = useOrderOffer(order.id);
  const retry = last?.status === 'DECLINED' || last?.status === 'EXPIRED';
  const [now, setNow] = useState(Date.now);
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [order.createdAt]);
  const minutes = Math.max(0, Math.floor((now - Date.parse(order.createdAt)) / 60000));
  const elapsed = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}min` : `${minutes} min`;
  const theme = KANBAN_COLUMN_THEME[kanbanColumnForStatus(order.status)];
  const isPending = order.status === 'PENDING';
  const isConfirmed = order.status === 'CONFIRMED';
  const isPreparing = order.status === 'PREPARING';
  const isReady = order.status === 'READY' || order.status === 'WAITING_FOR_DRIVER';
  const isDelivery = order.status === 'OUT_FOR_DELIVERY';
  const isClosed = order.status === 'DELIVERED' || order.status === 'CANCELLED';
  const isPickup = order.fulfillmentType === 'PICKUP';
  const isDineIn = order.fulfillmentType === 'DINE_IN';
  const pay = paymentBadge(order);
  const wait = pickupWaitingMinutes(order, now);
  const FulfillmentIcon = isDineIn ? UtensilsCrossed : isPickup ? ShoppingBag : Bike;
  const OriginIcon = isDineIn ? UtensilsCrossed : order.origin === 'pos' ? Store : Smartphone;
  const originLabels: Partial<Record<Order['origin'], string>> = { pos: 'BALCÃO', marketplace: 'MARKETPLACE', whatsapp: 'WHATSAPP', instagram: 'INSTAGRAM', google: 'GOOGLE', indicacao: 'INDICAÇÃO', qr_code: 'QR CODE', outros: 'OUTROS' };
  const originLabel = isDineIn ? 'MESA' : originLabels[order.origin] || 'CARDÁPIO DIGITAL';
  const itemSummary = order.items?.map(item => `${item.quantity}× ${item.productName}`).join(' · ') || 'Sem itens informados';
  const date = new Date(order.createdAt);
  const dateLabel = `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}, ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  const acceptedDriver = !isClosed && isReady && !!order.driverId && !!order.driverAcceptedAt;

  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPending) void onUpdateStatus(order.id, 'CONFIRMED');
    else if (isConfirmed) void onUpdateStatus(order.id, 'PREPARING');
    else if (isPreparing) void onUpdateStatus(order.id, 'READY');
    else if (isReady && (isPickup || isDineIn)) void onUpdateStatus(order.id, 'DELIVERED');
    else if (isReady && order.status === 'READY' && !live && !order.driverId) onAssignDriverClick(order);
    else if (isDelivery) void onUpdateStatus(order.id, 'DELIVERED');
    else onSelectOrder(order);
  };
  const actionLabel = order.status === 'WAITING_FOR_DRIVER' || (isReady && order.driverId) ? 'Ver detalhes'
    : isDineIn && isReady ? 'Servir' : (isPickup && pickupActionLabel(order.status))
    || (retry && isReady ? 'Chamar outro' : isReady ? 'Chamar entregador' : ORDER_STATUS_THEME[order.status]?.buttonLabel || 'Ver detalhes');
  const ActionIcon = isClosed ? Eye : isReady && !isPickup && !isDineIn ? Truck : isPending || isPreparing ? Check : CheckCircle2;

  return <article className="orders-kanban-card" data-selected={isSelected} data-testid={`order-card-${order.id}`}
    tabIndex={0} aria-label={`Pedido ${order.orderNumber}, ${order.customerName}`}
    draggable={!isClosed} onDragStart={e => { e.dataTransfer.setData('text/plain', order.id); e.dataTransfer.effectAllowed = 'move'; }}
    onClick={() => onSelectOrder(order)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelectOrder(order); } }}>
    {(live || retry) && <div className="orders-card-strip" data-offer="true" data-testid="driver-offer-strip"><DriverOfferStatus orderId={order.id} /></div>}
    {acceptedDriver && <div className="orders-card-strip flex items-center gap-1.5"><Truck size={13} />Entregador a caminho da loja</div>}
    {order.onlinePayment && order.onlinePayment.status !== 'paid' && <div className="orders-card-strip flex items-center gap-1.5"><CreditCard size={13} />Aguardando pagamento</div>}
    <div className="flex items-start justify-between gap-2 text-[15px] text-[#111827]">
      <div className="min-w-0 font-semibold"><span className="font-bold">#{order.orderNumber || order.id.slice(0, 6)}</span><span className="block truncate" title={order.customerName}>{order.customerName}</span></div>
      <strong className="shrink-0 whitespace-nowrap text-[14px] tabular-nums">{formatBRL(order.totalAmount)}</strong>
    </div>
    <p className="mt-2 truncate text-[13px] text-slate-500" title={itemSummary}>{itemSummary}</p>
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold">
      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 ${isPickup ? 'bg-[#fef3c7] text-[#b45309]' : isDineIn ? 'bg-purple-100 text-purple-700' : 'bg-[#dbeafe] text-[#1d4ed8]'}`}>
        <FulfillmentIcon size={12} />{isDineIn ? (order.tableLabel?.trim() ? `MESA ${order.tableLabel.trim().replace(/^mesa\s+/i, '').slice(0, 15).toUpperCase()}` : 'MESA') : isPickup ? 'RETIRADA' : 'DELIVERY'}
      </span>
      <span className="rounded-md bg-slate-100 px-1.5 py-1 text-slate-600">{paymentMethodShortLabel(order.paymentMethod)}</span>
      {!isClosed && <span className={`inline-flex items-center gap-1 ${minutes < 15 ? 'text-green-600' : minutes <= 30 ? 'text-orange-600' : 'text-red-600'}`}><Clock size={12} />{elapsed}</span>}
    </div>
    <div className="mt-2 space-y-1">
      {order.onlinePayment?.status === 'paid' && <OnlinePaymentBadge order={order} />}
      {isPickup && !isClosed && <div className="flex flex-wrap gap-1 text-[10px] font-semibold" data-testid="pickup-badges">
        <span data-testid="pickup-payment" data-paid={pay.paid} className={`rounded-md px-1.5 py-1 ${pay.paid ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>{pay.label}</span>
        {wait !== null && <span data-testid="pickup-waiting" className={`rounded-md px-1.5 py-1 ${wait >= 15 ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}>{waitingText(wait)}</span>}
      </div>}
      {orderAgeInfo(order, now).level === 'stale' && <OrderAgeBadge order={order} now={now} />}
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0 text-[9px] uppercase text-slate-400"><span className="flex items-center gap-1"><OriginIcon size={12} />{originLabel}</span><time dateTime={order.createdAt}>{dateLabel}</time></div>
      <div className="flex items-center gap-1">
        {order.driverId && onOpenChat && <button type="button" className="orders-card-icon" aria-label="Abrir chat com o entregador" title="Chat com o entregador" onClick={e => { e.stopPropagation(); onOpenChat(order); }}>
          <MessageSquare size={14} />{unreadChat && <span data-testid="unread-chat-dot" className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-600 ring-2 ring-white" />}
        </button>}
        {onPrint && <button type="button" className="orders-card-icon" aria-label="Imprimir pedido" title="Imprimir pedido" onClick={e => { e.stopPropagation(); onPrint(order); }}><ReceiptText size={14} /></button>}
        {isClosed && onArchive && <button type="button" className="orders-card-icon disabled:opacity-50" disabled={archiveBusy} aria-label="Arquivar pedido" title="Arquivar pedido" onClick={e => { e.stopPropagation(); onArchive(order); }}><Archive size={14} /></button>}
      </div>
    </div>
    <div className="mt-3 space-y-2">
      {isPending && onCancelClick && <button type="button" className="text-[11px] font-semibold text-red-600 hover:underline" onClick={e => { e.stopPropagation(); onCancelClick(order); }}>Recusar</button>}
      {!live && <button type="button" className="orders-card-action" onClick={handleActionClick}
        data-testid={order.status === 'READY' && order.fulfillmentType === 'DELIVERY' && !order.driverId ? 'card-call-driver' : undefined}
        style={{ backgroundColor: theme.color }}><ActionIcon size={14} className="shrink-0" /><span>{actionLabel}</span></button>}
    </div>
  </article>;
};
