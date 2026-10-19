import React from 'react';
import { Timer, ClockAlert } from 'lucide-react';
import type { OrderStatus } from '../../types';
import { slaLevel, SLA_CLASS, SLA_TITLE } from '../../lib/orders/sla';
import { formatAgePtBR } from '../../lib/orders/orderAge';

interface Props {
  status: OrderStatus;
  createdAt: string;
  prepMinutes?: number | null;
  now?: number;
  /** Texto pronto (ex.: cronômetro mm:ss do cartão); padrão "12 min". */
  label?: string;
  className?: string;
}

/** Cronômetro com semáforo: verde no prazo, âmbar a partir de 70% do preparo, vermelho quando atrasou. */
export const SlaTimerChip: React.FC<Props> = ({ status, createdAt, prepMinutes, now, label, className = '' }) => {
  const created = new Date(createdAt).getTime();
  const ageMs = Number.isFinite(created) ? Math.max(0, (now ?? Date.now()) - created) : 0;
  const level = slaLevel(status, ageMs, prepMinutes);
  if (level === 'none') return null;
  const Icon = level === 'late' ? ClockAlert : Timer;
  return (
    <span data-testid="sla-timer" data-level={level} title={SLA_TITLE[level]}
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border font-mono font-bold text-[9px] leading-none whitespace-nowrap ${SLA_CLASS[level]} ${className}`}>
      <Icon className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
      {label ?? formatAgePtBR(ageMs)}
    </span>
  );
};
