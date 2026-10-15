import React from 'react';
import { Bike, CheckCircle2, Navigation, AlertCircle, Ban, Users } from 'lucide-react';
import { Driver } from '../../../types';

interface DriverMetricsStripProps {
  drivers: Driver[];
}

export const DriverMetricsStrip: React.FC<DriverMetricsStripProps> = ({ drivers }) => {
  const total = drivers.length;
  const available = drivers.filter(d => d.status === 'AVAILABLE').length;
  const onDelivery = drivers.filter(d => d.status === 'ON_DELIVERY').length;
  const pending = drivers.filter(d => d.approvalStatus === 'PENDING').length;
  const suspended = drivers.filter(d => d.status === 'SUSPENDED' || d.approvalStatus === 'SUSPENDED').length;

  const cards = [
    {
      label: 'Entregadores',
      value: total,
      subtext: 'Cadastrados na frota',
      badge: 'Total',
      badgeColor: 'bg-slate-100 text-slate-700',
      icon: Users,
      iconBg: 'bg-slate-100 text-slate-700 border-slate-200',
      accentBorder: 'hover:border-slate-300',
    },
    {
      label: 'Disponíveis',
      value: available,
      subtext: 'Prontos para entrega',
      badge: 'Online',
      badgeColor: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      icon: CheckCircle2,
      iconBg: 'bg-emerald-50 text-emerald-600 border-emerald-200',
      accentBorder: 'hover:border-emerald-300',
    },
    {
      label: 'Em entrega',
      value: onDelivery,
      subtext: 'Em rota de entrega',
      badge: 'Em rota',
      badgeColor: 'bg-blue-50 text-blue-700 border border-blue-200',
      icon: Navigation,
      iconBg: 'bg-blue-50 text-blue-600 border-blue-200',
      accentBorder: 'hover:border-blue-300',
    },
    {
      label: 'Pendente aprovação',
      value: pending,
      subtext: 'Aguardando liberação',
      badge: 'Revisão',
      badgeColor: 'bg-amber-50 text-amber-700 border border-amber-200',
      icon: AlertCircle,
      iconBg: 'bg-amber-50 text-amber-600 border-amber-200',
      accentBorder: 'hover:border-amber-300',
    },
    {
      label: 'Suspensos',
      value: suspended,
      subtext: 'Acesso bloqueado',
      badge: 'Bloqueado',
      badgeColor: 'bg-rose-50 text-rose-700 border border-rose-200',
      icon: Ban,
      iconBg: 'bg-rose-50 text-rose-600 border-rose-200',
      accentBorder: 'hover:border-rose-300',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.label}
            className={`bg-white rounded-2xl p-4 border border-gray-200 shadow-xs transition-all duration-200 flex flex-col justify-between ${c.accentBorder}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-semibold text-gray-500 line-clamp-1">{c.label}</span>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center border shrink-0 ${c.iconBg}`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>

            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-bold tracking-tight text-gray-900">{c.value}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.badgeColor}`}>
                {c.badge}
              </span>
            </div>

            <p className="mt-1 text-[11px] text-gray-400 line-clamp-1">{c.subtext}</p>
          </div>
        );
      })}
    </div>
  );
};
