import React from 'react';
import { cn } from '../../utils/cn';
import { Loader2 } from 'lucide-react';

export interface LoadingStateProps {
  message?: string;
  className?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Carregando dados seguros...',
  className,
}) => {
  return (
    <div className={cn('flex flex-col items-center justify-center p-12 text-center', className)}>
      <Loader2 className="w-8 h-8 text-emerald-700 animate-spin mb-3" />
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{message}</span>
    </div>
  );
};
