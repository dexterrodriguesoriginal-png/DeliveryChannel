import React from 'react';
import { cn } from '../../utils/cn';

export type OrderStatusType =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | string;

export interface StatusBadgeProps {
  status: OrderStatusType;
  className?: string;
  size?: 'sm' | 'md';
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string; border: string }> = {
  PENDING: {
    label: 'Pendente',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    dot: 'bg-amber-500',
    border: 'border-amber-200/80',
  },
  CONFIRMED: {
    label: 'Pendente',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    dot: 'bg-amber-500',
    border: 'border-amber-200/80',
  },
  PREPARING: {
    label: 'Em preparo',
    bg: 'bg-orange-50',
    text: 'text-orange-800',
    dot: 'bg-orange-500',
    border: 'border-orange-200/80',
  },
  READY: {
    label: 'Pronto para entrega',
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    dot: 'bg-emerald-500',
    border: 'border-emerald-200/80',
  },
  OUT_FOR_DELIVERY: {
    label: 'Em rota',
    bg: 'bg-blue-50',
    text: 'text-blue-800',
    dot: 'bg-blue-500',
    border: 'border-blue-200/80',
  },
  DELIVERED: {
    label: 'Entregue',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    dot: 'bg-emerald-600',
    border: 'border-emerald-200/80',
  },
  CANCELLED: {
    label: 'Cancelado',
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    dot: 'bg-rose-500',
    border: 'border-rose-200/80',
  },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  className,
  size = 'md',
}) => {
  const config = STATUS_CONFIG[status] || {
    label: status,
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    dot: 'bg-gray-400',
    border: 'border-gray-200',
  };

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5 gap-1',
    md: 'text-[11px] px-2.5 py-1 gap-1.5',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center font-bold tracking-wider rounded-lg border leading-none',
        config.bg,
        config.text,
        config.border,
        sizeClasses[size],
        className
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', config.dot)} />
      {config.label}
    </span>
  );
};
