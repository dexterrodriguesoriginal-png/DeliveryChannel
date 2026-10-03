import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { financeRepository, FinancialSummary } from '../../repositories/financeRepository';
import { orderRepository } from '../../repositories/orderRepository';
import { Card } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { Button } from '../../components/ui/Button';
import { 
  DollarSign, 
  ShoppingBag, 
  TrendingUp, 
  Truck, 
  XCircle, 
  AlertTriangle, 
  RefreshCw, 
  Calendar,
  CreditCard,
  QrCode,
  Banknote
} from 'lucide-react';

type PeriodFilter = 'today' | '7d' | 'this_month' | '30d';

export const FinancePage: React.FC = () => {
  const { activeTenant, securityContext } = useAuth();
  const [period, setPeriod] = useState<PeriodFilter>('7d');
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calcula início e fim do intervalo temporal
  const { startDate, endDate } = useMemo(() => {
    const now = new Date();
    let start = new Date();
    // end_date é o fim do dia de hoje (exclusivo para início de amanhã)
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);

    if (period === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    } else if (period === '7d') {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
    } else if (period === 'this_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    } else if (period === '30d') {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
    }

    return { startDate: start, endDate: end };
  }, [period]);

  const fetchFinanceData = useCallback(async () => {
    if (!activeTenant?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await financeRepository.getFinancialSummary(
        securityContext,
        activeTenant.id,
        startDate,
        endDate
      );
      setSummary(data);
    } catch (err: any) {
      console.error('[FinancePage] Erro ao carregar resumo financeiro do Supabase:', err);
      setError(err.message || 'Falha ao carregar dados financeiros do servidor.');
    } finally {
      setLoading(false);
    }
  }, [activeTenant?.id, securityContext, startDate, endDate]);

  useEffect(() => {
    fetchFinanceData();
    if (!activeTenant?.id) return;
    // Canal oficial do Supabase Realtime para atualizar na chegada de novos pedidos ou cancelamentos
    const unsub = orderRepository.subscribeToOrders(activeTenant.id, () => {
      fetchFinanceData();
    });
    return unsub;
  }, [fetchFinanceData, activeTenant?.id]);

  if (!activeTenant) return null;

  const paymentLabels: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    PIX: { label: 'PIX Instantâneo', icon: <QrCode className="w-4 h-4 text-emerald-600" />, color: 'bg-emerald-500' },
    CREDIT_CARD: { label: 'Cartão de Crédito', icon: <CreditCard className="w-4 h-4 text-blue-600" />, color: 'bg-blue-500' },
    DEBIT_CARD: { label: 'Cartão de Débito', icon: <CreditCard className="w-4 h-4 text-indigo-600" />, color: 'bg-indigo-500' },
    CASH: { label: 'Dinheiro em Espécie', icon: <Banknote className="w-4 h-4 text-amber-600" />, color: 'bg-amber-500' },
  };

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. CABEÇALHO E FILTROS DE PERÍODO TEMPORAL REAL                           */}
      {/* ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Financeiro & Vendas da Loja</h2>
          <p className="text-xs text-gray-500">
            Faturamento operacional e extrato de recebimentos 100% oficial
          </p>
        </div>

        {/* Seletor de Período */}
        <div className="flex items-center gap-1.5 bg-gray-100/80 p-1 rounded-xl border border-gray-200/80 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setPeriod('today')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              period === 'today'
                ? 'bg-white text-gray-900 shadow-xs'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
            }`}
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={() => setPeriod('7d')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              period === '7d'
                ? 'bg-white text-gray-900 shadow-xs'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
            }`}
          >
            Últimos 7 dias
          </button>
          <button
            type="button"
            onClick={() => setPeriod('this_month')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              period === 'this_month'
                ? 'bg-white text-gray-900 shadow-xs'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
            }`}
          >
            Este mês
          </button>
          <button
            type="button"
            onClick={() => setPeriod('30d')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              period === '30d'
                ? 'bg-white text-gray-900 shadow-xs'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
            }`}
          >
            Últimos 30 dias
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ESTADO DE ERRO DE CONEXÃO COM RETRY (NUNCA MOSTRA MOCK)                   */}
      {/* ========================================================================= */}
      {error && !summary && (
        <div className="bg-white border border-amber-200/80 rounded-2xl p-8 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="text-sm sm:text-base font-bold text-slate-900">
            Não foi possível carregar os dados financeiros
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
            {error}
          </p>
          <div className="pt-2 flex items-center justify-center gap-2">
            <Button size="sm" variant="primary" onClick={() => fetchFinanceData()} className="text-xs cursor-pointer">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Tentar Novamente
            </Button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. KPIS PRINCIPAIS (DADOS 100% REAIS E LIVRES DE CANCELAMENTOS)           */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Faturamento Operacional"
          value={loading ? 'Carregando...' : `R$ ${(summary?.grossRevenue ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtext="Vendas válidas (exclui cancelados)"
          icon={<DollarSign className="w-5 h-5 text-emerald-700" />}
        />
        <StatCard
          title="Pedidos Válidos"
          value={loading ? '...' : (summary?.validOrdersCount ?? 0).toString()}
          subtext="Volume faturado no período"
          icon={<ShoppingBag className="w-5 h-5 text-blue-700" />}
        />
        <StatCard
          title="Ticket Médio"
          value={loading ? '...' : `R$ ${(summary?.averageTicket ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtext="Média por pedido faturado"
          icon={<TrendingUp className="w-5 h-5 text-indigo-700" />}
        />
        <StatCard
          title="Frete Cobrado"
          value={loading ? '...' : `R$ ${(summary?.deliveryFees ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtext="Taxas de entrega recebidas"
          icon={<Truck className="w-5 h-5 text-slate-700" />}
        />
      </div>

      {/* ========================================================================= */}
      {/* 3. EXTRATO POR FORMA DE PAGAMENTO (AGRUPAMENTO REAL DO BANCO)             */}
      {/* ========================================================================= */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Extrato Consolidado por Forma de Pagamento</h3>
            <p className="text-xs text-gray-500">
              Distribuição real de recebimentos sobre os pedidos válidos
            </p>
          </div>
          {loading && <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />}
        </div>

        {summary && summary.validOrdersCount === 0 ? (
          <div className="py-8 text-center text-gray-400 text-xs">
            Não houve vendas no período selecionado.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            {['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'].map((method) => {
              const meta = paymentLabels[method] || { label: method, icon: <CreditCard className="w-4 h-4 text-gray-600" />, color: 'bg-gray-500' };
              const item = summary?.paymentBreakdown.find(p => p.paymentMethod === method);
              const amount = item?.amount ?? 0;
              const count = item?.orderCount ?? 0;
              const pct = item?.percentage ?? 0;

              return (
                <div key={method} className="p-3.5 bg-gray-50/70 rounded-xl border border-gray-100 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                        {meta.icon}
                        {meta.label}
                      </span>
                      <span className="text-[10px] font-mono font-bold text-gray-400">{pct}%</span>
                    </div>
                    <div className="text-base font-extrabold text-gray-900 font-mono">
                      R$ {amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500">
                    <span>{count} {count === 1 ? 'pedido' : 'pedidos'}</span>
                    <div className="w-16 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                      <div className={`h-full ${meta.color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ========================================================================= */}
      {/* 4. BLOCO DE CANCELAMENTOS E RETENÇÃO OPERACIONAL                           */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-4 bg-rose-50/60 border border-rose-100 rounded-2xl flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
            <XCircle className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-rose-950">Pedidos Cancelados</h4>
            <div className="text-xl font-black text-rose-900 font-mono mt-0.5">
              {summary?.cancelledOrdersCount ?? 0}
            </div>
            <p className="text-[11px] text-rose-700 mt-0.5">
              Valor não realizado:{' '}
              <span className="font-bold font-mono">
                R$ {(summary?.cancelledAmount ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </p>
          </div>
        </div>

        <div className="p-4 bg-emerald-50/60 border border-emerald-100 rounded-2xl flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-emerald-950">Canal Proprietário AdegaFood</h4>
            <div className="text-xl font-black text-emerald-900 font-mono mt-0.5">
              0% de comissão
            </div>
            <p className="text-[11px] text-emerald-700 mt-0.5">
              Vendas diretas sem taxa percentual sobre os seus pedidos
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
