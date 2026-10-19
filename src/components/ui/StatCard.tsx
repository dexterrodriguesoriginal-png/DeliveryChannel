import React from 'react';
import { cn } from '../../utils/cn';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface StatCardProps {
  title: string;
  value: string | number;
  subtext?: string;
  change?: number; // percentage change, ex: 12.5 ou -3.2
  period?: string;
  icon?: React.ReactNode;
  iconColorClass?: string;
  className?: string;
  isEmpty?: boolean;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtext,
  change,
  period = 'vs. período anterior',
  icon,
  iconColorClass = 'bg-emerald-50 text-emerald-700 border-emerald-100',
  className,
  isEmpty = false,
}) => {
  return (
    <div
      className={cn(
        'bg-white border border-slate-200 rounded-xl p-3 shadow-sm relative overflow-hidden transition-all duration-200 hover:shadow-xs flex flex-col justify-between',
        className
      )}
    >
      <div>
        <div className="flex items-start justify-between gap-1">
          <span className="text-[11px] font-semibold text-slate-500 select-none">
            {title}
          </span>
          {icon && (
            <div
              className={cn(
                'w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 shadow-2xs',
                iconColorClass
              )}
            >
              {icon}
            </div>
          )}
        </div>

        <div className="mt-0.5">
          {isEmpty ? (
            <div className="text-xs font-bold text-gray-300 select-none tabular-nums">—</div>
          ) : (
            <div className="text-lg font-black tracking-tight text-gray-950 font-sans tabular-nums leading-tight">
              {value}
            </div>
          )}
        </div>
      </div>

      {(change !== undefined || subtext) && (
        <div className="mt-0.5 pt-0.5 border-t border-gray-100 flex items-center gap-1 text-[11px]">
          {change !== undefined && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-semibold px-0.5 py-0.2 rounded text-[11px]',
                change > 0 && 'text-emerald-700 bg-emerald-50',
                change < 0 && 'text-rose-700 bg-rose-50',
                change === 0 && 'text-gray-600 bg-gray-100'
              )}
            >
              {change > 0 ? (
                <TrendingUp className="w-2.5 h-2.5" />
              ) : change < 0 ? (
                <TrendingDown className="w-2.5 h-2.5" />
              ) : (
                <Minus className="w-2.5 h-2.5" />
              )}
              {change > 0 ? `+${change}%` : `${change}%`}
            </span>
          )}
          <span className="text-gray-400 truncate text-[11px]">
            {subtext || period}
          </span>
        </div>
      )}
    </div>
  );
};
