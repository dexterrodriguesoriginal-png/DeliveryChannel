import React from 'react';
import { Home, Search, Tag, ShoppingBag, Clock, Bike, User, ClipboardList } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface MobileNavigationProps {
  type: 'customer' | 'driver';
  activeTab: string;
  onTabChange: (tabId: string) => void;
  cartCount?: number;
  /** Ponto/contador no Perfil (notificações não lidas). */
  profileBadge?: number;
  primaryColor?: string;
}

export const MobileNavigation: React.FC<MobileNavigationProps> = ({
  type,
  activeTab,
  onTabChange,
  cartCount = 0,
  profileBadge = 0,
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

  // App do cliente (/app/<slug>): Início, Busca, Ofertas, Sacola, Pedidos e Perfil.
  const customerTabs = [
    { id: 'home', label: 'Início', icon: <Home className="w-5 h-5" /> },
    { id: 'search', label: 'Busca', icon: <Search className="w-5 h-5" /> },
    { id: 'offers', label: 'Ofertas', icon: <Tag className="w-5 h-5" /> },
    {
      id: 'cart',
      label: 'Sacola',
      icon: (
        <div className="relative">
          <ShoppingBag className="w-5 h-5" />
          {cartCount > 0 && (
            <span data-testid="nav-cart-count" className="absolute -top-1.5 -right-2 min-w-4 h-4 px-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center shadow-xs">
              {cartCount > 99 ? '99+' : cartCount}
            </span>
          )}
        </div>
      ),
    },
    { id: 'orders', label: 'Pedidos', icon: <ClipboardList className="w-5 h-5" /> },
    {
      id: 'profile',
      label: 'Perfil',
      icon: (
        <div className="relative">
          <User className="w-5 h-5" />
          {profileBadge > 0 && <span data-testid="nav-profile-dot" className="absolute -top-0.5 -right-1 w-2.5 h-2.5 rounded-full bg-rose-600 ring-2 ring-white" />}
        </div>
      ),
    },
  ];

  return (
    <nav data-testid="customer-bottom-nav" className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200 px-1 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] grid grid-cols-6 shadow-lg max-w-lg mx-auto sm:rounded-t-2xl">
      {customerTabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            data-testid={`nav-${tab.id}`}
            aria-current={isActive ? 'page' : undefined}
            className="flex flex-col items-center gap-0.5 py-1 text-[10px] sm:text-[11px] font-semibold transition-all cursor-pointer active:scale-95"
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
