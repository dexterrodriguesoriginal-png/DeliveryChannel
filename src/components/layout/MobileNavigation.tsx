import React from 'react';
import { Home, Search, Tag, ShoppingBag, Clock, Bike, User, Shield } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface MobileNavigationProps {
  type: 'customer' | 'driver';
  activeTab: string;
  onTabChange: (tabId: string) => void;
  cartCount?: number;
  primaryColor?: string;
}

export const MobileNavigation: React.FC<MobileNavigationProps> = ({
  type,
  activeTab,
  onTabChange,
  cartCount = 0,
  primaryColor = '#15803d',
}) => {
  if (type === 'driver') {
    const driverTabs = [
      { id: 'active-delivery', label: 'Entrega Atual', icon: <Bike className="w-5 h-5" /> },
      { id: 'history', label: 'Histórico', icon: <Clock className="w-5 h-5" /> },
      { id: 'driver-profile', label: 'Meu Perfil', icon: <User className="w-5 h-5" /> },
    ];

    return (
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200 px-6 py-2 flex items-center justify-around shadow-lg">
        {driverTabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'flex flex-col items-center gap-1 py-1 px-3 text-[11px] font-semibold transition-all cursor-pointer',
                isActive ? 'text-emerald-700' : 'text-gray-400 hover:text-gray-600'
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    );
  }

  const customerTabs = [
    { id: 'home', label: 'Início', icon: <Home className="w-5 h-5" /> },
    { id: 'search', label: 'Buscar', icon: <Search className="w-5 h-5" /> },
    { id: 'offers', label: 'Ofertas', icon: <Tag className="w-5 h-5" /> },
    {
      id: 'cart',
      label: 'Sacola',
      icon: (
        <div className="relative">
          <ShoppingBag className="w-5 h-5" />
          {cartCount > 0 && (
            <span className="absolute -top-1.5 -right-2 w-4 h-4 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center shadow-xs">
              {cartCount}
            </span>
          )}
        </div>
      ),
    },
    { id: 'orders', label: 'Pedidos', icon: <Clock className="w-5 h-5" /> },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200 px-3 py-2 flex items-center justify-around shadow-lg max-w-lg mx-auto sm:rounded-t-2xl">
      {customerTabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className="flex flex-col items-center gap-1 py-1 px-2.5 text-[10px] sm:text-[11px] font-semibold transition-all cursor-pointer"
            style={{
              color: isActive ? primaryColor : '#94a3b8',
            }}
          >
            {tab.icon}
            <span className={isActive ? 'font-bold' : ''}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
