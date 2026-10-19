import React from 'react';
import { cn } from '../../utils/cn';

export interface SectionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  headerAction?: React.ReactNode;
  noPadding?: boolean;
}

export const SectionCard: React.FC<SectionCardProps> = ({
  title,
  description,
  headerAction,
  noPadding = false,
  children,
  className,
  ...props
}) => {
  return (
    <div
      className={cn(
        'bg-white border border-slate-200 rounded-xl shadow-sm transition-all duration-150',
        className
      )}
      {...props}
    >
      {(title || headerAction) && (
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-100">
          <div>
            {title && (
              <h2 className="text-sm font-bold text-slate-900 font-sans">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                {description}
              </p>
            )}
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
      )}
      <div className={cn(!noPadding && 'p-3')}>{children}</div>
    </div>
  );
};
