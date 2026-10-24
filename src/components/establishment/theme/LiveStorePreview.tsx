import React, { useState } from 'react';
import { TenantTheme } from '../../../types';
import {
  themeToTokens,
  generateCssVariables,
  getSurfaceBackgroundStyle,
  computeTypographyStyles,
  computeCardBoxShadow,
  resolveCardBorderRadius,
  resolveCardBorderWidth,
} from '../../../lib/theme/themeEngine';
import {
  Smartphone,
  Monitor,
  Search,
  ShoppingBag,
  Star,
  Plus,
  Clock,
  Flame,
  Home,
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
  const typo = computeTypographyStyles(tokens.typography);

  const generalBgStyle = getSurfaceBackgroundStyle(tokens.backgrounds.general, p.bgGeneral);
  const headerBgStyle = getSurfaceBackgroundStyle(tokens.backgrounds.header, p.bgHeader);
  const cardBgStyle = getSurfaceBackgroundStyle(tokens.backgrounds.card, p.bgCard);

  const cardBorderRadius = resolveCardBorderRadius(c);
  const cardBorderWidth = resolveCardBorderWidth(c);
  const cardBoxShadow = computeCardBoxShadow(c);

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

  // Estilo isolado para os botões de categoria:
  // Controlado exclusivamente por p.categoryBg (Botão Categoria), sem depender de p.bgCard, p.buttonBg ou p.primary
  const renderCategoryButton = (cat: { id: string; label: string }) => {
    const isSelected = activeCategory === cat.id;
    let className = 'px-3 py-1.5 text-xs transition-all shrink-0 cursor-pointer border ';

    if (c.categoryStyle === 'pill') {
      className += 'rounded-full ';
    } else {
      className += 'rounded-lg ';
    }

    if (isSelected) {
      className += 'font-bold ring-1 ring-black/15 shadow-2xs';
    } else {
      className += 'font-medium opacity-90 hover:opacity-100';
    }

    const style: React.CSSProperties = {
      backgroundColor: c.categoryStyle === 'outline' ? 'transparent' : p.categoryBg,
      color: p.textTitle,
      borderColor: p.border,
      fontFamily: typo.cssFont,
      fontSize: `${Math.round(11 * typo.scaleFactor)}px`,
    };

    return (
      <button
        key={cat.id}
        type="button"
        data-testid="preview-category-btn"
        data-category-id={cat.id}
        onClick={() => setActiveCategory(cat.id)}
        style={style}
        className={className}
      >
        {cat.label}
      </button>
    );
  };

  // Estilos tipográficos isolados para títulos vs textos corridos
  const titleTextStyle: React.CSSProperties = {
    color: p.textTitle,
    fontFamily: typo.cssFont,
    fontWeight: typo.titleWeight,
    fontStyle: typo.titleFontStyle,
    textTransform: typo.titleTextTransform,
    letterSpacing: typo.letterSpacing,
    lineHeight: typo.lineHeight,
    fontSize: `${Math.round(12 * typo.scaleFactor)}px`,
  };

  const bodyTextStyle: React.CSSProperties = {
    color: p.textMain,
    fontFamily: typo.cssFont,
    fontWeight: typo.bodyWeight,
    fontStyle: 'normal',
    textTransform: 'none',
    letterSpacing: typo.letterSpacing,
    lineHeight: typo.lineHeight,
    fontSize: `${Math.round(10 * typo.scaleFactor)}px`,
  };

  const secondaryTextStyle: React.CSSProperties = {
    color: p.textSecondary,
    fontFamily: typo.cssFont,
    fontSize: `${Math.round(10 * typo.scaleFactor)}px`,
  };

  return (
    <div className="flex flex-col items-center w-full" data-testid="live-store-preview">
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
            data-testid="preview-mode-mobile"
            onClick={() => setViewMode('mobile')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
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
            data-testid="preview-mode-desktop"
            onClick={() => setViewMode('desktop')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
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

          {/* Tela interna (Superfície de Fundo Geral) */}
          <div
            data-testid="preview-general-surface"
            className="relative flex-1 w-full rounded-[38px] overflow-hidden flex flex-col shadow-inner transition-colors duration-200"
            style={{
              ...cssVars,
              ...generalBgStyle,
              fontFamily: typo.cssFont,
            }}
          >
            {/* Status bar */}
            <div className="pt-2.5 px-6 flex items-center justify-between text-[11px] font-semibold z-20">
              <span data-testid="preview-text-secondary" style={secondaryTextStyle}>
                12:45
              </span>
              <div className="flex items-center gap-1 text-xs">
                <Clock
                  data-testid="preview-icon-clock"
                  className="w-3 h-3"
                  style={{ color: p.iconColor }}
                />
                <span data-testid="preview-delivery-time-label" style={secondaryTextStyle}>
                  30-45m
                </span>
              </div>
            </div>

            {/* Cabeçalho (Superfície Fundo do Cabeçalho) */}
            <div
              data-testid="preview-header"
              className="pt-3 pb-3 px-4 flex items-center justify-between border-b shadow-2xs transition-colors duration-200"
              style={{
                ...headerBgStyle,
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
                    data-testid="preview-logo-fallback"
                    className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0"
                    style={{
                      backgroundColor: p.primary,
                      color: '#ffffff',
                    }}
                  >
                    {(theme.storeName || 'L').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <h4
                    data-testid="preview-store-title"
                    className="truncate"
                    style={titleTextStyle}
                  >
                    {theme.storeName || 'Sua Loja Delivery'}
                  </h4>
                  <div className="flex items-center gap-1.5" style={secondaryTextStyle}>
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
                data-testid="preview-header-action-button"
                className="w-8 h-8 rounded-full flex items-center justify-center shadow-xs shrink-0 transition-transform active:scale-95"
                style={{
                  backgroundColor: p.buttonBg,
                  color: p.buttonText,
                  borderRadius: c.buttonRadius || cardBorderRadius,
                }}
              >
                <ShoppingBag className="w-4 h-4" />
              </button>
            </div>

            {/* Conteúdo rolável */}
            <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3 no-scrollbar text-xs">
              {/* Barra de Busca (Superfície neutra própria, independente de bgCard) */}
              <div className="relative">
                <Search
                  data-testid="preview-icon-search"
                  className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: p.iconColor }}
                />
                <div
                  data-testid="preview-search-bar"
                  className="w-full border pl-8 pr-3 py-2 text-[11px] shadow-2xs"
                  style={{
                    backgroundColor: '#ffffff',
                    borderColor: p.border,
                    color: p.textSecondary,
                    borderRadius: cardBorderRadius,
                    fontFamily: typo.cssFont,
                  }}
                >
                  Buscar no cardápio...
                </div>
              </div>

              {/* Banner / Oferta (Usa Cor Principal e Cor Secundária sem afetar botões ou cards) */}
              <div
                data-testid="preview-promo-banner"
                className="p-3.5 relative overflow-hidden shadow-xs"
                style={{
                  backgroundColor: p.primary,
                  color: '#ffffff',
                  borderRadius: cardBorderRadius,
                }}
              >
                <div className="relative z-10 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      data-testid="preview-accent-badge"
                      className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider inline-flex items-center gap-1"
                      style={{
                        backgroundColor: p.accent,
                        color: '#ffffff',
                      }}
                    >
                      <Flame className="w-2.5 h-2.5" /> OFERTA DO DIA
                    </span>
                    <span
                      data-testid="preview-secondary-element"
                      className="px-2 py-0.5 rounded-full text-[9px] font-bold"
                      style={{
                        backgroundColor: p.secondary,
                        color: '#ffffff',
                      }}
                    >
                      App Exclusivo
                    </span>
                  </div>
                  <p
                    className="font-extrabold leading-tight"
                    style={{
                      fontFamily: typo.cssFont,
                      fontSize: `${Math.round(12 * typo.scaleFactor)}px`,
                    }}
                  >
                    {theme.tagline || 'Seu canal de compras direto e exclusivo.'}
                  </p>
                  <p className="text-[10px] opacity-90">Descontos exclusivos no app próprio</p>
                </div>
              </div>

              {/* Categorias (Controladas exclusivamente por p.categoryBg) */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                {categories.map(renderCategoryButton)}
              </div>

              {/* Lista de Produtos (Cards controlados exclusivamente por bgCard / backgrounds.card) */}
              <div className="space-y-2">
                {sampleProducts.map((prod) => (
                  <div
                    key={prod.id}
                    data-testid="preview-product-card"
                    data-product-id={prod.id}
                    className="p-2.5 flex items-center justify-between gap-2 transition-all"
                    style={{
                      ...cardBgStyle,
                      borderColor: p.border,
                      borderWidth: `${cardBorderWidth}px`,
                      borderStyle: cardBorderWidth > 0 ? 'solid' : 'none',
                      borderRadius: cardBorderRadius,
                      boxShadow: cardBoxShadow,
                    }}
                  >
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span
                          data-testid="preview-product-title"
                          className="truncate"
                          style={titleTextStyle}
                        >
                          {prod.name}
                        </span>
                      </div>
                      <p
                        data-testid="preview-product-desc"
                        className="line-clamp-2"
                        style={bodyTextStyle}
                      >
                        {prod.desc}
                      </p>
                      <div className="flex items-center gap-1.5 pt-1">
                        {prod.hasPromo ? (
                          <span
                            data-testid="preview-promo-price"
                            className="font-extrabold"
                            style={{
                              color: p.promoPrice,
                              fontFamily: typo.cssFont,
                              fontSize: `${Math.round(12 * typo.scaleFactor)}px`,
                            }}
                          >
                            {prod.promoPrice}
                          </span>
                        ) : (
                          <span
                            data-testid="preview-normal-price"
                            className="font-extrabold"
                            style={{
                              color: p.price,
                              fontFamily: typo.cssFont,
                              fontSize: `${Math.round(12 * typo.scaleFactor)}px`,
                            }}
                          >
                            {prod.price}
                          </span>
                        )}
                        {prod.hasPromo && (
                          <span
                            data-testid="preview-strikethrough-price"
                            className="line-through"
                            style={secondaryTextStyle}
                          >
                            {prod.price}
                          </span>
                        )}
                        {prod.tag && (
                          <span
                            data-testid="preview-product-accent-tag"
                            className="text-[8px] font-bold px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: p.accent,
                              color: '#ffffff',
                            }}
                          >
                            {prod.tag}
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
                        data-testid="preview-action-button"
                        className="absolute -bottom-1 -right-1 px-1.5 h-5 rounded-full flex items-center justify-center gap-0.5 shadow-xs cursor-pointer text-[9px] font-bold"
                        style={{
                          backgroundColor: p.buttonBg,
                          color: p.buttonText,
                          borderRadius: c.buttonRadius || cardBorderRadius,
                          fontFamily: typo.cssFont,
                        }}
                      >
                        <Plus className="w-2.5 h-2.5" />
                        <span>Add</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom Nav (Controlada exclusivamente por p.bgMenu para o fundo e p.iconColor para os ícones) */}
            <div
              data-testid="preview-bottom-menu"
              className="py-2.5 px-6 border-t flex items-center justify-around z-10"
              style={{
                backgroundColor: p.bgMenu,
                borderColor: p.border,
              }}
            >
              <div className="flex flex-col items-center gap-0.5">
                <Home
                  data-testid="preview-icon-nav-home"
                  className="w-3.5 h-3.5"
                  style={{ color: p.iconColor }}
                />
                <span
                  data-testid="preview-nav-label"
                  className="text-[9px] font-bold"
                  style={{ color: p.textSecondary, fontFamily: typo.cssFont }}
                >
                  Início
                </span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <Search
                  data-testid="preview-icon-nav-search"
                  className="w-3.5 h-3.5"
                  style={{ color: p.iconColor }}
                />
                <span
                  data-testid="preview-nav-label"
                  className="text-[9px]"
                  style={{ color: p.textSecondary, fontFamily: typo.cssFont }}
                >
                  Buscar
                </span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <ShoppingBag
                  data-testid="preview-icon-nav-bag"
                  className="w-3.5 h-3.5"
                  style={{ color: p.iconColor }}
                />
                <span
                  data-testid="preview-nav-label"
                  className="text-[9px]"
                  style={{ color: p.textSecondary, fontFamily: typo.cssFont }}
                >
                  Sacola
                </span>
              </div>
            </div>

            {/* iOS Home bar */}
            <div
              className="h-4 flex items-center justify-center pb-1"
              style={{ backgroundColor: p.bgMenu }}
            >
              <div className="w-24 h-1 bg-gray-300 rounded-full" />
            </div>
          </div>
        </div>
      ) : (
        /* Vista Desktop / Tablet */
        <div
          data-testid="preview-general-surface"
          className="w-full max-w-2xl rounded-2xl border overflow-hidden shadow-lg transition-colors duration-200"
          style={{
            ...cssVars,
            ...generalBgStyle,
            borderColor: p.border,
            fontFamily: typo.cssFont,
          }}
        >
          {/* Top Bar Desktop */}
          <div
            data-testid="preview-header"
            className="px-6 py-4 border-b flex items-center justify-between"
            style={{
              ...headerBgStyle,
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
                    color: '#ffffff',
                  }}
                >
                  {(theme.storeName || 'L').charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h3 data-testid="preview-store-title" style={titleTextStyle}>
                  {theme.storeName || 'Sua Loja Delivery'}
                </h3>
                <p style={secondaryTextStyle}>
                  {theme.tagline || 'Seu canal de compras direto e exclusivo.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              data-testid="preview-action-button"
              className="px-4 py-2 text-xs font-bold flex items-center gap-2 shadow-xs cursor-pointer"
              style={{
                backgroundColor: p.buttonBg,
                color: p.buttonText,
                borderRadius: c.buttonRadius || cardBorderRadius,
                fontFamily: typo.cssFont,
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
                  data-testid="preview-icon-search"
                  className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: p.iconColor }}
                />
                <div
                  data-testid="preview-search-bar"
                  className="w-full border pl-8 pr-3 py-1.5 text-xs shadow-2xs"
                  style={{
                    backgroundColor: '#ffffff',
                    borderColor: p.border,
                    color: p.textSecondary,
                    borderRadius: cardBorderRadius,
                    fontFamily: typo.cssFont,
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
                  data-testid="preview-product-card"
                  className="p-4 flex flex-col justify-between gap-3 transition-all"
                  style={{
                    ...cardBgStyle,
                    borderColor: p.border,
                    borderWidth: `${cardBorderWidth}px`,
                    borderStyle: cardBorderWidth > 0 ? 'solid' : 'none',
                    borderRadius: cardBorderRadius,
                    boxShadow: cardBoxShadow,
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
                      <h5 data-testid="preview-product-title" className="truncate" style={titleTextStyle}>
                        {prod.name}
                      </h5>
                      <p data-testid="preview-product-desc" className="line-clamp-2" style={bodyTextStyle}>
                        {prod.desc}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: p.border }}>
                    <div className="flex items-baseline gap-1.5">
                      {prod.hasPromo ? (
                        <span
                          data-testid="preview-promo-price"
                          className="font-extrabold text-sm"
                          style={{ color: p.promoPrice, fontFamily: typo.cssFont }}
                        >
                          {prod.promoPrice}
                        </span>
                      ) : (
                        <span
                          data-testid="preview-normal-price"
                          className="font-extrabold text-sm"
                          style={{ color: p.price, fontFamily: typo.cssFont }}
                        >
                          {prod.price}
                        </span>
                      )}
                      {prod.hasPromo && (
                        <span
                          data-testid="preview-strikethrough-price"
                          className="text-xs line-through"
                          style={secondaryTextStyle}
                        >
                          {prod.price}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      data-testid="preview-action-button"
                      className="px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer"
                      style={{
                        backgroundColor: p.buttonBg,
                        color: p.buttonText,
                        borderRadius: c.buttonRadius || cardBorderRadius,
                        fontFamily: typo.cssFont,
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

          {/* Bottom Nav Desktop */}
          <div
            data-testid="preview-bottom-menu"
            className="py-3 px-8 border-t flex items-center justify-around"
            style={{
              backgroundColor: p.bgMenu,
              borderColor: p.border,
            }}
          >
            <div className="flex items-center gap-1.5">
              <Home
                data-testid="preview-icon-nav-home"
                className="w-4 h-4"
                style={{ color: p.iconColor }}
              />
              <span className="text-xs font-bold" style={secondaryTextStyle}>
                Início
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Search
                data-testid="preview-icon-nav-search"
                className="w-4 h-4"
                style={{ color: p.iconColor }}
              />
              <span className="text-xs" style={secondaryTextStyle}>
                Buscar
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <ShoppingBag
                data-testid="preview-icon-nav-bag"
                className="w-4 h-4"
                style={{ color: p.iconColor }}
              />
              <span className="text-xs" style={secondaryTextStyle}>
                Sacola
              </span>
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
