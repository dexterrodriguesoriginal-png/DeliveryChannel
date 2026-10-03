import React from 'react';
import { cn } from '../../utils/cn';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({
  className,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  children,
  disabled,
  ...props
}, ref) => {
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98] select-none';

  const variants = {
    primary: 'bg-emerald-700 text-white hover:bg-emerald-800 shadow-2xs shadow-emerald-700/20 focus:ring-emerald-600',
    secondary: 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100/80 border border-emerald-200/60 focus:ring-emerald-500',
    outline: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 shadow-2xs focus:ring-emerald-500',
    ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:ring-emerald-500',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-2xs shadow-rose-600/20 focus:ring-rose-500',
    success: 'bg-green-600 text-white hover:bg-green-700 shadow-2xs focus:ring-green-500',
  };

  const sizes = {
    sm: 'text-[8px] px-1 py-0 gap-0.5 h-4.5 rounded',
    md: 'text-[9px] px-2 py-0 gap-0.5 h-5.5 rounded font-semibold',
    lg: 'text-[10px] px-2.5 py-0.5 gap-1 h-6 rounded',
  };

  return (
    <button
      ref={ref}
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="w-3 h-3 animate-spin text-current" />
      ) : (
        leftIcon
      )}
      <span>{children}</span>
      {!isLoading && rightIcon}
    </button>
  );
});

Button.displayName = 'Button';
