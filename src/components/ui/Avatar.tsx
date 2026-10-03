import React from 'react';
import { cn } from '../../utils/cn';

export interface AvatarProps {
  src?: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  src,
  name = 'AdegaFood',
  size = 'md',
  className,
}) => {
  const [hasError, setHasError] = React.useState(false);

  const sizes = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-7 h-7 text-xs',
    md: 'w-8.5 h-8.5 text-sm',
    lg: 'w-11 h-11 text-base font-semibold',
    xl: 'w-14 h-14 text-lg font-bold',
  };

  const getInitials = (n: string) => {
    return n
      .split(' ')
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  };

  if (src && !hasError) {
    return (
      <img
        src={src}
        alt={name}
        onError={() => setHasError(true)}
        className={cn('rounded-full object-cover border border-gray-200/80 shrink-0 bg-gray-100', sizes[size], className)}
      />
    );
  }

  return (
    <div
      className={cn(
        'rounded-full bg-emerald-100 text-emerald-800 font-medium flex items-center justify-center border border-emerald-200/80 shrink-0 select-none',
        sizes[size],
        className
      )}
    >
      {getInitials(name)}
    </div>
  );
};
