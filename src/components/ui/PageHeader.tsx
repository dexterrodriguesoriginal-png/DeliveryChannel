import React from 'react';
import { cn } from '../../utils/cn';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  badge,
  actions,
  className,
}) => {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 pb-1 border-b border-gray-100', className)}>
      <div className="space-y-0.2 min-w-0">
        <div className="flex items-center gap-1 flex-wrap">
          <h1 className="text-xs sm:text-sm font-bold tracking-tight text-gray-950 truncate">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && (
          <p className="text-[8.5px] text-gray-500 font-normal leading-tight">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-0.5 shrink-0 flex-wrap">
          {actions}
        </div>
      )}
    </div>
  );
};
