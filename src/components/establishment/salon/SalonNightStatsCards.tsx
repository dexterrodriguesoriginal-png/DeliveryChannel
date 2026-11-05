import React from 'react';
import { formatBRL } from '../../../lib/pricing/money';
import { salonStatsDuration, salonStatsPeriod, type SalonNightStats } from '../../../lib/salon/nightStats';

export interface SalonNightStatsCardsProps {
  stats: SalonNightStats | null;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
}

export const SalonNightStatsCards: React.FC<SalonNightStatsCardsProps> = ({ stats, loading, error, onRefresh }) => {
  if (!stats) return <div className="border-b border-slate-100 px-4 py-3 text-xs text-slate-500" role="status">
    {loading ? 'Carregando estatísticas…' : 'Estatísticas indisponíveis.'}
    {!!error && onRefresh && <button type="button" onClick={onRefresh} className="ml-2 font-bold text-teal-800 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700">Tentar novamente</button>}
  </div>;
  const cards = [
    ['Pedidos da noite', String(stats.orders_count)],
    ['Mesas atendidas', String(stats.tables_served)],
    ['Faturamento do salão', formatBRL(stats.revenue_cents / 100)],
    ['Ticket médio por mesa', stats.average_ticket_cents === null ? '—' : formatBRL(stats.average_ticket_cents / 100)],
    ['Permanência média', salonStatsDuration(stats.average_stay_seconds)],
    ['Chamados atendidos', String(stats.calls_handled)],
    ['Resposta média', salonStatsDuration(stats.average_response_seconds)],
    ['Contas abertas', String(stats.open_tabs)],
  ];
  return <section aria-label="Estatísticas da noite" className="border-b border-slate-100 px-3 py-3">
    <p className="mb-2 px-1 text-[11px] font-semibold text-slate-500">{salonStatsPeriod(stats)}</p>
    <dl className="grid grid-cols-2 gap-1.5">{cards.map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 px-2.5 py-2">
      <dt className="text-[10px] font-semibold leading-tight text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-black leading-tight tabular-nums text-slate-900">{value}</dd>
    </div>)}</dl>
    <p className="mt-2 px-1 text-[10px] leading-tight text-slate-500">Mesas atendidas contam visitas encerradas. Contas abertas incluem as anteriores ao período.</p>
  </section>;
};

