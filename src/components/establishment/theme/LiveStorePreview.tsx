import React, { useState } from 'react';
import { TenantTheme } from '../../../types';
import {
  themeToTokens,
  generateCssVariables,
  formatCssBackground,
} from '../../../lib/theme/themeEngine';
import {
  Smartphone,
  Monitor,
  Search,
  ShoppingBag,
  Star,
  Plus,
  Clock,
  Sparkles,
  Tag,
  CheckCircle2,
  MapPin,
  Flame,
} from 'lucide-react';

export interface LiveStorePreviewProps {
  theme: TenantTheme;
  storeSlug?: string;
  isOpen?: boolean;
  defaultMode?: 'mobile' | 'desktop';
}

export const LiveStorePreview: React.FC<LiveStorePreviewProps> = ({
  theme,
  isOpen = true,
  defaultMode = 'mobile',
}) => {
  const [viewMode, setViewMode] = useState<'mobile' | 'desktop'>(defaultMode);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const tokens = themeToTokens(theme);
  const cssVars = generateCssVariables(tokens) as React.CSSProperties;

  const p = tokens.palette;
  const c = tokens.components;
  const t = tokens.typography;

  const categories = [
    { id: 'all', label: 'Todos' },
    { id: 'featured', label: 'Destaques' },
    { id: 'promos', label: 'Promoções' },
    { id: 'drinks', label: 'Bebidas' },
    { id: 'combos', label: 'Combos' },
  ];

  const sampleProducts = [
    {
      id: '1',
      name: 'Vinho Tinto Reserva Especial 750ml',
      desc: 'Safra selecionada em carvalho francês com notas de frutas vermelhas.',
      price: 'R$ 89,90',
      promoPrice: 'R$ 69,90',
      hasPromo: true,
      tag: 'Mais Vendido',
      rating: '4.9',
      image: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=300&h=300&fit=crop',
    },
    {
      id: '2',
      name: 'Cerveja Artesanal IPA Puro Malte 500ml',
      desc: 'Lúpulos aromáticos, amargor equilibrado e extremamente refrescante.',
      price: 'R$ 18,90',
      promoPrice: null,
      hasPromo: false,
      tag: 'Gelada',
      rating: '4.8',
      image: 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=300&h=300&fit=crop',
    },
    {
      id: '3',
      name: 'Combo Petiscos Gourmet & Queijos Nobres',
      desc: 'Porção para compartilhar com queijo brie, copa defumada e castanhas.',
      price: 'R$ 54,90',
      promoPrice: 'R$ 44,90',
      hasPromo: true,
      tag: 'Oferta',
      rating: '5.0',
      image: 'https://images.unsplash.com/photo-1541529086526-db283c563270?w=300&h=300&fit=crop',
    },
  ];

  // Helper de sombra dos cards
  const cardShadowClass =
    c.cardShadow === 'none'
      ? 'shadow-none'
      : c.cardShadow === 'md'
      ? 'shadow-md'
      : c.cardShadow === 'lg'
      ? 'shadow-lg'
      : 'shadow-xs';

  // Helper de estilo das categorias
  const renderCategoryButton = (cat: { id: string; label: string }) => {
    const isSelected = activeCategory === cat.id;
    let style: React.CSSProperties = {};
    let className = 'px-3 py-1.5 text-xs font-semibold transition-all shrink-0 cursor-pointer ';

    if (c.categoryStyle === 'pill') {
      className += 'rounded-full ';
    } else {
      className += 'rounded-lg ';
    }

    if (isSelected) {
      style = {
        backgroundColor: p.primary,
        color: p.buttonText || '#ffffff',
      };
      className += 'shadow-xs';
    } else {
      style = {
        backgroundColor: c.categoryStyle === 'outline' ? 'transparent' : p.bgCard,
        color: p.textSecondary,
        borderColor: p.border,
      };
      className += 'border hover:opacity-90';
    }

    return (
      <button
        key={cat.id}
        type="button"
        onClick={() => setActiveCategory(cat.id)}
        style={style}
        className={className}
      >
        {cat.label}
      </button>
    );
  };

  return (
    <div className="flex flex-col items-center w-full">
      {/* Controles de visualização: Celular vs Desktop */}
      <div className="flex items-center justify-between w-full pb-3 border-b border-gray-100 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-800 tracking-wide uppercase">
            Preview ao Vivo
          </span>
          <span className="text-[11px] text-gray-400">
            {viewMode === 'mobile' ? 'Mobile PWA (390 × 844 px)' : 'Desktop / Tablet (Vitrine Expandida)'}
          </span>
        </div>

        <div className="flex items-center bg-gray-100 p-0.5 rounded-lg">
          <button
            type="button"
            onClick={() => setViewMode('mobile')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              viewMode === 'mobile'
                ? 'bg-white text-gray-900 shadow-2xs'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Celular</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('desktop')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              viewMode === 'desktop'
                ? 'bg-white text-gray-900 shadow-2xs'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Desktop</span>
          </button>
        </div>
      </div>

      {/* Frame do Simulador */}
      {viewMode === 'mobile' ? (
        <div className="relative w-[340px] h-[690px] bg-gray-950 rounded-[48px] p-3 shadow-2xl ring-1 ring-gray-900/10 border-4 border-gray-800 flex flex-col overflow-hidden select-none">
          {/* Speaker & notch */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-gray-950 rounded-b-2xl z-30 flex items-center justify-center">
            <div className="w-12 h-1 bg-gray-800 rounded-full" />
            <div className="w-2.5 h-2.5 bg-gray-900 rounded-full border border-gray-800 ml-3" />
          </div>

          {/* Tela interna */}
          <div
            className="relative flex-1 w-full rounded-[38px] overflow-hidden flex flex-col shadow-inner transition-colors duration-200"
            style={{
              ...cssVars,
              background: formatCssBackground(tokens.backgrounds.general),
              fontFamily: 'var(--dc-font-family)',
            }}
          >
            {/* Status bar */}
            <div className="pt-2.5 px-6 flex items-center justify-between text-[11px] font-semibold text-gray-800 z-20">
              <span style={{ color: p.textSecondary }}>12:45</span>
              <div className="flex items-center gap-1 text-xs" style={{ color: p.textSecondary }}>
                <Clock className="w-3 h-3" />
                <span>30-45m</span>
              </div>
            </div>

            {/* Cabeçalho */}
            <div
              className="pt-3 pb-3 px-4 flex items-center justify-between border-b shadow-2xs transition-colors duration-200"
              style={{
                background: formatCssBackground(tokens.backgrounds.header),
                borderColor: p.border,
              }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {theme.logoUrl ? (
                  <img
                    src={theme.logoUrl}
                    alt={theme.storeName}
                    className="w-9 h-9 rounded-full object-cover border shrink-0"
                    style={{ borderColor: p.border }}
                  />
                ) : (
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0"
                    style={{
                      backgroundColor: p.primary,
                      color: p.buttonText || '#ffffff',
                    }}
                  >
                    {(theme.storeName || 'L').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <h4
                    className="text-xs font-bold truncate leading-tight"
                    style={{ color: p.textTitle }}
                  >
                    {theme.storeName || 'Sua Loja Delivery'}
                  </h4>
                  <div className="flex items-center gap-1.5 text-[10px]" style={{ color: p.textSecondary }}>
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-emerald-500' : 'bg-rose-500'}`}
                    />
                    <span>{isOpen ? 'Loja Aberta' : 'Fechada'}</span>
                    <span>·</span>
                    <span className="flex items-center text-amber-500">
                      <Star className="w-2.5 h-2.5 fill-current" /> 4.9
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="w-8 h-8 rounded-full flex items-center justify-center shadow-xs shrink-0 transition-transform active:scale-95"
                style={{
                  backgroundColor: p.primary,
                  color: p.buttonText || '#ffffff',
                  borderRadius: c.buttonRadius,
                }}
              >
                <ShoppingBag className="w-4 h-4" />
              </button>
            </div>

            {/* Conteúdo rolável */}
            <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3 no-scrollbar text-xs">
              {/* Barra de Busca */}
              <div className="relative">
                <Search
                  className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: p.textSecondary }}
                />
                <div
                  className="w-full border pl-8 pr-3 py-2 text-[11px] shadow-2xs"
                  style={{
                    backgroundColor: p.bgCard,
                    borderColor: p.border,
                    color: p.textSecondary,
                    borderRadius: c.borderRadius,
                  }}
                >
                  Buscar no cardápio...
                </div>
              </div>

              {/* Banner / Oferta */}
              <div
                className="p-3.5 relative overflow-hidden shadow-xs"
                style={{
                  backgroundColor: p.primary,
                  color: p.buttonText || '#ffffff',
                  borderRadius: c.borderRadius,
                }}
              >
                <div className="relative z-10 space-y-1">
                  <span
                    className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider inline-flex items-center gap-1"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.22)',
                      color: p.buttonText || '#ffffff',
                    }}
                  >
                    <Flame className="w-2.5 h-2.5" /> OFERTA DO DIA
                  </span>
                  <p className="font-extrabold text-xs leading-tight">
                    {theme.tagline || 'Seu canal de compras direto e exclusivo.'}
                  </p>
                  <p className="text-[10px] opacity-90">Descontos exclusivos no app próprio</p>
                </div>
              </div>

              {/* Categorias */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                {categories.map(renderCategoryButton)}
              </div>

              {/* Lista de Produtos */}
              <div className="space-y-2">
                {sampleProducts.map((prod) => (
                  <div
                    key={prod.id}
                    className={`p-2.5 flex items-center justify-between gap-2 transition-all ${cardShadowClass}`}
                    style={{
                      background: formatCssBackground(tokens.backgrounds.card),
                      borderColor: p.border,
                      borderWidth: c.cardBorder ? '1px' : '0px',
                      borderRadius: c.cardRadius || c.borderRadius,
                    }}
                  >
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span
                          className="font-bold text-[11px] truncate"
                          style={{ color: p.textTitle }}
                        >
                          {prod.name}
                        </span>
                      </div>
                      <p
                        className="text-[9px] line-clamp-1 leading-tight"
                        style={{ color: p.textSecondary }}
                      >
                        {prod.desc}
                      </p>
                      <div className="flex items-center gap-1.5 pt-1">
                        <span
                          className="font-extrabold text-xs"
                          style={{ color: prod.hasPromo ? p.promoPrice : p.price }}
                        >
                          {prod.promoPrice || prod.price}
                        </span>
                        {prod.hasPromo && (
                          <span
                            className="text-[9px] line-through"
                            style={{ color: p.textSecondary }}
                          >
                            {prod.price}
                          </span>
                        )}
                        {prod.hasPromo && (
                          <span
                            className="text-[8px] font-bold px-1 py-0.2 rounded"
                            style={{
                              backgroundColor: `${p.promoPrice}15`,
                              color: p.promoPrice,
                            }}
                          >
                            PROMO
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="relative shrink-0">
                      <img
                        src={prod.image}
                        alt={prod.name}
                        className="w-13 h-13 object-cover rounded-lg border"
                        style={{ borderColor: p.border }}
                      />
                      <button
                        type="button"
                        className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center shadow-xs cursor-pointer"
                        style={{
                          backgroundColor: p.buttonBg,
                          color: p.buttonText || '#ffffff',
                          borderRadius: c.buttonRadius,
                        }}
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom Nav */}
            <div
              className="py-2.5 px-6 border-t flex items-center justify-around z-10"
              style={{
                backgroundColor: p.bgMenu || p.bgCard,
                borderColor: p.border,
              }}
            >
              <div className="flex flex-col items-center gap-0.5" style={{ color: p.primary }}>
                <div className="w-1.5 h-1.5 rounded-full bg-current" />
                <span className="text-[9px] font-bold">Início</span>
              </div>
              <div className="flex flex-col items-center gap-0.5" style={{ color: p.textSecondary }}>
                <Search className="w-3.5 h-3.5" />
                <span className="text-[9px]">Buscar</span>
              </div>
              <div className="flex flex-col items-center gap-0.5" style={{ color: p.textSecondary }}>
                <ShoppingBag className="w-3.5 h-3.5" />
                <span className="text-[9px]">Sacola</span>
              </div>
            </div>

            {/* iOS Home bar */}
            <div className="h-4 flex items-center justify-center pb-1">
              <div className="w-24 h-1 bg-gray-300 rounded-full" />
            </div>
          </div>
        </div>
      ) : (
        /* Vista Desktop / Tablet */
        <div
          className="w-full max-w-2xl rounded-2xl border overflow-hidden shadow-lg transition-colors duration-200"
          style={{
            ...cssVars,
            background: formatCssBackground(tokens.backgrounds.general),
            borderColor: p.border,
            fontFamily: 'var(--dc-font-family)',
          }}
        >
          {/* Top Bar Desktop */}
          <div
            className="px-6 py-4 border-b flex items-center justify-between"
            style={{
              background: formatCssBackground(tokens.backgrounds.header),
              borderColor: p.border,
            }}
          >
            <div className="flex items-center gap-3">
              {theme.logoUrl ? (
                <img
                  src={theme.logoUrl}
                  alt={theme.storeName}
                  className="w-10 h-10 rounded-full object-cover border"
                  style={{ borderColor: p.border }}
                />
              ) : (
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm"
                  style={{
                    backgroundColor: p.primary,
                    color: p.buttonText || '#ffffff',
                  }}
                >
                  {(theme.storeName || 'L').charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h3 className="font-bold text-sm leading-tight" style={{ color: p.textTitle }}>
                  {theme.storeName || 'Sua Loja Delivery'}
                </h3>
                <p className="text-xs" style={{ color: p.textSecondary }}>
                  {theme.tagline || 'Seu canal de compras direto e exclusivo.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              className="px-4 py-2 text-xs font-bold flex items-center gap-2 shadow-xs cursor-pointer"
              style={{
                backgroundColor: p.buttonBg,
                color: p.buttonText || '#ffffff',
                borderRadius: c.buttonRadius,
              }}
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Ver Sacola (3 itens)</span>
            </button>
          </div>

          {/* Desktop Content */}
          <div className="p-6 space-y-5">
            {/* Search and Categories bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
                {categories.map(renderCategoryButton)}
              </div>
              <div className="relative w-full sm:w-56">
                <Search
                  className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: p.textSecondary }}
                />
                <div
                  className="w-full border pl-8 pr-3 py-1.5 text-xs shadow-2xs"
                  style={{
                    backgroundColor: p.bgCard,
                    borderColor: p.border,
                    color: p.textSecondary,
                    borderRadius: c.borderRadius,
                  }}
                >
                  Buscar itens...
                </div>
              </div>
            </div>

            {/* Grid of Product Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {sampleProducts.map((prod) => (
                <div
                  key={prod.id}
                  className={`p-4 flex flex-col justify-between gap-3 border transition-all ${cardShadowClass}`}
                  style={{
                    background: formatCssBackground(tokens.backgrounds.card),
                    borderColor: p.border,
                    borderRadius: c.cardRadius || c.borderRadius,
                  }}
                >
                  <div className="flex gap-3">
                    <img
                      src={prod.image}
                      alt={prod.name}
                      className="w-16 h-16 object-cover rounded-lg border shrink-0"
                      style={{ borderColor: p.border }}
                    />
                    <div className="min-w-0 space-y-1">
                      <h5 className="font-bold text-xs truncate" style={{ color: p.textTitle }}>
                        {prod.name}
                      </h5>
                      <p className="text-[11px] line-clamp-2" style={{ color: p.textSecondary }}>
                        {prod.desc}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: p.border }}>
                    <div className="flex items-baseline gap-1.5">
                      <span
                        className="font-extrabold text-sm"
                        style={{ color: prod.hasPromo ? p.promoPrice : p.price }}
                      >
                        {prod.promoPrice || prod.price}
                      </span>
                      {prod.hasPromo && (
                        <span className="text-xs line-through" style={{ color: p.textSecondary }}>
                          {prod.price}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      className="px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer"
                      style={{
                        backgroundColor: p.buttonBg,
                        color: p.buttonText || '#ffffff',
                        borderRadius: c.buttonRadius,
                      }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Adicionar</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 text-center text-xs font-medium text-gray-500">
        Simulação em tempo real com tokens CSS sincronizados
      </div>
    </div>
  );
};
