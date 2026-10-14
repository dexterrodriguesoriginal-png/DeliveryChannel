import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, DollarSign, Flame, ShoppingCart, TrendingUp, TrendingDown, Minus, Info, AlertTriangle,
  CalendarDays, Download, Trophy, Clock, Gauge,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import type { Offer } from '../../types';
import type { SecurityContext } from '../../services/securityEngine';
import { calculatePromoCardStatus, getPromoStatusMeta } from '../../utils/promoCardDateUtils';
import {
  buildPerformanceCsv, compareMetric, computePromoPerformance, getPromoCardKind, previousPeriod, resolvePeriod,
  staleCheckoutCards, topCardsByRevenue, usageLimitAlerts,
  type MetricDelta, type PeriodPreset, type PeriodRange, type PromoOrder,
} from '../../utils/promoPerformance';
import { promoPerformanceRepository } from '../../repositories/promoPerformanceRepository';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const toInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const STALE_DAYS = 7;

const Hint: React.FC<{ text: string }> = ({ text }) => (
  <span title={text} aria-label={text} className="inline-flex cursor-help text-gray-400"><Info className="w-3.5 h-3.5" /></span>
);

const Delta: React.FC<{ d: MetricDelta; testId: string }> = ({ d, testId }) => {
  if (d.direction === 'none') return <span data-testid={testId} className="text-[11px] text-gray-400" title="Período anterior sem dados para comparar">sem base no período anterior</span>;
  const Icon = d.direction === 'up' ? TrendingUp : d.direction === 'down' ? TrendingDown : Minus;
  const cls = d.direction === 'up' ? 'text-emerald-700' : d.direction === 'down' ? 'text-red-600' : 'text-gray-500';
  return (
    <span data-testid={testId} className={`inline-flex items-center gap-1 text-[11px] font-bold ${cls}`} title="Comparado ao período anterior de mesma duração">
      <Icon className="w-3.5 h-3.5" />{d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '='} {Math.abs(d.pct!).toLocaleString('pt-BR')}% vs. período anterior
    </span>
  );
};

interface Props {
  tenantId: string;
  securityContext: SecurityContext;
  offers: Offer[];
  onEditCard: (card: Offer) => void;
}

export const PromoPerformancePanel: React.FC<Props> = ({ tenantId, securityContext, offers, onEditCard }) => {
  const [preset, setPreset] = useState<PeriodPreset>('30d');
  const [customFrom, setCustomFrom] = useState(() => toInput(new Date(Date.now() - 29 * 864e5)));
  const [customTo, setCustomTo] = useState(() => toInput(new Date()));
  const [now, setNow] = useState(() => new Date());
  const range = useMemo(() => resolvePeriod(preset, now, { from: customFrom, to: customTo }), [preset, now, customFrom, customTo]);
  const prevRange = useMemo(() => (range ? previousPeriod(range) : null), [range]);

  const [orders, setOrders] = useState<PromoOrder[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [hasAttr, setHasAttr] = useState<boolean | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!range || !prevRange) return;
    setLoading(true); setError(null);
    try {
      const windows: PeriodRange[] = [{ start: prevRange.start, end: range.end }];
      const staleStart = new Date(now.getTime() - STALE_DAYS * 864e5);
      if (staleStart < prevRange.start || now >= range.end) windows.push({ start: staleStart, end: new Date(now.getTime() + 1000) });
      const r = await promoPerformanceRepository.getOrders(securityContext, tenantId, windows);
      setOrders(r.orders); setIsDemo(r.isDemo); setHasAttr(r.hasAttributionColumn); setTruncated(r.truncated);
    } catch (e) {
      setOrders([]); setError(e instanceof Error ? e.message : 'Falha ao carregar pedidos.');
    } finally { setLoading(false); }
  }, [range, prevRange, now, securityContext, tenantId]);

  useEffect(() => { load(); }, [load]);

  const tenantOffers = useMemo(() => offers.filter(o => !o.tenantId || o.tenantId === tenantId), [offers, tenantId]);
  const summary = useMemo(() => (range ? computePromoPerformance({ tenantId, cards: tenantOffers, orders, range }) : null), [range, tenantId, tenantOffers, orders]);
  const prevSummary = useMemo(() => (prevRange ? computePromoPerformance({ tenantId, cards: tenantOffers, orders, range: prevRange }) : null), [prevRange, tenantId, tenantOffers, orders]);
  const rowById = useMemo(() => new Map((summary?.rows || []).map(r => [r.cardId, r])), [summary]);
  const offerById = useMemo(() => new Map(tenantOffers.map(o => [o.id, o])), [tenantOffers]);
  const top3 = useMemo(() => topCardsByRevenue(summary?.rows || []), [summary]);
  const stale = useMemo(() => staleCheckoutCards({ tenantId, cards: tenantOffers, orders, now, days: STALE_DAYS, isLive: c => calculatePromoCardStatus(c) === 'ACTIVE' }), [tenantId, tenantOffers, orders, now]);
  const usage = useMemo(() => usageLimitAlerts(tenantOffers), [tenantOffers]);
  const hasCheckoutCards = tenantOffers.some(o => getPromoCardKind(o) === 'CUSTOM_OFFER');
  const ready = !loading && !error && !!summary;
  const attributionUnavailable = hasAttr === false;
  const noAttributionData = ready && summary!.attributedOrders === 0 && summary!.cancelledOrRefunded === 0;

  const d = (cur: number | null | undefined, prev: number | null | undefined) => compareMetric(cur ?? null, prev ?? null);

  const exportCsv = () => {
    if (!summary || !range) return;
    const csv = buildPerformanceCsv({ cards: tenantOffers, rows: summary.rows, range, statusLabel: c => getPromoStatusMeta(calculatePromoCardStatus(c)).label });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `desempenho-cards_${toInput(range.start)}_a_${toInput(new Date(range.end.getTime() - 1))}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const presets: { id: PeriodPreset; label: string }[] = [
    { id: 'today', label: 'Hoje' }, { id: '7d', label: 'Últimos 7 dias' }, { id: '30d', label: 'Últimos 30 dias' }, { id: 'custom', label: 'Personalizado' },
  ];
  const kpi = (v: React.ReactNode) => (loading ? <span className="inline-block h-7 w-20 rounded bg-gray-200 animate-pulse" /> : error ? '—' : v);
  const showDelta = ready && !attributionUnavailable;

  return (
    <div className="space-y-6" data-testid="promo-performance">
      {/* Filtro de período + exportação */}
      <Card className="p-4 flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-900"><CalendarDays className="w-4 h-4 text-emerald-600" /><span>Período</span></div>
        <div className="flex flex-wrap items-center gap-2">
          {presets.map(p => (
            <button key={p.id} type="button" onClick={() => { setPreset(p.id); setNow(new Date()); }} aria-pressed={preset === p.id}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${preset === p.id ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <div className="flex items-center gap-1 text-xs">
              <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1" aria-label="Data inicial" />
              <span>até</span>
              <input type="date" value={customTo} min={customFrom} onChange={e => setCustomTo(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1" aria-label="Data final" />
            </div>
          )}
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!ready || tenantOffers.length === 0} className="flex items-center gap-1" title="Exporta os números por card do período selecionado">
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </Button>
        </div>
      </Card>

      {!range && <Card className="p-4 text-xs text-amber-800 bg-amber-50 border-amber-200">Selecione um período válido (data inicial menor ou igual à final).</Card>}
      {isDemo && <Card className="p-3 text-xs bg-gray-50 border-gray-200 text-gray-700 flex gap-2"><Info className="w-4 h-4 shrink-0" /> Modo local de demonstração: os números vêm de dados demonstrativos, não de vendas reais.</Card>}
      {truncated && <Card className="p-3 text-xs bg-amber-50 border-amber-200 text-amber-800 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> Período com volume muito alto: os números podem estar incompletos. Reduza o período.</Card>}
      {error && (
        <Card className="p-4 border-red-200 bg-red-50 text-red-800 text-xs flex flex-col sm:flex-row sm:items-center gap-3 justify-between" role="alert">
          <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Não foi possível carregar os pedidos do período: {error}</span>
          <Button size="sm" variant="outline" onClick={load}>Tentar novamente</Button>
        </Card>
      )}

      {/* Indicadores */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 space-y-2 border-emerald-100 bg-emerald-50/40">
          <div className="flex items-center justify-between text-emerald-800">
            <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1">Pedidos via Promoção <Hint text="Pedidos fechados pelo checkout promocional de um card (origem gravada pelo servidor). Cancelados e estornados não contam. Vendas comuns do produto divulgado não entram." /></span>
            <ShoppingCart className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black font-mono text-gray-900" data-testid="kpi-orders">{kpi(summary?.attributedOrders ?? 0)}</div>
          {showDelta && <Delta d={d(summary?.attributedOrders, prevSummary?.attributedOrders)} testId="delta-orders" />}
          <p className="text-[11px] text-gray-500">{summary && summary.cancelledOrRefunded > 0 ? `${summary.cancelledOrRefunded} cancelado(s)/estornado(s) excluído(s)` : 'Somente pedidos válidos atribuídos a cards'}</p>
        </Card>
        <Card className="p-4 space-y-2 border-blue-100 bg-blue-50/40">
          <div className="flex items-center justify-between text-blue-800">
            <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1">Faturamento Promocional <Hint text="Soma de (total do pedido − taxa de entrega) dos pedidos promocionais válidos: itens já com desconto, sem frete." /></span>
            <DollarSign className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black font-mono text-gray-900" data-testid="kpi-revenue">{kpi(brl(summary?.revenue ?? 0))}</div>
          {showDelta && <Delta d={d(summary?.revenue, prevSummary?.revenue)} testId="delta-revenue" />}
          <p className="text-[11px] text-gray-500">{ready && summary!.discount > 0 ? `Desconto concedido: ${brl(summary!.discount)}` : 'Líquido de desconto, sem taxa de entrega'}</p>
        </Card>
        <Card className="p-4 space-y-2 border-amber-100 bg-amber-50/40">
          <div className="flex items-center justify-between text-amber-800">
            <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1">Benefícios Resgatados <Hint text="Resgates registrados pelo servidor (número do resgate gravado no pedido) em pedidos válidos do período. Visualizações não contam." /></span>
            <Flame className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black font-mono text-gray-900" data-testid="kpi-redemptions">{kpi(summary?.redemptions ?? 0)}</div>
          {showDelta && <Delta d={d(summary?.redemptions, prevSummary?.redemptions)} testId="delta-redemptions" />}
          <p className="text-[11px] text-gray-500">Resgates válidos no período</p>
        </Card>
        <Card className="p-4 space-y-2 border-purple-100 bg-purple-50/40">
          <div className="flex items-center justify-between text-purple-800">
            <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1">Ticket Médio <Hint text="Faturamento promocional ÷ pedidos promocionais válidos do período." /></span>
            <TrendingUp className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black font-mono text-gray-900" data-testid="kpi-ticket">{kpi(summary?.averageTicket != null ? brl(summary.averageTicket) : '—')}</div>
          {showDelta && <Delta d={d(summary?.averageTicket, prevSummary?.averageTicket)} testId="delta-ticket" />}
          <p className="text-[11px] text-gray-500">Valor médio por compra promocional</p>
        </Card>
      </div>

      {noAttributionData && (
        <Card className="p-4 text-xs text-gray-700 bg-white border-dashed flex gap-2" data-testid="empty-state">
          <Info className="w-4 h-4 shrink-0 text-gray-400" />
          <div className="space-y-1">
            <p className="font-bold text-gray-900">Nenhuma venda atribuída a cards neste período.</p>
            {attributionUnavailable ? (
              <p>A base atual ainda não registra a origem promocional dos pedidos (migrations 026 e 027 não ativadas no banco). Os indicadores passam a funcionar após a ativação.</p>
            ) : !hasCheckoutCards ? (
              <p>Somente cards com <b>Checkout promocional</b> geram pedidos rastreáveis. Cards apenas visuais e de produto do catálogo ainda não têm rastreamento de origem.</p>
            ) : (
              <p>Quando clientes comprarem pelo checkout promocional de um card, os resultados aparecem aqui.</p>
            )}
            <p className="text-gray-500">Visualizações e cliques ainda não são rastreados de forma confiável, por isso conversão não é exibida.</p>
          </div>
        </Card>
      )}

      {/* Destaques e alertas */}
      {ready && tenantOffers.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-4 space-y-3" data-testid="top3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1"><Trophy className="w-4 h-4 text-amber-500" /> Top 3 por faturamento <Hint text="Cards com maior faturamento atribuído no período selecionado." /></h4>
            {top3.length === 0 ? <p className="text-xs text-gray-500">Nenhum card com faturamento atribuído no período.</p> : (
              <ol className="space-y-2">
                {top3.map((r, i) => {
                  const c = offerById.get(r.cardId)!;
                  return (
                    <li key={r.cardId} className="flex items-center justify-between gap-2 text-xs">
                      <button type="button" onClick={() => onEditCard(c)} className="text-left font-semibold text-gray-900 hover:underline cursor-pointer line-clamp-1">{i + 1}. {c.title}</button>
                      <span className="font-mono font-bold shrink-0">{brl(r.revenue!)} <span className="text-gray-400 font-normal">· {r.orders} ped.</span></span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
          <Card className="p-4 space-y-3" data-testid="stale-alert">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1"><Clock className="w-4 h-4 text-red-500" /> Sem venda há {STALE_DAYS} dias <Hint text={`Cards de checkout promocional ativos há pelo menos ${STALE_DAYS} dias sem nenhum pedido válido nos últimos ${STALE_DAYS} dias (independe do período selecionado).`} /></h4>
            {attributionUnavailable ? <p className="text-xs text-gray-500">Indisponível até a origem dos pedidos ser registrada no banco.</p>
              : !hasCheckoutCards ? <p className="text-xs text-gray-500">Só cards de checkout promocional são monitorados; nenhum cadastrado.</p>
              : stale.length === 0 ? <p className="text-xs text-gray-500">Nenhum card ativo parado. 👍</p> : (
                <ul className="space-y-2">
                  {stale.map(c => (
                    <li key={c.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-gray-900 line-clamp-1">{c.title}</span>
                      <Button size="sm" variant="outline" onClick={() => onEditCard(c)}>Revisar</Button>
                    </li>
                  ))}
                </ul>
              )}
          </Card>
          <Card className="p-4 space-y-3" data-testid="usage-alert">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1"><Gauge className="w-4 h-4 text-amber-600" /> Limite de usos ≥ 90% <Hint text="Contador acumulado de usos do card (sem filtro de período) comparado ao limite configurado." /></h4>
            {usage.length === 0 ? <p className="text-xs text-gray-500">Nenhum card com limite próximo do fim.</p> : (
              <ul className="space-y-2">
                {usage.map(u => (
                  <li key={u.card.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0">
                      <span className="font-semibold text-gray-900 line-clamp-1">{u.card.title}</span>
                      <span className={`block font-mono ${u.exhausted ? 'text-red-600' : 'text-amber-700'}`}>{u.used} / {u.limit} ({u.pct.toLocaleString('pt-BR')}%){u.exhausted ? ' · esgotado' : ''}</span>
                    </span>
                    <Button size="sm" variant="outline" onClick={() => onEditCard(u.card)}>Ajustar</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* Tabela por card */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-emerald-600" /><span>Desempenho por Card / Oferta</span></h3>
          <span className="text-xs text-gray-500 font-mono">{tenantOffers.length} cards cadastrados</span>
        </div>
        {tenantOffers.length === 0 ? (
          <p className="text-xs text-gray-500 py-6 text-center">Nenhum card promocional cadastrado. Crie um card na aba Cards Promocionais.</p>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full min-w-[980px] text-left text-xs [&_th]:px-2 [&_td]:px-2" data-testid="perf-table">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider">
                  <th className="pb-3">Card / Oferta</th>
                  <th className="pb-3">Tipo</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3" title="Não rastreado de forma confiável">Visualiz. / Cliques</th>
                  <th className="pb-3 text-right">Pedidos</th>
                  <th className="pb-3 text-right">Faturamento</th>
                  <th className="pb-3 text-right" title="Desconto concedido no período e quanto de desconto foi dado para cada R$ 1 vendido">Desconto × Fat.</th>
                  <th className="pb-3">Preço</th>
                  <th className="pb-3" title="Contador acumulado do card, sem filtro de período">Usos / Limite</th>
                  <th className="pb-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tenantOffers.map(card => {
                  const statusMeta = getPromoStatusMeta(calculatePromoCardStatus(card));
                  const row = rowById.get(card.id);
                  const kind = getPromoCardKind(card);
                  const na = <span className="text-gray-400" title={kind === 'BANNER_ONLY' ? 'Card apenas visual não gera pedido rastreável' : 'Origem das vendas de produto do catálogo ainda não é rastreada'}>n/a</span>;
                  return (
                    <tr key={card.id} className="hover:bg-gray-50" data-testid={`row-${card.id}`}>
                      <td className="py-3 font-semibold text-gray-900">
                        <span className="flex items-center gap-2">
                          <span className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                            {card.mediaUrl ? <img src={card.mediaUrl} alt="" className="w-full h-full object-cover" /> : <span className="w-full h-full flex items-center justify-center text-gray-400">🖼️</span>}
                          </span>
                          <span className="min-w-0"><span className="line-clamp-1">{card.title}</span><span className="block text-[10px] font-mono text-gray-400">#{card.id.slice(0, 8)}</span></span>
                        </span>
                      </td>
                      <td className="py-3 font-medium">
                        {kind === 'CUSTOM_OFFER' ? <span className="text-amber-800 font-bold">Checkout promocional</span>
                          : kind === 'PRODUCT' ? <span className="text-blue-800 font-bold">Produto do catálogo</span>
                          : <span className="text-gray-600">Apenas visual</span>}
                      </td>
                      <td className="py-3"><span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${statusMeta.badgeClass}`}>{statusMeta.label}</span></td>
                      <td className="py-3 text-gray-400" title="Rastreamento de visualizações/cliques ainda não instrumentado">—</td>
                      <td className="py-3 text-right font-mono">
                        {loading ? '…' : row?.orders == null ? na : <span>{row.orders}{row.cancelledOrders ? <span className="text-[10px] text-gray-400"> (+{row.cancelledOrders} canc.)</span> : null}</span>}
                      </td>
                      <td className="py-3 text-right font-mono font-bold text-gray-900">{loading ? '…' : row?.revenue == null ? na : brl(row.revenue)}</td>
                      <td className="py-3 text-right font-mono">
                        {loading ? '…' : row?.discount == null ? na : (
                          <span>{brl(row.discount)}<span className="block text-[10px] text-gray-500">{row.discountRatio == null ? 'sem faturamento' : `${brl(row.discountRatio)} por R$ 1 vendido`}</span></span>
                        )}
                      </td>
                      <td className="py-3 font-mono font-bold text-gray-900">{card.promoPrice ? brl(card.promoPrice) : card.promotionalPrice ? brl(card.promotionalPrice) : '—'}</td>
                      <td className="py-3 font-mono">{kind === 'CUSTOM_OFFER' ? (card.promoUsageLimit ? `${card.promoTimesUsed || 0} / ${card.promoUsageLimit}` : `${card.promoTimesUsed || 0} / Ilimitado`) : '—'}</td>
                      <td className="py-3 text-right"><Button size="sm" variant="outline" onClick={() => onEditCard(card)}>Editar</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-gray-500">
          Atribuição: um pedido conta uma única vez, apenas para o card cujo checkout promocional o originou (registrado pelo servidor). Vendas comuns de produtos divulgados não são atribuídas ao card. Cancelados e estornados ficam fora do faturamento.
        </p>
      </Card>
    </div>
  );
};
