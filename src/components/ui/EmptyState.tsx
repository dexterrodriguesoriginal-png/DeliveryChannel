import React from 'react';
import { cn } from '../../utils/cn';
import { PackageOpen } from 'lucide-react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className,
}) => {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center p-8 lg:p-12 border border-dashed border-gray-200 rounded-3xl bg-gray-50/50', className)}>
      <div className="w-14 h-14 rounded-2xl bg-white border border-gray-200 shadow-xs flex items-center justify-center text-gray-400 mb-4">
        {icon || <PackageOpen className="w-7 h-7 text-emerald-700/60" />}
      </div>
      <h3 className="text-base font-bold text-gray-900">{title}</h3>
      {description && (
        <p className="text-xs text-gray-500 max-w-sm mt-1 mb-5 leading-relaxed">
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
};
