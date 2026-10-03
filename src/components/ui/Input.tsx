import React from 'react';
import { cn } from '../../utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({
  className,
  label,
  helperText,
  error,
  leftIcon,
  rightIcon,
  id,
  ...props
}, ref) => {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="w-full flex flex-col gap-0.5">
      {label && (
        <label htmlFor={inputId} className="text-[8px] font-semibold text-gray-700 select-none">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {leftIcon && (
          <div className="absolute left-1.5 text-gray-400 pointer-events-none flex items-center">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full bg-white text-[9.5px] text-gray-900 placeholder:text-gray-400 border border-gray-200 rounded px-1.5 py-0.5 h-6 outline-none transition-all duration-200',
            'focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/10 shadow-2xs',
            leftIcon && 'pl-5',
            rightIcon && 'pr-5',
            error && 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/10 text-rose-900',
            className
          )}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-1.5 text-gray-400 flex items-center">
            {rightIcon}
          </div>
        )}
      </div>
      {error ? (
        <span className="text-[10px] text-rose-600 font-medium">{error}</span>
      ) : helperText ? (
        <span className="text-[10px] text-gray-500">{helperText}</span>
      ) : null}
    </div>
  );
});

Input.displayName = 'Input';
