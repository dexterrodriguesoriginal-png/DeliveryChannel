import React, { useState, useMemo } from 'react';
import { 
  Clock, 
  Search, 
  Calendar, 
  MapPin, 
  User, 
  Bike, 
  CheckCircle2, 
  DollarSign, 
  ChevronRight 
} from 'lucide-react';
import { Driver, Order } from '../../../types';

interface DriverHistoryTabProps {
  orders: Order[];
  drivers: Driver[];
}

export const DriverHistoryTab: React.FC<DriverHistoryTabProps> = ({ orders, drivers }) => {
  const [search, setSearch] = useState('');
  const [selectedDriverFilter, setSelectedDriverFilter] = useState<string>('ALL');

  // Filter completed or in transit orders
  const deliveryOrders = useMemo(() => {
    return orders
      .filter((o) => o.fulfillmentType === 'DELIVERY' || o.driverId)
      .filter((o) => {
        const term = search.toLowerCase().trim();
        const matchSearch =
          !term ||
          o.orderNumber.toString().includes(term) ||
          o.customerName.toLowerCase().includes(term) ||
          o.deliveryAddress.toLowerCase().includes(term) ||
          (o.driverName && o.driverName.toLowerCase().includes(term));

        if (!matchSearch) return false;

        if (selectedDriverFilter === 'ALL') return true;
        return o.driverId === selectedDriverFilter;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [orders, search, selectedDriverFilter]);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden flex flex-col">
      {/* Filters Header */}
      <div className="p-4 sm:p-5 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por número do pedido, cliente ou endereço..."
            className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedDriverFilter}
            onChange={(e) => setSelectedDriverFilter(e.target.value)}
            className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-700 focus:outline-none focus:border-emerald-500 cursor-pointer shadow-2xs"
          >
            <option value="ALL">Todos os entregadores</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      {deliveryOrders.length === 0 ? (
        <div className="p-12 text-center text-gray-400 text-xs space-y-2">
          <Clock className="w-8 h-8 mx-auto text-gray-300" />
          <p className="font-semibold text-gray-700">Nenhum registro de entrega encontrado.</p>
          <p>As entregas despachadas pela central aparecerão aqui automaticamente.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/70 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                <th className="py-3 px-5">Pedido</th>
                <th className="py-3 px-4">Entregador</th>
                <th className="py-3 px-4">Destino / Cliente</th>
                <th className="py-3 px-3">Data / Hora</th>
                <th className="py-3 px-3">Taxa / Total</th>
                <th className="py-3 px-5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs">
              {deliveryOrders.map((ord) => {
                const driverName = ord.driverName || drivers.find((d) => d.id === ord.driverId)?.name || 'Frota Geral';
                const isDelivered = ord.status === 'DELIVERED';

                return (
                  <tr key={ord.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3.5 px-5 font-bold text-gray-900">
                      #{ord.orderNumber}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center font-bold text-[10px] shrink-0 border border-emerald-200">
                          <Bike className="w-3.5 h-3.5" />
                        </div>
                        <span className="font-semibold text-gray-800">{driverName}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 max-w-xs">
                      <div className="space-y-0.5">
                        <p className="font-semibold text-gray-900 truncate">{ord.customerName}</p>
                        <p className="text-[11px] text-gray-500 truncate flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-gray-400 shrink-0" />
                          {ord.deliveryAddress}
                        </p>
                      </div>
                    </td>

                    <td className="py-3.5 px-3 text-gray-500 font-mono text-[11px] whitespace-nowrap">
                      {new Date(ord.createdAt).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>

                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <div className="space-y-0.5">
                        <span className="font-bold text-gray-900 block">
                          {ord.totalAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                        <span className="text-[10px] text-emerald-700 font-medium">
                          Taxa: {ord.deliveryFee.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                      </div>
                    </td>

                    <td className="py-3.5 px-5 text-right whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                        isDelivered
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-blue-50 text-blue-700 border border-blue-200'
                      }`}>
                        {isDelivered ? 'Entregue' : 'Em rota'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
