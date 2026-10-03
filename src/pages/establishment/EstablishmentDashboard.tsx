import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { productRepository } from '../../repositories/productRepository';
import { tenantRepository } from '../../repositories/tenantRepository';
import { orderRepository } from '../../repositories/orderRepository';
import { customerRepository } from '../../repositories/customerRepository';
import { driverRepository } from '../../repositories/driverRepository';
import { getPublicStorePath, isValidStoreSlug } from '../../utils/publicStoreUrl';
import { StatCard } from '../../components/ui/StatCard';
import { SectionCard } from '../../components/ui/SectionCard';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Button } from '../../components/ui/Button';
import { Order, Customer, Product, Driver } from '../../types';
import { 
  DollarSign, 
  ShoppingBag, 
  Users, 
  TrendingUp, 
  CheckCircle2, 
  AlertTriangle,
  Package,
  RefreshCw,
  Plus,
  ArrowRight,
  ExternalLink,
  Store,
  Tag,
  Clock,
  Bike,
  Power
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';

interface EstablishmentDashboardProps {
  onNavigate?: (tab: string) => void;
}

export const EstablishmentDashboard: React.FC<EstablishmentDashboardProps> = ({ onNavigate }) => {
  const { activeTenant, currentUser, securityContext } = useAuth();
  const { showToast } = useToast();

  // Estados de dados reais do Supabase / Repositórios
  const [remoteOrders, setRemoteOrders] = useState<Order[] | null>(null);
  const [remoteCustomers, setRemoteCustomers] = useState<Customer[] | null>(null);
  const [remoteDrivers, setRemoteDrivers] = useState<Driver[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUpdatingStoreStatus, setIsUpdatingStoreStatus] = useState(false);
  const [storeIsOpen, setStoreIsOpen] = useState<boolean>(activeTenant?.settings?.isOpen ?? true);

  // Sincroniza estado de loja aberta/fechada com configurações do tenant ativo
  useEffect(() => {
    if (activeTenant?.settings?.isOpen !== undefined) {
      setStoreIsOpen(activeTenant.settings.isOpen);
    }
  }, [activeTenant?.settings?.isOpen]);

  // Filtro de período para o gráfico de vendas: Hoje | 7 dias | 30 dias
  const [salesPeriod, setSalesPeriod] = useState<'today' | '7d' | '30d'>('7d');

  // Busca dados reais para o tenant ativo
  const fetchRealData = useCallback(async () => {
    if (!activeTenant?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const [fetchedOrders, fetchedCustomers, fetchedDrivers, tenantProducts] = await Promise.all([
        orderRepository.getOrders(securityContext, activeTenant.id).catch(() => []),
        customerRepository.getCustomers(securityContext, activeTenant.id).catch(() => []),
        driverRepository.listDrivers(securityContext, activeTenant.id).catch(() => []),
        productRepository.getProducts(securityContext, activeTenant.id).catch(() => []),
      ]);
      setRemoteOrders(fetchedOrders);
      setRemoteCustomers(fetchedCustomers);
      setRemoteDrivers(fetchedDrivers);
      setProducts(tenantProducts);
    } catch (err: any) {
      console.error('[EstablishmentDashboard] Erro ao carregar dados do Supabase:', err);
      setError(err.message || 'Falha ao carregar dados do painel do banco de dados.');
    } finally {
      setIsLoading(false);
    }
  }, [activeTenant?.id, securityContext]);

  useEffect(() => {
    fetchRealData();
    if (!activeTenant?.id) return;
    const unsubscribe = orderRepository.subscribeToOrders(activeTenant.id, () => {
      fetchRealData();
    });
    return unsubscribe;
  }, [fetchRealData, activeTenant?.id]);

  if (!activeTenant) return null;

  // Dados reais 100% Supabase (sem fallbacks para dataStore)
  const orders = remoteOrders || [];
  const customers = remoteCustomers || [];

  // Cálculos de métricas reais
  const todayStr = new Date().toISOString().split('T')[0];
  const ordersToday = orders.filter(o => o.createdAt.startsWith(todayStr));
  const revenueToday = ordersToday
    .filter(o => o.status !== 'CANCELLED')
    .reduce((acc, o) => acc + o.totalAmount, 0);

  const nonCancelledOrders = orders.filter(o => o.status !== 'CANCELLED');
  const totalRevenue = nonCancelledOrders.reduce((acc, o) => acc + o.totalAmount, 0);
  const totalOrdersCount = orders.length;
  const ticketMedio = nonCancelledOrders.length > 0 ? totalRevenue / nonCancelledOrders.length : 0;
  const deliveredOrdersCount = orders.filter(o => o.status === 'DELIVERED').length;
  const customersCount = customers.length;

  // Status da Operação (pedidos em andamento, entregas em andamento, alertas de estoque)
  const isStoreOpen = storeIsOpen;
  const defaultPrepMinutes = activeTenant.settings?.defaultPrepTimeMinutes ?? 30;
  const estimatedPrepTimeStr = `${defaultPrepMinutes} min`;
  const pendingOrPreparingCount = orders.filter(o => ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'].includes(o.status)).length;
  const inDeliveryCount = orders.filter(o => o.status === 'OUT_FOR_DELIVERY').length;
  const activeDriversCount = remoteDrivers ? remoteDrivers.filter(d => d.isOnline).length : 0;
  const lowStockCount = products.filter(p => (p.stockQuantity ?? 0) <= (p.minStock ?? 5)).length;

  // Toggle do status operacional da loja (Aberta / Fechada) no Supabase
  const handleToggleStoreOpen = async () => {
    setIsUpdatingStoreStatus(true);
    const newIsOpen = !isStoreOpen;
    try {
      await tenantRepository.updateSettings(securityContext, activeTenant.id, { isOpen: newIsOpen });
      setStoreIsOpen(newIsOpen);
      if (activeTenant.settings) {
        activeTenant.settings.isOpen = newIsOpen;
      }
      showToast({
        type: 'success',
        title: newIsOpen ? 'Loja Aberta' : 'Loja Fechada',
        message: newIsOpen 
          ? 'Seu estabelecimento agora está aberto para receber pedidos.' 
          : 'Seu estabelecimento foi pausado e não receberá novos pedidos.',
      });
      await fetchRealData();
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao alterar status',
        message: err.message || 'Falha ao sincronizar status da loja.',
      });
    } finally {
      setIsUpdatingStoreStatus(false);
    }
  };

  // Produtos mais vendidos com base estritamente em dados reais de pedidos
  const topProducts = useMemo(() => {
    const counts: Record<string, { name: string; quantity: number; revenue: number }> = {};
    nonCancelledOrders.forEach(order => {
      order.items?.forEach(item => {
        if (!counts[item.productId]) {
          counts[item.productId] = {
            name: item.productName || 'Produto',
            quantity: 0,
            revenue: 0,
          };
        }
        counts[item.productId].quantity += item.quantity || 1;
        counts[item.productId].revenue += item.totalPrice || ((item.unitPrice || 0) * (item.quantity || 1));
      });
    });

    return Object.entries(counts)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }, [nonCancelledOrders]);

  // Vendas por período com base estritamente em pedidos reais
  const salesChartData = useMemo(() => {
    if (salesPeriod === 'today') {
      const slots: Array<{ label: string; amount: number; count: number }> = [
        { label: '00h-04h', amount: 0, count: 0 },
        { label: '04h-08h', amount: 0, count: 0 },
        { label: '08h-12h', amount: 0, count: 0 },
        { label: '12h-16h', amount: 0, count: 0 },
        { label: '16h-20h', amount: 0, count: 0 },
        { label: '20h-24h', amount: 0, count: 0 },
      ];

      ordersToday.filter(o => o.status !== 'CANCELLED').forEach(o => {
        const orderHour = new Date(o.createdAt).getHours();
        const slotIdx = Math.min(5, Math.floor(orderHour / 4));
        slots[slotIdx].amount += o.totalAmount;
        slots[slotIdx].count += 1;
      });

      const maxAmount = Math.max(...slots.map(s => s.amount), 1);
      const totalAmount = slots.reduce((acc, s) => acc + s.amount, 0);
      const totalCount = slots.reduce((acc, s) => acc + s.count, 0);
      return { bars: slots, maxAmount, totalAmount, totalCount, hasSales: totalCount > 0 };
    }

    if (salesPeriod === '7d') {
      const days: Array<{ label: string; amount: number; count: number }> = [];
      const dateMap: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().split('T')[0];
        const weekday = d.toLocaleDateString('pt-BR', { weekday: 'short' });
        const label = weekday.charAt(0).toUpperCase() + weekday.slice(1, 3);
        dateMap[iso] = days.length;
        days.push({ label, amount: 0, count: 0 });
      }

      nonCancelledOrders.forEach(o => {
        const dayIso = o.createdAt.split('T')[0];
        if (dateMap[dayIso] !== undefined) {
          const idx = dateMap[dayIso];
          days[idx].amount += o.totalAmount;
          days[idx].count += 1;
        }
      });

      const maxAmount = Math.max(...days.map(d => d.amount), 1);
      const totalAmount = days.reduce((acc, d) => acc + d.amount, 0);
      const totalCount = days.reduce((acc, d) => acc + d.count, 0);
      return { bars: days, maxAmount, totalAmount, totalCount, hasSales: totalCount > 0 };
    }

    // '30d' -> 5 intervalos quinzenais/semanais legíveis
    const intervals: Array<{ label: string; amount: number; count: number; startIso: string; endIso: string }> = [];
    for (let i = 4; i >= 0; i--) {
      const dEnd = new Date();
      dEnd.setDate(dEnd.getDate() - (i * 6));
      const dStart = new Date();
      dStart.setDate(dStart.getDate() - ((i + 1) * 6 - 1));
      
      const startStr = `${dStart.getDate().toString().padStart(2, '0')}/${(dStart.getMonth() + 1).toString().padStart(2, '0')}`;
      const endStr = `${dEnd.getDate().toString().padStart(2, '0')}/${(dEnd.getMonth() + 1).toString().padStart(2, '0')}`;
      intervals.push({
        label: `${startStr} a ${endStr}`,
        amount: 0,
        count: 0,
        startIso: dStart.toISOString().split('T')[0],
        endIso: dEnd.toISOString().split('T')[0],
      });
    }

    nonCancelledOrders.forEach(o => {
      const orderDateIso = o.createdAt.split('T')[0];
      const match = intervals.find(inv => orderDateIso >= inv.startIso && orderDateIso <= inv.endIso);
      if (match) {
        match.amount += o.totalAmount;
        match.count += 1;
      }
    });

    const maxAmount = Math.max(...intervals.map(d => d.amount), 1);
    const totalAmount = intervals.reduce((acc, d) => acc + d.amount, 0);
    const totalCount = intervals.reduce((acc, d) => acc + d.count, 0);
    return { bars: intervals, maxAmount, totalAmount, totalCount, hasSales: totalCount > 0 };
  }, [salesPeriod, ordersToday, nonCancelledOrders]);

  // Saudação de acordo com o horário do dia
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Bom dia' : currentHour < 18 ? 'Boa tarde' : 'Boa noite';
  const userName = currentUser?.name ? currentUser.name.split(' ')[0] : 'Comerciante';

  // Avançar status do pedido
  const handleAdvanceStatus = async (orderId: string, currentStatus: string) => {
    let nextStatus: any = 'PREPARING';
    if (currentStatus === 'PENDING') nextStatus = 'CONFIRMED';
    else if (currentStatus === 'CONFIRMED') nextStatus = 'PREPARING';
    else if (currentStatus === 'PREPARING') nextStatus = 'READY';
    else if (currentStatus === 'READY') nextStatus = 'OUT_FOR_DELIVERY';
    else if (currentStatus === 'OUT_FOR_DELIVERY') nextStatus = 'DELIVERED';

    try {
      await orderRepository.updateStatus(securityContext, activeTenant.id, orderId, nextStatus);
      await fetchRealData();
      showToast({
        type: 'success',
        title: 'Status Atualizado',
        message: `Pedido avançou para "${nextStatus}".`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Atualizar',
        message: err.message,
      });
    }
  };

  return (
    <div className="space-y-2">
      {/* ========================================================================= */}
      {/* 1. CABEÇALHO DO DASHBOARD (COMANDO 49 SEÇÃO 4 / COMANDO 125)               */}
      {/* ========================================================================= */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-1.5 pb-1.5 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-sm sm:text-base font-bold tracking-tight text-slate-900 font-sans">
              {greeting}, {userName}
            </h1>
            <span className="text-[8.5px] px-1 py-0 rounded-full bg-emerald-50 text-emerald-800 font-semibold border border-emerald-200/80">
              {activeTenant.name}
            </span>
          </div>
          <p className="text-[9.5px] text-slate-500 mt-0.2 leading-tight">
            Acompanhe o desempenho e a operação do seu estabelecimento.
          </p>
        </div>

        {/* Ações Rápidas */}
        <div className="flex items-center gap-0.5 flex-wrap">
          {onNavigate && (
            <>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onNavigate('est-products')}
                leftIcon={<Plus className="w-2 h-2" />}
                className="text-[9.5px] font-semibold shadow-2xs bg-emerald-700 hover:bg-emerald-800"
              >
                Adicionar produto
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate('est-offers')}
                leftIcon={<Tag className="w-2 h-2" />}
                className="text-[9.5px] font-medium border-slate-200 hover:bg-slate-50 text-slate-700"
              >
                Criar promoção
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate('est-orders')}
                leftIcon={<ShoppingBag className="w-2 h-2" />}
                className="text-[9.5px] font-medium border-slate-200 hover:bg-slate-50 text-slate-700"
              >
                Ver pedidos
              </Button>
            </>
          )}

          {isValidStoreSlug(activeTenant.slug) && (
            <a
              href={getPublicStorePath(activeTenant.slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-[9.5px] font-semibold text-slate-700 shadow-2xs transition-colors h-5.5"
              title="Abrir Catálogo Público do Cliente"
            >
              <span>Abrir catálogo</span>
              <ExternalLink className="w-2 h-2 text-slate-400" />
            </a>
          )}

          <button
            type="button"
            onClick={() => fetchRealData()}
            className="p-1 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors cursor-pointer"
            title="Sincronizar dados"
            aria-label="Sincronizar dados"
          >
            <RefreshCw className={`w-2.5 h-2.5 ${isLoading ? 'animate-spin text-emerald-700' : ''}`} />
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ALERTA DE ERRO DE CONEXÃO COM RETRY                                       */}
      {/* ========================================================================= */}
      {error && remoteOrders === null && (
        <div className="bg-white border border-amber-200/80 rounded-lg p-4 text-center space-y-2 shadow-xs">
          <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <h3 className="text-xs sm:text-sm font-bold text-slate-900">
            Não foi possível carregar as métricas do painel
          </h3>
          <p className="text-[10px] text-slate-500 max-w-sm mx-auto leading-tight">
            {error}
          </p>
          <div className="pt-0.5 flex items-center justify-center gap-1.5">
            <Button size="sm" variant="primary" onClick={() => fetchRealData()} className="text-[9.5px] cursor-pointer">
              <RefreshCw className="w-2.5 h-2.5 mr-1" />
              Tentar Novamente
            </Button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. ALERTAS E ATENÇÃO (COMANDO 49 SEÇÃO 10)                                 */}
      {/* ========================================================================= */}
      {lowStockCount > 0 && (
        <div className="bg-amber-50/90 border border-amber-200/80 rounded-lg p-2 flex items-center justify-between gap-2 text-amber-900 shadow-2xs">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5.5 h-5.5 rounded bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-3 h-3" />
            </div>
            <div className="min-w-0 text-[10px]">
              <p className="font-bold text-amber-950">Aviso Operacional: Estoque Baixo</p>
              <p className="text-amber-800/90 truncate text-[9px]">
                {lowStockCount} {lowStockCount === 1 ? 'produto atingiu' : 'produtos atingiram'} o nível mínimo cadastrado.
              </p>
            </div>
          </div>
          {onNavigate && (
            <button
              onClick={() => onNavigate('est-inventory')}
              className="text-[9px] font-bold text-amber-900 hover:underline shrink-0 px-2 py-0.5 rounded bg-amber-100/80 hover:bg-amber-100 transition-colors"
            >
              Acessar Kardex
            </button>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. STATUS OPERACIONAL (COMANDO 49 SEÇÃO 5 / COMANDO 125)                   */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
        {/* Loja Aberta/Fechada com Toggle Real */}
        <div className="flex items-center justify-between p-1.5 sm:p-2 bg-white border border-slate-200/80 rounded shadow-2xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isStoreOpen ? 'bg-emerald-500 ring-1 ring-emerald-500/20' : 'bg-rose-500 ring-1 ring-rose-500/20'}`} />
            <div className="min-w-0">
              <div className="text-[7.5px] uppercase font-bold text-slate-400 tracking-wider">Status da Loja</div>
              <div className="text-[10px] font-bold text-slate-900 truncate">
                {isStoreOpen ? '● Aberta' : '● Fechada'}
              </div>
            </div>
          </div>
          <button
            onClick={handleToggleStoreOpen}
            disabled={isUpdatingStoreStatus}
            className={`inline-flex items-center gap-0.5 text-[8px] font-semibold px-1.5 py-0.2 rounded transition-colors cursor-pointer shrink-0 ${
              isStoreOpen 
                ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' 
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            }`}
            title={isStoreOpen ? 'Pausar pedidos e fechar loja' : 'Abrir loja para receber pedidos'}
          >
            <Power className="w-2 h-2" />
            <span>{isStoreOpen ? 'Fechar' : 'Abrir'}</span>
          </button>
        </div>

        {/* Tempo Médio de Entrega */}
        <div className="flex items-center justify-between p-1.5 sm:p-2 bg-white border border-slate-200/80 rounded shadow-2xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-4.5 h-4.5 rounded bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <Clock className="w-2.5 h-2.5" />
            </div>
            <div className="min-w-0">
              <div className="text-[7.5px] uppercase font-bold text-slate-400 tracking-wider">Tempo de Preparo</div>
              <div className="text-[10px] font-bold text-slate-900 truncate">
                {estimatedPrepTimeStr}
              </div>
            </div>
          </div>
          {onNavigate && (
            <button
              onClick={() => onNavigate('est-settings')}
              className="text-[8px] text-slate-500 hover:text-emerald-700 font-semibold cursor-pointer shrink-0"
            >
              Ajustar
            </button>
          )}
        </div>

        {/* Pedidos em Andamento */}
        <div className="flex items-center justify-between p-1.5 sm:p-2 bg-white border border-slate-200/80 rounded shadow-2xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pendingOrPreparingCount > 0 ? 'bg-amber-500 ring-1 ring-amber-500/20' : 'bg-slate-300'}`} />
            <div className="min-w-0">
              <div className="text-[7.5px] uppercase font-bold text-slate-400 tracking-wider">Em Andamento</div>
              <div className="text-[10px] font-bold text-slate-900 truncate tabular-nums">
                {pendingOrPreparingCount > 0 ? `${pendingOrPreparingCount} na fila` : 'Nenhum'}
              </div>
            </div>
          </div>
          {onNavigate && (
            <button
              onClick={() => onNavigate('est-orders')}
              className="text-[8px] text-emerald-700 hover:underline font-semibold cursor-pointer shrink-0"
            >
              Ver fila
            </button>
          )}
        </div>

        {/* Entregadores Ativos */}
        <div className="flex items-center justify-between p-1.5 sm:p-2 bg-white border border-slate-200/80 rounded shadow-2xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-4.5 h-4.5 rounded bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
              <Bike className="w-2.5 h-2.5" />
            </div>
            <div className="min-w-0">
              <div className="text-[7.5px] uppercase font-bold text-slate-400 tracking-wider">Entregadores</div>
              <div className="text-[10px] font-bold text-slate-900 truncate tabular-nums">
                {activeDriversCount > 0 
                  ? `${activeDriversCount} online` 
                  : inDeliveryCount > 0 ? `${inDeliveryCount} em entrega` : 'Disponível'}
              </div>
            </div>
          </div>
          {onNavigate && (
            <button
              onClick={() => onNavigate('est-drivers')}
              className="text-[8px] text-emerald-700 hover:underline font-semibold cursor-pointer shrink-0"
            >
              Frota
            </button>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. KPI CARDS (COMANDO 49 SEÇÃO 6 / COMANDO 125)                           */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-1.5">
        <StatCard
          title="Pedidos de hoje"
          value={ordersToday.length}
          subtext={ordersToday.length > 0 ? `R$ ${revenueToday.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} faturados hoje` : 'Nenhum pedido hoje'}
          icon={<ShoppingBag className="w-4 h-4 text-emerald-700" />}
          isEmpty={ordersToday.length === 0}
        />

        <StatCard
          title="Faturamento"
          value={totalOrdersCount > 0 ? `R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'R$ 0,00'}
          subtext={`${nonCancelledOrders.length} vendas confirmadas`}
          icon={<DollarSign className="w-4 h-4 text-emerald-700" />}
          isEmpty={totalRevenue === 0}
        />

        <StatCard
          title="Ticket médio"
          value={nonCancelledOrders.length > 0 ? `R$ ${ticketMedio.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'R$ 0,00'}
          subtext="Média por venda concluída"
          icon={<TrendingUp className="w-4 h-4 text-emerald-700" />}
          isEmpty={nonCancelledOrders.length === 0}
        />

        <StatCard
          title="Pedidos entregues"
          value={deliveredOrdersCount}
          subtext={`${orders.filter(o => o.status === 'CANCELLED').length} cancelados`}
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-700" />}
          isEmpty={deliveredOrdersCount === 0}
        />

        <StatCard
          title="Clientes"
          value={customersCount}
          subtext="Base cadastrada"
          icon={<Users className="w-4 h-4 text-emerald-700" />}
          isEmpty={customersCount === 0}
        />
      </div>

      {/* ========================================================================= */}
      {/* 5. ÁREA DE VENDAS & PRODUTOS MAIS VENDIDOS (COMANDO 49 SEÇÃO 7)            */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico Visual de Vendas com Filtros de Período */}
        <SectionCard
          title="Vendas"
          description="Evolução de faturamento por período com dados reais"
          headerAction={
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setSalesPeriod('today')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  salesPeriod === 'today'
                    ? 'bg-white text-slate-900 shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={() => setSalesPeriod('7d')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  salesPeriod === '7d'
                    ? 'bg-white text-slate-900 shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                7 dias
              </button>
              <button
                type="button"
                onClick={() => setSalesPeriod('30d')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  salesPeriod === '30d'
                    ? 'bg-white text-slate-900 shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                30 dias
              </button>
            </div>
          }
          className="lg:col-span-2"
        >
          {salesChartData.hasSales ? (
            <div className="space-y-4 pt-1">
              {/* Total do período em destaque */}
              <div className="flex items-baseline justify-between pb-3 border-b border-slate-100">
                <div>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Total no período
                  </span>
                  <div className="text-xl sm:text-2xl font-extrabold text-slate-900 font-sans tabular-nums">
                    R$ {salesChartData.totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-semibold text-slate-500 tabular-nums">
                    {salesChartData.totalCount} {salesChartData.totalCount === 1 ? 'pedido registrado' : 'pedidos registrados'}
                  </span>
                </div>
              </div>

              {/* Barras do Gráfico */}
              <div className="h-44 flex items-end justify-between gap-2 pt-6">
                {salesChartData.bars.map((bar, idx) => {
                  const heightPercent = Math.max(8, Math.round((bar.amount / salesChartData.maxAmount) * 100));
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-2 group">
                      <div className="w-full flex justify-center items-end h-32">
                        <div
                          style={{ height: `${heightPercent}%` }}
                          className="w-full max-w-[44px] bg-emerald-700/85 hover:bg-emerald-700 rounded-t-lg transition-all relative cursor-pointer"
                        >
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-9 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[11px] font-mono py-1 px-2.5 rounded-lg pointer-events-none whitespace-nowrap z-20 shadow-md">
                            R$ {bar.amount.toFixed(2)} ({bar.count} {bar.count === 1 ? 'ped' : 'peds'})
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] sm:text-[11px] font-medium text-slate-500 font-mono truncate max-w-full text-center">
                        {bar.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="py-12 px-4 text-center space-y-2">
              <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 flex items-center justify-center mx-auto">
                <TrendingUp className="w-5 h-5 text-slate-400" />
              </div>
              <h4 className="text-xs font-bold text-slate-800">Nenhuma venda no período selecionado</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                Assim que seus clientes confirmarem pedidos, o gráfico de evolução do faturamento será preenchido automaticamente.
              </p>
            </div>
          )}
        </SectionCard>

        {/* Produtos Mais Vendidos */}
        <SectionCard
          title="Mais Vendidos"
          description="Itens com maior saída nos pedidos reais"
        >
          {topProducts.length > 0 ? (
            <div className="space-y-2.5 pt-1">
              {topProducts.map((p, idx) => (
                <div key={p.id} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50/80 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">{p.name}</p>
                      <p className="text-[11px] text-slate-400 tabular-nums">
                        {p.quantity} {p.quantity === 1 ? 'unidade vendida' : 'unidades vendidas'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-mono font-bold text-emerald-800 tabular-nums">
                      R$ {p.revenue.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 px-4 text-center space-y-2">
              <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 flex items-center justify-center mx-auto">
                <Package className="w-5 h-5 text-slate-400" />
              </div>
              <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                Nenhum produto vendido ainda. Quando seus clientes fizerem pedidos, os itens mais populares aparecerão aqui.
              </p>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ========================================================================= */}
      {/* 6. PEDIDOS RECENTES (COMANDO 49 SEÇÃO 8)                                   */}
      {/* ========================================================================= */}
      <SectionCard
        title="Pedidos Recentes"
        description="Acompanhe e despache pedidos em tempo real"
        headerAction={
          onNavigate && (
            <button
              onClick={() => onNavigate('est-orders')}
              className="text-xs font-bold text-emerald-700 hover:text-emerald-800 cursor-pointer inline-flex items-center gap-1"
            >
              <span>Ver todos ({orders.length})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )
        }
        noPadding
      >
        {orders.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <h4 className="font-bold text-sm sm:text-base text-slate-900">Você ainda não recebeu pedidos</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
              Quando seus clientes realizarem pedidos pelo seu catálogo, eles aparecerão aqui instantaneamente.
            </p>
            <div className="pt-1">
              {isValidStoreSlug(activeTenant.slug) && (
                <a
                  href={getPublicStorePath(activeTenant.slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs"
                >
                  <span>Ver catálogo</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                <tr>
                  <th className="p-3.5 pl-5">Pedido</th>
                  <th className="p-3.5">Cliente</th>
                  <th className="p-3.5">Itens</th>
                  <th className="p-3.5">Total</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Horário</th>
                  <th className="p-3.5 pr-5 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.slice(0, 6).map((order) => {
                  const itemsCount = order.items?.reduce((acc, it) => acc + (it.quantity || 1), 0) || 0;
                  const firstItemName = order.items?.[0]?.productName;
                  return (
                    <tr key={order.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="p-3.5 pl-5 font-mono font-bold text-slate-900">
                        #{order.orderNumber}
                      </td>
                      <td className="p-3.5">
                        <div className="font-bold text-slate-900">{order.customerName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{order.customerPhone}</div>
                      </td>
                      <td className="p-3.5">
                        <div className="text-slate-800 font-medium">
                          {itemsCount} {itemsCount === 1 ? 'item' : 'itens'}
                        </div>
                        {firstItemName && (
                          <div className="text-[11px] text-slate-400 truncate max-w-[140px]">
                            {firstItemName}
                          </div>
                        )}
                      </td>
                      <td className="p-3.5 font-mono font-bold text-emerald-800 tabular-nums">
                        R$ {order.totalAmount.toFixed(2)}
                      </td>
                      <td className="p-3.5">
                        <StatusBadge status={order.status} size="sm" />
                      </td>
                      <td className="p-3.5 text-slate-500 font-mono">
                        {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-3.5 pr-5 text-right">
                        {order.status === 'PENDING' && (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => handleAdvanceStatus(order.id, order.status)}
                            className="text-xs bg-emerald-700 hover:bg-emerald-800"
                          >
                            Aceitar
                          </Button>
                        )}
                        {order.status === 'CONFIRMED' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleAdvanceStatus(order.id, order.status)}
                            className="text-xs"
                          >
                            Preparar
                          </Button>
                        )}
                        {order.status === 'PREPARING' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleAdvanceStatus(order.id, order.status)}
                            className="text-xs"
                          >
                            Pronto
                          </Button>
                        )}
                        {order.status === 'READY' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAdvanceStatus(order.id, order.status)}
                            className="text-xs"
                          >
                            Despachar
                          </Button>
                        )}
                        {order.status === 'OUT_FOR_DELIVERY' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAdvanceStatus(order.id, order.status)}
                            className="text-xs"
                          >
                            Concluir
                          </Button>
                        )}
                        {(order.status === 'DELIVERED' || order.status === 'CANCELLED') && (
                          <span className="text-slate-400 text-xs font-medium">Finalizado</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
};
