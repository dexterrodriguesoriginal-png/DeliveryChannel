import React from 'react';
import { TenantTheme } from '../../types';
import { Wifi, Battery, Signal, Search, ShoppingBag, ArrowLeft, Star, Heart, Clock } from 'lucide-react';

export interface MobileSimulatorProps {
  theme: TenantTheme;
  storeSlug: string;
  isOpen?: boolean;
}

export const MobileSimulator: React.FC<MobileSimulatorProps> = ({
  theme,
  isOpen = true,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-2 select-none">
      {/* Smartphone Device Frame */}
      <div className="relative w-[310px] sm:w-[340px] h-[640px] sm:h-[680px] bg-gray-950 rounded-[48px] p-3 shadow-2xl ring-1 ring-gray-900/10 border-4 border-gray-800 flex flex-col overflow-hidden">
        {/* Hardware details: Speaker & camera notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-gray-950 rounded-b-2xl z-30 flex items-center justify-center">
          <div className="w-12 h-1 bg-gray-800 rounded-full" />
          <div className="w-2.5 h-2.5 bg-gray-900 rounded-full border border-gray-800 ml-3" />
        </div>

        {/* Screen Bezel */}
        <div 
          className="relative flex-1 w-full rounded-[38px] overflow-hidden flex flex-col text-gray-900 transition-colors duration-300 font-sans shadow-inner"
          style={{ backgroundColor: theme.backgroundColor || '#f8fafc' }}
        >
          {/* iOS Status Bar */}
          <div className="pt-2 px-6 flex items-center justify-between text-[11px] font-semibold text-gray-800 z-20">
            <span>12:45</span>
            <div className="flex items-center gap-1.5">
              <Signal className="w-3 h-3 text-gray-700" />
              <Wifi className="w-3 h-3 text-gray-700" />
              <Battery className="w-4 h-4 text-gray-700" />
            </div>
          </div>

          {/* App Header */}
          <div 
            className="pt-3 pb-3 px-4 flex items-center justify-between shadow-xs transition-colors duration-300"
            style={{ backgroundColor: theme.cardColor || '#ffffff' }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {theme.logoUrl ? (
                <img
                  src={theme.logoUrl}
                  alt={theme.storeName}
                  className="w-8 h-8 rounded-full object-cover border border-gray-200 shrink-0"
                />
              ) : (
                <div 
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                  style={{ backgroundColor: theme.primaryColor || '#15803d' }}
                >
                  {theme.storeName.charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <h4 className="text-xs font-bold truncate leading-tight" style={{ color: theme.textColor }}>
                  {theme.storeName}
                </h4>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  <span>{isOpen ? 'Loja Aberta' : 'Fechada'}</span>
                  <span>•</span>
                  <span className="flex items-center text-amber-500">
                    <Star className="w-2.5 h-2.5 fill-current" /> 4.9
                  </span>
                </div>
              </div>
            </div>

            <button 
              className="w-7 h-7 rounded-full flex items-center justify-center text-white shadow-xs shrink-0"
              style={{ backgroundColor: theme.primaryColor || '#15803d' }}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Scrollable Screen Content */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3.5 no-scrollbar text-xs">
            {/* Search Mock */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <div className="w-full bg-white border border-gray-200/80 rounded-xl pl-8 pr-3 py-2 text-[11px] text-gray-400 shadow-2xs">
                Buscar no cardápio...
              </div>
            </div>

            {/* Offer Banner preview */}
            <div 
              className="p-3.5 rounded-2xl text-white relative overflow-hidden shadow-sm"
              style={{ 
                backgroundColor: theme.primaryColor || '#15803d',
                borderRadius: theme.borderRadius || '1rem'
              }}
            >
              <div className="relative z-10 space-y-1">
                <span className="px-1.5 py-0.5 rounded-full bg-white/25 text-[9px] font-black uppercase tracking-wider">
                  OFERTA DO DIA
                </span>
                <p className="font-bold text-xs leading-tight">20% OFF na primeira compra</p>
                <p className="text-[10px] text-white/80">Válido no app próprio</p>
              </div>
            </div>

            {/* Category Pills */}
            <div className="flex items-center gap-1.5 overflow-hidden">
              <span 
                className="px-2.5 py-1 text-[10px] font-bold text-white rounded-lg shadow-2xs whitespace-nowrap"
                style={{ backgroundColor: theme.primaryColor }}
              >
                Todos
              </span>
              <span className="px-2.5 py-1 text-[10px] font-medium bg-white text-gray-600 rounded-lg border border-gray-200 shadow-2xs whitespace-nowrap">
                Mais Vendidos
              </span>
              <span className="px-2.5 py-1 text-[10px] font-medium bg-white text-gray-600 rounded-lg border border-gray-200 shadow-2xs whitespace-nowrap">
                Bebidas
              </span>
            </div>

            {/* Product Cards preview */}
            <div className="space-y-2">
              <div 
                className="p-2.5 rounded-xl border border-gray-100 flex items-center justify-between gap-2 shadow-xs transition-colors"
                style={{ 
                  backgroundColor: theme.cardColor || '#ffffff',
                  borderRadius: theme.borderRadius || '0.85rem'
                }}
              >
                <div className="space-y-0.5 min-w-0">
                  <h5 className="font-bold text-[11px] text-gray-900 truncate">Vinho Tinto Reserva</h5>
                  <p className="text-[9px] text-gray-500 line-clamp-1">Garrafa 750ml safra nobre</p>
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="font-extrabold text-[11px] text-emerald-800">R$ 69,90</span>
                    <span className="text-[9px] text-gray-400 line-through">R$ 89,90</span>
                  </div>
                </div>
                <div 
                  className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 border"
                >
                  <span className="text-[9px] font-bold text-gray-400">FOTO</span>
                </div>
              </div>

              <div 
                className="p-2.5 rounded-xl border border-gray-100 flex items-center justify-between gap-2 shadow-xs transition-colors"
                style={{ 
                  backgroundColor: theme.cardColor || '#ffffff',
                  borderRadius: theme.borderRadius || '0.85rem'
                }}
              >
                <div className="space-y-0.5 min-w-0">
                  <h5 className="font-bold text-[11px] text-gray-900 truncate">Cerveja Artesanal IPA</h5>
                  <p className="text-[9px] text-gray-500 line-clamp-1">Puro malte gelada</p>
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="font-extrabold text-[11px] text-emerald-800">R$ 19,90</span>
                  </div>
                </div>
                <div 
                  className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 border"
                >
                  <span className="text-[9px] font-bold text-gray-400">FOTO</span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom App Nav Mock */}
          <div 
            className="py-2 px-6 border-t border-gray-100 flex items-center justify-around text-gray-400 z-10"
            style={{ backgroundColor: theme.cardColor || '#ffffff' }}
          >
            <div className="flex flex-col items-center gap-0.5" style={{ color: theme.primaryColor }}>
              <div className="w-1.5 h-1.5 rounded-full bg-current" />
              <span className="text-[9px] font-bold">Início</span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <Search className="w-3.5 h-3.5" />
              <span className="text-[9px]">Buscar</span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <ShoppingBag className="w-3.5 h-3.5" />
              <span className="text-[9px]">Sacola</span>
            </div>
          </div>

          {/* iOS Bottom Home Bar */}
          <div className="h-4 flex items-center justify-center pb-1">
            <div className="w-28 h-1 bg-gray-300 rounded-full" />
          </div>
        </div>
      </div>
      <div className="mt-3 text-center">
        <span className="text-xs font-semibold text-gray-500">
          Simulador Mobile PWA em tempo real
        </span>
      </div>
    </div>
  );
};
