import { DriverOffersContext, DriverOfferStatus } from '../../components/dispatch/DriverOfferStatus';
import { useOwnerDriverOffers } from '../../hooks/useOwnerDriverOffers';
import { driverOfferRepository } from '../../repositories/driverOfferRepository';
import { visibleStaffOrders } from '../../lib/orders/onlinePaymentGate';
import { OnlineOrderPaymentPanel } from '../../components/client/OnlineOrderPaymentPanel';
import { OnlinePaymentBadge } from '../../components/establishment/OnlinePaymentBadge';
import { OrderChat } from '../../components/chat/OrderChat';
import { dispatchChatRepository, QueueDriver, DispatchMode, type OwnerNotification } from '../../repositories/dispatchChatRepository';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { OrdersKanban } from '../../components/establishment/OrdersKanban';
import { isDateInOrdersPeriod, matchesOrderSearch, KANBAN_COLUMNS, kanbanColumnForStatus, type OrdersPeriod } from '../../components/establishment/ordersKanban';
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
import { driverInviteRepository } from '../../repositories/driverRepository';
import { productRepository } from '../../repositories/productRepository';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { Order, OrderStatus, PaymentStatus, Driver, Product } from '../../types';
import { playNewOrderSound } from '../../utils/audio';
import { ThermalReceiptModal } from '../../components/establishment/ThermalReceiptModal';
import { PDVModal } from '../../components/establishment/PDVModal';
import { KanbanOrderCard } from '../../components/establishment/KanbanOrderCard';
import { OrderStatusChip } from '../../components/establishment/StatusIcon';
import { SlaTimerChip } from '../../components/establishment/SlaTimerChip';
import { useNewOrderAlarm } from '../../lib/orders/newOrderAlarm';
import { ORDER_STATUS_THEME, DELAYED_PREPARING_THEME, checkIsPreparingDelayed, orderActionButtonStyle } from '../../utils/orderStatusTheme';
import { ShoppingBag, Bike, Clock, Phone, FileText, User, RefreshCw, Search, X, ChevronRight, ChevronDown, AlertTriangle, Printer, Plus, DollarSign, MessageSquare, Layers, List, Volume2, VolumeX, Building2, Check, UtensilsCrossed, MoreVertical, SlidersHorizontal } from 'lucide-react';
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
import { canArchiveOrder, matchesOrderStatusTab } from '../../lib/orders/archive';

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
  'ARCHIVED',
]);

export const OrdersPage: React.FC<OrdersPageProps> = ({ activeTab: requestedTab, onTabChange }) => {
  const { activeTenant, securityContext, availableTenants, switchTenant, supabaseUser, activeRole } = useAuth();
  const { isModuleEnabled } = useModules();
  const { showToast } = useToast();

  // Estados principais da fila de pedidos
  const [archiveBusy, setArchiveBusy] = useState(false);
  const archiveInFlight = useRef(false);
  const [archiveAllOpen, setArchiveAllOpen] = useState(false);
  const canManageArchive = activeRole === 'OWNER' || activeRole === 'MANAGER';
  const [remoteOrders, setRemoteOrders] = useState<Order[] | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  // 19/10: true só quando list_assignable_drivers respondeu com sucesso (vazio = loja sem entregador aprovado).
  const [driversLoaded, setDriversLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());
  const [syncError, setSyncError] = useState<string | null>(null);

  // Preferências antigas (cards) ou inválidas passam a usar Kanban.
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>(() => {
    try {
      return localStorage.getItem('adegafood_orders_view_mode') === 'table' ? 'table' : 'kanban';
    } catch {
      return 'kanban';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('adegafood_orders_view_mode', viewMode);
    } catch {}
  }, [viewMode]);

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

  // Som de alerta e Auto-aceitar
  const soundEnabled = !['OWNER','MANAGER'].includes(activeRole || '');
  // Tempo de Preparo da loja (min) para o semáforo/atraso; padrão 25 (lib/orders/sla)
  const prepMinutes = activeTenant?.settings?.defaultPrepTimeMinutes;

  // Filtros de apresentação, sem alterar o gate de pagamento.
  const [internalActiveTab, setInternalActiveTab] = useState<string>('ALL');
  const activeTab = requestedTab === undefined
    ? internalActiveTab
    : ORDER_STATUS_TABS.has(requestedTab) ? requestedTab : 'ALL';
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const changeActiveTab = (tab: string) => {
    setSelectedOrder(null);
    setInternalActiveTab(tab);
    onTabChange?.(tab);
  };
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterFulfillment, setFilterFulfillment] = useState<'ALL' | FulfillmentTab>('ALL');
  const [filterDriver, setFilterDriver] = useState<'ALL' | 'WITH_DRIVER' | 'WITHOUT_DRIVER'>('ALL');
  const [filterPeriod, setFilterPeriod] = useState<OrdersPeriod>('TODAY');

  // COMANDO 135: Painel de controles recolhível (Busca, filtros, abas, modos, legenda)
  const [isControlsCollapsed, setIsControlsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('adegafood_orders_controls_collapsed') !== 'false';
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

  const [unreadMessages, setUnreadMessages] = useState<OwnerNotification[]>([]);
  useEffect(() => {
    setUnreadMessages([]);
    if (!activeTenant?.id || !supabaseUser?.id || !['OWNER', 'MANAGER'].includes(activeRole || '')) return;
    let alive = true;
    const load = async () => {
      try {
        const rows = await dispatchChatRepository.notifications(activeTenant.id);
        if (alive) setUnreadMessages(rows.filter(n => n.kind === 'ORDER_MESSAGE' && !n.read_at));
      } catch { /* O sino existente continua responsável pelos erros das notificações. */ }
    };
    const channel = supabase.channel(`orders-chat-indicators:${activeTenant.id}:${supabaseUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'owner_notifications', filter: `tenant_id=eq.${activeTenant.id}` }, () => { void load(); })
      .subscribe(() => { void load(); });
    void load();
    const timer = window.setInterval(load, 15000);
    return () => { alive = false; window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [activeTenant?.id, supabaseUser?.id, activeRole]);
  const openOrderChat = (order: Order) => {
    if (!activeTenant) return;
    sessionStorage.setItem(`dc:focus-chat:${activeTenant.id}`, order.id);
    setSelectedOrder(order);
    setDrawerTab('detalhes');
    window.dispatchEvent(new CustomEvent('dc:open-chat', { detail: order.id }));
    for (const notification of unreadMessages.filter(n => n.ref_id === order.id)) {
      void dispatchChatRepository.read(activeTenant.id, notification.id).then(() => {
        setUnreadMessages(rows => rows.filter(n => n.id !== notification.id));
      }).catch(() => { /* Não retirar o ponto até confirmar a leitura. */ });
    }
  };

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
    if (!assigningOrder || !activeTenant?.id || !['OWNER','MANAGER','DELIVERY_MANAGER'].includes(activeRole || '')) return;
    setQueueLoading(true);
    void dispatchChatRepository.queue(activeTenant.id).then(r => {
      if (!alive) return;
      setDispatchMode(r.mode); setQueue(r.drivers);
      if (r.mode === 'AUTO_QUEUE') setSelectedDriverUserId(r.drivers[0]?.user_id || '');
    }).catch(e => { if (alive) setQueueError(e.message); }).finally(() => { if (alive) setQueueLoading(false); });
    return () => { alive = false; };
  }, [assigningOrder?.id, activeTenant?.id, activeRole]);
  useEffect(() => {
    const focus = (e: Event) => {
      const found = remoteOrders?.find(o => o.id === (e as CustomEvent).detail);
      if (!found) return;
      if (found.archivedAt) changeActiveTab('ARCHIVED');
      else if (found.status === 'CANCELLED') changeActiveTab('CANCELLED');
      setSelectedOrder(found);
      setDrawerTab('detalhes');
      sessionStorage.removeItem(FOCUS_ORDER_KEY);
    };
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
        orderRepository.getOrders(securityContext, activeTenant.id, { allPages: true }),
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
      if (focused?.archivedAt) changeActiveTab('ARCHIVED');
      else if (focused?.status === 'CANCELLED') changeActiveTab('CANCELLED');
      if (focusId) { try { sessionStorage.removeItem(FOCUS_ORDER_KEY); } catch { /* sem storage */ } }
      if (focused && sessionStorage.getItem(`dc:dispatch-order:${activeTenant.id}`) === focused.id) {
        sessionStorage.removeItem(`dc:dispatch-order:${activeTenant.id}`); setAssigningOrder(focused);
      }
      setSelectedOrder(prev => {
        if (focused) return focused;
        // O quadro abre completo; detalhes aparecem ao selecionar um pedido ou aviso.
        if (!prev) return null;
        const updated = ordersWithTableLabels.find(o => o.id === prev.id);
        if (updated && !matchesOrderStatusTab(updated, activeTabRef.current)) return null;
        return updated || null;
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
    // Kanban: arrastar só avança etapas; voltar exige a ação explícita no detalhe.
    const columnRank = KANBAN_COLUMNS.indexOf(kanbanColumnForStatus(targetStatus));
    if (columnRank < KANBAN_COLUMNS.indexOf(kanbanColumnForStatus(targetOrder.status))) {
      showToast({ type: 'warning', title: 'Movimento não permitido', message: 'Arraste o pedido apenas para a próxima etapa.' });
      return;
    }
    // Delivery só é entregue depois de sair com o entregador (aceite + código de retirada).
    if (targetStatus === 'DELIVERED' && targetOrder.fulfillmentType === 'DELIVERY' && targetOrder.status !== 'OUT_FOR_DELIVERY') {
      showToast({ type: 'warning', title: 'Despacho pendente', message: 'Chame um entregador e confira o código de retirada antes de concluir a entrega.' });
      return;
    }

    if (targetStatus === 'OUT_FOR_DELIVERY' && !targetOrder.driverId && targetOrder.fulfillmentType !== 'PICKUP') {
      setAssigningOrder(targetOrder);
      const firstAvail = drivers.find(d => d.status === 'AVAILABLE')?.userId || '';
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
    if (!assigningOrder || (dispatchMode === 'OWNER_PICKS' && !selectedDriverUserId) || !activeTenant?.id) return;

    setIsAssigning(true);
    try {
      await driverOfferRepository.offer(assigningOrder.id, dispatchMode === 'AUTO_QUEUE' ? null : selectedDriverUserId);
      await ownerOffers.refresh();

      showToast({
        type: 'success',
        title: 'Chamada enviada',
        message: 'Aguardando aceite do entregador.',
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

  const handleArchive = async (orderIds: string[], archive: boolean) => {
    if (!canManageArchive || archiveInFlight.current || !orderIds.length) return;
    archiveInFlight.current = true;
    setArchiveBusy(true);
    try {
      await orderRepository.archiveOrders(orderIds, archive);
      setSelectedOrder(current => current && orderIds.includes(current.id) ? null : current);
      setArchiveAllOpen(false);
      await fetchOrders(true);
      showToast({ type: 'success', title: archive ? 'Pedidos arquivados' : 'Pedidos desarquivados', message: 'Histórico e relatórios preservados.' });
    } catch (err) {
      showToast({ type: 'error', title: 'Não foi possível alterar o arquivamento', message: err instanceof Error ? err.message : 'Tente novamente.' });
    } finally {
      archiveInFlight.current = false;
      setArchiveBusy(false);
    }
  };

  const allOrders = visibleStaffOrders(remoteOrders || []);
  const unarchivedOrders = allOrders.filter(order => !order.archivedAt);
  const cancelledOrderIds = unarchivedOrders.filter(order => order.status === 'CANCELLED').map(order => order.id);
  // As cinco colunas incluem encerrados; o histórico arquivado mantém sua Lista.
  const effectiveViewMode = activeTab === 'ARCHIVED' ? 'table' : viewMode;
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

  // Filtragem composta em memória
  const scopedOrders = useMemo(() => {
    // 19/10: pedido novo sempre no topo; os antigos em aberto ganham o selo "recebido há ...".
    return sortOrdersNewestFirst(allOrders).filter(order => {
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
      if (!isDateInOrdersPeriod(order.createdAt, filterPeriod)) {
        return false;
      }

      if (!matchesOrderSearch(order, searchQuery)) return false;

      return true;
    });
  }, [allOrders, filterFulfillment, filterDriver, filterPeriod, searchQuery]);

  // Contadores dos filtros de status.
  const fulfillmentOrders = scopedOrders.filter(order => !order.archivedAt);
  const countNovos = fulfillmentOrders.filter(o => o.status === 'PENDING').length;
  const countConfirmados = fulfillmentOrders.filter(o => o.status === 'CONFIRMED').length;
  const countEmPreparo = fulfillmentOrders.filter(o => o.status === 'PREPARING').length;
  const countProntos = fulfillmentOrders.filter(o => o.status === 'READY' || o.status === 'WAITING_FOR_DRIVER').length;
  const countEmRota = fulfillmentOrders.filter(o => o.status === 'OUT_FOR_DELIVERY').length;
  const countEntregues = fulfillmentOrders.filter(o => o.status === 'DELIVERED').length;
  const countCancelados = fulfillmentOrders.filter(o => o.status === 'CANCELLED').length;

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
    { id: 'ARCHIVED', label: 'Arquivados', count: scopedOrders.filter(o => o.archivedAt).length },
  ];

  const filteredOrders = scopedOrders.filter(order => activeTab === 'ALL' ? !order.archivedAt : matchesOrderStatusTab(order, activeTab));

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

  const ownerOffers = useOwnerDriverOffers(activeTenant?.id,
    (remoteOrders || []).filter(o => !['CANCELLED','DELIVERED'].includes(o.status)).map(o => o.id), () => { void fetchOrders(true); });
  const liveOffer = (id: string) => ownerOffers.offers.find(f => f.order_id === id && f.status === 'OFFERED');
  const retryOffer = (id: string) => ['DECLINED','EXPIRED'].includes(ownerOffers.offers.find(f => f.order_id === id)?.status || '');

  const orderQueue = queue.filter(d => !ownerOffers.offers.some(f => f.order_id === assigningOrder?.id && f.driver_user_id === d.user_id && ['DECLINED','EXPIRED'].includes(f.status)));
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

                <DriverOfferStatus orderId={selectedOrder.id} />

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
          {canManageArchive && canArchiveOrder(selectedOrder) && (
            <Button size="sm" variant="outline" disabled={archiveBusy}
              onClick={() => void handleArchive([selectedOrder.id], !selectedOrder.archivedAt)}>
              {selectedOrder.archivedAt ? 'Desarquivar' : 'Arquivar'}
            </Button>
          )}
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
          {selectedOrder.status !== 'CANCELLED' && selectedOrder.status !== 'DELIVERED' && !liveOffer(selectedOrder.id) && selectedOrder.status !== 'WAITING_FOR_DRIVER' && (
            <button
              type="button"
              onClick={() => {
                if (selectedOrder.status === 'PENDING') handleUpdateStatus(selectedOrder.id, 'CONFIRMED');
                else if (selectedOrder.status === 'CONFIRMED') handleUpdateStatus(selectedOrder.id, 'PREPARING');
                else if (selectedOrder.status === 'PREPARING') handleUpdateStatus(selectedOrder.id, 'READY');
                else if (selectedOrder.status === 'READY') {
                  setAssigningOrder(selectedOrder);
                  const firstAvail = drivers.find(d => d.status === 'AVAILABLE')?.userId || '';
                  setSelectedDriverUserId(firstAvail);
                } else if (selectedOrder.status === 'OUT_FOR_DELIVERY') handleUpdateStatus(selectedOrder.id, 'DELIVERED');
              }}
              style={orderActionButtonStyle(selectedOrderTheme, selectedOrder)}
              className="w-full py-1.5 px-1.5 rounded-md font-bold text-[9px] uppercase tracking-wide flex items-center justify-center gap-1 shadow-2xs hover:opacity-90 transition-all cursor-pointer active:scale-98 min-h-[30px] leading-tight text-center"
            >
              <Check className="w-2.5 h-2.5 stroke-[3] shrink-0" />
              <span className="truncate">{selectedOrder.status === 'READY' && retryOffer(selectedOrder.id) ? 'Chamar outro' : selectedOrderTheme.buttonLabel}</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <DriverOffersContext.Provider value={ownerOffers}>
    <div className="flex-1 min-w-0 h-full flex flex-row overflow-hidden relative font-sans">
      {/* ========================================================================= */}
      {/* REGIÃO 2: CONTEÚDO OPERACIONAL (TOPO + KANBAN / LISTA)                   */}
      {/* ========================================================================= */}
      <div className="flex-1 min-w-0 h-full min-h-0 overflow-hidden flex flex-col">
        <header className="shrink-0 border-b border-slate-200/80 bg-white px-3 py-3">
          <h1 className="sr-only">Pedidos</h1>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold tracking-wider text-slate-400">PERÍODO</span>
              <div className="flex items-center gap-1 rounded-xl bg-[#f1f5f9] p-1" aria-label="Período dos pedidos">
                {([['TODAY', 'Hoje'], ['YESTERDAY', 'Ontem'], ['7D', '7 dias']] as const).map(([id, label]) => <button key={id} type="button"
                  aria-pressed={filterPeriod === id} onClick={() => setFilterPeriod(id)}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors duration-150 ${filterPeriod === id ? 'bg-[#dc2626] text-white' : 'text-slate-500 hover:bg-white'}`}>{label}</button>)}
                <details className="relative">
                  <summary className={`flex cursor-pointer list-none items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold ${filterPeriod === 'ALL' || filterPeriod === '30D' ? 'bg-[#dc2626] text-white' : 'text-slate-500'}`}>Mais <ChevronDown size={12} /></summary>
                  <div className="absolute left-0 top-full z-30 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                    <label className="text-xs font-medium text-slate-500">Período
                      <select aria-label="Selecionar período" value={filterPeriod} onChange={e => setFilterPeriod(e.target.value as OrdersPeriod)} className="mt-2 w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-700">
                        <option value="ALL">Todos os períodos</option><option value="TODAY">Hoje</option><option value="YESTERDAY">Ontem</option><option value="7D">Últimos 7 dias</option><option value="30D">Últimos 30 dias</option>
                      </select>
                    </label>
                  </div>
                </details>
              </div>
            </div>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <div className="relative min-w-[200px] flex-1 lg:max-w-[290px]">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input aria-label="Buscar pedidos" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Número, nome ou telefone"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-xs outline-none focus:border-red-400" />
                {searchQuery && <button type="button" aria-label="Limpar busca" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><X size={14} /></button>}
              </div>
              {([['kanban', 'Kanban', Layers], ['table', 'Lista', List]] as const).map(([id, label, Icon]) => <button key={id} type="button" aria-pressed={effectiveViewMode === id}
                onClick={() => { setViewMode(id); if (activeTab === 'ARCHIVED' && id === 'kanban') changeActiveTab('ALL'); }}
                className={`flex h-10 items-center gap-1.5 rounded-xl border bg-white px-3 text-xs font-semibold ${effectiveViewMode === id ? 'border-red-300 text-red-600' : 'border-slate-200 text-slate-600'}`}><Icon size={15} />{label}</button>)}
              <button type="button" aria-label="Filtros e controles" aria-expanded={!isControlsCollapsed} onClick={toggleControlsCollapsed} className="flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600"><SlidersHorizontal size={15} />Filtros</button>
              {isModuleEnabled('pos') && <button type="button" data-testid="open-pdv" onClick={() => setIsPDVOpen(true)} disabled={!isN1N6Backend()} title={isN1N6Backend() ? undefined : N1N6_ONLY_MESSAGE}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-[#dc2626] px-4 text-xs font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50"><Plus size={16} />NOVO PEDIDO</button>}
            </div>
          </div>
          {!isControlsCollapsed && <div className="mt-3 max-h-[35vh] space-y-3 overflow-y-auto border-t border-slate-100 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Tipo de atendimento" value={filterFulfillment} onChange={e => setFilterFulfillment(e.target.value as 'ALL' | FulfillmentTab)} className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">
                <option value="ALL">Todos os atendimentos</option>{visibleFulfillmentTabs.map(id => <option key={id} value={id}>{id === 'DELIVERY' ? 'Delivery' : id === 'PICKUP' ? 'Retirada' : 'Salão'}</option>)}
              </select>
              <select aria-label="Filtrar entregador" value={filterDriver} onChange={e => setFilterDriver(e.target.value as typeof filterDriver)} className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600"><option value="ALL">Todos os entregadores</option><option value="WITH_DRIVER">Com entregador</option><option value="WITHOUT_DRIVER">Sem entregador</option></select>
              <button type="button" data-testid="orders-sound" onClick={newOrderAlarm.toggle} aria-pressed={newOrderAlarm.enabled && newOrderAlarm.unlocked} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600">{newOrderAlarm.enabled && newOrderAlarm.unlocked ? <Volume2 size={14} /> : <VolumeX size={14} />}{newOrderAlarm.enabled && newOrderAlarm.unlocked ? 'Som ligado' : 'Ativar som'}</button>
              <button type="button" onClick={() => fetchOrders()} disabled={isRefreshing} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600"><RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />Atualizar</button>
              <div className="flex items-center gap-2 text-xs text-slate-500"><span>Tamanho:</span><button type="button" aria-label="Diminuir tamanho" disabled={cardScale <= 50} onClick={() => handleStepCardScale(-5)}>−</button><button type="button" title="Redefinir tamanho" onClick={handleResetCardScale}>{cardScale}%</button><button type="button" aria-label="Aumentar tamanho" disabled={cardScale >= 150} onClick={() => handleStepCardScale(5)}>+</button></div>
              <button type="button" onClick={handleClearFilters} className="ml-auto text-xs font-semibold text-red-600">Limpar filtros</button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" data-testid="fulfillment-tabs" role="tablist" aria-label="Atendimento">
              {([['DELIVERY', 'Entrega', Bike], ['PICKUP', 'Retirada', ShoppingBag], ['DINE_IN', 'Salão', UtensilsCrossed]] as const).filter(([id]) => visibleFulfillmentTabs.includes(id)).map(([id, label, Icon]) => {
                const counts = tabCounts(allOrders, id, prepMinutes);
                return <button type="button" key={id} role="tab" data-testid={`ftab-${id}`} data-tone={tabTone(counts)} data-count={counts.acionaveis} aria-selected={filterFulfillment === id} onClick={() => setFilterFulfillment(filterFulfillment === id ? 'ALL' : id)} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${filterFulfillment === id ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-600'}`}><Icon size={14} />{label} <span>{counts.acionaveis}</span>{counts.atrasado > 0 && <span className="text-red-600">· {counts.atrasado} atrasado(s)</span>}</button>;
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Etapas dos pedidos">
              {statusPills.map(tab => <button type="button" key={tab.id} onClick={() => changeActiveTab(tab.id)} aria-pressed={activeTab === tab.id} className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs ${activeTab === tab.id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>{tab.label} <span>{tab.count}</span></button>)}
            </div>
          </div>}
        </header>

        {/* ÁREA OPERACIONAL DE PEDIDOS: KANBAN / LISTA */}
        <div className={`flex flex-1 min-h-0 min-w-0 flex-col gap-3 p-3 ${effectiveViewMode === 'table' ? 'overflow-y-auto' : 'overflow-hidden'}`}>
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
          {activeTab === 'CANCELLED' && canManageArchive && (
            <div className="mb-3 flex items-center gap-3">
              <Button variant="outline" size="sm" disabled={archiveBusy || !cancelledOrderIds.length} onClick={() => setArchiveAllOpen(true)}>
                Arquivar todos os cancelados
              </Button>
              <span className="text-xs text-slate-500">Todos os cancelados da loja, em qualquer atendimento ou período.</span>
            </div>
          )}
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
          ) : loading && effectiveViewMode === 'table' ? (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-3">
              <Skeleton className="h-6 w-1/4 rounded-lg" />
              <Skeleton className="h-10 w-full rounded-xl" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          ) : filteredOrders.length === 0 && effectiveViewMode === 'table' ? (
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
              {/* KANBAN: cinco colunas com rolagem independente. */}
              {/* ========================================================================= */}
              {effectiveViewMode === 'kanban' && <OrdersKanban orders={filteredOrders} loading={loading} onDrop={handleKanbanDrop}
                renderOrder={order => <div key={order.id} style={{ zoom: `${cardScale}%` }}><KanbanOrderCard
                  order={orderForCard(order)} isSelected={selectedOrder?.id === order.id} prepMinutes={prepMinutes}
                  onSelectOrder={setSelectedOrder} onUpdateStatus={handleUpdateStatus}
                  onPrint={setOrderToPrint} onOpenChat={openOrderChat} unreadChat={unreadMessages.some(n => n.ref_id === order.id)}
                  onArchive={canManageArchive && canArchiveOrder(order) ? ord => { void handleArchive([ord.id], true); } : undefined} archiveBusy={archiveBusy}
                  onAssignDriverClick={ord => { setAssigningOrder(ord); setSelectedDriverUserId(drivers.find(d => d.status === 'AVAILABLE')?.userId || ''); }}
                  onCancelClick={ord => { setCancellingOrder(ord); setCancellationReason('Cliente solicitou cancelamento'); }}
                /></div>} />}

              {/* ========================================================================= */}
              {/* MODO LISTA POR STATUS    */}
              {/* ========================================================================= */}
              {effectiveViewMode === 'table' && (
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
                                  <DriverOfferStatus orderId={order.id} /><OrderStatusChip status={order.status} late={checkIsPreparingDelayed(order.createdAt, order.status, prepMinutes)} className="text-[7.5px] px-1 py-0" />
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
                                      else if (order.status === 'READY' && !liveOffer(order.id)) {
                                        setAssigningOrder(order);
                                        const firstAvail = drivers.find(d => d.status === 'AVAILABLE')?.userId || '';
                                        setSelectedDriverUserId(firstAvail);
                                      } else if (order.status === 'OUT_FOR_DELIVERY') handleUpdateStatus(order.id, 'DELIVERED');
                                      else setSelectedOrder(order);
                                    }}
                                    style={orderActionButtonStyle(rowTheme, order)}
                                    className="py-0.2 px-1.5 rounded text-[8.5px] font-bold shadow-2xs hover:opacity-90 transition-all cursor-pointer"
                                  >
                                    {liveOffer(order.id) || order.status === 'WAITING_FOR_DRIVER' ? 'Ver detalhes' : (order.fulfillmentType === 'PICKUP' && pickupActionLabel(order.status)) || (retryOffer(order.id) ? 'Chamar outro' : rowTheme.buttonLabel)}
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
        title={`Chamar entregador — Pedido #${assigningOrder?.orderNumber}`}
        size="sm"
      >
        <form onSubmit={handleAssignDriver} className="space-y-4">
          <p className="text-xs text-slate-600">
            O entregador receberá uma oferta e poderá aceitar ou recusar a corrida.
          </p>

          {queueError && <p role="alert">{queueError}</p>}
          {queueLoading && <p>Consultando entregadores…</p>}
          <div className="space-y-2">
            {dispatchMode === 'AUTO_QUEUE' ? <p className="font-semibold">{orderQueue[0] ? `Será chamado: ${orderQueue[0].name}` : 'Nenhum entregador disponível.'}</p> : drivers.length === 0 ? (
              <p data-testid="no-approved-driver" className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
                {driversLoaded
                  ? noApprovedDriverMessage()
                  : canListDrivers
                    ? 'Não foi possível carregar a lista de entregadores agora. Tente de novo em instantes.'
                    : 'Seu perfil não pode chamar entregadores. Peça ao dono ou gerente da loja.'}
              </p>
            ) : !drivers.some(d => d.status === 'AVAILABLE' && queue.some(q => q.user_id === d.userId)) ? (
              <p data-testid="no-available-driver" role="status" className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
                Nenhum entregador disponível agora. Peça para um entregador abrir o app e ficar online (Disponível); ele aparece aqui na hora.
              </p>
            ) : (
              <select
                value={selectedDriverUserId}
                onChange={(e) => setSelectedDriverUserId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:border-emerald-700"
                required
              >
                <option value="">Selecione um entregador...</option>
                {drivers.filter(d => d.status === 'AVAILABLE' && queue.some(q => q.user_id === d.userId)).map(d => (
                  <option key={d.id} value={d.userId || d.id}>
                    {d.name}{ownerOffers.offers.some(f => f.order_id === assigningOrder?.id && f.driver_user_id === d.userId && f.status === 'DECLINED') ? ' — recusou' : ownerOffers.offers.some(f => f.order_id === assigningOrder?.id && f.driver_user_id === d.userId && f.status === 'EXPIRED') ? ' — não respondeu' : ' — disponível'}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAssigningOrder(null)} className="text-xs">
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={isAssigning || queueLoading || Boolean(queueError) || (dispatchMode === 'OWNER_PICKS' ? !selectedDriverUserId : !orderQueue.length)} className="text-xs font-bold bg-[#15803d] hover:bg-[#166534] text-white">
              {isAssigning ? 'Chamando...' : 'Chamar entregador'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={archiveAllOpen} onClose={() => { if (!archiveBusy) setArchiveAllOpen(false); }}
        title="Arquivar todos os cancelados" size="sm">
        <p className="text-sm text-slate-700">Os pedidos saem desta tela, mas continuam no histórico e nos relatórios.</p>
        <p className="mt-2 text-sm">{cancelledOrderIds.length} pedidos cancelados da loja serão arquivados.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" disabled={archiveBusy} onClick={() => setArchiveAllOpen(false)}>Voltar</Button>
          <Button disabled={archiveBusy || !cancelledOrderIds.length} onClick={() => void handleArchive(cancelledOrderIds, true)}>
            {archiveBusy ? 'Arquivando...' : 'Arquivar todos os cancelados'}
          </Button>
        </div>
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
    </DriverOffersContext.Provider>
  );
};
