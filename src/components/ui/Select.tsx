import React from 'react';
import { cn } from '../../utils/cn';
import { ChevronDown } from 'lucide-react';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({
  className,
  label,
  helperText,
  error,
  options,
  id,
  ...props
}, ref) => {
  const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="w-full flex flex-col gap-0.5">
      {label && (
        <label htmlFor={selectId} className="text-[8px] font-semibold text-gray-700 select-none">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'w-full appearance-none bg-white text-[9.5px] text-gray-900 border border-gray-200 rounded px-1.5 py-0.5 pr-5 h-6 outline-none transition-all duration-200 cursor-pointer',
            'focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/10 shadow-2xs',
            error && 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/10',
            className
          )}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="w-2 h-2 text-gray-400 absolute right-1.5 pointer-events-none" />
      </div>
      {error ? (
        <span className="text-[10px] text-rose-600 font-medium">{error}</span>
      ) : helperText ? (
        <span className="text-[10px] text-gray-500">{helperText}</span>
      ) : null}
    </div>
  );
});

Select.displayName = 'Select';
