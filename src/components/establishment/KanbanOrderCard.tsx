import React, { useState, useEffect } from 'react';
import { Check, CheckCircle2, Truck, Eye, Clock, MessageSquare, ReceiptText, Archive, CreditCard, X } from 'lucide-react';
import { DriverOfferStatus, useOrderOffer } from '../dispatch/DriverOfferStatus';
import type { Order, OrderStatus } from '../../types';
import { ORDER_STATUS_THEME } from '../../utils/orderStatusTheme';
import { orderAgeInfo } from '../../lib/orders/orderAge';
import { pickupActionLabel, pickupWaitingMinutes, waitingText } from '../../lib/orders/fulfillmentTabs';
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
  const wait = pickupWaitingMinutes(order, now);
  const fulfillmentLabel = isDineIn ? (order.tableLabel?.trim() ? `Mesa ${order.tableLabel.trim().replace(/^mesa\s+/i, '').slice(0, 15)}` : 'Mesa') : isPickup ? 'Retirada' : 'Delivery';
  const paid = order.onlinePayment?.status === 'paid' || order.paymentStatus === 'PAID';
  const awaitingPayment = !!order.onlinePayment && order.onlinePayment.status !== 'paid';
  const stale = orderAgeInfo(order, now).level === 'stale';
  // Semáforo do prazo: verde < 15 min, âmbar até 30 min (perto de atrasar), vermelho acima (atrasado) ou pedido envelhecido.
  const urgency = isClosed ? 'closed' : stale || minutes > 30 ? 'late' : minutes >= 15 ? 'near' : 'ok';
  const urgencyLabel = { closed: 'Pedido encerrado', late: 'Atrasado', near: 'Perto de atrasar', ok: 'No prazo' }[urgency];
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

  const showPrimary = !live && !isClosed;

  return <article className="orders-kanban-card" data-selected={isSelected} data-urgency={urgency} data-testid={`order-card-${order.id}`}
    tabIndex={0} aria-label={`Pedido ${order.orderNumber}, ${order.customerName}`} aria-current={isSelected || undefined}
    draggable={!isClosed} onDragStart={e => { e.dataTransfer.setData('text/plain', order.id); e.dataTransfer.effectAllowed = 'move'; }}
    onClick={() => onSelectOrder(order)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelectOrder(order); } }}>
    {(live || retry) && <div className="orders-card-strip" data-offer="true" data-testid="driver-offer-strip"><DriverOfferStatus orderId={order.id} /></div>}
    {acceptedDriver && <div className="orders-card-strip flex items-center gap-1"><Truck size={11} />Entregador a caminho da loja</div>}
    {awaitingPayment && <div className="orders-card-strip flex items-center gap-1"><CreditCard size={11} />Aguardando pagamento</div>}
    <div className="orders-card-row">
      <div className="orders-card-main">
        <p className="orders-card-title" title={`#${order.orderNumber || order.id.slice(0, 6)} ${order.customerName}`}>
          <span>#{order.orderNumber || order.id.slice(0, 6)}</span> {order.customerName}
        </p>
        <p className="orders-card-sub">
          <span className="orders-card-sub-text" title={`${formatBRL(order.totalAmount)} · ${fulfillmentLabel} · ${paymentMethodShortLabel(order.paymentMethod)}`}>
            {formatBRL(order.totalAmount)}<span className="orders-card-extra"> · {fulfillmentLabel} · {paymentMethodShortLabel(order.paymentMethod)}</span>
          </span>
          {!isClosed && <span className="orders-card-timer" data-urgency={urgency}><Clock size={10} />{elapsed}</span>}
          {isPickup && !isClosed && wait !== null && <span data-testid="pickup-waiting" className="orders-card-timer" data-urgency={wait >= 15 ? 'late' : 'ok'}>{waitingText(wait)}</span>}
        </p>
      </div>
      <div className="orders-card-meta">
        {unreadChat && <span className="orders-card-unread" aria-hidden="true"><MessageSquare size={11} /></span>}
        {paid && <span className="orders-card-paid" title={order.onlinePayment ? 'Pago online' : 'Pagamento confirmado'}>Pago</span>}
        <span className="orders-card-dot" data-urgency={urgency} role="img" aria-label={urgencyLabel} title={urgencyLabel} />
      </div>
      <div className="orders-card-hover">
        {order.driverId && onOpenChat && <button type="button" className="orders-card-icon" aria-label="Abrir chat com o entregador" title="Chat com o entregador" onClick={e => { e.stopPropagation(); onOpenChat(order); }}>
          <MessageSquare size={13} />{unreadChat && <span data-testid="unread-chat-dot" className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-600 ring-2 ring-white" />}
        </button>}
        {onPrint && <button type="button" className="orders-card-icon" aria-label="Imprimir pedido" title="Imprimir pedido" onClick={e => { e.stopPropagation(); onPrint(order); }}><ReceiptText size={13} /></button>}
        {isClosed && onArchive && <button type="button" className="orders-card-icon disabled:opacity-50" disabled={archiveBusy} aria-label="Arquivar pedido" title="Arquivar pedido" onClick={e => { e.stopPropagation(); onArchive(order); }}><Archive size={13} /></button>}
        {!isClosed && onCancelClick && (isPending
          ? <button type="button" className="orders-card-icon orders-card-icon-danger orders-card-refuse" title="Recusar pedido" onClick={e => { e.stopPropagation(); onCancelClick(order); }}><X size={13} /><span>Recusar</span></button>
          : <button type="button" className="orders-card-icon orders-card-icon-danger" aria-label="Cancelar pedido" title="Cancelar pedido" onClick={e => { e.stopPropagation(); onCancelClick(order); }}><X size={13} /></button>)}
        {showPrimary && <button type="button" className="orders-card-action" title={actionLabel} aria-label={actionLabel} onClick={handleActionClick}
          data-testid={order.status === 'READY' && order.fulfillmentType === 'DELIVERY' && !order.driverId ? 'card-call-driver' : undefined}
          style={{ backgroundColor: theme.color }}><ActionIcon size={13} className="shrink-0" /><span>{actionLabel}</span></button>}
      </div>
    </div>
  </article>;
};
