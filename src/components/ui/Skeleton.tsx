import React from 'react';
import { cn } from '../../utils/cn';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular' | 'card';
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className,
  variant = 'rectangular',
  ...props
}) => {
  const variantStyles = {
    text: 'h-4 w-full rounded-md',
    circular: 'rounded-full',
    rectangular: 'rounded-xl',
    card: 'h-32 w-full rounded-2xl',
  };

  return (
    <div
      className={cn(
        'animate-pulse bg-gray-200/80',
        variantStyles[variant],
        className
      )}
      {...props}
    />
  );
};
