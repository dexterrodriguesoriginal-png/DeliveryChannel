import React from 'react';
import { cn } from '../../utils/cn';

export interface TabItem {
  id: string;
  label: string;
  badge?: number | string;
  icon?: React.ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
  variant?: 'underline' | 'pills';
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTab,
  onChange,
  className,
  variant = 'underline',
}) => {
  if (variant === 'pills') {
    return (
      <div className={cn('flex items-center gap-1 p-0.5 bg-gray-100 rounded-lg overflow-x-auto no-scrollbar', className)}>
        {tabs.map(tab => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={cn(
                'flex items-center gap-0.5 px-1 py-0.2 text-[9px] font-semibold rounded transition-all duration-200 whitespace-nowrap cursor-pointer',
                isActive
                  ? 'bg-white text-emerald-800 shadow-2xs border border-gray-200/50 font-bold'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  className={cn(
                    'text-[7px] px-1 py-0.2 rounded-full font-bold',
                    isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-700'
                  )}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn('border-b border-gray-200 flex items-center gap-2 overflow-x-auto no-scrollbar', className)}>
      {tabs.map(tab => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex items-center gap-1 pb-1 pt-0.5 text-[9px] sm:text-[10px] font-semibold border-b-2 transition-all duration-200 whitespace-nowrap -mb-px cursor-pointer',
              isActive
                ? 'border-emerald-700 text-emerald-800 font-bold'
                : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span
                className={cn(
                  'text-[8px] px-1.5 py-0.2 rounded-full font-bold',
                  isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
