import React, { useState, useMemo } from 'react';
import { 
  Bike, 
  Search, 
  Phone, 
  Star, 
  ChevronRight, 
  Filter, 
  Car, 
  Truck, 
  User, 
  AlertCircle,
  CheckCircle2,
  Clock,
  Ban,
  MoreVertical,
  Edit2
} from 'lucide-react';
import { Driver, DriverStatus } from '../../../types';
import { Badge } from '../../ui/Badge';
import { DriverApprovalBadge } from '../statusBadges';

interface DriverTableSectionProps {
  drivers: Driver[];
  selectedDriver: Driver | null;
  onSelectDriver: (driver: Driver) => void;
  onOpenEdit: (driver: Driver) => void;
  deliveryFee?: number;
}

export const DriverTableSection: React.FC<DriverTableSectionProps> = ({
  drivers,
  selectedDriver,
  onSelectDriver,
  onOpenEdit,
  deliveryFee = 6.5,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | DriverStatus | 'PENDING'>('ALL');

  const filteredDrivers = useMemo(() => {
    return drivers.filter((drv) => {
      // Search text
      const term = search.toLowerCase().trim();
      const matchSearch =
        !term ||
        drv.name.toLowerCase().includes(term) ||
        (drv.phone && drv.phone.includes(term)) ||
        (drv.plate && drv.plate.toLowerCase().includes(term)) ||
        (drv.vehicle && drv.vehicle.toLowerCase().includes(term));

      // Status filter
      if (!matchSearch) return false;
      if (statusFilter === 'ALL') return true;
      if (statusFilter === 'PENDING') return drv.approvalStatus === 'PENDING';
      return drv.status === statusFilter;
    });
  }, [drivers, search, statusFilter]);

  const getVehicleIcon = (vehicleType?: string) => {
    switch (vehicleType?.toUpperCase()) {
      case 'CARRO':
        return <Car className="w-4 h-4 text-slate-600" />;
      case 'VAN':
        return <Truck className="w-4 h-4 text-slate-600" />;
      case 'BIKE':
      case 'MOTO':
      default:
        return <Bike className="w-4 h-4 text-emerald-700" />;
    }
  };

  const getStatusBadge = (drv: Driver) => {
    if (drv.approvalStatus === 'PENDING') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          Pendente
        </span>
      );
    }

    switch (drv.status) {
      case 'AVAILABLE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Disponível
          </span>
        );
      case 'ON_DELIVERY':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            Em entrega
          </span>
        );
      case 'SUSPENDED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Suspenso
          </span>
        );
      case 'UNAVAILABLE':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            Indisponível
          </span>
        );
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden flex flex-col">
      {/* 1. Título "Entregadores (N)" acima da busca */}
      <div className="px-5 pt-4 pb-2 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-bold text-gray-900 text-sm">
          Entregadores ({drivers.length})
        </h3>
      </div>

      {/* Busca + Filtro "Todos os status" */}
      <div className="p-4 sm:p-5 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou placa..."
            className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-700 focus:outline-none focus:border-emerald-500 cursor-pointer shadow-2xs"
          >
            <option value="ALL">Todos os status</option>
            <option value="AVAILABLE">Disponíveis</option>
            <option value="ON_DELIVERY">Em entrega</option>
            <option value="PENDING">Pendentes de aprovação</option>
            <option value="SUSPENDED">Suspensos</option>
            <option value="UNAVAILABLE">Indisponíveis</option>
          </select>
        </div>
      </div>

      {/* 2. Cabeçalho de tabela SEMPRE visível: NOME, STATUS, ENTREGAS HOJE, GANHOS HOJE, AVALIAÇÃO, AÇÕES */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/70 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
              <th className="py-3 px-4 sm:px-5">NOME</th>
              <th className="py-3 px-3">STATUS</th>
              <th className="py-3 px-3">ENTREGAS HOJE</th>
              <th className="py-3 px-3">GANHOS HOJE</th>
              <th className="py-3 px-3">AVALIAÇÃO</th>
              <th className="py-3 px-4 sm:px-5 text-right">AÇÕES</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-xs">
            {filteredDrivers.length === 0 ? (
              /* Estado vazio em linha abaixo do cabeçalho */
              <tr>
                <td colSpan={6} className="py-12 text-center">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-2">
                    <Search className="w-5 h-5" />
                  </div>
                  <h4 className="text-sm font-semibold text-gray-900">Nenhum entregador encontrado</h4>
                  <p className="text-xs text-gray-400 max-w-xs mx-auto mt-1">
                    Ajuste os filtros de busca ou convide novos entregadores para a sua frota.
                  </p>
                </td>
              </tr>
            ) : (
              filteredDrivers.map((drv) => {
                const isSelected = selectedDriver?.id === drv.id;
                const completedCount = drv.completedDeliveriesToday || 0;

                // Driver initials
                const initials = drv.name
                  .split(' ')
                  .map((n) => n[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join('')
                  .toUpperCase() || 'E';

                return (
                  <tr
                    key={drv.id}
                    onClick={() => onSelectDriver(drv)}
                    className={`transition-colors cursor-pointer group ${
                      isSelected
                        ? 'bg-emerald-50/60 font-medium'
                        : 'hover:bg-gray-50/80'
                    }`}
                  >
                    {/* NOME */}
                    <td className="py-3.5 px-4 sm:px-5">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 transition-colors ${
                          isSelected
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'bg-emerald-50 text-emerald-800 border border-emerald-200/60 group-hover:bg-emerald-100'
                        }`}>
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 truncate flex items-center gap-1.5">
                            {drv.name}
                            {drv.isOnline && (
                              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" title="Online" />
                            )}
                          </p>
                          <div className="flex items-center gap-2 text-[11px] text-gray-400 font-mono">
                            <span>{drv.phone || 'Sem telefone'}</span>
                            <span>•</span>
                            <span className="truncate">{drv.plate || drv.vehicle}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* STATUS */}
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      {getStatusBadge(drv)}
                    </td>

                    {/* ENTREGAS HOJE */}
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-gray-900">{completedCount}</span>
                        <span className="text-[11px] text-gray-500">
                          {completedCount === 1 ? 'entrega' : 'entregas'}
                        </span>
                      </div>
                    </td>

                    {/* GANHOS HOJE */}
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span className="text-gray-400 font-medium">—</span>
                    </td>

                    {/* AVALIAÇÃO */}
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span className="text-gray-400 font-medium">—</span>
                    </td>

                    {/* AÇÕES */}
                    <td className="py-3.5 px-4 sm:px-5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => onSelectDriver(drv)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                            isSelected
                              ? 'bg-emerald-600 text-white shadow-2xs'
                              : 'text-gray-600 hover:text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          Ver Perfil
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenEdit(drv)}
                          className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Editar cadastro do veículo"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
