import React from 'react';
import { cn } from '../../utils/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export const Card: React.FC<CardProps> = ({
  className,
  hover = false,
  children,
  ...props
}) => {
  return (
    <div
      className={cn(
        'bg-white border border-gray-200/80 rounded p-1.5 sm:p-2 shadow-2xs transition-all duration-200',
        hover && 'hover:shadow-sm hover:border-gray-300 hover:-translate-y-0.5',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
