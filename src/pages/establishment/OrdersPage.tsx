import { visibleStaffOrders } from '../../lib/orders/onlinePaymentGate';
import { OnlineOrderPaymentPanel } from '../../components/client/OnlineOrderPaymentPanel';
import { OnlinePaymentBadge } from '../../components/establishment/OnlinePaymentBadge';
import { OrderChat } from '../../components/chat/OrderChat';
import { dispatchChatRepository, QueueDriver, DispatchMode } from '../../repositories/dispatchChatRepository';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { KanbanColumnHeader } from '../../components/establishment/KanbanColumnHeader';
import { ArrivalQueuePanel } from '../../components/pickup/ArrivalQueuePanel';
import { PickupHandoverModal } from '../../components/pickup/PickupHandoverModal';
import { arrivalRepository } from '../../repositories/arrivalRepository';
import { tabCounts, tabTone, pickupActionLabel, matchesFulfillmentTab, dineInOrderLabel, resolveDineInTableLabels, visibleFulfillmentTabsFor, type FulfillmentTab } from '../../lib/orders/fulfillmentTabs';
import { PickupCodeBadge } from '../../components/establishment/PickupCodeBadge';
import { storeDeliveredNeedsReason } from '../../lib/orders/handoff';
import { useAuth } from '../../context/AuthContext';
import { orderRepository } from '../../repositories/orderRepository';
import { validateStatusChange } from '../../repositories/orderMappers';
import { isN1N6Backend, N1N6_ONLY_MESSAGE } from '../../lib/backendSchema';
import { rpcErrorMessage } from '../../lib/rpcErrors';
import { driverRepository, driverInviteRepository } from '../../repositories/driverRepository';
import { productRepository } from '../../repositories/productRepository';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { Order, OrderStatus, PaymentStatus, Driver, Product } from '../../types';
import { playNewOrderSound } from '../../utils/audio';
import { ThermalReceiptModal } from '../../components/establishment/ThermalReceiptModal';
import { PDVModal } from '../../components/establishment/PDVModal';
import { CompactOrderCard, CardDensity } from '../../components/establishment/CompactOrderCard';
import { KanbanOrderCard } from '../../components/establishment/KanbanOrderCard';
import { OrderStatusChip, StatusIconByKey } from '../../components/establishment/StatusIcon';
import { SlaTimerChip } from '../../components/establishment/SlaTimerChip';
import { useNewOrderAlarm } from '../../lib/orders/newOrderAlarm';
import { ORDER_STATUS_THEME, DELAYED_PREPARING_THEME, checkIsPreparingDelayed, orderActionButtonStyle } from '../../utils/orderStatusTheme';
import { 
  ShoppingBag, 
  Bike, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Phone, 
  MapPin, 
  FileText, 
  User, 
  RefreshCw, 
  Search, 
  X, 
  ChevronRight, 
  ChevronUp,
  ChevronDown,
  AlertTriangle, 
  Printer, 
  Plus, 
  Bell, 
  Truck, 
  DollarSign, 
  MessageSquare, 
  Layers, 
  LayoutGrid, 
  List, 
  Volume2, 
  VolumeX, 
  Flame, 
  Building2,
  Calendar,
  Check,
  UtensilsCrossed,
  Package,
  XCircle,
  ClipboardCheck,
  CheckCheck,
  MoreVertical,
  SlidersHorizontal,
  FileSpreadsheet
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { assignableDrivers, canAssignDrivers } from '../../lib/driverAdmin';
import { useModules } from '../../hooks/useModules';
import { paymentMethodLabel, ownerStatusToastMessage } from '../../lib/orders/labels';
import { applyOrderUpdate } from '../../lib/orders/applyOrderUpdate';
import { OrderTotalsLines } from '../../components/establishment/OrderTotalsLines';
import { formatBRL } from '../../lib/pricing/money';
import { OrderAgeBadge } from '../../components/establishment/OrderAgeBadge';
import { FOCUS_ORDER_KEY } from '../../lib/orders/orderAlerts';
import { sortOrdersNewestFirst, countStaleActiveOrders } from '../../lib/orders/orderAge';
import { dispatchErrorMessage, noApprovedDriverMessage, NO_APPROVED_DRIVER_TITLE, shouldBlockCallDriver } from '../../lib/orders/dispatchErrors';
import { supabase } from '../../lib/supabase';

function orderForCard(order: Order): Order {
  return order.fulfillmentType === 'DINE_IN'
    ? { ...order, customerName: dineInOrderLabel(order) }
    : order;
}

interface OrdersPageProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

const ORDER_STATUS_TABS = new Set([
  'ALL',
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
]);

export const OrdersPage: React.FC<OrdersPageProps> = ({ activeTab: requestedTab, onTabChange }) => {
  const { activeTenant, securityContext, availableTenants, switchTenant, supabaseUser, activeRole } = useAuth();
  const { isModuleEnabled } = useModules();
  const { showToast } = useToast();

  // Estados principais da fila de pedidos
  const [remoteOrders, setRemoteOrders] = useState<Order[] | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  // 19/10: true só quando list_assignable_drivers respondeu com sucesso (vazio = loja sem entregador aprovado).
  const [driversLoaded, setDriversLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());
  const [syncError, setSyncError] = useState<string | null>(null);

  // Modo de visualização: CARDS, KANBAN ou TABELA
  const [viewMode, setViewMode] = useState<'cards' | 'kanban' | 'table'>('cards');

  // Tamanho dos cards em porcentagem com botões (-) e (+) (50% a 150%)
  const [cardScale, setCardScale] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('adegafood_card_scale');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 50 && parsed <= 150) return parsed;
      }
    } catch {}
    return 100;
  });

  const handleStepCardScale = (delta: number) => {
    setCardScale(prev => {
      const next = Math.max(50, Math.min(150, prev + delta));
      try {
        localStorage.setItem('adegafood_card_scale', String(next));
      } catch {}
      return next;
    });
  };

  const handleResetCardScale = () => {
    setCardScale(100);
    try {
      localStorage.setItem('adegafood_card_scale', '100');
    } catch {}
  };

  // Mantém density sincronizada para compatibilidade
  const density: CardDensity = cardScale <= 80 ? 'compact' : cardScale <= 110 ? 'normal' : 'comfortable';

  // Som de alerta e Auto-aceitar
  const soundEnabled = !['OWNER','MANAGER'].includes(activeRole || '');
  // Tempo de Preparo da loja (min) para o semáforo/atraso; padrão 25 (lib/orders/sla)
  const prepMinutes = activeTenant?.settings?.defaultPrepTimeMinutes;

  // Filtros (Padrão: 'ALL' como no print, onde o pill "Todos 12" fica verde)
  const [internalActiveTab, setInternalActiveTab] = useState<string>('ALL');
  const activeTab = requestedTab === undefined
    ? internalActiveTab
    : ORDER_STATUS_TABS.has(requestedTab) ? requestedTab : 'ALL';
  const changeActiveTab = (tab: string) => {
    setInternalActiveTab(tab);
    onTabChange?.(tab);
  };
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterFulfillment, setFilterFulfillment] = useState<'ALL' | FulfillmentTab>('DELIVERY');
  const [filterDriver, setFilterDriver] = useState<'ALL' | 'WITH_DRIVER' | 'WITHOUT_DRIVER'>('ALL');
  const [filterPeriod, setFilterPeriod] = useState<'ALL' | 'TODAY' | 'YESTERDAY' | '7D' | '30D'>('ALL');

  // COMANDO 135: Painel de controles recolhível (Busca, filtros, abas, modos, legenda)
  const [isControlsCollapsed, setIsControlsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('adegafood_orders_controls_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleControlsCollapsed = () => {
    setIsControlsCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('adegafood_orders_controls_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  // Pedido selecionado para Drawer lateral acoplado (como no print)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [drawerTab, setDrawerTab] = useState<'detalhes' | 'historico' | 'acoes'>('detalhes');

  // Impressão Térmica 80mm & Frente de Caixa PDV
  const [orderToPrint, setOrderToPrint] = useState<Order | null>(null);
  const [isPDVOpen, setIsPDVOpen] = useState(false);
  const [storeProducts, setStoreProducts] = useState<Product[]>([]);

  // Referência para contagem anterior de novos pedidos (alarme sonoro)
  const prevPendingCountRef = useRef<number | null>(null);

  // Modal de atribuição de motorista
  const [assigningOrder, setAssigningOrder] = useState<Order | null>(null);
  const [selectedDriverUserId, setSelectedDriverUserId] = useState<string>('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [dispatchMode, setDispatchMode] = useState<DispatchMode>('OWNER_PICKS');
  const [queue, setQueue] = useState<QueueDriver[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState('');
  useEffect(() => {
    let alive = true; setSelectedDriverUserId(''); setQueue([]); setQueueError(''); setDispatchMode('OWNER_PICKS'); setQueueLoading(false);
    if (!assigningOrder || !activeTenant?.id || !['OWNER','MANAGER'].includes(activeRole || '')) return;
    setQueueLoading(true);
    void dispatchChatRepository.queue(activeTenant.id).then(r => {
      if (!alive) return;
      setDispatchMode(r.mode); setQueue(r.drivers);
      if (r.mode === 'AUTO_QUEUE') setSelectedDriverUserId(r.drivers[0]?.user_id || '');
    }).catch(e => { if (alive) setQueueError(e.message); }).finally(() => { if (alive) setQueueLoading(false); });
    return () => { alive = false; };
  }, [assigningOrder?.id, activeTenant?.id, activeRole]);
  useEffect(() => {
    const focus = (e: Event) => { const id = (e as CustomEvent).detail; const found = remoteOrders?.find(o => o.id === id); if (found) { setSelectedOrder(found); setDrawerTab('detalhes'); sessionStorage.removeItem(FOCUS_ORDER_KEY); } };
    window.addEventListener('dc:focus-order', focus);
    return () => window.removeEventListener('dc:focus-order', focus);
  }, [remoteOrders]);

  // Modal de cancelamento de pedido com justificativa
  const [cancellingOrder, setCancellingOrder] = useState<Order | null>(null);
  const [handoverOrder, setHandoverOrder] = useState<Order | null>(null);
  // 2100: descobre se o banco tem a fila de chegada (sem a migration a interface some).
  useEffect(() => { if (activeTenant?.id) arrivalRepository.listOpen(activeTenant.id).catch(() => {}); }, [activeTenant?.id]);
  const [cancellationReason, setCancellationReason] = useState<string>('Cliente solicitou cancelamento');

  const canListDrivers = canAssignDrivers(activeRole);

  // Busca os pedidos e motoristas
  const fetchOrders = useCallback(async (silent = false) => {
    if (!activeTenant?.id) return;
    if (!silent) {
      if (!remoteOrders) setLoading(true);
      else setIsRefreshing(true);
    }
    try {
      setSyncError(null);
      const [orderData, driverData, productsData] = await Promise.all([
        orderRepository.getOrders(securityContext, activeTenant.id),
        // 0700 v3.4: list_assignable_drivers (OWNER/MANAGER/DELIVERY_MANAGER; só APPROVED elegíveis).
        canListDrivers
          ? driverInviteRepository.listAssignableDrivers(activeTenant.id)
              .then(list => { setDriversLoaded(true); return list; })
              .catch(() => { setDriversLoaded(false); return [] as Driver[]; })
          : Promise.resolve([] as Driver[]),
        productRepository.getProducts(securityContext, activeTenant.id).catch(() => []),
      ]);
      let ordersWithTableLabels = visibleStaffOrders(orderData);
      const missingTableLabelOrderIds = [...new Set(orderData
        .filter(order => order.fulfillmentType === 'DINE_IN' && !order.tableLabel)
        .map(order => order.id))];
      if (missingTableLabelOrderIds.length) {
        const { data: labels, error: labelsError } = await supabase.rpc('get_dine_in_order_table_labels', {
          p_tenant_id: activeTenant.id,
          p_order_ids: missingTableLabelOrderIds,
        });
        if (labelsError) {
          console.warn('[OrdersPage] Não foi possível carregar os nomes das mesas:', labelsError.message);
        } else if (labels) {
          const labelsByOrderId = new Map<string, string>(
            (labels as Array<{ order_id: string; table_label: string }>).map(row => [row.order_id, row.table_label])
          );
          ordersWithTableLabels = resolveDineInTableLabels(ordersWithTableLabels, labelsByOrderId);
        }
      }
      setRemoteOrders(ordersWithTableLabels);
      // Atribuição só para entregadores APPROVED confirmados (sem fallback).
      setDrivers(assignableDrivers(driverData));
      setStoreProducts(productsData);
      setLastSyncTime(new Date());

      // Se nenhum pedido estiver selecionado e houver pedidos, seleciona o primeiro para exibir o Drawer igual ao print
      // 19/10: "Ver pedido" no Dashboard abre este pedido selecionado.
      let focusId: string | null = null;
      try { focusId = sessionStorage.getItem(FOCUS_ORDER_KEY); } catch { /* sem storage */ }
      const focused = focusId ? ordersWithTableLabels.find(o => o.id === focusId) : undefined;
      if (focusId) { try { sessionStorage.removeItem(FOCUS_ORDER_KEY); } catch { /* sem storage */ } }
      if (focused && sessionStorage.getItem(`dc:dispatch-order:${activeTenant.id}`) === focused.id) {
        sessionStorage.removeItem(`dc:dispatch-order:${activeTenant.id}`); setAssigningOrder(focused);
      }
      setSelectedOrder(prev => {
        if (focused) return focused;
        if (!prev) {
          // 19/10: no celular o detalhe cobre a tela inteira; só abre sozinho em telas largas.
          const wide = typeof window === 'undefined' || typeof window.matchMedia !== 'function'
            || window.matchMedia('(min-width: 1024px)').matches;
          return wide ? (ordersWithTableLabels[0] || null) : null;
        }
        return ordersWithTableLabels.find(o => o.id === prev.id) || prev;
      });

      // Dispara som nativo Web Audio API caso novos pedidos pendentes tenham chegado
      const currentPendingCount = ordersWithTableLabels.filter(o => o.status === 'PENDING').length;
      if (soundEnabled && prevPendingCountRef.current !== null && currentPendingCount > prevPendingCountRef.current) {
        playNewOrderSound();
      }
      prevPendingCountRef.current = currentPendingCount;
    } catch (err: any) {
      console.warn('[OrdersPage] Erro ao sincronizar pedidos:', err);
      setSyncError(err.message || 'Falha ao sincronizar');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [activeTenant, securityContext, remoteOrders, soundEnabled, canListDrivers]);

  // Inscrição Realtime
  useEffect(() => {
    setRemoteOrders(null);
    setSelectedOrder(null);
    setSyncError(null);
    fetchOrders();

    if (!activeTenant?.id) return;
    const unsubscribe = orderRepository.subscribeToOrders(activeTenant.id, () => {
      fetchOrders(true);
    });

    const pollInterval = setInterval(() => {
      fetchOrders(true);
    }, 10000);

    return () => {
      unsubscribe();
      clearInterval(pollInterval);
    };
  }, [activeTenant?.id]);

  // Tecla ESC para modais
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (assigningOrder) setAssigningOrder(null);
        if (cancellingOrder) setCancellingOrder(null);
        if (orderToPrint) setOrderToPrint(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [assigningOrder, cancellingOrder, orderToPrint]);

  // Pagamento (N1–N6): update_order_payment_status — OWNER/MANAGER/CASHIER, validado no servidor.
  const canChangePayment = activeRole === 'OWNER' || activeRole === 'MANAGER' || activeRole === 'CASHIER';
  const handleUpdatePayment = async (order: Order, next: PaymentStatus) => {
    if (!activeTenant?.id) return;
    let note: string | undefined;
    if (next === 'REFUNDED') {
      // Servidor exige motivo e só aceita OWNER/MANAGER para estorno.
      const reason = window.prompt(`Motivo do estorno do pedido #${order.orderNumber}:`);
      if (!reason || !reason.trim()) return;
      note = reason.trim().slice(0, 500);
    }
    try {
      const updated = await orderRepository.updatePaymentStatus(securityContext, activeTenant.id, order.id, next, note);
      setSelectedOrder(updated);
      showToast({ type: 'success', title: 'Pagamento atualizado', message: next === 'PAID' ? 'Pagamento marcado como recebido.' : 'Estorno registrado.' });
      await fetchOrders(true);
    } catch (err: any) {
      showToast({ type: 'error', title: 'Falha no pagamento', message: err.message || 'Não foi possível atualizar o pagamento.' });
    }
  };

  // Atualização de status operacional
  const handleUpdateStatus = async (orderId: string, newStatus: OrderStatus, note?: string) => {
    if (!activeTenant?.id) return;
    const currentOrder = (remoteOrders || []).find(o => o.id === orderId);
    if (currentOrder?.fulfillmentType !== 'PICKUP' && currentOrder && newStatus === 'WAITING_FOR_DRIVER' && !currentOrder.driverId) {
      setAssigningOrder(currentOrder); return;
    }
    if (newStatus === 'OUT_FOR_DELIVERY' && currentOrder?.driverId) {
      setSelectedOrder(currentOrder); setDrawerTab('detalhes');
      showToast({ type: 'info', title: 'Retirada', message: 'Peça o código ao entregador.' }); return;
    }
    // 2100: com a fila de chegada ativa, retirada se conclui conferindo o código do cliente.
    if (!note && newStatus === 'DELIVERED' && currentOrder?.fulfillmentType === 'PICKUP' && arrivalRepository.isOn()) {
      setHandoverOrder(currentOrder);
      return;
    }
    const current = currentOrder?.status;
    // 1600: entrega sem o código do cliente = override manual com motivo (auditado no servidor).
    if (!note && storeDeliveredNeedsReason(currentOrder, newStatus)) {
      const reason = window.prompt('O entregador confirma a entrega com o código do cliente. Para concluir sem o código, informe o motivo:');
      if (!reason || !reason.trim()) return;
      note = reason.trim();
    }
    // 19/10: "Aguardar entregador" sem nenhum entregador aprovado deixaria o pedido esperando para sempre
    // (o servidor aceita a mudança). Avisa o porquê e o que fazer em vez de chamar.
    if (newStatus === 'WAITING_FOR_DRIVER' && shouldBlockCallDriver({ canListDrivers, driversLoaded, approvedCount: drivers.length })) {
      showToast({ type: 'warning', title: NO_APPROVED_DRIVER_TITLE, message: noApprovedDriverMessage() });
      return;
    }
    // F5: cancelado é final; cancelamento exige motivo (o servidor reforça as mesmas regras).
    const check = validateStatusChange(current, newStatus, note);
    if (!check.ok) {
      showToast({ type: 'warning', title: 'Alteração não permitida', message: check.message });
      return;
    }
    try {
      const updated = await orderRepository.updateStatus(securityContext, activeTenant.id, orderId, newStatus, check.note || undefined, current);
      // Atualiza o card na hora com o pedido devolvido pelo servidor; a sincronização completa vem em seguida.
      setRemoteOrders(prev => applyOrderUpdate(prev, updated));
      setSelectedOrder(prev => (prev && updated && prev.id === updated.id ? { ...prev, ...updated } : prev));
      showToast({
        type: 'success',
        title: 'Status atualizado',
        message: ownerStatusToastMessage(updated?.status || newStatus, updated?.orderNumber),
      });
      await fetchOrders(true);
    } catch (err: any) {
      const isDispatch = newStatus === 'WAITING_FOR_DRIVER' || newStatus === 'OUT_FOR_DELIVERY';
      showToast({
        type: 'error',
        title: isDispatch ? 'Não foi possível chamar o entregador' : 'Falha ao atualizar',
        message: isDispatch ? dispatchErrorMessage(err) : (err.message || 'Não foi possível atualizar o pedido.'),
      });
    }
  };

  // Drag and Drop nativo no Kanban
  const handleKanbanDrop = async (orderId: string, targetStatus: OrderStatus) => {
    const targetOrder = allOrders.find(o => o.id === orderId);
    if (!targetOrder || targetOrder.status === targetStatus) return;
    if (targetOrder.status === 'CANCELLED') {
      showToast({ type: 'warning', title: 'Pedido cancelado', message: 'Pedido cancelado não pode ser reaberto.' });
      return;
    }
    if (targetStatus === 'CANCELLED') {
      // Cancelamento sempre pelo modal (motivo obrigatório + estorno).
      setCancellingOrder(targetOrder);
      return;
    }

    if (targetStatus === 'OUT_FOR_DELIVERY' && !targetOrder.driverId && targetOrder.fulfillmentType !== 'PICKUP') {
      setAssigningOrder(targetOrder);
      const firstAvail = drivers.find(d => d.status === 'AVAILABLE')?.userId || drivers[0]?.userId || '';
      setSelectedDriverUserId(firstAvail);
      return;
    }

    await handleUpdateStatus(orderId, targetStatus);
  };

  // Cancelar com justificativa e estorno
  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingOrder || !activeTenant?.id) return;
    const reason = (cancellationReason || '').trim();
    const check = validateStatusChange(cancellingOrder.status, 'CANCELLED', reason);
    if (!check.ok) {
      showToast({ type: 'warning', title: 'Cancelamento', message: check.message });
      return;
    }

    try {
      const updated = await orderRepository.updateStatus(
        securityContext,
        activeTenant.id,
        cancellingOrder.id,
        'CANCELLED',
        `Cancelado: ${reason}`.slice(0, 500),
        cancellingOrder.status
      );
      setRemoteOrders(prev => applyOrderUpdate(prev, updated));
      setSelectedOrder(prev => (prev && updated && prev.id === updated.id ? { ...prev, ...updated } : prev));
      showToast({
        type: 'success',
        title: 'Pedido Cancelado',
        message: `Pedido #${cancellingOrder.orderNumber} cancelado. Produtos estornados ao estoque.`,
      });
      setCancellingOrder(null);
      await fetchOrders(true);
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao cancelar',
        message: err.message || 'Falha ao cancelar pedido.',
      });
    }
  };

  // Atribuir entregador
  const handleAssignDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningOrder || !selectedDriverUserId || !activeTenant?.id) return;

    setIsAssigning(true);
    try {
      await driverRepository.assignOrder(
        securityContext,
        activeTenant.id,
        assigningOrder.id,
        selectedDriverUserId
      );

      showToast({
        type: 'success',
        title: 'Entregador designado',
        message: 'Peça o código ao entregador quando ele chegar para retirar.',
      });

      setAssigningOrder(null);
      setSelectedDriverUserId('');
      await fetchOrders(true);
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Não foi possível despachar',
        message: dispatchErrorMessage(err),
      });
    } finally {
      setIsAssigning(false);
    }
  };

  // Venda Balcão no PDV
  const handlePDVSubmit = async (data: {
    customerName: string;
    customerPhone: string;
    items: Array<{ productId: string; quantity: number; notes?: string }>;
    paymentMethod: 'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'PIX';
    notes?: string;
    couponCode?: string;
    idempotencyKey: string;
  }) => {
    if (!activeTenant?.id) return;
    try {
      // F4: process_pos_sale_atomic aceita só OWNER/MANAGER/CASHIER; preço e cupom no servidor.
      await orderRepository.createPosSale(securityContext, activeTenant.id, {
        customerName: data.customerName || undefined,
        customerPhone: data.customerPhone || undefined,
        items: data.items,
        paymentMethod: data.paymentMethod,
        couponCode: data.couponCode,
        idempotencyKey: data.idempotencyKey,
        notes: data.notes,
      });
      showToast({
        type: 'success',
        title: 'Venda Balcão Registrada',
        message: 'Pedido de caixa concluído e estoque baixado com sucesso.',
      });
      setIsPDVOpen(false);
      await fetchOrders(true);
    } catch (err: any) {
      const msg = rpcErrorMessage(err) || err.message || 'Falha ao registrar venda de balcão.';
      showToast({
        type: 'error',
        title: 'Erro no PDV',
        message: msg,
      });
      throw err;
    }
  };

  const allOrders = visibleStaffOrders(remoteOrders || []);
  const visibleFulfillmentTabs = visibleFulfillmentTabsFor(isModuleEnabled, allOrders);
  const visibleTabsKey = visibleFulfillmentTabs.join(',');
  useEffect(() => {
    if (filterFulfillment !== 'ALL' && !visibleFulfillmentTabs.includes(filterFulfillment)) {
      setFilterFulfillment(visibleFulfillmentTabs[0] || 'ALL');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTabsKey, filterFulfillment]);
  // 19/10: bipe a cada ~5 s enquanto houver pedido em "Novo" (mesma preferência do Dashboard)
  const newOrderAlarm = useNewOrderAlarm(['OWNER','MANAGER'].includes(activeRole || '') ? 0 : allOrders.filter(o => o.status === 'PENDING').length, { tenant: activeTenant?.id || '', user: supabaseUser?.id || '' });

  // Helper de filtro de período
  const isDateInPeriod = (dateStr: string, period: string) => {
    if (period === 'ALL') return true;
    const date = new Date(dateStr);
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (period === 'TODAY') {
      return date >= todayMidnight;
    }
    if (period === 'YESTERDAY') {
      const yesterdayMidnight = new Date(todayMidnight);
      yesterdayMidnight.setDate(yesterdayMidnight.getDate() - 1);
      return date >= yesterdayMidnight && date < todayMidnight;
    }
    if (period === '7D') {
      const sevenDaysAgo = new Date(todayMidnight);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      return date >= sevenDaysAgo;
    }
    if (period === '30D') {
      const thirtyDaysAgo = new Date(todayMidnight);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return date >= thirtyDaysAgo;
    }
    return true;
  };

  // Contagens exatas dos 7 status + Faturamento hoje (idêntico ao screenshot)
  const fulfillmentOrders = allOrders.filter(order => matchesFulfillmentTab(order, filterFulfillment));
  const countNovos = fulfillmentOrders.filter(o => o.status === 'PENDING').length;
  const countConfirmados = fulfillmentOrders.filter(o => o.status === 'CONFIRMED').length;
  const countEmPreparo = fulfillmentOrders.filter(o => o.status === 'PREPARING').length;
  const countProntos = fulfillmentOrders.filter(o => o.status === 'READY' || o.status === 'WAITING_FOR_DRIVER').length;
  const countEmRota = fulfillmentOrders.filter(o => o.status === 'OUT_FOR_DELIVERY').length;
  const countEntregues = fulfillmentOrders.filter(o => o.status === 'DELIVERED').length;
  const countCancelados = fulfillmentOrders.filter(o => o.status === 'CANCELLED').length;

  const faturamentoHoje = allOrders
    .filter(o => o.status === 'DELIVERED')
    .reduce((acc, cur) => acc + (cur.totalAmount || 0), 0);

  // Status pills com contadores
  const statusPills = [
    { id: 'ALL', label: 'Todos', count: fulfillmentOrders.length },
    { id: 'PENDING', label: 'Novos', count: countNovos },
    { id: 'CONFIRMED', label: 'Confirmados', count: countConfirmados },
    { id: 'PREPARING', label: 'Em preparo', count: countEmPreparo },
    { id: 'READY', label: 'Prontos', count: countProntos },
    { id: 'OUT_FOR_DELIVERY', label: 'Em rota', count: countEmRota },
    { id: 'DELIVERED', label: 'Entregues', count: countEntregues },
    { id: 'CANCELLED', label: 'Cancelados', count: countCancelados },
  ];

  // Filtragem composta em memória
  const filteredOrders = useMemo(() => {
    // 19/10: pedido novo sempre no topo; os antigos em aberto ganham o selo "recebido há ...".
    return sortOrdersNewestFirst(allOrders).filter(order => {
      // 1. Filtro de Status
      if (activeTab !== 'ALL' && order.status !== activeTab) {
        return false;
      }

      // 2. Filtro de Atendimento
      if (!matchesFulfillmentTab(order, filterFulfillment)) {
        return false;
      }

      // 3. Filtro de Motorista
      if (filterDriver === 'WITH_DRIVER' && !order.driverId) {
        return false;
      }
      if (filterDriver === 'WITHOUT_DRIVER' && order.driverId) {
        return false;
      }

      // 4. Filtro de Período
      if (!isDateInPeriod(order.createdAt, filterPeriod)) {
        return false;
      }

      // 5. Busca por número, cliente ou telefone
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const numMatch = order.orderNumber.toString().includes(query) || `#${order.orderNumber}`.includes(query);
        const nameMatch = (order.customerName || '').toLowerCase().includes(query);
        const phoneMatch = (order.customerPhone || '').replace(/\D/g, '').includes(query.replace(/\D/g, ''));
        if (!numMatch && !nameMatch && !phoneMatch) {
          return false;
        }
      }

      return true;
    });
  }, [allOrders, activeTab, filterFulfillment, filterDriver, filterPeriod, searchQuery]);

  const staleActiveCount = countStaleActiveOrders(allOrders, lastSyncTime.getTime());

  const hasActiveFilters = searchQuery !== '' || filterFulfillment !== 'ALL' || filterDriver !== 'ALL' || filterPeriod !== 'ALL' || activeTab !== 'ALL';

  const handleClearFilters = () => {
    setSearchQuery('');
    setFilterFulfillment('ALL');
    setFilterDriver('ALL');
    setFilterPeriod('ALL');
    changeActiveTab('ALL');
  };

  const formatPaymentMethod = (method?: string) => paymentMethodLabel(method);

  const isAuthorizedForActiveTenant = availableTenants.length === 0 
    ? true 
    : availableTenants.some(t => t.tenantId === activeTenant?.id && t.status === 'ACTIVE');

  if (!activeTenant) return null;

  if (!isAuthorizedForActiveTenant) {
    return (
      <div className="bg-white border border-amber-200/80 rounded-2xl p-12 text-center space-y-4 max-w-lg mx-auto my-8 shadow-xs">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto">
          <Building2 className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-slate-900">
            Este estabelecimento não está disponível para sua conta.
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Você não possui um vínculo ativo com <strong className="text-slate-800">{activeTenant.name}</strong>.
          </p>
        </div>
      </div>
    );
  }

  // Classes do Grid Responsivo de acordo com a Densidade selecionada e presença do Drawer lateral (COMANDO 124)
  const cardsGridClass = selectedOrder
    ? density === 'compact'
      ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3'
      : density === 'comfortable'
      ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'
      : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5'
    : density === 'compact'
      ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3'
      : density === 'comfortable'
      ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4'
      : 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3.5';

  const isSelectedDelayed = selectedOrder ? checkIsPreparingDelayed(selectedOrder.createdAt, selectedOrder.status, prepMinutes) : false;
  const selectedOrderTheme = selectedOrder 
    ? (isSelectedDelayed ? DELAYED_PREPARING_THEME : (ORDER_STATUS_THEME[selectedOrder.status] || ORDER_STATUS_THEME.PENDING)) 
    : null;

  // Renderizador do Conteúdo do Drawer de Detalhes Status-Aware (COMANDO 123)
  const renderDrawerContent = () => {
    if (!selectedOrder || !selectedOrderTheme) return null;

    const totalItemsCount = selectedOrder.items?.reduce((acc, it) => acc + (it.quantity || 1), 0) || selectedOrder.items?.length || 0;
    const createdAtDate = new Date(selectedOrder.createdAt);
    const orderTimeStr = createdAtDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const elapsedMinutes = Math.floor((Date.now() - createdAtDate.getTime()) / (1000 * 60));
    const elapsedStr = elapsedMinutes < 60 ? `${elapsedMinutes} min atrás` : `${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m atrás`;

    return (
      <div className="flex flex-col h-full overflow-hidden select-text">
        {/* Barra de Acento Superior do Status */}
        <div 
          className="h-1.5 w-full shrink-0 transition-colors" 
          style={{ backgroundColor: selectedOrderTheme.accent }} 
        />

        {/* Header do Drawer Status-Aware (Fundo e Borda Suave do Status) */}
        <div 
          style={{ 
            backgroundColor: selectedOrderTheme.drawerBg || selectedOrderTheme.bg,
            borderBottom: `1px solid ${selectedOrderTheme.border}`
          }}
          className="p-1.5 shrink-0 space-y-0.5 transition-colors"
        >
          {/* Linha 1: Badge de Status + Tempo Decorrido + Botão Fechar */}
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 min-w-0">
              <OrderStatusChip status={selectedOrder.status} late={isSelectedDelayed} className="text-[8px] px-1.5 py-0.5" />
              <span className="text-[7.5px] font-mono text-slate-500 font-semibold flex items-center gap-0.5 shrink-0">
                <Clock className="w-2 h-2 text-slate-400" />
                <span>{elapsedStr}</span>
              </span>
              <OrderAgeBadge order={selectedOrder} />
            </div>

            <button
              type="button"
              onClick={() => setSelectedOrder(null)}
              className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-black/5 transition-colors cursor-pointer shrink-0"
              title="Fechar painel de detalhes"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* Linha 2: # Número do Pedido + Valor Total */}
          <div className="flex items-baseline justify-between pt-0.5 gap-1">
            <div className="min-w-0 flex-1">
              <h3 className="font-extrabold text-[11.5px] text-slate-900 font-mono tracking-tight leading-tight truncate">
                Pedido #{selectedOrder.orderNumber || selectedOrder.id.slice(0, 6)}
              </h3>
              <p className="text-[8px] text-slate-500 font-medium truncate">
                {orderTimeStr} • {totalItemsCount} {totalItemsCount === 1 ? 'item' : 'itens'}
              </p>
            </div>

            <div className="text-right shrink-0">
              <div className="text-[11.5px] font-black text-slate-900 font-mono leading-tight">
                {formatBRL(selectedOrder.totalAmount)}
              </div>
              <div className="text-[7.5px] text-slate-500 font-medium truncate max-w-[65px]">
                {formatPaymentMethod(selectedOrder.paymentMethod)}
              </div>
            </div>
          </div>
        </div>

        {/* Alerta de Atraso se aplicável */}
        {isSelectedDelayed && (
          <div className="mx-1 mt-1 p-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[8px] flex items-center gap-1 font-bold animate-pulse shrink-0">
            <AlertTriangle className="w-2.5 h-2.5 text-rose-600 shrink-0" />
            <span className="truncate">⚠️ Atrasado (+25 min)</span>
          </div>
        )}

        {/* Abas Internas: Detalhes, Histórico, Ações */}
        <div className="flex items-center border-b border-slate-100 text-[8.5px] font-bold text-slate-500 shrink-0 px-0.5 bg-white">
          <button
            type="button"
            onClick={() => setDrawerTab('detalhes')}
            style={drawerTab === 'detalhes' ? { color: selectedOrderTheme.accent, borderBottomColor: selectedOrderTheme.accent } : {}}
            className={`flex-1 py-1 text-center cursor-pointer transition-colors border-b-2 ${
              drawerTab === 'detalhes' ? 'font-black border-current' : 'border-transparent hover:text-slate-800'
            }`}
          >
            Detalhes
          </button>
          <button
            type="button"
            onClick={() => setDrawerTab('historico')}
            style={drawerTab === 'historico' ? { color: selectedOrderTheme.accent, borderBottomColor: selectedOrderTheme.accent } : {}}
            className={`flex-1 py-1 text-center cursor-pointer transition-colors border-b-2 ${
              drawerTab === 'historico' ? 'font-black border-current' : 'border-transparent hover:text-slate-800'
            }`}
          >
            Histórico
          </button>
          <button
            type="button"
            onClick={() => setDrawerTab('acoes')}
            style={drawerTab === 'acoes' ? { color: selectedOrderTheme.accent, borderBottomColor: selectedOrderTheme.accent } : {}}
            className={`flex-1 py-1 text-center cursor-pointer transition-colors border-b-2 ${
              drawerTab === 'acoes' ? 'font-black border-current' : 'border-transparent hover:text-slate-800'
            }`}
          >
            Ações
          </button>
        </div>

        {/* Conteúdo com Scroll Próprio Independente */}
        <div className="overflow-y-auto flex-1 p-1.5 space-y-1.5 scrollbar-thin text-[9px]">
          {drawerTab === 'detalhes' && (
            <>
              {/* Seção 1: Cliente */}
              <div className="p-1.5 rounded-lg bg-slate-50/80 border border-slate-200/80 space-y-1">
                <div className="text-[7.5px] font-bold uppercase tracking-wider text-slate-400">Cliente</div>
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-5.5 h-5.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[9px] flex items-center justify-center shrink-0">
                      {selectedOrder.customerName?.charAt(0).toUpperCase() || 'C'}
                    </div>
                    <div className="min-w-0">
                      <div className="font-extrabold text-[10.5px] text-slate-900 truncate leading-tight">{selectedOrder.customerName}</div>
                      <div className="text-[8px] text-slate-500 font-mono leading-none truncate mt-0.5">{selectedOrder.customerPhone}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {selectedOrder.customerPhone && (
                      <a
                        href={`https://wa.me/55${selectedOrder.customerPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá ${selectedOrder.customerName}! Estamos preparando seu pedido #${selectedOrder.orderNumber || selectedOrder.id.substring(0, 6)} na ${activeTenant.name}.`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center transition-colors"
                        title="Chamar no WhatsApp"
                      >
                        <MessageSquare className="w-2.5 h-2.5" />
                      </a>
                    )}
                    {selectedOrder.customerPhone && (
                      <a
                        href={`tel:${selectedOrder.customerPhone.replace(/\D/g, '')}`}
                        className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center justify-center transition-colors"
                        title="Ligar para cliente"
                      >
                        <Phone className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Seção 2: Entrega */}
              <div className="p-1.5 rounded-lg bg-slate-50/80 border border-slate-200/80 space-y-0.5">
                <div className="text-[7.5px] font-bold uppercase tracking-wider text-slate-400">Atendimento & Entrega</div>
                <div className="flex items-start gap-1.5">
                  <div className="w-5.5 h-5.5 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 mt-0.5">
                    {selectedOrder.fulfillmentType === 'PICKUP' ? <Building2 className="w-2.5 h-2.5" /> : <Bike className="w-2.5 h-2.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-extrabold text-[10px] text-slate-900 leading-tight">
                      {selectedOrder.fulfillmentType === 'PICKUP' ? 'Retirada no Balcão' : 'Entrega Delivery'}
                    </div>
                    <div className="text-[8px] text-slate-600 leading-snug break-words mt-0.5">
                      {selectedOrder.deliveryAddress || 'Retirada presencial pelo cliente no estabelecimento'}
                    </div>
                  </div>
                </div>
              </div>
              {selectedOrder.fulfillmentType !== 'PICKUP' && selectedOrder.status !== 'DELIVERED' && selectedOrder.status !== 'CANCELLED' && (
                <PickupCodeBadge key={selectedOrder.id} orderId={selectedOrder.id} status={selectedOrder.status} onDone={() => fetchOrders(true)} />
              )}

              {selectedOrder.driverId && <OrderChat key={selectedOrder.id} tenantId={activeTenant.id} orderId={selectedOrder.id}
                initialOpen={sessionStorage.getItem(`dc:focus-chat:${activeTenant.id}`) === selectedOrder.id}
                closed={['DELIVERED','CANCELLED'].includes(selectedOrder.status)} />}
              {/* Seção 3: Itens do pedido */}
              <div className="p-1.5 rounded-lg bg-slate-50/80 border border-slate-200/80 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="text-[7.5px] font-bold uppercase tracking-wider text-slate-400">Itens do pedido</div>
                  <span className="text-[7.5px] font-mono text-slate-500 font-bold">{totalItemsCount} unid.</span>
                </div>
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5 scrollbar-thin divide-y divide-slate-200/60">
                  {selectedOrder.items.map((item, idx) => (
                    <div key={idx} className="pt-1 first:pt-0 flex justify-between items-start text-[9px]">
                      <div className="flex-1 pr-1.5 min-w-0">
                        <span className="font-bold text-slate-900 leading-snug break-words">
                          <span className="font-mono text-emerald-800 font-black mr-1 text-[9.5px]">{item.quantity}x</span>
                          <span className="text-[9px]">{item.productName}</span>
                        </span>
                        {item.notes && (
                          <p className="text-[7.5px] text-amber-700 font-medium mt-0.5 italic break-words">Obs: {item.notes}</p>
                        )}
                        {item.options?.map(option => (
                          <p key={option.optionId} className="text-[8px] text-slate-600 font-semibold mt-0.5">
                            {option.fraction && option.fraction < 1 ? `${option.fraction === 0.5 ? '½' : `${Math.round(option.fraction * 100)}%`} ` : '+ '}
                            {option.optionName}{option.unitPriceCents > 0 ? ` (${formatBRL(option.unitPriceCents / 100)})` : ''}
                          </p>
                        ))}
                      </div>
                      <span className="font-mono font-bold text-slate-900 shrink-0 text-[9px] ml-1">
                        {formatBRL(item.totalPrice)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Seção 4: Observação */}
              {selectedOrder.notes && (
                <div className="p-1.5 rounded-lg bg-amber-50/80 border border-amber-200/80 space-y-0.5 text-[8.5px]">
                  <div className="flex items-center gap-1 font-bold text-amber-900 text-[8px]">
                    <FileText className="w-2 h-2 text-amber-700" />
                    <span>Observação do Cliente</span>
                  </div>
                  <p className="text-[8px] text-amber-800 leading-relaxed font-medium break-words">
                    {selectedOrder.notes}
                  </p>
                </div>
              )}

              {/* Seção 5: Pagamento */}
              <div className="p-1.5 rounded-lg bg-slate-50/80 border border-slate-200/80 space-y-0.5" data-testid="owner-order-totals">
                <div className="text-[7.5px] font-bold uppercase tracking-wider text-slate-400">Pagamento & Financeiro</div>
                <div className="flex items-center gap-1 font-semibold text-slate-700 text-[8.5px] truncate">
                  <DollarSign className="w-2.5 h-2.5 text-emerald-700 shrink-0" />
                  <span className="truncate">Forma: {formatPaymentMethod(selectedOrder.paymentMethod)}</span>
                </div>
                <OrderTotalsLines order={selectedOrder} />
                <OnlinePaymentBadge order={selectedOrder} />
                {selectedOrder.onlinePayment && <OnlineOrderPaymentPanel key={selectedOrder.id} orderId={selectedOrder.id} staff onConfirmed={() => { void fetchOrders(true); }} />}
              </div>
            </>
          )}

          {drawerTab === 'historico' && (
            <div className="space-y-1.5 p-0.5">
              <div className="text-[7.5px] font-bold uppercase tracking-wider text-slate-400">Linha do Tempo Operacional</div>
              <div className="space-y-1.5 border-l-2 border-slate-200 pl-2.5 ml-1 text-[8px]">
                <div className="relative">
                  <div className="w-2 h-2 rounded-full bg-amber-500 absolute -left-[14px] top-1 ring-2 ring-white" />
                  <div className="font-bold text-slate-900 text-[9px]">Pedido Criado</div>
                  <div className="text-[7.5px] text-slate-500 font-mono">{orderTimeStr}</div>
                </div>

                <div className="relative">
                  <div className={`w-2 h-2 rounded-full absolute -left-[14px] top-1 ring-2 ring-white ${
                    selectedOrder.status !== 'PENDING' ? 'bg-amber-400' : 'bg-slate-300'
                  }`} />
                  <div className="font-bold text-slate-900 text-[9px]">Confirmação</div>
                  <div className="text-[7.5px] text-slate-500">
                    {selectedOrder.status !== 'PENDING' ? 'Confirmado' : 'Aguardando'}
                  </div>
                </div>

                <div className="relative">
                  <div className={`w-2 h-2 rounded-full absolute -left-[14px] top-1 ring-2 ring-white ${
                    selectedOrder.status === 'PREPARING' || selectedOrder.status === 'READY' || selectedOrder.status === 'OUT_FOR_DELIVERY' || selectedOrder.status === 'DELIVERED'
                      ? 'bg-blue-600'
                      : 'bg-slate-300'
                  }`} />
                  <div className="font-bold text-slate-900 text-[9px]">Preparo na Cozinha</div>
                  <div className="text-[7.5px] text-slate-500">
                    {selectedOrder.status === 'PREPARING' ? 'Em produção' : selectedOrder.status === 'PENDING' || selectedOrder.status === 'CONFIRMED' ? 'Pendente' : 'Concluído'}
                  </div>
                </div>

                <div className="relative">
                  <div className={`w-2 h-2 rounded-full absolute -left-[14px] top-1 ring-2 ring-white ${
                    selectedOrder.status === 'READY' || selectedOrder.status === 'OUT_FOR_DELIVERY' || selectedOrder.status === 'DELIVERED'
                      ? 'bg-green-700'
                      : 'bg-slate-300'
                  }`} />
                  <div className="font-bold text-slate-900 text-[9px]">Pronto para Envio</div>
                  <div className="text-[7.5px] text-slate-500">
                    {selectedOrder.status === 'READY' ? 'Embalado' : 'Pendente'}
                  </div>
                </div>

                <div className="relative">
                  <div className={`w-2 h-2 rounded-full absolute -left-[14px] top-1 ring-2 ring-white ${
                    selectedOrder.status === 'OUT_FOR_DELIVERY' || selectedOrder.status === 'DELIVERED'
                      ? 'bg-cyan-600'
                      : 'bg-slate-300'
                  }`} />
                  <div className="font-bold text-slate-900 text-[9px]">Em Rota de Entrega</div>
                  <div className="text-[7.5px] text-slate-500">
                    {selectedOrder.status === 'OUT_FOR_DELIVERY' ? 'A caminho' : 'Pendente'}
                  </div>
                </div>

                <div className="relative">
                  <div className={`w-2 h-2 rounded-full absolute -left-[14px] top-1 ring-2 ring-white ${
                    selectedOrder.status === 'DELIVERED' ? 'bg-slate-500' : 'bg-slate-300'
                  }`} />
                  <div className="font-bold text-slate-900 text-[9px]">Entregue</div>
                  <div className="text-[7.5px] text-slate-500">
                    {selectedOrder.status === 'DELIVERED' ? 'Finalizado' : 'Pendente'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {drawerTab === 'acoes' && (
            <div className="space-y-1.5 p-0.5">
              <div className="text-[7.5px] font-bold uppercase tracking-wider text-slate-400">Atalhos Operacionais</div>
              <div className="grid grid-cols-1 gap-1">
                {isModuleEnabled('printing') && (
                <button
                  type="button"
                  onClick={() => setOrderToPrint(selectedOrder)}
                  className="w-full p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-between text-[8.5px] font-bold text-slate-800 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <Printer className="w-2.5 h-2.5 text-slate-600 shrink-0" />
                    <span className="truncate">Imprimir Cupom (80mm)</span>
                  </span>
                  <ChevronRight className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                </button>
                )}

                {isN1N6Backend() && !selectedOrder.onlinePayment && canChangePayment && selectedOrder.status !== 'CANCELLED' && selectedOrder.paymentStatus !== 'PAID' && selectedOrder.paymentStatus !== 'REFUNDED' && (
                  <button
                    type="button"
                    data-testid="mark-paid"
                    onClick={() => handleUpdatePayment(selectedOrder, 'PAID')}
                    className="w-full p-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 flex items-center justify-between text-[8.5px] font-bold text-emerald-900 transition-colors cursor-pointer"
                  >
                    <span className="truncate">Marcar pagamento como recebido</span>
                    <ChevronRight className="w-2.5 h-2.5 text-emerald-500 shrink-0" />
                  </button>
                )}
                {isN1N6Backend() && !selectedOrder.onlinePayment && (activeRole === 'OWNER' || activeRole === 'MANAGER') && selectedOrder.paymentStatus === 'PAID' && (
                  <button
                    type="button"
                    data-testid="mark-refunded"
                    onClick={() => handleUpdatePayment(selectedOrder, 'REFUNDED')}
                    className="w-full p-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 flex items-center justify-between text-[8.5px] font-bold text-rose-800 transition-colors cursor-pointer"
                  >
                    <span className="truncate">Registrar estorno (reverte cupom/promoção no servidor)</span>
                    <ChevronRight className="w-2.5 h-2.5 text-rose-400 shrink-0" />
                  </button>
                )}

                {selectedOrder.customerPhone && (
                  <a
                    href={`https://wa.me/55${selectedOrder.customerPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá ${selectedOrder.customerName}! Informamos que seu pedido #${selectedOrder.orderNumber || selectedOrder.id.substring(0, 6)} está ${selectedOrderTheme.label}.`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full p-1.5 rounded-lg border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/60 flex items-center justify-between text-[8.5px] font-bold text-emerald-900 transition-colors"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <MessageSquare className="w-2.5 h-2.5 text-emerald-700 shrink-0" />
                      <span className="truncate">Mensagem WhatsApp</span>
                    </span>
                    <ChevronRight className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                  </a>
                )}

                {selectedOrder.status === 'READY' && selectedOrder.fulfillmentType !== 'PICKUP' && (
                  <button
                    type="button"
                    data-testid="panel-call-driver"
                    onClick={() => setAssigningOrder(selectedOrder)}
                    className="w-full p-2 rounded-lg bg-[#15803d] hover:bg-[#166534] text-white flex items-center justify-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide cursor-pointer"
                  >
                    <Bike className="w-3 h-3" /> Despachar entrega
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setAssigningOrder(selectedOrder);
                    const firstAvail = drivers.find(d => d.status === 'AVAILABLE')?.userId || drivers[0]?.userId || '';
                    setSelectedDriverUserId(firstAvail);
                  }}
                  className="w-full p-1.5 rounded-lg border border-green-300 bg-green-50/60 hover:bg-green-100/60 flex items-center justify-between text-[8.5px] font-bold text-green-900 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <Truck className="w-2.5 h-2.5 text-green-700 shrink-0" />
                    <span className="truncate">Atribuir Entregador</span>
                  </span>
                  <ChevronRight className="w-2.5 h-2.5 text-green-700 shrink-0" />
                </button>

                {selectedOrder.status !== 'CANCELLED' && selectedOrder.status !== 'DELIVERED' && (
                  <button
                    type="button"
                    onClick={() => {
                      setCancellingOrder(selectedOrder);
                      setCancellationReason('Cancelamento solicitado pelo operador');
                    }}
                    className="w-full p-1.5 rounded-lg border border-rose-200 bg-rose-50/50 hover:bg-rose-100/60 flex items-center justify-between text-[8.5px] font-bold text-rose-700 transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <X className="w-2.5 h-2.5 text-rose-600 shrink-0" />
                      <span className="truncate">Cancelar Pedido</span>
                    </span>
                    <ChevronRight className="w-2.5 h-2.5 text-rose-500 shrink-0" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Rodapé Fixo: Botões de Ação */}
        <div className="p-1.5 bg-white border-t border-slate-100 space-y-1 shrink-0 shadow-xs">
          <div className="grid grid-cols-2 gap-1">
            {isModuleEnabled('printing') && (
            <button
              type="button"
              onClick={() => setOrderToPrint(selectedOrder)}
              className="py-1 px-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[8.5px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer h-7"
            >
              <Printer className="w-2.5 h-2.5 text-slate-500" />
              <span>Imprimir</span>
            </button>
            )}

            {selectedOrder.status === 'PENDING' ? (
              <button
                type="button"
                onClick={() => {
                  setCancellingOrder(selectedOrder);
                  setCancellationReason('Estabelecimento recusou o pedido');
                }}
                className="py-1 px-1 rounded-md border border-rose-200 bg-rose-50/60 hover:bg-rose-100 text-rose-700 text-[8.5px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer h-7"
              >
                <X className="w-2.5 h-2.5" />
                <span>Recusar</span>
              </button>
            ) : selectedOrder.status !== 'CANCELLED' && selectedOrder.status !== 'DELIVERED' ? (
              <button
                type="button"
                onClick={() => setCancellingOrder(selectedOrder)}
                className="py-1 px-1 rounded-md border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 text-[8.5px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer h-7"
              >
                <X className="w-2.5 h-2.5" />
                <span>Cancelar</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="py-1 px-1 rounded-md border border-slate-200 bg-slate-50 text-slate-600 text-[8.5px] font-bold cursor-pointer h-7"
              >
                Fechar
              </button>
            )}
          </div>

          {/* Botão de Ação Primária no Drawer */}
          {selectedOrder.status !== 'CANCELLED' && selectedOrder.status !== 'DELIVERED' && (
            <button
              type="button"
              onClick={() => {
                if (selectedOrder.status === 'PENDING') handleUpdateStatus(selectedOrder.id, 'CONFIRMED');
                else if (selectedOrder.status === 'CONFIRMED') handleUpdateStatus(selectedOrder.id, 'PREPARING');
                else if (selectedOrder.status === 'PREPARING') handleUpdateStatus(selectedOrder.id, 'READY');
                else if (selectedOrder.status === 'READY') {
                  setAssigningOrder(selectedOrder);
                  const firstAvail = drivers.find(d => d.status === 'AVAILABLE')?.userId || drivers[0]?.userId || '';
                  setSelectedDriverUserId(firstAvail);
                } else if (selectedOrder.status === 'OUT_FOR_DELIVERY') handleUpdateStatus(selectedOrder.id, 'DELIVERED');
              }}
              style={orderActionButtonStyle(selectedOrderTheme, selectedOrder)}
              className="w-full py-1.5 px-1.5 rounded-md font-bold text-[9px] uppercase tracking-wide flex items-center justify-center gap-1 shadow-2xs hover:opacity-90 transition-all cursor-pointer active:scale-98 min-h-[30px] leading-tight text-center"
            >
              <Check className="w-2.5 h-2.5 stroke-[3] shrink-0" />
              <span className="truncate">{selectedOrderTheme.buttonLabel}</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 min-w-0 h-full flex flex-row overflow-hidden relative font-sans">
      {/* ========================================================================= */}
      {/* REGIÃO 2: CONTEÚDO OPERACIONAL (TOPO + CARDS / KANBAN / TABELA)           */}
      {/* ========================================================================= */}
      <div className="flex-1 min-w-0 h-full overflow-y-auto flex flex-col scrollbar-thin">
        {/* TOPO: Cabeçalho, KPIs, Busca, Modos, Densidade, Legenda (COMANDO 125) */}
        <div className="p-2 sm:p-2.5 pb-1 space-y-1.5 shrink-0">
          {/* 1. TOPO DA PÁGINA: TÍTULO, SUBTÍTULO, ATUALIZAR E PDV */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">
                  Pedidos
                </h1>
                <span className="text-xs sm:text-sm px-3 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold border border-slate-200 tabular-nums">
                  {allOrders.length} {allOrders.length === 1 ? 'pedido' : 'pedidos'}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 font-normal">
                Gerencie e acompanhe todos os pedidos do seu estabelecimento.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={newOrderAlarm.toggle}
                data-testid="orders-sound"
                aria-pressed={newOrderAlarm.enabled && newOrderAlarm.unlocked}
                title={newOrderAlarm.enabled && newOrderAlarm.unlocked ? 'Som ligado para notificações desta loja. Clique para desligar.' : 'Ativar som das notificações'}
                className={`h-9 py-2 px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                  newOrderAlarm.enabled && newOrderAlarm.unlocked ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-amber-50 border-amber-400 text-amber-900 hover:bg-amber-100'}`}
              >
                {newOrderAlarm.enabled && newOrderAlarm.unlocked ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                <span>{newOrderAlarm.enabled && newOrderAlarm.unlocked ? 'Som ligado' : 'Ativar som'}</span>
              </button>
              <button
                type="button"
                onClick={() => fetchOrders()}
                disabled={isRefreshing}
                className="h-9 py-2 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-[13px] font-bold flex items-center gap-2 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-700' : 'text-slate-500'}`} />
                <span>Atualizar</span>
              </button>

              {isModuleEnabled('pos') && (
                <button
                  type="button"
                  onClick={() => setIsPDVOpen(true)}
                  disabled={!isN1N6Backend()}
                  title={isN1N6Backend() ? undefined : N1N6_ONLY_MESSAGE}
                  data-testid="open-pdv"
                  className="disabled:opacity-50 disabled:cursor-not-allowed h-9 py-2 px-4 rounded-xl bg-[#15803d] hover:bg-[#166534] text-white text-xs sm:text-[13px] font-bold flex items-center gap-2 transition-colors shadow-2xs cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Nova Venda Balcão (PDV)</span>
                </button>
              )}
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 2. LINHA DE 8 CARDS DE STATUS / KPIS (ESCALA VISUAL +15% CONFORME COMANDO 127) */}
          {/* ========================================================================= */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1.5">
            {/* 1. Novos */}
            <button
              type="button"
              onClick={() => changeActiveTab(activeTab === 'PENDING' ? 'ALL' : 'PENDING')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between bg-white ${
                activeTab === 'PENDING' ? 'border-amber-400 ring-1 ring-amber-300' : 'border-slate-200/90 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                  <Bell className="w-3 h-3" />
                </div>
                <span className="text-xs sm:text-[12px] font-bold text-amber-700 truncate">Novos</span>
              </div>
              <div className="pt-1.5">
                <div className="text-base sm:text-lg font-black text-slate-900 font-mono leading-none">{countNovos}</div>
                <div className="text-[9.5px] sm:text-[10px] text-slate-400 mt-0.5 truncate">Aguardando</div>
              </div>
            </button>

            {/* 2. Confirmados */}
            <button
              type="button"
              onClick={() => changeActiveTab(activeTab === 'CONFIRMED' ? 'ALL' : 'CONFIRMED')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between bg-white ${
                activeTab === 'CONFIRMED' ? 'border-amber-400 ring-1 ring-amber-300' : 'border-slate-200/90 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                  <ClipboardCheck className="w-3 h-3" />
                </div>
                <span className="text-xs sm:text-[12px] font-bold text-amber-600 truncate">Confirmados</span>
              </div>
              <div className="pt-1.5">
                <div className="text-base sm:text-lg font-black text-slate-900 font-mono leading-none">{countConfirmados}</div>
                <div className="text-[9.5px] sm:text-[10px] text-slate-400 mt-0.5 truncate">Aceitos</div>
              </div>
            </button>

            {/* 3. Em preparo (AZUL — padrão KDS) */}
            <button
              type="button"
              onClick={() => changeActiveTab(activeTab === 'PREPARING' ? 'ALL' : 'PREPARING')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between bg-white ${
                activeTab === 'PREPARING' ? 'border-blue-500 ring-1 ring-blue-300' : 'border-slate-200/90 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                  <Flame className="w-3 h-3" />
                </div>
                <span className="text-xs sm:text-[12px] font-bold text-blue-700 truncate">Em preparo</span>
              </div>
              <div className="pt-1.5">
                <div className="text-base sm:text-lg font-black text-slate-900 font-mono leading-none">{countEmPreparo}</div>
                <div className="text-[9.5px] sm:text-[10px] text-slate-400 mt-0.5 truncate">Preparando</div>
              </div>
            </button>

            {/* 4. Prontos (VERDE — padrão KDS) */}
            <button
              type="button"
              onClick={() => changeActiveTab(activeTab === 'READY' ? 'ALL' : 'READY')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between bg-white ${
                activeTab === 'READY' ? 'border-green-400 ring-1 ring-green-300' : 'border-slate-200/90 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-green-50 text-green-700 flex items-center justify-center shrink-0">
                  <ShoppingBag className="w-3 h-3" />
                </div>
                <span className="text-xs sm:text-[12px] font-bold text-green-700 truncate">Prontos</span>
              </div>
              <div className="pt-1.5">
                <div className="text-base sm:text-lg font-black text-slate-900 font-mono leading-none">{countProntos}</div>
                <div className="text-[9.5px] sm:text-[10px] text-slate-400 mt-0.5 truncate">Aguard. rota</div>
              </div>
            </button>

            {/* 5. Em rota (CIANO — padrão KDS) */}
            <button
              type="button"
              onClick={() => changeActiveTab(activeTab === 'OUT_FOR_DELIVERY' ? 'ALL' : 'OUT_FOR_DELIVERY')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between bg-white ${
                activeTab === 'OUT_FOR_DELIVERY' ? 'border-cyan-400 ring-1 ring-cyan-300' : 'border-slate-200/90 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-cyan-50 text-cyan-700 flex items-center justify-center shrink-0">
                  <Bike className="w-3 h-3" />
                </div>
                <span className="text-xs sm:text-[12px] font-bold text-cyan-700 truncate">Em rota</span>
              </div>
              <div className="pt-1.5">
                <div className="text-base sm:text-lg font-black text-slate-900 font-mono leading-none">{countEmRota}</div>
                <div className="text-[9.5px] sm:text-[10px] text-slate-400 mt-0.5 truncate">Na rua</div>
              </div>
            </button>

            {/* 6. Entregues */}
            <button
              type="button"
              onClick={() => changeActiveTab(activeTab === 'DELIVERED' ? 'ALL' : 'DELIVERED')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between bg-white ${
                activeTab === 'DELIVERED' ? 'border-slate-400 ring-1 ring-slate-300' : 'border-slate-200/90 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-slate-50 text-slate-600 flex items-center justify-center shrink-0">
                  <CheckCheck className="w-3 h-3" />
                </div>
                <span className="text-xs sm:text-[12px] font-bold text-slate-700 truncate">Entregues</span>
              </div>
              <div className="pt-1.5">
                <div className="text-base sm:text-lg font-black text-slate-900 font-mono leading-none">{countEntregues}</div>
                <div className="text-[9.5px] sm:text-[10px] text-slate-400 mt-0.5 truncate">Hoje</div>
              </div>
            </button>

            {/* 7. Cancelados */}
            <button
              type="button"
              onClick={() => changeActiveTab(activeTab === 'CANCELLED' ? 'ALL' : 'CANCELLED')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between bg-white ${
                activeTab === 'CANCELLED' ? 'border-red-400 ring-1 ring-red-300' : 'border-slate-200/90 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                  <XCircle className="w-3 h-3" />
                </div>
                <span className="text-xs sm:text-[12px] font-bold text-red-600 truncate">Cancelados</span>
              </div>
              <div className="pt-1.5">
                <div className="text-base sm:text-lg font-black text-slate-900 font-mono leading-none">{countCancelados}</div>
                <div className="text-[9.5px] sm:text-[10px] text-slate-400 mt-0.5 truncate">Hoje</div>
              </div>
            </button>

            {/* 8. Faturamento hoje */}
            <div className="p-2.5 rounded-xl border border-slate-200/90 bg-white text-left flex flex-col justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <DollarSign className="w-3 h-3" />
                </div>
                <span className="text-xs sm:text-[12px] font-medium text-slate-500 truncate">Faturamento</span>
              </div>
              <div className="pt-1.5">
                <div className="text-sm sm:text-base font-black text-emerald-700 font-mono leading-none truncate">
                  {formatBRL(faturamentoHoje)}
                </div>
                <div className="text-[9.5px] sm:text-[10px] text-slate-400 mt-0.5 truncate">Hoje</div>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 3. PAINEL DE CONTROLES RECOLHÍVEL (COMANDO 135)                           */}
          {/* ========================================================================= */}
          {!isControlsCollapsed ? (
            <div className="space-y-1.5 transition-all duration-200">
              <div className="bg-white border border-slate-200/90 rounded-xl p-3 shadow-2xs space-y-2.5">
                {/* Linha 1: Campo de Busca Full Width (+15%) */}
                <div className="relative w-full">
                  <Search className="w-4.5 h-4.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar pedido, cliente ou telefone..."
                    className="w-full pl-10.5 pr-9 py-2 rounded-xl border border-slate-200 bg-slate-50/40 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-emerald-700 focus:bg-white transition-all h-10 font-normal"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-full cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Linha 2: Filtros Dropdown à esquerda e Alternador de Modos à direita (+15%) */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  {/* Dropdowns */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={filterFulfillment}
                      onChange={(e) => setFilterFulfillment(e.target.value as any)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs sm:text-[12px] font-semibold text-slate-700 outline-none focus:border-emerald-700 h-9 cursor-pointer"
                    >
                      <option value="ALL">Tipo: Todos</option>
                      <option value="DELIVERY">Delivery</option>
                      <option value="PICKUP">Retirada</option>
                      <option value="DINE_IN">Salão</option>
                    </select>

                    <select
                      value={filterDriver}
                      onChange={(e) => setFilterDriver(e.target.value as any)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs sm:text-[12px] font-semibold text-slate-700 outline-none focus:border-emerald-700 h-9 cursor-pointer"
                    >
                      <option value="ALL">Motorista: Todos</option>
                      <option value="WITH_DRIVER">Com motorista</option>
                      <option value="WITHOUT_DRIVER">Sem motorista</option>
                    </select>

                    <select
                      value={filterPeriod}
                      onChange={(e) => setFilterPeriod(e.target.value as any)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs sm:text-[12px] font-semibold text-slate-700 outline-none focus:border-emerald-700 h-9 cursor-pointer"
                    >
                      <option value="ALL">Período: Todos</option>
                      <option value="TODAY">Hoje</option>
                      <option value="YESTERDAY">Ontem</option>
                      <option value="7D">Últimos 7 dias</option>
                      <option value="30D">Últimos 30 dias</option>
                    </select>
                  </div>

                  {/* Alternador de Modos: Cards, Kanban, Tabela (+15%) */}
                  <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200/80 h-9 shrink-0">
                    <button
                      type="button"
                      onClick={() => setViewMode('cards')}
                      className={`py-1.5 px-3 rounded-md text-xs sm:text-[12px] font-bold flex items-center gap-1.5 transition-all cursor-pointer h-8 ${
                        viewMode === 'cards'
                          ? 'bg-emerald-700 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                      title="Cards: Visualização rápida de muitos pedidos"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span>Cards</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('kanban')}
                      className={`py-1.5 px-3 rounded-md text-xs sm:text-[12px] font-bold flex items-center gap-1.5 transition-all cursor-pointer h-8 ${
                        viewMode === 'kanban'
                          ? 'bg-emerald-700 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                      title="Kanban: Fluxo operacional por colunas"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Kanban</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('table')}
                      className={`py-1.5 px-3 rounded-md text-xs sm:text-[12px] font-bold flex items-center gap-1.5 transition-all cursor-pointer h-8 ${
                        viewMode === 'table'
                          ? 'bg-emerald-700 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                      title="Tabela: Controle detalhado, conferência e histórico"
                    >
                      <List className="w-3.5 h-3.5" />
                      <span>Tabela</span>
                    </button>
                  </div>
                </div>

                {/* Abas Entrega | Retirada | Salão, cada qual com contador de pedidos acionáveis. */}
                <div className="flex items-stretch gap-1.5 pt-2 border-t border-slate-100" role="tablist" data-testid="fulfillment-tabs">
                  {([['DELIVERY', 'Entrega', Bike], ['PICKUP', 'Retirada', ShoppingBag], ['DINE_IN', 'Salão', UtensilsCrossed]] as const).filter(([id]) => visibleFulfillmentTabs.includes(id)).map(([id, label, Icon]) => {
                    const c = tabCounts(allOrders, id as FulfillmentTab, prepMinutes);
                    const tone = tabTone(c);
                    const toneCls: Record<string, string> = {
                      red: 'bg-red-600 text-white', amber: 'bg-amber-400 text-amber-950', green: 'bg-green-700 text-white',
                      blue: 'bg-blue-600 text-white', cyan: 'bg-cyan-600 text-white', neutral: 'bg-slate-200 text-slate-600',
                    };
                    const toneText: Record<string, string> = { red: 'atrasado', amber: 'novo', green: 'pronto', blue: 'em preparo', cyan: 'em rota', neutral: 'sem pedidos' };
                    const isActive = filterFulfillment === id;
                    return (
                      <button key={id} type="button" role="tab" aria-selected={isActive} data-testid={`ftab-${id}`} data-tone={tone} data-count={c.acionaveis}
                        onClick={() => setFilterFulfillment(isActive ? 'ALL' : (id as FulfillmentTab))}
                        className={`flex-1 sm:flex-none flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 text-[13px] font-black transition-all cursor-pointer ${isActive ? 'bg-white border-emerald-600 shadow-sm text-slate-900' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-white'}`}>
                        <Icon className="w-4 h-4" />
                        <span>{label}</span>
                        <span className={`min-w-[1.5rem] text-center text-[11px] px-1.5 py-0.5 rounded-full tabular-nums ${toneCls[tone]}`} title={toneText[tone]}>{c.acionaveis}</span>
                        {c.atrasado > 0 && <span className="text-[10px] font-bold text-red-700">⚠ {c.atrasado} atrasado{c.atrasado > 1 ? 's' : ''}</span>}
                        {c.atrasado === 0 && c.novo > 0 && <span className="text-[10px] font-bold text-amber-700">🔔 {c.novo} novo{c.novo > 1 ? 's' : ''}</span>}
                        {c.atrasado === 0 && c.novo === 0 && c.pronto > 0 && <span className="text-[10px] font-bold text-green-700">✓ {c.pronto} pronto{c.pronto > 1 ? 's' : ''}</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Linha 3: Abas de Status e Tamanho dos Cards (COMANDO 129/130: Todos até Cancelados totalmente visíveis) */}
                <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-slate-100 min-w-0">
                  {/* Status Pills */}
                  <div className="flex items-center gap-[3.5px] min-w-0 overflow-x-auto scrollbar-none py-0.5">
                    {statusPills.map(tab => {
                      const isActive = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => changeActiveTab(tab.id)}
                          className={`flex items-center gap-1 px-[7px] py-0.5 rounded-full text-[10.5px] font-bold whitespace-nowrap transition-all cursor-pointer h-6 shrink-0 ${
                            isActive
                              ? 'bg-emerald-700 text-white shadow-2xs'
                              : 'bg-white border border-slate-200/90 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <span className="whitespace-nowrap">{tab.label}</span>
                          <span
                            className={`text-[8.5px] px-1 py-0.1 rounded-full tabular-nums font-bold ${
                              isActive ? 'bg-white/20 text-white font-black' : 'bg-slate-100 text-slate-500 font-bold'
                            }`}
                          >
                            {tab.count}
                          </span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => changeActiveTab('ALL')}
                      className="w-5 h-5 rounded-full bg-white border border-slate-200 text-slate-500 flex items-center justify-center hover:bg-slate-50 shrink-0 cursor-pointer text-[10px] font-bold"
                      title="Mais filtros"
                    >
                      +
                    </button>
                  </div>

                  {/* Recurso Funcional: Tamanho dos cards com (-) e (+) e Porcentagem */}
                  <div className="flex items-center gap-1.5 shrink-0 bg-slate-50 border border-slate-200/90 px-2 py-0.5 rounded-lg shadow-2xs h-6 whitespace-nowrap ml-auto">
                    <span className="text-[10px] font-bold text-slate-700 select-none whitespace-nowrap">
                      Tamanho:
                    </span>
                    <div className="flex items-center gap-0.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleStepCardScale(-5)}
                        disabled={cardScale <= 50}
                        className="w-4.5 h-4.5 rounded-md bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 text-slate-700 flex items-center justify-center font-black text-xs cursor-pointer shadow-2xs active:scale-95 transition-all"
                        title="Diminuir tamanho dos cards (-5%)"
                      >
                        −
                      </button>

                      <button
                        type="button"
                        onClick={handleResetCardScale}
                        className="px-1 py-0.2 rounded-md bg-white border border-slate-200 text-slate-800 font-mono font-black text-[10px] hover:border-emerald-500 hover:text-emerald-700 transition-colors shadow-2xs cursor-pointer tabular-nums"
                        title="Clique para redefinir para 100%"
                      >
                        {cardScale}%
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStepCardScale(5)}
                        disabled={cardScale >= 150}
                        className="w-4.5 h-4.5 rounded-md bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 text-slate-700 flex items-center justify-center font-black text-xs cursor-pointer shadow-2xs active:scale-95 transition-all"
                        title="Aumentar tamanho dos cards (+5%)"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Legenda Oficial Ultra Discreta: COR = STATUS (+15%) */}
              <div className="flex items-center gap-3.5 pt-2 text-xs sm:text-[12px] text-slate-600 font-semibold overflow-x-auto scrollbar-none border-t border-slate-100">
                <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider shrink-0">Legenda:</span>
                <span className="inline-flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full bg-[#F59E0B]"></span><StatusIconByKey icon="bell" className="w-3 h-3 text-slate-500" />Novo</span>
                <span className="inline-flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full bg-[#FCD34D]"></span><StatusIconByKey icon="confirmed" className="w-3 h-3 text-slate-500" />Confirmado</span>
                <span className="inline-flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full bg-[#2563EB]"></span><StatusIconByKey icon="flame" className="w-3 h-3 text-slate-500" />Preparo</span>
                <span className="inline-flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full bg-[#15803D]"></span><StatusIconByKey icon="ready" className="w-3 h-3 text-slate-500" />Pronto</span>
                <span className="inline-flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full bg-[#0891B2]"></span><StatusIconByKey icon="bike" className="w-3 h-3 text-slate-500" />Rota</span>
                <span className="inline-flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full bg-[#64748B]"></span><StatusIconByKey icon="delivered" className="w-3 h-3 text-slate-500" />Entregue</span>
                <span className="inline-flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full bg-[#F87171]"></span><StatusIconByKey icon="cancelled" className="w-3 h-3 text-slate-500" />Cancelado</span>
                <span className="inline-flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full bg-[#DC2626]"></span><StatusIconByKey icon="late" className="w-3 h-3 text-slate-500" />Atrasado</span>
              </div>

              {/* Botão de Recolher Painel (Centralizado na base do painel) */}
              <div className="flex justify-center pt-0.5">
                <button
                  type="button"
                  onClick={toggleControlsCollapsed}
                  className="inline-flex items-center gap-1 px-3 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 border border-slate-200/90 text-slate-600 hover:text-slate-900 transition-all cursor-pointer shadow-2xs group"
                  title="Recolher filtros"
                  aria-label="Recolher filtros"
                >
                  <ChevronUp className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-700 transition-transform group-hover:-translate-y-0.5" />
                  <span className="text-[10px] font-bold">Recolher filtros</span>
                </button>
              </div>
            </div>
          ) : (
            /* Faixa Fina quando Recolhido (24px a 30px) */
            <div className="pt-0.5 transition-all duration-200">
              <button
                type="button"
                onClick={toggleControlsCollapsed}
                className="w-full h-7 py-1 px-3 bg-white hover:bg-slate-50 border border-slate-200/90 rounded-lg shadow-2xs flex items-center justify-center gap-1.5 text-slate-600 hover:text-slate-900 transition-all cursor-pointer group"
                title="Mostrar filtros e controles"
                aria-label="Mostrar filtros e controles"
              >
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-700 transition-transform group-hover:translate-y-0.5" />
                <span className="text-[11px] font-bold tracking-tight">Mostrar filtros e controles</span>
              </button>
            </div>
          )}
        </div>

        {/* ÁREA OPERACIONAL DE PEDIDOS: CARDS / KANBAN / TABELA */}
        <div className="flex-1 min-w-0 p-2.5 sm:p-3 pt-0.5 space-y-3">
          {staleActiveCount > 0 && (
            <div data-testid="stale-orders-banner" className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-3 py-2 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                <strong>{staleActiveCount === 1 ? '1 pedido está em aberto há mais de 1 dia.' : `${staleActiveCount} pedidos estão em aberto há mais de 1 dia.`}</strong>{' '}
                Eles aparecem com o selo vermelho "recebido há ...". Confira se ainda são válidos, conclua ou cancele. Os pedidos novos ficam sempre no topo.
              </span>
            </div>
          )}
          {filterFulfillment === 'PICKUP' && activeTenant?.id && (
            <div className="mb-2">
              <ArrivalQueuePanel tenantId={activeTenant.id} storeName={activeTenant.name} orders={allOrders}
                canRotate={activeRole === 'OWNER' || activeRole === 'MANAGER'}
                onHandover={(o) => setHandoverOrder(o)}
                onError={(m) => showToast({ type: 'warning', title: 'Fila de retirada', message: m })}
                onCalled={() => showToast({ type: 'success', title: 'Cliente chamado', message: 'O celular do cliente foi avisado.' })} />
            </div>
          )}
          <PickupHandoverModal order={handoverOrder} onClose={() => setHandoverOrder(null)}
            onDone={() => { setHandoverOrder(null); showToast({ type: 'success', title: 'Retirada confirmada', message: 'Pedido entregue ao cliente.' }); fetchOrders(true); }}
            onOverride={(id, reason) => handleUpdateStatus(id, 'DELIVERED', reason)} />
          {syncError && (!remoteOrders || remoteOrders.length === 0) ? (
            <div className="bg-white border border-amber-200/80 rounded-2xl p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Não foi possível carregar os pedidos
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {syncError}
              </p>
              <Button size="sm" variant="primary" onClick={() => fetchOrders()} className="text-xs">
                Tentar Novamente
              </Button>
            </div>
          ) : loading ? (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-3">
              <Skeleton className="h-6 w-1/4 rounded-lg" />
              <Skeleton className="h-10 w-full rounded-xl" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">
                Nenhum pedido encontrado nesta etapa
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {hasActiveFilters
                  ? 'Tente ajustar os filtros ou clique em "Todos".'
                  : 'Novos pedidos aparecerão aqui automaticamente.'}
              </p>
              {hasActiveFilters && (
                <Button size="sm" variant="outline" onClick={handleClearFilters} className="text-xs">
                  Limpar filtros
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* ========================================================================= */}
              {/* MODO CARDS (SCREENSHOT 1)                                                 */}
              {/* ========================================================================= */}
              {viewMode === 'cards' && (
                <div className={cardsGridClass} style={{ zoom: `${cardScale}%` }}>
                  {filteredOrders.map(order => (
                    <CompactOrderCard
                      prepMinutes={prepMinutes}
                      key={order.id}
                      order={orderForCard(order)}
                      density={density}
                      isSelected={selectedOrder?.id === order.id}
                      onSelectOrder={(ord) => setSelectedOrder(ord)}
                      onUpdateStatus={handleUpdateStatus}
                      onAssignDriverClick={(ord) => {
                        setAssigningOrder(ord);
                        const firstAvail = drivers.find(d => d.status === 'AVAILABLE')?.userId || drivers[0]?.userId || '';
                        setSelectedDriverUserId(firstAvail);
                      }}
                      onCancelClick={(ord) => {
                        setCancellingOrder(ord);
                        setCancellationReason('Cliente solicitou cancelamento');
                      }}
                    />
                  ))}
                </div>
              )}

              {/* ========================================================================= */}
              {/* MODO KANBAN (FLUXO OPERACIONAL - 4 COLUNAS CONFORTÁVEIS COM DRAWER)       */}
              {/* ========================================================================= */}
              {viewMode === 'kanban' && (
                <div className="w-full overflow-x-auto scrollbar-thin pb-4" style={{ zoom: `${cardScale}%` }}>
                  <div className="flex items-start gap-2.5 min-w-max">
                    {/* 1. NOVOS (AMARELO SUAVE) */}
                    <div 
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                      onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); handleKanbanDrop(id, 'PENDING'); }}
                      className="w-[195px] sm:w-[205px] xl:w-[215px] shrink-0    rounded-xl p-2 flex flex-col min-h-[400px] border-2" style={{ backgroundColor: ORDER_STATUS_THEME.PENDING.drawerBg, borderColor: ORDER_STATUS_THEME.PENDING.border }}
                    >
                      <KanbanColumnHeader status="PENDING" label="Novos" count={countNovos} />
                      <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-300px)] pr-0.5 scrollbar-thin flex-1">
                        {fulfillmentOrders.filter(o => o.status === 'PENDING').map(order => (
                          <KanbanOrderCard
                            prepMinutes={prepMinutes}
                            key={order.id}
                            order={orderForCard(order)}
                            isSelected={selectedOrder?.id === order.id}
                            onSelectOrder={(ord) => setSelectedOrder(ord)}
                            onUpdateStatus={handleUpdateStatus}
                            onAssignDriverClick={(ord) => {
                              setAssigningOrder(ord);
                              const firstAvail = drivers.find(d => d.status === 'AVAILABLE')?.userId || drivers[0]?.userId || '';
                              setSelectedDriverUserId(firstAvail);
                            }}
                            onCancelClick={(ord) => {
                              setCancellingOrder(ord);
                              setCancellationReason('Cliente solicitou cancelamento');
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* 2. CONFIRMADOS (AZUL SUAVE) */}
                    <div 
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                      onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); handleKanbanDrop(id, 'CONFIRMED'); }}
                      className="w-[195px] sm:w-[205px] xl:w-[215px] shrink-0    rounded-xl p-2 flex flex-col min-h-[400px] border-2" style={{ backgroundColor: ORDER_STATUS_THEME.CONFIRMED.drawerBg, borderColor: ORDER_STATUS_THEME.CONFIRMED.border }}
                    >
                      <KanbanColumnHeader status="CONFIRMED" label="Confirmados" count={countConfirmados} />
                      <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-300px)] pr-0.5 scrollbar-thin flex-1">
                        {fulfillmentOrders.filter(o => o.status === 'CONFIRMED').map(order => (
                          <KanbanOrderCard
                            prepMinutes={prepMinutes}
                            key={order.id}
                            order={orderForCard(order)}
                            isSelected={selectedOrder?.id === order.id}
                            onSelectOrder={(ord) => setSelectedOrder(ord)}
                            onUpdateStatus={handleUpdateStatus}
                            onAssignDriverClick={(ord) => {
                              setAssigningOrder(ord);
                              const firstAvail = drivers.find(d => d.status === 'AVAILABLE')?.userId || drivers[0]?.userId || '';
                              setSelectedDriverUserId(firstAvail);
                            }}
                            onCancelClick={(ord) => {
                              setCancellingOrder(ord);
                              setCancellationReason('Cliente solicitou cancelamento');
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* 3. EM PREPARO (VERDE SUAVE OFICIAL - COZINHA TRABALHANDO) */}
                    <div 
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                      onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); handleKanbanDrop(id, 'PREPARING'); }}
                      className="w-[195px] sm:w-[205px] xl:w-[215px] shrink-0    rounded-xl p-2 flex flex-col min-h-[400px] border-2" style={{ backgroundColor: ORDER_STATUS_THEME.PREPARING.drawerBg, borderColor: ORDER_STATUS_THEME.PREPARING.border }}
                    >
                      <KanbanColumnHeader status="PREPARING" label="Em preparo" count={countEmPreparo} />
                      <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-300px)] pr-0.5 scrollbar-thin flex-1">
                        {fulfillmentOrders.filter(o => o.status === 'PREPARING').map(order => (
                          <KanbanOrderCard
                            prepMinutes={prepMinutes}
                            key={order.id}
                            order={orderForCard(order)}
                            isSelected={selectedOrder?.id === order.id}
                            onSelectOrder={(ord) => setSelectedOrder(ord)}
                            onUpdateStatus={handleUpdateStatus}
                            onAssignDriverClick={(ord) => {
                              setAssigningOrder(ord);
                              const firstAvail = drivers.find(d => d.status === 'AVAILABLE')?.userId || drivers[0]?.userId || '';
                              setSelectedDriverUserId(firstAvail);
                            }}
                            onCancelClick={(ord) => {
                              setCancellingOrder(ord);
                              setCancellationReason('Cliente solicitou cancelamento');
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* 4. PRONTOS (ROXO SUAVE OFICIAL - COZINHA FINALIZOU) */}
                    <div 
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                      onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); handleKanbanDrop(id, 'READY'); }}
                      className="w-[195px] sm:w-[205px] xl:w-[215px] shrink-0    rounded-xl p-2 flex flex-col min-h-[400px] border-2" style={{ backgroundColor: ORDER_STATUS_THEME.READY.drawerBg, borderColor: ORDER_STATUS_THEME.READY.border }}
                    >
                      <KanbanColumnHeader status="READY" label="Prontos" count={countProntos} />
                      <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-300px)] pr-0.5 scrollbar-thin flex-1">
                        {fulfillmentOrders.filter(o => o.status === 'READY' || o.status === 'WAITING_FOR_DRIVER').map(order => (
                          <KanbanOrderCard
                            prepMinutes={prepMinutes}
                            key={order.id}
                            order={orderForCard(order)}
                            isSelected={selectedOrder?.id === order.id}
                            onSelectOrder={(ord) => setSelectedOrder(ord)}
                            onUpdateStatus={handleUpdateStatus}
                            onAssignDriverClick={(ord) => {
                              setAssigningOrder(ord);
                              const firstAvail = drivers.find(d => d.status === 'AVAILABLE')?.userId || drivers[0]?.userId || '';
                              setSelectedDriverUserId(firstAvail);
                            }}
                            onCancelClick={(ord) => {
                              setCancellingOrder(ord);
                              setCancellationReason('Cliente solicitou cancelamento');
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* 5. EM ROTA (AZUL SUAVE OFICIAL - TRAJETO / ENTREGA) */}
                    <div 
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                      onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); handleKanbanDrop(id, 'OUT_FOR_DELIVERY'); }}
                      className="w-[195px] sm:w-[205px] xl:w-[215px] shrink-0    rounded-xl p-2 flex flex-col min-h-[400px] border-2" style={{ backgroundColor: ORDER_STATUS_THEME.OUT_FOR_DELIVERY.drawerBg, borderColor: ORDER_STATUS_THEME.OUT_FOR_DELIVERY.border }}
                    >
                      <KanbanColumnHeader status="OUT_FOR_DELIVERY" label="Em rota" count={countEmRota} />
                      <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-300px)] pr-0.5 scrollbar-thin flex-1">
                        {fulfillmentOrders.filter(o => o.status === 'OUT_FOR_DELIVERY').map(order => (
                          <KanbanOrderCard
                            prepMinutes={prepMinutes}
                            key={order.id}
                            order={orderForCard(order)}
                            isSelected={selectedOrder?.id === order.id}
                            onSelectOrder={(ord) => setSelectedOrder(ord)}
                            onUpdateStatus={handleUpdateStatus}
                            onAssignDriverClick={(ord) => {
                              setAssigningOrder(ord);
                              const firstAvail = drivers.find(d => d.status === 'AVAILABLE')?.userId || drivers[0]?.userId || '';
                              setSelectedDriverUserId(firstAvail);
                            }}
                            onCancelClick={(ord) => {
                              setCancellingOrder(ord);
                              setCancellationReason('Cliente solicitou cancelamento');
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ========================================================================= */}
              {/* MODO TABELA VISUAL POR STATUS (SCREENSHOT 3 - COMANDO 125 COMPACTADO)    */}
              {/* ========================================================================= */}
              {viewMode === 'table' && (
                <div className="bg-white border border-slate-200/90 rounded-lg shadow-xs overflow-hidden" style={{ zoom: `${cardScale}%` }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[9.5px]">
                      <thead className="bg-slate-50/90 text-slate-500 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="py-1 px-1.5 pl-2 flex items-center gap-1 text-[8.5px]">
                            <input type="checkbox" className="rounded text-emerald-600 focus:ring-emerald-500" readOnly />
                            <span># Pedido</span>
                          </th>
                          <th className="py-1 px-1.5 text-[8.5px]">Cliente</th>
                          <th className="py-1 px-1.5 text-[8.5px]">Hora</th>
                          <th className="py-1 px-1.5 text-[8.5px]">Itens</th>
                          <th className="py-1 px-1.5 text-[8.5px]">Tipo</th>
                          <th className="py-1 px-1.5 text-[8.5px]">Pagamento</th>
                          <th className="py-1 px-1.5 text-[8.5px]">Status</th>
                          <th className="py-1 px-1.5 text-[8.5px]">Total</th>
                          <th className="py-1 px-2 pr-2 text-right text-[8.5px]">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredOrders.map(order => {
                          const totalItemsCount = order.items?.reduce((acc, it) => acc + (it.quantity || 1), 0) || order.items?.length || 0;
                          const orderTimeStr = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                          const rowTheme = ORDER_STATUS_THEME[order.status] || ORDER_STATUS_THEME.PENDING;
                          const isSelected = selectedOrder?.id === order.id;

                          return (
                            <tr
                              key={order.id}
                              onClick={() => setSelectedOrder(order)}
                              style={{ backgroundColor: rowTheme.bg }}
                              className={`transition-colors cursor-pointer group relative ${
                                isSelected ? 'ring-2 ring-emerald-500/60' : 'hover:opacity-90'
                              }`}
                            >
                              {/* # Pedido com Barra Lateral Colorida & Checkbox & Tempo */}
                              <td className="py-1 px-1.5 pl-2 relative">
                                <div 
                                  className="absolute left-0 top-0 bottom-0 w-0.5" 
                                  style={{ backgroundColor: rowTheme.accent }} 
                                />
                                <div className="flex items-center gap-1">
                                  <input 
                                    type="checkbox" 
                                    checked={isSelected} 
                                    onChange={() => setSelectedOrder(order)}
                                    className="rounded text-emerald-600 focus:ring-emerald-500" 
                                  />
                                  <span className="font-mono font-black text-slate-900 text-[10px]">
                                    #{order.orderNumber || order.id.slice(0, 6)}
                                  </span>
                                  <span className="text-[8px] font-mono text-rose-600 font-bold flex items-center gap-0.5">
                                    <Clock className="w-2 h-2" />
                                    <span>{orderTimeStr}</span>
                                  </span>
                                  <OrderAgeBadge order={order} />
                                </div>
                              </td>

                              {/* Cliente */}
                              <td className="py-1 px-1.5">
                                <div className="flex items-center gap-1">
                                  <User className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                                  <div>
                                    <div className="font-bold text-slate-900 text-[9.5px] leading-tight">{dineInOrderLabel(order)}</div>
                                    <div className="text-[8px] text-slate-400 font-mono leading-none">{order.customerPhone}</div>
                                  </div>
                                </div>
                              </td>

                              {/* Hora */}
                              <td className="py-1 px-1.5 text-slate-500 font-mono text-[9px]">
                                {orderTimeStr}
                              </td>

                              {/* Itens */}
                              <td className="py-1 px-1.5 text-slate-700 font-medium text-[9px]">
                                {totalItemsCount} {totalItemsCount === 1 ? 'item' : 'itens'}
                              </td>

                              {/* Tipo */}
                              <td className="py-1 px-1.5 text-slate-700 text-[9px]">
                                <span className="flex items-center gap-0.5">
                                  {order.fulfillmentType === 'DINE_IN' ? (
                                    <>
                                      <UtensilsCrossed className="w-2.5 h-2.5 text-slate-400" />
                                      <span>Salão</span>
                                    </>
                                  ) : order.fulfillmentType === 'PICKUP' ? (
                                    <>
                                      <Building2 className="w-2.5 h-2.5 text-slate-400" />
                                      <span>Retirada</span>
                                    </>
                                  ) : (
                                    <>
                                      <Bike className="w-2.5 h-2.5 text-slate-400" />
                                      <span>Delivery</span>
                                    </>
                                  )}
                                </span>
                              </td>

                              {/* Pagamento */}
                              <td className="py-1 px-1.5 text-slate-700 font-medium text-[9px]">
                                <span className="flex items-center gap-0.5">
                                  <DollarSign className="w-2.5 h-2.5 text-slate-400" />
                                  <span>{formatPaymentMethod(order.paymentMethod)}</span>
                                </span>
                              </td>

                              {/* Status Badge */}
                              <td className="py-1 px-1.5">
                                <span className="inline-flex items-center gap-1">
                                  <OrderStatusChip status={order.status} late={checkIsPreparingDelayed(order.createdAt, order.status, prepMinutes)} className="text-[7.5px] px-1 py-0" />
                                  <SlaTimerChip status={order.status} createdAt={order.createdAt} prepMinutes={prepMinutes} className="text-[7.5px] px-1 py-0" />
                                </span>
                              </td>

                              {/* Total */}
                              <td className="py-1 px-1.5 font-mono font-black text-slate-900 text-[10px]">
                                {formatBRL(order.totalAmount)}
                              </td>

                              {/* Ação */}
                              <td className="py-1 px-1.5 pr-2 text-right">
                                <div className="inline-flex items-center gap-0.5 justify-end">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (order.status === 'PENDING') handleUpdateStatus(order.id, 'CONFIRMED');
                                      else if (order.status === 'CONFIRMED') handleUpdateStatus(order.id, 'PREPARING');
                                      else if (order.status === 'PREPARING') handleUpdateStatus(order.id, 'READY');
                                      else if (order.status === 'READY' && order.fulfillmentType === 'PICKUP') handleUpdateStatus(order.id, 'DELIVERED');
                                      else if (order.status === 'READY') {
                                        setAssigningOrder(order);
                                        const firstAvail = drivers.find(d => d.status === 'AVAILABLE')?.userId || drivers[0]?.userId || '';
                                        setSelectedDriverUserId(firstAvail);
                                      } else if (order.status === 'OUT_FOR_DELIVERY') handleUpdateStatus(order.id, 'DELIVERED');
                                      else setSelectedOrder(order);
                                    }}
                                    style={orderActionButtonStyle(rowTheme, order)}
                                    className="py-0.2 px-1.5 rounded text-[8.5px] font-bold shadow-2xs hover:opacity-90 transition-all cursor-pointer"
                                  >
                                    {(order.fulfillmentType === 'PICKUP' && pickupActionLabel(order.status)) || rowTheme.buttonLabel}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedOrder(order);
                                    }}
                                    className="p-1 rounded text-slate-400 hover:text-slate-700"
                                  >
                                    <MoreVertical className="w-3 h-3" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* REGIÃO 3: DRAWER STATUS-AWARE FIXO À DIREITA (LARGURA DO MENU: 200px)     */}
      {/* ========================================================================= */}
      {selectedOrder && selectedOrderTheme && (
        <>
          {/* Desktop: Fixo e colado no lado direito da tela (exatamente 200px como a coluna do menu) */}
          <aside className="hidden lg:flex w-[200px] shrink-0 border-l border-slate-200/90 bg-white h-full flex-col shadow-lg z-20 overflow-hidden animate-in slide-in-from-right duration-200">
            {renderDrawerContent()}
          </aside>

          {/* Mobile / Tablet: Drawer flutuante com backdrop */}
          <div 
            className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs lg:hidden animate-in fade-in"
            onClick={() => setSelectedOrder(null)}
          >
            <aside 
              className="w-full max-w-[200px] bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {renderDrawerContent()}
            </aside>
          </div>
        </>
      )}

      {/* ========================================================================= */}
      {/* MODAIS: ATRIBUIR MOTORISTA, CANCELAR, IMPRESSÃO TÉRMICA & PDV             */}
      {/* ========================================================================= */}
      {/* Modal de Atribuição de Motorista */}
      <Modal
        isOpen={Boolean(assigningOrder)}
        onClose={() => setAssigningOrder(null)}
        title={`Despachar Pedido #${assigningOrder?.orderNumber}`}
        size="sm"
      >
        <form onSubmit={handleAssignDriver} className="space-y-4">
          <p className="text-xs text-slate-600">
            Selecione o entregador responsável pelo transporte deste pedido:
          </p>

          {queueError && <p role="alert">{queueError}</p>}
          {queueLoading && <p>Consultando entregadores…</p>}
          <div className="space-y-2">
            {dispatchMode === 'AUTO_QUEUE' ? <p className="font-semibold">{queue[0] ? `Próximo da fila: ${queue[0].name}` : 'Nenhum entregador disponível.'}</p> : drivers.length === 0 ? (
              <p data-testid="no-approved-driver" className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
                {driversLoaded
                  ? noApprovedDriverMessage()
                  : canListDrivers
                    ? 'Não foi possível carregar a lista de entregadores agora. Tente de novo em instantes.'
                    : 'Seu perfil não vê a lista de entregadores. Use "Aguardar entregador" ou peça ao dono ou gerente para despachar.'}
              </p>
            ) : (
              <select
                value={selectedDriverUserId}
                onChange={(e) => setSelectedDriverUserId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:border-emerald-700"
                required
              >
                <option value="">Selecione um motorista...</option>
                {drivers.filter(d => d.status === 'AVAILABLE').map(d => (
                  <option key={d.id} value={d.userId || d.id}>
                    {d.name} {d.status === 'AVAILABLE' ? '🟢 (Disponível)' : '🟡 (Em entrega)'}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAssigningOrder(null)} className="text-xs">
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={isAssigning || queueLoading || Boolean(queueError) || !selectedDriverUserId} className="text-xs font-bold bg-[#15803d] hover:bg-[#166534] text-white">
              {isAssigning ? 'Atribuindo...' : 'Confirmar e Despachar'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de Cancelamento */}
      <Modal
        isOpen={Boolean(cancellingOrder)}
        onClose={() => setCancellingOrder(null)}
        title={`Cancelar Pedido #${cancellingOrder?.orderNumber}`}
        size="sm"
      >
        <form onSubmit={handleConfirmCancel} className="space-y-4">
          <p className="text-xs text-slate-600">
            Deseja cancelar este pedido? Os produtos retornarão ao estoque da loja.
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">Motivo:</label>
            <select
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 outline-none focus:border-emerald-700"
            >
              <option value="Cliente solicitou cancelamento">Cliente solicitou cancelamento</option>
              <option value="Itens esgotados no estoque">Itens esgotados no estoque</option>
              <option value="Endereço fora do raio de entrega">Endereço fora do raio de entrega</option>
              <option value="Problema com forma de pagamento">Problema com forma de pagamento</option>
              <option value="Outro motivo operacional">Outro motivo operacional</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setCancellingOrder(null)} className="text-xs">
              Voltar
            </Button>
            <Button type="submit" variant="danger" size="sm" className="text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white">
              Confirmar Cancelamento
            </Button>
          </div>
        </form>
      </Modal>

      {/* Impressão Térmica 80mm */}
      <ThermalReceiptModal
        order={orderToPrint}
        storeName={activeTenant.name}
        onClose={() => setOrderToPrint(null)}
      />

      {/* Frente de Caixa PDV */}
      {isModuleEnabled('pos') && (
        <PDVModal
          isOpen={isPDVOpen}
          tenantId={activeTenant?.id || ''}
          products={storeProducts}
          addonsEnabled={isModuleEnabled('addons')}
          onClose={() => setIsPDVOpen(false)}
          onSubmit={handlePDVSubmit}
        />
      )}
    </div>
  );
};
