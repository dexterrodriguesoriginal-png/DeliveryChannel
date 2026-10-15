import React from 'react';
import { 
  TrendingUp, 
  Award, 
  Clock, 
  Star, 
  CheckCircle2, 
  DollarSign, 
  Bike,
  ShieldCheck
} from 'lucide-react';
import { Driver, Order } from '../../../types';

interface DriverPerformanceTabProps {
  drivers: Driver[];
  orders: Order[];
}

export const DriverPerformanceTab: React.FC<DriverPerformanceTabProps> = ({ drivers, orders }) => {
  const completedOrders = orders.filter((o) => o.status === 'DELIVERED');
  const totalDeliveries = completedOrders.length;

  return (
    <div className="space-y-6">
      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500">Taxa de Pontualidade</span>
            <div className="w-8 h-8 rounded-xl bg-gray-50 text-gray-500 flex items-center justify-center border border-gray-200">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <span className="text-2xl font-bold text-gray-400 block mt-2">—</span>
          <span className="text-[11px] text-gray-400 font-medium">Sem dados históricos de rota</span>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500">Tempo Médio de Rota</span>
            <div className="w-8 h-8 rounded-xl bg-gray-50 text-gray-500 flex items-center justify-center border border-gray-200">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <span className="text-2xl font-bold text-gray-400 block mt-2">—</span>
          <span className="text-[11px] text-gray-400 font-medium">Tempo de percurso não calculado</span>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500">Avaliação dos Clientes</span>
            <div className="w-8 h-8 rounded-xl bg-gray-50 text-gray-500 flex items-center justify-center border border-gray-200">
              <Star className="w-4 h-4" />
            </div>
          </div>
          <span className="text-2xl font-bold text-gray-400 block mt-2">—</span>
          <span className="text-[11px] text-gray-400 font-medium">Sem avaliações registradas</span>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500">Total Despachado</span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center border border-purple-200">
              <Award className="w-4 h-4" />
            </div>
          </div>
          <span className="text-2xl font-bold text-gray-900 block mt-2">{totalDeliveries}</span>
          <span className="text-[11px] text-purple-700 font-medium">Entregas concluídas no período</span>
        </div>
      </div>

      {/* Driver Performance Ranking */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div>
            <h4 className="font-bold text-sm text-gray-900">Produtividade da Frota</h4>
            <p className="text-xs text-gray-500">Métricas consolidadas de cada entregador vinculado</p>
          </div>
          <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
            {drivers.length} entregadores
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/70 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                <th className="py-3 px-5">Posição</th>
                <th className="py-3 px-4">Entregador</th>
                <th className="py-3 px-4">Veículo</th>
                <th className="py-3 px-3">Entregas Hoje</th>
                <th className="py-3 px-3">Pontualidade</th>
                <th className="py-3 px-5 text-right">Avaliação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {drivers.map((drv, idx) => (
                <tr key={drv.id} className="hover:bg-gray-50/80 transition-colors">
                  <td className="py-3.5 px-5 font-bold text-gray-500">
                    #{idx + 1}
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-gray-900">
                    {drv.name}
                  </td>
                  <td className="py-3.5 px-4 text-gray-600 font-mono text-[11px]">
                    {drv.vehicle} • {drv.plate || 'N/D'}
                  </td>
                  <td className="py-3.5 px-3 font-bold text-gray-900">
                    {drv.completedDeliveriesToday || 0}
                  </td>
                  <td className="py-3.5 px-3 font-medium text-gray-400">
                    —
                  </td>
                  <td className="py-3.5 px-5 text-right font-medium text-gray-400">
                    —
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
