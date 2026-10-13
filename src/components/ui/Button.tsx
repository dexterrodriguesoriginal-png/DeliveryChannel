import React from 'react';
import { cn } from '../../utils/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
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
  disabled,
  children,
  ...props
}, ref) => {
  const variants = {
    primary: 'bg-emerald-700 text-white hover:bg-emerald-800 active:bg-emerald-900 shadow-sm border border-transparent focus:ring-emerald-600/30',
    secondary: 'bg-gray-100 text-gray-800 hover:bg-gray-200 active:bg-gray-300 border border-gray-200 focus:ring-gray-400/20',
    outline: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 active:bg-gray-100 shadow-2xs focus:ring-emerald-600/20',
    ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 active:bg-gray-200 border-transparent focus:ring-gray-400/20',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-sm border border-transparent focus:ring-rose-600/30',
  };

  const sizes = {
    sm: 'text-xs px-2.5 py-1.5 rounded-lg gap-1.5 font-medium min-h-7',
    md: 'text-sm px-3.5 py-2 rounded-xl gap-2 font-semibold min-h-9',
    lg: 'text-base px-5 py-2.5 rounded-xl gap-2.5 font-semibold min-h-11',
  };

  return (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      className={cn(
        'inline-flex items-center justify-center select-none transition-all duration-150 outline-none focus:ring-2 disabled:opacity-50 disabled:pointer-events-none cursor-pointer',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {isLoading ? (
        <svg className="animate-spin w-4 h-4 text-current shrink-0" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : leftIcon ? (
        <span className="shrink-0">{leftIcon}</span>
      ) : null}
      {children}
      {!isLoading && rightIcon && (
        <span className="shrink-0">{rightIcon}</span>
      )}
    </button>
  );
});

Button.displayName = 'Button';
