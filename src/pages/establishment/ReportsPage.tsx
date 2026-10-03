import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportsRepository, ReportsSummary } from '../../repositories/reportsRepository';
import { orderRepository } from '../../repositories/orderRepository';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../context/ToastContext';
import { 
  BarChart3, 
  TrendingUp, 
  Download, 
  ShoppingBag, 
  DollarSign, 
  Users, 
  AlertTriangle, 
  RefreshCw,
  FolderTree,
  Calendar
} from 'lucide-react';

type PeriodFilter = 'today' | '7d' | 'this_month' | '30d';

export const ReportsPage: React.FC = () => {
  const { activeTenant, securityContext } = useAuth();
  const { showToast } = useToast();
  const [period, setPeriod] = useState<PeriodFilter>('7d');
  const [summary, setSummary] = useState<ReportsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calcula intervalo temporal com precisão UTC/Local consistente com FinancePage
  const { startDate, endDate } = useMemo(() => {
    const now = new Date();
    let start = new Date();
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

  const fetchReports = useCallback(async () => {
    if (!activeTenant?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await reportsRepository.getReportsSummary(
        securityContext,
        activeTenant.id,
        startDate,
        endDate
      );
      setSummary(data);
    } catch (err: any) {
      console.error('[ReportsPage] Erro ao carregar relatórios do Supabase:', err);
      setError(err.message || 'Falha ao processar relatórios do servidor.');
    } finally {
      setLoading(false);
    }
  }, [activeTenant?.id, securityContext, startDate, endDate]);

  useEffect(() => {
    fetchReports();
    if (!activeTenant?.id) return;
    // Canal oficial do Supabase Realtime para escutar novos pedidos ou alterações
    const unsub = orderRepository.subscribeToOrders(activeTenant.id, () => {
      fetchReports();
    });
    return unsub;
  }, [fetchReports, activeTenant?.id]);

  /**
   * Exportação CSV REAL:
   * 1. Consulta dados filtrados no Supabase;
   * 2. Monta strings com escape rigoroso e BOM UTF-8 (\uFEFF);
   * 3. Cria Blob nativo no browser;
   * 4. Dispara download automático via link programático.
   */
  const handleExportCSV = async () => {
    if (!activeTenant?.id) return;
    setIsExporting(true);
    try {
      const rows = await reportsRepository.getOrdersForExport(
        securityContext,
        activeTenant.id,
        startDate,
        endDate
      );

      if (rows.length === 0) {
        showToast({
          type: 'info',
          title: 'Exportação Vazia',
          message: 'Nenhum pedido válido encontrado no período para exportar.',
        });
        return;
      }

      // Cabeçalhos em português com formato delimitado por ponto-e-vírgula (padrão Excel BR)
      const headers = ['Pedido', 'Data', 'Cliente', 'Telefone', 'Subtotal', 'Desconto', 'Frete', 'Total', 'Status', 'Forma de Pagamento'];
      
      const escapeCSV = (val: any) => {
        const str = String(val ?? '').replace(/"/g, '""');
        return `"${str}"`;
      };

      const csvLines = [
        headers.join(';'),
        ...rows.map(r => [
          escapeCSV(`#${r.orderNumber}`),
          escapeCSV(new Date(r.createdAt).toLocaleString('pt-BR')),
          escapeCSV(r.customerName),
          escapeCSV(r.customerPhone),
          escapeCSV(r.subtotal.toFixed(2).replace('.', ',')),
          escapeCSV(r.discount.toFixed(2).replace('.', ',')),
          escapeCSV(r.deliveryFee.toFixed(2).replace('.', ',')),
          escapeCSV(r.totalAmount.toFixed(2).replace('.', ',')),
          escapeCSV(r.status),
          escapeCSV(r.paymentMethod),
        ].join(';'))
      ];

      // BOM UTF-8 (\uFEFF) para garantir acentuação correta no Microsoft Excel
      const blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      const filename = `relatorio-vendas-${activeTenant.slug}-${period}-${new Date().toISOString().split('T')[0]}.csv`;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast({
        type: 'success',
        title: 'Relatório Exportado com Sucesso',
        message: `Arquivo ${filename} baixado contendo ${rows.length} pedidos.`,
      });
    } catch (err: any) {
      console.error('[ReportsPage] Erro ao exportar CSV:', err);
      showToast({
        type: 'error',
        title: 'Erro na Exportação',
        message: err.message || 'Falha ao gerar arquivo CSV.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (!activeTenant) return null;

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. CABEÇALHO, CONTROLES DE PERÍODO E BOTÃO DE EXPORTAÇÃO REAL             */}
      {/* ========================================================================= */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-900">Relatórios & Inteligência de Vendas</h2>
            <Badge variant="brand" size="sm">DADOS REAIS</Badge>
          </div>
          <p className="text-xs text-gray-500">
            Desempenho de vendas, clientes ativos e ranking de produtos do seu aplicativo
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Seletor de Período Temporal */}
          <div className="flex items-center gap-1 bg-gray-100/80 p-1 rounded-xl border border-gray-200/80">
            <button
              type="button"
              onClick={() => setPeriod('today')}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                period === 'today' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => setPeriod('7d')}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                period === '7d' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              7 dias
            </button>
            <button
              type="button"
              onClick={() => setPeriod('this_month')}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                period === 'this_month' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Este mês
            </button>
            <button
              type="button"
              onClick={() => setPeriod('30d')}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                period === '30d' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              30 dias
            </button>
          </div>

          {/* Botão de Exportação CSV Real */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={isExporting || loading}
            leftIcon={isExporting ? <RefreshCw className="w-4 h-4 text-gray-600 animate-spin" /> : <Download className="w-4 h-4 text-gray-600" />}
            className="text-xs cursor-pointer"
          >
            {isExporting ? 'Exportando...' : 'Exportar (.CSV)'}
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ALERTA DE ERRO DE CONEXÃO COM RETRY                                       */}
      {/* ========================================================================= */}
      {error && !summary && (
        <div className="bg-white border border-amber-200/80 rounded-2xl p-8 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="text-sm sm:text-base font-bold text-slate-900">
            Não foi possível carregar os relatórios
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
            {error}
          </p>
          <div className="pt-2 flex items-center justify-center gap-2">
            <Button size="sm" variant="primary" onClick={() => fetchReports()} className="text-xs cursor-pointer">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Tentar Novamente
            </Button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. KPIS DE DESEMPENHO NO PERÍODO SELECIONADO                              */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-gray-400">Total de Pedidos</span>
            <ShoppingBag className="w-4 h-4 text-gray-400" />
          </div>
          <div className="text-2xl font-black text-gray-900 font-mono">
            {loading ? '...' : (summary?.totalOrders ?? 0)}
          </div>
          <p className="text-xs text-emerald-700 font-medium">Pedidos faturados no período</p>
        </Card>

        <Card className="p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-gray-400">Faturamento Válido</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-800 font-mono">
            {loading ? 'Carregando...' : `R$ ${(summary?.totalRevenue ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
          <p className="text-xs text-gray-500 font-medium">Exclui pedidos cancelados</p>
        </Card>

        <Card className="p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-gray-400">Ticket Médio</span>
            <TrendingUp className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-black text-blue-900 font-mono">
            {loading ? '...' : `R$ ${(summary?.averageTicket ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
          <p className="text-xs text-gray-500 font-medium">Média por pedido válido</p>
        </Card>

        <Card className="p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-gray-400">Clientes Ativos</span>
            <Users className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-black text-gray-900 font-mono">
            {loading ? '...' : (summary?.activeCustomers ?? 0)}
          </div>
          <p className="text-xs text-emerald-700 font-medium">Clientes com pedidos no período</p>
        </Card>
      </div>

      {/* ========================================================================= */}
      {/* 3. EVOLUÇÃO DAS VENDAS NO PERÍODO (TIMELINE LEVE)                         */}
      {/* ========================================================================= */}
      {summary && summary.dailySales.length > 0 && (
        <Card className="p-5 space-y-3">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-700" />
            Evolução Diária de Vendas
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 pt-2">
            {summary.dailySales.map(day => (
              <div key={day.date} className="p-2.5 bg-gray-50 rounded-xl border border-gray-100 text-center">
                <span className="text-[10px] text-gray-400 font-mono">
                  {new Date(day.date + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                </span>
                <div className="text-sm font-bold text-gray-900 font-mono mt-0.5">
                  R$ {day.revenue.toFixed(0)}
                </div>
                <span className="text-[10px] text-emerald-700 font-medium">
                  {day.orderCount} {day.orderCount === 1 ? 'ped' : 'peds'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ========================================================================= */}
      {/* 4. GRID: TOP 5 PRODUTOS E VENDAS POR CATEGORIA                            */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top 5 Produtos Mais Vendidos */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-700" />
              Produtos Mais Vendidos (Top 5)
            </h3>
            <span className="text-[10px] text-gray-400 font-semibold">Por Faturamento</span>
          </div>

          {summary && summary.topProducts.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">
              Nenhuma venda registrada no período selecionado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
                  <tr>
                    <th className="p-2">#</th>
                    <th className="p-2">Produto</th>
                    <th className="p-2 text-center">Qtd Vendida</th>
                    <th className="p-2 text-right">Faturamento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(summary?.topProducts || []).map((item, idx) => (
                    <tr key={item.productId || idx} className="hover:bg-gray-50/50">
                      <td className="p-2 font-bold font-mono text-gray-400">#{idx + 1}</td>
                      <td className="p-2 font-medium text-gray-900 max-w-[160px] truncate">{item.productName}</td>
                      <td className="p-2 text-center font-mono font-bold text-gray-700">{item.quantitySold} un</td>
                      <td className="p-2 text-right font-mono font-bold text-emerald-800">
                        R$ {item.revenue.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Vendas por Categoria */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <FolderTree className="w-4 h-4 text-blue-700" />
              Vendas por Categoria
            </h3>
            <span className="text-[10px] text-gray-400 font-semibold">Participação</span>
          </div>

          {summary && summary.salesByCategory.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">
              Nenhuma categoria faturada no período selecionado.
            </p>
          ) : (
            <div className="space-y-3 pt-1">
              {(summary?.salesByCategory || []).map(cat => (
                <div key={cat.categoryId} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-gray-800">{cat.categoryName}</span>
                    <span className="font-mono font-bold text-gray-900">
                      R$ {cat.revenue.toFixed(2)}{' '}
                      <span className="text-gray-400 text-[10px] font-normal">({cat.percentage}%)</span>
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-blue-600 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
