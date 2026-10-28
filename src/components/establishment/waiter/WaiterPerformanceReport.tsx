import React, { useEffect, useState } from 'react';
import { Card } from '../../ui/Card';
import { formatBRL } from '../../../lib/pricing/money';
import { formatResponseTime, initials } from '../../../lib/waiter/waiterRouting';
import { waiterV2Repository, type WaiterReportRow } from '../../../repositories/waiterV2Repository';
import { Clock, DollarSign, ShoppingBag, Utensils, Users } from 'lucide-react';

interface WaiterPerformanceReportProps {
  tenantId: string;
  startDate: Date;
  endDate: Date;
}

export const WaiterPerformanceReport: React.FC<WaiterPerformanceReportProps> = ({
  tenantId,
  startDate,
  endDate,
}) => {
  const [rows, setRows] = useState<WaiterReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    setLoading(true);
    setError('');
    waiterV2Repository
      .report(tenantId, startDate, endDate)
      .then(res => {
        if (alive) setRows(res);
      })
      .catch((err: any) => {
        if (alive) setError(err.message || 'Erro ao carregar relatório dos garçons.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [tenantId, startDate, endDate]);

  if (loading) {
    return (
      <Card className="p-5 text-center text-xs text-gray-500">
        Carregando desempenho por garçom…
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4 bg-rose-50 border-rose-200 text-rose-700 text-xs">
        {error}
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="p-5 text-center text-xs text-gray-500" data-testid="waiter-report-empty">
        <Users className="mx-auto h-8 w-8 text-gray-400 mb-2" />
        <p className="font-semibold text-gray-700">Nenhum atendimento de garçom registrado no período.</p>
        <p className="mt-1 text-gray-400">Quando a equipe lançar pedidos e atender chamados, as métricas aparecerão aqui.</p>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3" data-testid="waiter-performance-report">
      <div className="flex items-center justify-between border-b border-gray-100 pb-2">
        <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
          <Users className="h-4 w-4 text-emerald-700" />
          Desempenho por Garçom
        </h3>
        <span className="text-xs text-gray-500 font-mono">
          {rows.length} {rows.length === 1 ? 'garçom' : 'garçons'}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-gray-100 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
              <th className="py-2.5 pr-3">Garçom</th>
              <th className="py-2.5 px-2 text-center">Mesas</th>
              <th className="py-2.5 px-2 text-center">Pedidos</th>
              <th className="py-2.5 px-2 text-right">Total Vendido</th>
              <th className="py-2.5 px-2 text-center">Chamados</th>
              <th className="py-2.5 px-2 text-center">Tempo Médio</th>
              <th className="py-2.5 pl-2 text-right">Gorjetas / 10%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(row => (
              <tr key={row.waiterId} className="hover:bg-gray-50/70 transition">
                <td className="py-2.5 pr-3">
                  <div className="flex items-center gap-2 font-bold text-gray-900">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-[10px] font-bold text-emerald-800 border border-emerald-200">
                      {initials(row.name)}
                    </span>
                    <span>{row.name}</span>
                  </div>
                </td>
                <td className="py-2.5 px-2 text-center font-mono font-semibold text-gray-700">
                  {row.tabsAttended}
                </td>
                <td className="py-2.5 px-2 text-center font-mono font-semibold text-gray-700">
                  {row.ordersCount}
                </td>
                <td className="py-2.5 px-2 text-right font-mono font-bold text-gray-900">
                  {formatBRL(row.totalSold)}
                </td>
                <td className="py-2.5 px-2 text-center font-mono text-gray-700">
                  {row.callsHandled}
                </td>
                <td className="py-2.5 px-2 text-center font-mono text-gray-700">
                  {formatResponseTime(row.avgResponseSeconds)}
                </td>
                <td className="py-2.5 pl-2 text-right font-mono font-bold text-emerald-700">
                  {formatBRL(row.serviceFeeTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
