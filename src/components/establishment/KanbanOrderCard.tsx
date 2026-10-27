import React, { useState, useEffect } from 'react';
import { Check, CheckCircle2, Truck, Eye, Clock, MessageSquare, ReceiptText, Archive, CreditCard, X, Bike, ShoppingBag, UtensilsCrossed, Store, Wallet, Smartphone } from 'lucide-react';
import { DriverOfferStatus, useOrderOffer } from '../dispatch/DriverOfferStatus';
import type { Order, OrderStatus } from '../../types';
import { ORDER_STATUS_THEME } from '../../utils/orderStatusTheme';
import { orderAgeInfo } from '../../lib/orders/orderAge';
import { pickupActionLabel, pickupWaitingMinutes, waitingText } from '../../lib/orders/fulfillmentTabs';
import { paymentMethodShortLabel } from '../../lib/orders/labels';
import { formatBRL } from '../../lib/pricing/money';
import { KANBAN_COLUMN_THEME, kanbanColumnForStatus, itemsSummary } from './ordersKanban';
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
  const elapsed = minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}` : `${minutes}m`;
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
  const paid = order.onlinePayment?.status === 'paid' || order.paymentStatus === 'PAID';
  const awaitingPayment = !!order.onlinePayment && order.onlinePayment.status !== 'paid';
  const stale = orderAgeInfo(order, now).level === 'stale';
  // Semáforo do prazo: verde < 15 min, âmbar até 30 min (perto de atrasar), vermelho acima (atrasado) ou pedido envelhecido.
  const urgency = isClosed ? 'closed' : stale || minutes > 30 ? 'late' : minutes >= 15 ? 'near' : 'ok';
  const TypeIcon = isDineIn ? UtensilsCrossed : order.origin === 'pos' ? Store : isPickup ? ShoppingBag : Bike;
  const typeLabel = isDineIn ? (order.tableLabel?.trim() ? `Mesa ${order.tableLabel.trim().replace(/^mesa\s+/i, '').slice(0, 15)}` : 'Mesa') : order.origin === 'pos' ? 'Balcão' : isPickup ? 'Retirada' : 'Delivery';
  const hood = !isDineIn && !isPickup && order.origin !== 'pos' ? (order.addressDetails?.neighborhood || '').trim() : '';
  const PayIcon = /CARD/i.test(String(order.paymentMethod)) ? CreditCard : Wallet;
  const { short: itemSummary, full: itemSummaryFull } = itemsSummary(order);
  const OriginIcon = isDineIn ? UtensilsCrossed : order.origin === 'pos' ? Store : Smartphone;
  const originLabels: Partial<Record<Order['origin'], string>> = { pos: 'Balcão', marketplace: 'Marketplace', whatsapp: 'WhatsApp', instagram: 'Instagram', google: 'Google', indicacao: 'Indicação', qr_code: 'QR Code', outros: 'Outros' };
  const originLabel = isDineIn ? 'Mesa' : originLabels[order.origin] || 'Cardápio digital';
  const date = new Date(order.createdAt);
  const dateLabel = `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
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

  return <article className="orders-kanban-card" data-selected={isSelected} data-column={kanbanColumnForStatus(order.status)} style={{ '--kc': theme.color } as React.CSSProperties} data-urgency={urgency} data-testid={`order-card-${order.id}`}
    tabIndex={0} aria-label={`Pedido ${order.orderNumber}, ${order.customerName}`} aria-current={isSelected || undefined}
    draggable={!isClosed} onDragStart={e => { e.dataTransfer.setData('text/plain', order.id); e.dataTransfer.effectAllowed = 'move'; }}
    onClick={() => onSelectOrder(order)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelectOrder(order); } }}>
    {(live || retry) && <div className="orders-card-strip" data-offer="true" data-testid="driver-offer-strip"><DriverOfferStatus orderId={order.id} /></div>}
    {acceptedDriver && <div className="orders-card-strip flex items-center gap-1"><Truck size={11} />Entregador a caminho da loja</div>}
    {awaitingPayment && <div className="orders-card-strip flex items-center gap-1"><CreditCard size={11} />Aguardando pagamento</div>}
    <div className="orders-card-row">
      <div className="orders-card-l1">
        <p className="orders-card-title" title={`#${order.orderNumber || order.id.slice(0, 6)} ${order.customerName}`}><span className="orders-card-num">#{order.orderNumber || order.id.slice(0, 6)}</span></p>
        <strong className="orders-card-total">{formatBRL(order.totalAmount)}</strong>
      </div>
      <p className="orders-card-name" title={order.customerName}>{order.customerName}</p>
      <p className="orders-card-items" title={itemSummaryFull}>{itemSummary}</p>
      <div className="orders-card-l3">
        <div className="orders-card-chips">
          <span className="orders-card-chip" data-kind="type" title={typeLabel + (hood ? ` · ${hood}` : '')}><TypeIcon size={11} /><span className="orders-card-chip-label">{typeLabel}</span>{hood && <span className="orders-card-hood">· {hood}</span>}</span>
          <span className="orders-card-chip orders-card-paychip" data-kind="pay" data-paid={paid}><PayIcon size={11} /><span>{paymentMethodShortLabel(order.paymentMethod)}</span></span>
          {paid && <span className="orders-card-chip orders-card-paid" title={order.onlinePayment ? 'Pago online' : 'Pagamento confirmado'}><Check size={10} strokeWidth={3} />Pago</span>}
          {!isClosed && <span className="orders-card-chip orders-card-timer" data-urgency={urgency}><Clock size={10} />{elapsed}</span>}
          {isPickup && !isClosed && wait !== null && <span data-testid="pickup-waiting" className="orders-card-chip orders-card-timer" data-urgency={wait >= 15 ? 'late' : 'ok'}>{waitingText(wait)}</span>}
        </div>
        <div className="orders-card-meta">
          {unreadChat && <span className="orders-card-unread" aria-hidden="true"><MessageSquare size={11} /></span>}
          <span className="orders-card-dot" data-urgency={urgency} role="img" aria-label={urgencyLabel} title={urgencyLabel} />
        </div>
      </div>
      <div className="orders-card-footer">
        <div className="orders-card-origin" title={`${originLabel} · ${dateLabel}`}><OriginIcon size={11} /><span className="orders-card-origin-label">{originLabel}</span><time dateTime={order.createdAt}>{dateLabel}</time></div>
        <div className="orders-card-actions">
          {order.driverId && onOpenChat && <button type="button" className="orders-card-icon" aria-label="Abrir chat com o entregador" title="Chat com o entregador" onClick={e => { e.stopPropagation(); onOpenChat(order); }}>
            <MessageSquare size={13} />{unreadChat && <span data-testid="unread-chat-dot" className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-600 ring-2 ring-white" />}
          </button>}
          {onPrint && <button type="button" className="orders-card-icon" aria-label="Imprimir pedido" title="Imprimir pedido" onClick={e => { e.stopPropagation(); onPrint(order); }}><ReceiptText size={13} /></button>}
          {isClosed && onArchive && <button type="button" className="orders-card-icon disabled:opacity-50" disabled={archiveBusy} aria-label="Arquivar pedido" title="Arquivar pedido" onClick={e => { e.stopPropagation(); onArchive(order); }}><Archive size={13} /></button>}
          {!isClosed && onCancelClick && (isPending
            ? <button type="button" className="orders-card-icon orders-card-icon-danger orders-card-refuse" title="Recusar pedido" onClick={e => { e.stopPropagation(); onCancelClick(order); }}><X size={13} /><span>Recusar</span></button>
            : <button type="button" className="orders-card-icon orders-card-icon-danger" aria-label="Cancelar pedido" title="Cancelar pedido" onClick={e => { e.stopPropagation(); onCancelClick(order); }}><X size={13} /></button>)}
          {showPrimary ? <button type="button" className="orders-card-action" title={actionLabel} aria-label={actionLabel} onClick={handleActionClick}
            data-testid={order.status === 'READY' && order.fulfillmentType === 'DELIVERY' && !order.driverId ? 'card-call-driver' : undefined}
            style={{ backgroundColor: theme.color }}><ActionIcon size={13} className="shrink-0" /><span>{actionLabel}</span></button>
            : live ? <button type="button" className="orders-card-details" onClick={e => { e.stopPropagation(); onSelectOrder(order); }}>Detalhes</button> : null}
        </div>
      </div>
    </div>
  </article>;
};
