import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, ShoppingBag, Plus, Utensils, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Category, Product } from '../../../types';
import './totemMenu.css';

export interface TotemTheme {
  background: string;
  surface: string;
  text: string;
  accent: string;
  accentText: string;
  categoryActiveBg: string;
  fontFamily?: string;
  radius: number;
}

export interface TotemOutdoorSlide {
  id: string;
  imageUrl?: string;
  videoUrl?: string;
  title?: string;
  productId?: string;
}

export interface TotemMenuViewProps {
  storeName: string;
  logoUrl?: string;
  categories: Category[];
  products: Product[];
  outdoorSlides: TotemOutdoorSlide[];
  theme: TotemTheme;
  cartCount: number;
  onAddProduct(product: Product): void;
  onOpenProduct?(product: Product): void;
  onOpenCart(): void;
  onBack?(): void;
}

export const DEFAULT_TOTEM_THEME: TotemTheme = {
  background: '#0f172a',
  surface: '#1e293b',
  text: '#f8fafc',
  accent: '#10b981',
  accentText: '#0f172a',
  categoryActiveBg: '#334155',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  radius: 16,
};

function formatBRL(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const parts = rounded.toFixed(2).split('.');
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${integerPart},${parts[1]}`;
}

const ProductImage: React.FC<{ imageUrl?: string; name: string }> = ({ imageUrl, name }) => {
  const [error, setError] = useState(false);

  if (!imageUrl || error) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center p-4 text-center totem-placeholder-shimmer select-none"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          color: 'var(--totem-text)',
        }}
        data-testid="product-image-placeholder"
      >
        <Utensils className="w-12 h-12 opacity-30 mb-2" aria-hidden="true" />
        <span className="text-xs font-semibold opacity-40 uppercase tracking-wider line-clamp-1">
          {name}
        </span>
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={name}
      onError={() => setError(true)}
      className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
      loading="lazy"
    />
  );
};

export default function TotemMenuView({
  storeName,
  logoUrl,
  categories,
  products,
  outdoorSlides,
  theme = DEFAULT_TOTEM_THEME,
  cartCount,
  onAddProduct,
  onOpenProduct,
  onOpenCart,
  onBack,
}: TotemMenuViewProps): React.JSX.Element {
  // Only active & available products
  const availableProducts = useMemo(() => {
    return products.filter(p => p.isActive !== false && p.isAvailable !== false);
  }, [products]);

  // Group products by categoryId
  const productsByCat = useMemo(() => {
    const map: Record<string, Product[]> = {};
    for (const p of availableProducts) {
      if (!map[p.categoryId]) map[p.categoryId] = [];
      map[p.categoryId].push(p);
    }
    return map;
  }, [availableProducts]);

  // Only active categories that have available products, sorted by order
  const visibleCategories = useMemo(() => {
    return categories
      .filter(cat => cat.isActive !== false && (productsByCat[cat.id]?.length ?? 0) > 0)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [categories, productsByCat]);

  const [activeCategoryId, setActiveCategoryId] = useState<string>('');
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  const productsScrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // Synchronize initial active category
  useEffect(() => {
    if (visibleCategories.length > 0) {
      if (!activeCategoryId || !visibleCategories.some(c => c.id === activeCategoryId)) {
        setActiveCategoryId(visibleCategories[0].id);
      }
    } else {
      setActiveCategoryId('');
    }
  }, [visibleCategories, activeCategoryId]);

  // Rotate outdoor slides
  useEffect(() => {
    if (!outdoorSlides || outdoorSlides.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentSlideIndex(prev => (prev + 1) % outdoorSlides.length);
    }, 5500);
    return () => clearInterval(timer);
  }, [outdoorSlides]);

  const handleSelectCategory = (catId: string) => {
    setActiveCategoryId(catId);
    const targetSection = sectionRefs.current[catId];
    if (targetSection && typeof targetSection.scrollIntoView === 'function') {
      targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleScroll = () => {
    if (!productsScrollRef.current) return;
    const containerTop = productsScrollRef.current.getBoundingClientRect().top;
    let currentId = visibleCategories[0]?.id || '';

    for (const cat of visibleCategories) {
      const el = sectionRefs.current[cat.id];
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top - containerTop <= 140) {
          currentId = cat.id;
        }
      }
    }

    if (currentId && currentId !== activeCategoryId) {
      setActiveCategoryId(currentId);
    }
  };

  const handleSlideClick = (slide: TotemOutdoorSlide) => {
    if (slide.productId && onOpenProduct) {
      const matched = products.find(p => p.id === slide.productId);
      if (matched) {
        onOpenProduct(matched);
      }
    }
  };

  const activeSlide = outdoorSlides && outdoorSlides.length > 0
    ? outdoorSlides[currentSlideIndex % outdoorSlides.length]
    : null;

  return (
    <div
      className="totem-menu-container flex flex-col h-screen w-full overflow-hidden select-none"
      style={{
        backgroundColor: 'var(--totem-bg)',
        color: 'var(--totem-text)',
        fontFamily: theme.fontFamily || DEFAULT_TOTEM_THEME.fontFamily,
        ['--totem-bg' as string]: theme.background,
        ['--totem-surface' as string]: theme.surface,
        ['--totem-text' as string]: theme.text,
        ['--totem-accent' as string]: theme.accent,
        ['--totem-accent-text' as string]: theme.accentText,
        ['--totem-cat-active-bg' as string]: theme.categoryActiveBg,
        ['--totem-radius' as string]: `${theme.radius ?? 16}px`,
      } as React.CSSProperties}
      data-testid="totem-menu-view"
    >
      {/* Top Header */}
      <header
        className="w-full flex items-center justify-between px-3 sm:px-6 py-3 shrink-0 border-b border-white/10 z-20"
        style={{ backgroundColor: 'var(--totem-surface)' }}
      >
        <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Voltar"
              data-testid="totem-back-button"
              className="p-2 sm:px-3.5 sm:py-2 rounded-xl flex items-center gap-1.5 font-bold text-xs sm:text-sm border border-white/10 bg-white/5 hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
              <span className="hidden sm:inline">Voltar</span>
            </button>
          )}

          {logoUrl && (
            <img
              src={logoUrl}
              alt={storeName}
              className="w-8 h-8 sm:w-11 sm:h-11 rounded-xl object-cover shadow-sm shrink-0"
            />
          )}

          <h1 className="text-sm sm:text-xl font-black tracking-tight truncate">
            {storeName}
          </h1>
        </div>
      </header>

      {/* Outdoor Banner Area (Hide if no slides) */}
      {outdoorSlides && outdoorSlides.length > 0 && activeSlide && (
        <section
          data-testid="totem-outdoor-area"
          aria-label="Destaques"
          className="relative w-full h-36 sm:h-48 md:h-56 lg:h-64 shrink-0 overflow-hidden border-b border-white/10 bg-black/40"
        >
          <div
            className={`w-full h-full relative cursor-pointer ${activeSlide.productId ? 'cursor-pointer' : ''}`}
            onClick={() => handleSlideClick(activeSlide)}
            data-testid="outdoor-active-slide"
            role={activeSlide.productId ? 'button' : undefined}
            tabIndex={activeSlide.productId ? 0 : undefined}
            aria-label={activeSlide.title || 'Slide de destaque'}
          >
            {activeSlide.videoUrl ? (
              <video
                src={activeSlide.videoUrl}
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            ) : activeSlide.imageUrl ? (
              <img
                src={activeSlide.imageUrl}
                alt={activeSlide.title || 'Destaque'}
                className="w-full h-full object-cover totem-slide-fade"
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center p-6 text-center"
                style={{ backgroundColor: 'var(--totem-surface)' }}
              >
                <Utensils className="w-12 h-12 opacity-20" aria-hidden="true" />
              </div>
            )}

            {/* Gradient shadow overlay for legibility */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex items-end p-4 sm:p-6">
              {activeSlide.title && (
                <h2 className="text-white text-base sm:text-2xl md:text-3xl font-black drop-shadow-md tracking-tight">
                  {activeSlide.title}
                </h2>
              )}
            </div>
          </div>

          {/* Slide Navigation Dots if multiple slides */}
          {outdoorSlides.length > 1 && (
            <div className="absolute bottom-2.5 right-4 z-10 flex items-center gap-1.5 bg-black/50 backdrop-blur-md px-2.5 py-1 rounded-full">
              <button
                type="button"
                aria-label="Slide anterior"
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentSlideIndex(prev => (prev - 1 + outdoorSlides.length) % outdoorSlides.length);
                }}
                className="p-0.5 text-white/70 hover:text-white"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              {outdoorSlides.map((slide, idx) => (
                <button
                  key={slide.id}
                  type="button"
                  aria-label={`Slide ${idx + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentSlideIndex(idx);
                  }}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === currentSlideIndex % outdoorSlides.length
                      ? 'w-4 bg-white'
                      : 'w-1.5 bg-white/40'
                  }`}
                />
              ))}
              <button
                type="button"
                aria-label="Próximo slide"
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentSlideIndex(prev => (prev + 1) % outdoorSlides.length);
                }}
                className="p-0.5 text-white/70 hover:text-white"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </section>
      )}

      {/* Main Body: Left Categories Column & Right Products Grid */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* Left Column: Categories */}
        <aside
          data-testid="totem-categories-sidebar"
          aria-label="Categorias"
          className="w-20 sm:w-28 md:w-36 lg:w-44 shrink-0 flex flex-col border-r border-white/10 overflow-y-auto totem-hide-scrollbar"
          style={{ backgroundColor: 'var(--totem-surface)' }}
        >
          {visibleCategories.map(cat => {
            const isActive = cat.id === activeCategoryId;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid={`category-btn-${cat.id}`}
                onClick={() => handleSelectCategory(cat.id)}
                className="w-full min-h-[68px] sm:min-h-[80px] p-2 sm:p-3 flex flex-col items-center justify-center text-center gap-1.5 transition-all relative cursor-pointer border-b border-white/5"
                style={{
                  backgroundColor: isActive ? theme.categoryActiveBg : 'transparent',
                  color: 'var(--totem-text)',
                }}
              >
                {isActive && (
                  <span
                    className="absolute left-0 top-0 bottom-0 w-1 sm:w-1.5"
                    style={{ backgroundColor: 'var(--totem-accent)' }}
                    aria-hidden="true"
                  />
                )}

                {cat.imageUrl ? (
                  <img
                    src={cat.imageUrl}
                    alt=""
                    className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg object-cover"
                    aria-hidden="true"
                  />
                ) : (
                  <Utensils className="w-5 h-5 sm:w-6 sm:h-6 opacity-60" aria-hidden="true" />
                )}

                <span className="text-[11px] sm:text-xs md:text-sm font-bold leading-tight line-clamp-2">
                  {cat.name}
                </span>
              </button>
            );
          })}
        </aside>

        {/* Right Column: Products Grid */}
        <main
          ref={productsScrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-3 sm:p-5 md:p-6 totem-scroll-area space-y-8 pb-32"
          tabIndex={0}
          aria-label="Cardápio"
        >
          {visibleCategories.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center opacity-60 p-6">
              <Utensils className="w-12 h-12 mb-3 opacity-30" />
              <p className="font-bold text-base">Nenhum item disponível no momento</p>
            </div>
          ) : (
            visibleCategories.map(cat => {
              const catProducts = productsByCat[cat.id] || [];
              return (
                <section
                  key={cat.id}
                  id={`category-section-${cat.id}`}
                  ref={el => { sectionRefs.current[cat.id] = el; }}
                  className="scroll-mt-4"
                  aria-labelledby={`cat-title-${cat.id}`}
                  data-testid={`category-section-${cat.id}`}
                >
                  <div className="mb-3 sm:mb-4 pb-2 border-b border-white/10 flex items-baseline gap-2">
                    <h2
                      id={`cat-title-${cat.id}`}
                      className="text-lg sm:text-2xl font-black tracking-tight"
                    >
                      {cat.name}
                    </h2>
                    <span className="text-xs opacity-50 font-bold">
                      ({catProducts.length} {catProducts.length === 1 ? 'item' : 'itens'})
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4 md:gap-5">
                    {catProducts.map(product => {
                      const hasPromo = typeof product.promotionalPrice === 'number' &&
                        product.promotionalPrice > 0 &&
                        product.promotionalPrice < product.price;

                      return (
                        <div
                          key={product.id}
                          data-testid={`product-card-${product.id}`}
                          className="totem-product-card flex flex-col overflow-hidden border border-white/10 shadow-lg cursor-pointer transition-all"
                          style={{
                            backgroundColor: 'var(--totem-surface)',
                            color: 'var(--totem-text)',
                            borderRadius: 'var(--totem-radius)',
                          }}
                          onClick={() => onOpenProduct?.(product)}
                        >
                          {/* Large Product Photo */}
                          <div className="relative w-full aspect-[4/3] bg-black/20 overflow-hidden">
                            <ProductImage imageUrl={product.imageUrl} name={product.name} />
                            {hasPromo && (
                              <span
                                className="absolute top-2.5 right-2.5 px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-black uppercase rounded-lg shadow-md tracking-wider"
                                style={{
                                  backgroundColor: 'var(--totem-accent)',
                                  color: 'var(--totem-accent-text)',
                                }}
                                data-testid="promo-badge"
                              >
                                Oferta
                              </span>
                            )}
                          </div>

                          {/* Card Content */}
                          <div className="flex flex-col flex-1 p-3.5 sm:p-4 justify-between gap-3">
                            <div>
                              <h3 className="font-bold text-base sm:text-lg leading-snug line-clamp-2">
                                {product.name}
                              </h3>
                              {product.description && (
                                <p className="mt-1 text-xs sm:text-sm opacity-70 line-clamp-2 leading-relaxed">
                                  {product.description}
                                </p>
                              )}
                            </div>

                            <div className="pt-2 border-t border-white/5 flex flex-col gap-3">
                              {/* Price Display */}
                              <div className="flex items-baseline gap-2 flex-wrap min-h-[1.75rem]">
                                {hasPromo ? (
                                  <>
                                    <span
                                      className="text-base sm:text-xl font-extrabold"
                                      style={{ color: 'var(--totem-accent)' }}
                                    >
                                      {formatBRL(product.promotionalPrice!)}
                                    </span>
                                    <del className="text-xs sm:text-sm line-through opacity-50 font-medium">
                                      {formatBRL(product.price)}
                                    </del>
                                  </>
                                ) : (
                                  <span className="text-base sm:text-xl font-extrabold">
                                    {formatBRL(product.price)}
                                  </span>
                                )}
                              </div>

                              {/* Action Button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAddProduct(product);
                                }}
                                aria-label={`Adicionar ${product.name}`}
                                data-testid={`add-product-${product.id}`}
                                className="w-full flex items-center justify-center gap-2 py-2.5 sm:py-3 px-3 font-bold text-xs sm:text-sm tracking-wide rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
                                style={{
                                  backgroundColor: 'var(--totem-accent)',
                                  color: 'var(--totem-accent-text)',
                                  borderRadius: 'calc(var(--totem-radius) * 0.75)',
                                }}
                              >
                                <Plus className="w-4 h-4 stroke-[2.5]" aria-hidden="true" />
                                <span>Adicionar</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </main>
      </div>

      {/* Fixed Cart Button */}
      <button
        type="button"
        onClick={onOpenCart}
        aria-label={`Ver sacola com ${cartCount} itens`}
        data-testid="totem-cart-button"
        className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-40 flex items-center gap-2.5 sm:gap-3 px-4 py-3 sm:px-5 sm:py-4 rounded-full shadow-2xl transition-all active:scale-95 cursor-pointer font-extrabold text-sm sm:text-base border border-white/20"
        style={{
          backgroundColor: 'var(--totem-accent)',
          color: 'var(--totem-accent-text)',
        }}
      >
        <div className="relative">
          <ShoppingBag className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.2]" aria-hidden="true" />
        </div>
        <span>Ver sacola</span>
        <span
          data-testid="totem-cart-badge"
          className="min-w-[22px] h-[22px] px-1.5 flex items-center justify-center text-xs font-black rounded-full shadow"
          style={{
            backgroundColor: 'var(--totem-bg)',
            color: 'var(--totem-text)',
          }}
        >
          {cartCount}
        </span>
      </button>
    </div>
  );
}
