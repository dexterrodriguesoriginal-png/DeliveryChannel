/**
 * ThemedProductList — Componente de vitrine compartilhado
 * Renderiza produtos respeitando rigorosamente a configuração de layout dos tokens:
 * - productLayout: 'grid-2' | 'grid-3' | 'list' | 'list-large-photo' | 'featured-first'
 * - photoSize: 'small' | 'medium' | 'large'
 * - photoRatio: 'square' | 'landscape' | 'portrait'
 * - density: 'compact' | 'standard' | 'airy'
 *
 * Utilizado de forma idêntica tanto no ClientApp (vitrine real do consumidor)
 * quanto no LiveStorePreview (emulador de prévia do estabelecimento).
 */

import React from 'react';
import { computeTypographyStyles, getSurfaceBackgroundStyle, resolveCardBorderRadius, resolveCardBorderWidth, computeCardBoxShadow } from '../../lib/theme/themeEngine';
import { ThemeTokens } from '../../types/theme';
import { ShoppingBag, Plus, Minus, Star, Flame } from 'lucide-react';

export interface ThemedProductItem {
  id: string;
  name: string;
  description?: string;
  price: number | string;
  promotionalPrice?: number | string | null;
  imageUrl?: string;
  unit?: string;
  isAvailable?: boolean;
  stockQuantity?: number;
  rating?: string;
  tag?: string;
}

export interface ThemedProductListProps {
  products: ThemedProductItem[];
  tokens: ThemeTokens;
  cartQtyOf?: (productId: string) => number;
  onSelectProduct?: (product: ThemedProductItem) => void;
  onAddToCart?: (product: ThemedProductItem) => void;
  onRemoveFromCart?: (product: ThemedProductItem) => void;
  highlightedProductId?: string | null;
  emptyMessage?: string;
  emptySubtitle?: string;
  isEmulatorPreview?: boolean;
}

function formatDisplayPrice(price: number | string): string {
  if (typeof price === 'string') return price;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price);
}

export const ThemedProductList: React.FC<ThemedProductListProps> = ({
  products,
  tokens,
  cartQtyOf,
  onSelectProduct,
  onAddToCart,
  onRemoveFromCart,
  highlightedProductId,
  emptyMessage = 'Nenhum produto encontrado',
  emptySubtitle = 'Tente selecionar outra categoria ou buscar por outro termo.',
  isEmulatorPreview = false,
}) => {
  const p = tokens.palette;
  const typo = computeTypographyStyles(tokens.typography);
  const c = tokens.components;
  const layout = tokens.layout || {
    productLayout: 'grid-2',
    photoSize: 'medium',
    photoRatio: 'square',
    headerStyle: 'classic',
    categoryStyle: 'pill',
    density: 'standard',
  };

  if (products.length === 0) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-gray-200 text-gray-400 space-y-1">
        <p className="font-bold text-gray-600">{emptyMessage}</p>
        <p className="text-xs">{emptySubtitle}</p>
      </div>
    );
  }

  // Configuração de Densidade (Padding, Gap e Tipografia)
  const densityStyles = {
    compact: { cardPad: 'p-2.5', gap: 'gap-2', titleSize: 'text-xs', bodySize: 'text-[11px]', priceSize: 'text-xs' },
    standard: { cardPad: 'p-3.5', gap: 'gap-3', titleSize: 'text-sm', bodySize: 'text-xs', priceSize: 'text-sm' },
    airy: { cardPad: 'p-4 sm:p-5', gap: 'gap-4', titleSize: 'text-base', bodySize: 'text-sm', priceSize: 'text-base' },
  }[layout.density || 'standard'];

  // Proporção de Foto
  const photoRatioClass = {
    square: 'aspect-square',
    landscape: 'aspect-[16/10]',
    portrait: 'aspect-[3/4]',
  }[layout.photoRatio || 'square'];

  // Estilo Base do Cartão derivado dos tokens
  const cardStyle: React.CSSProperties = {
    ...getSurfaceBackgroundStyle(tokens.backgrounds.card, p.bgCard),
    borderRadius: resolveCardBorderRadius(c), boxShadow: computeCardBoxShadow(c),
    borderWidth: resolveCardBorderWidth(c), borderStyle: 'solid', borderColor: p.border,
  };
  const titleStyle: React.CSSProperties = {
    color: p.textTitle, fontFamily: 'var(--dc-heading-font-family, sans-serif)', fontWeight: typo.titleWeight,
    textTransform: typo.titleTextTransform, fontStyle: typo.titleFontStyle,
    letterSpacing: typo.letterSpacing, lineHeight: typo.lineHeight,
  };
  const bodyStyle: React.CSSProperties = {
    color: p.textMain, fontFamily: typo.cssFont, fontWeight: typo.bodyWeight,
    textTransform: 'none', fontStyle: 'normal', lineHeight: typo.lineHeight,
    ...(isEmulatorPreview ? { fontSize: `${Math.round(10 * typo.scaleFactor)}px` } : {}),
  };

  // Renderiza um card individual
  const renderCard = (prod: ThemedProductItem, isFeaturedHero = false, isGridCard = false) => {
    const isOutOfStock =
      prod.isAvailable !== undefined ? !prod.isAvailable : (prod.stockQuantity ?? 1) <= 0;
    const qty = cartQtyOf ? cartQtyOf(prod.id) : 0;
    const hasPromo = prod.promotionalPrice !== undefined && prod.promotionalPrice !== null && prod.promotionalPrice !== '' && prod.promotionalPrice !== 0;

    const isHighlighted = highlightedProductId === prod.id;

    // Se for grid card ou featured hero, o layout é vertical (foto no topo)
    const isVerticalLayout =
      isGridCard ||
      isFeaturedHero ||
      layout.productLayout === 'grid-2' ||
      layout.productLayout === 'grid-3';

    if (isVerticalLayout) {
      return (
        <div
          key={prod.id}
          id={isEmulatorPreview ? undefined : `product-${prod.id}`}
          data-testid="preview-product-card"
          data-product-id={prod.id}
          onClick={() => onSelectProduct?.(prod)}
          className={`flex flex-col justify-between transition-all cursor-pointer group ${densityStyles.cardPad} ${
            isHighlighted ? 'ring-2 ring-emerald-500 bg-emerald-50/40 shadow-md' : ''
          } ${isOutOfStock ? 'opacity-70' : ''}`}
          style={cardStyle}
        >
          {/* Imagem do Produto no Topo */}
          <div className="relative w-full overflow-hidden rounded-xl bg-gray-100 mb-2">
            {prod.imageUrl ? (
              <img
                src={prod.imageUrl}
                alt={prod.name}
                className={`w-full ${photoRatioClass} object-cover group-hover:scale-105 transition-transform duration-300`}
              />
            ) : (
              <div className={`w-full ${photoRatioClass} flex items-center justify-center text-gray-300`}>
                <ShoppingBag className="w-8 h-8" />
              </div>
            )}

            {prod.tag && (
              <span
                data-testid="preview-accent-badge"
                className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider text-white shadow-xs"
                style={{ backgroundColor: 'var(--dc-accent, #22c55e)' }}
              >
                {prod.tag}
              </span>
            )}

            {prod.rating && (
              <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-xs text-white text-[10px] font-bold flex items-center gap-1">
                <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                {prod.rating}
              </span>
            )}
          </div>

          {/* Dados do Produto */}
          <div className="space-y-1 min-w-0 flex-1">
            <h3
              data-testid="preview-product-title"
              className={`font-bold ${densityStyles.titleSize} leading-snug line-clamp-2`}
              style={titleStyle}
            >
              {prod.name}
            </h3>

            {prod.description && (
              <p
                data-testid="preview-product-desc"
                className={`line-clamp-2 ${densityStyles.bodySize}`}
                style={bodyStyle}
              >
                {prod.description}
              </p>
            )}
          </div>

          {/* Preços e Ações */}
          <div className={`flex items-center justify-between pt-2 mt-auto gap-2 ${isEmulatorPreview ? 'flex-wrap' : ''}`}>
            <div className="flex items-baseline gap-1.5 flex-wrap">
              {hasPromo ? (
                <>
                  <span
                    data-testid="preview-promo-price"
                    className={`font-black font-mono ${densityStyles.priceSize}`}
                    style={{ color: p.promoPrice }}
                  >
                    {formatDisplayPrice(prod.promotionalPrice!)}
                  </span>
                  <span
                    data-testid="preview-strikethrough-price"
                    className="text-[10px] text-gray-400 line-through font-mono"
                  >
                    {formatDisplayPrice(prod.price)}
                  </span>
                </>
              ) : (
                <span
                  data-testid="preview-normal-price"
                  className={`font-black font-mono ${densityStyles.priceSize}`}
                  style={{ color: p.price }}
                >
                  {formatDisplayPrice(prod.price)}
                </span>
              )}
              {prod.unit && (
                <span className="text-[10px] text-gray-400 font-mono uppercase">/{prod.unit}</span>
              )}
            </div>

            {/* Botão de Adição / Quantidade */}
            {isOutOfStock ? (
              <span className="text-[10px] font-bold text-gray-400 uppercase py-1">Esgotado</span>
            ) : qty > 0 && onRemoveFromCart ? (
              <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 shadow-2xs">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFromCart(prod);
                  }}
                  className="w-6 h-6 rounded-lg bg-white flex items-center justify-center text-gray-700 hover:bg-gray-200 cursor-pointer shadow-xs"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="text-xs font-black font-mono px-1">{qty}</span>
                <button
                  type="button"
                  data-testid="preview-action-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToCart?.(prod);
                  }}
                  className="w-6 h-6 rounded-lg text-white flex items-center justify-center cursor-pointer shadow-xs"
                  style={{ backgroundColor: p.buttonBg, color: p.buttonText }}
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="preview-action-button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToCart?.(prod);
                }}
                className={`${isEmulatorPreview ? 'px-2 h-7 gap-1 text-[10px] font-bold' : 'w-7 h-7 sm:w-8 sm:h-8'} rounded-full flex items-center justify-center text-white cursor-pointer shadow-xs active:scale-95 transition-transform`}
                style={{
                  backgroundColor: p.buttonBg, color: p.buttonText,
                  borderRadius: c.buttonRadius || 'var(--dc-card-radius, 1rem)',
                }}
              >
                <Plus className="w-4 h-4" />{isEmulatorPreview ? <span>Adicionar</span> : <span className="sr-only">Adicionar {prod.name}</span>}
              </button>
            )}
          </div>
        </div>
      );
    }

    // Layout Horizontal em Lista (Modo 'list' ou 'list-large-photo')
    const isLargePhoto = layout.productLayout === 'list-large-photo';
    const photoSizeClass = isLargePhoto
      ? 'w-24 h-24 sm:w-28 sm:h-28'
      : layout.photoSize === 'small'
      ? 'w-16 h-16'
      : layout.photoSize === 'large'
      ? 'w-24 h-24'
      : 'w-20 h-20 sm:w-24 sm:h-24';

    return (
      <div
        key={prod.id}
        id={isEmulatorPreview ? undefined : `product-${prod.id}`}
        data-testid="preview-product-card"
        data-product-id={prod.id}
        onClick={() => onSelectProduct?.(prod)}
        className={`flex items-center justify-between gap-3 transition-all cursor-pointer group ${densityStyles.cardPad} ${
          isHighlighted ? 'ring-2 ring-emerald-500 bg-emerald-50/40 shadow-md' : ''
        } ${isOutOfStock ? 'opacity-70' : ''}`}
        style={cardStyle}
      >
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3
              data-testid="preview-product-title"
              className={`font-bold ${densityStyles.titleSize} leading-snug truncate`}
              style={titleStyle}
            >
              {prod.name}
            </h3>
            {prod.tag && (
              <span
                data-testid="preview-accent-badge"
                className="px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase text-white shrink-0"
                style={{ backgroundColor: 'var(--dc-accent, #22c55e)' }}
              >
                {prod.tag}
              </span>
            )}
          </div>

          {prod.description && (
            <p
              data-testid="preview-product-desc"
              className={`line-clamp-2 ${densityStyles.bodySize}`}
              style={bodyStyle}
            >
              {prod.description}
            </p>
          )}

          <div className="flex items-baseline gap-2 pt-1">
            {hasPromo ? (
              <>
                <span
                  data-testid="preview-promo-price"
                  className={`font-black font-mono ${densityStyles.priceSize}`}
                  style={{ color: p.promoPrice }}
                >
                  {formatDisplayPrice(prod.promotionalPrice!)}
                </span>
                <span
                  data-testid="preview-strikethrough-price"
                  className="text-xs text-gray-400 line-through font-mono"
                >
                  {formatDisplayPrice(prod.price)}
                </span>
              </>
            ) : (
              <span
                data-testid="preview-normal-price"
                className={`font-black font-mono ${densityStyles.priceSize}`}
                style={{ color: p.price }}
              >
                {formatDisplayPrice(prod.price)}
              </span>
            )}
            {prod.unit && (
              <span className="text-[10px] text-gray-400 font-mono uppercase">/{prod.unit}</span>
            )}
          </div>
        </div>

        {/* Foto lateral e botão */}
        <div className="relative shrink-0 flex flex-col items-center gap-2">
          {prod.imageUrl ? (
            <img
              src={prod.imageUrl}
              alt={prod.name}
              className={`${photoSizeClass} ${photoRatioClass} rounded-xl object-cover border border-gray-100 group-hover:scale-105 transition-transform`}
            />
          ) : (
            <div className={`${photoSizeClass} ${photoRatioClass} rounded-xl bg-gray-100 flex items-center justify-center text-gray-300`}>
              <ShoppingBag className="w-6 h-6" />
            </div>
          )}

          {isOutOfStock ? (
            <span className="text-[10px] font-bold text-gray-400 uppercase py-1">Indisponível</span>
          ) : qty > 0 && onRemoveFromCart ? (
            <div className="flex items-center gap-1.5 bg-gray-100 rounded-xl p-1 shadow-2xs">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFromCart(prod);
                }}
                className="w-6 h-6 rounded-lg bg-white flex items-center justify-center text-gray-700 hover:bg-gray-200 cursor-pointer shadow-xs"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-xs font-black font-mono px-1">{qty}</span>
              <button
                type="button"
                data-testid="preview-action-button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToCart?.(prod);
                }}
                className="w-6 h-6 rounded-lg text-white flex items-center justify-center cursor-pointer shadow-xs"
                style={{ backgroundColor: p.buttonBg, color: p.buttonText }}
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-testid="preview-action-button"
              onClick={(e) => {
                e.stopPropagation();
                onAddToCart?.(prod);
              }}
              className="px-2.5 py-1 text-xs font-bold text-white rounded-lg flex items-center gap-1 shadow-2xs cursor-pointer active:scale-95 transition-transform"
              style={{
                backgroundColor: p.buttonBg, color: p.buttonText,
                borderRadius: c.buttonRadius || 'var(--dc-card-radius, 1rem)',
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Adicionar</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  // 1. Featured-first: Primeiro produto em destaque panorâmico, demais em grid
  if (layout.productLayout === 'featured-first' && products.length > 1) {
    const [first, ...rest] = products;
    return (
      <div className="space-y-3">
        {/* Card Destaque Panorâmico */}
        <div className="relative">
          {renderCard(first, true, true)}
        </div>
        {/* Demais produtos em Grid */}
        <div className="grid grid-cols-2 gap-3">
          {rest.map((p) => renderCard(p, false, true))}
        </div>
      </div>
    );
  }

  // 2. Grid de 3 colunas
  if (layout.productLayout === 'grid-3') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {products.map((p) => renderCard(p, false, true))}
      </div>
    );
  }

  // 3. Grid de 2 colunas
  if (layout.productLayout === 'grid-2') {
    return (
      <div className="grid grid-cols-2 gap-3">
        {products.map((p) => renderCard(p, false, true))}
      </div>
    );
  }

  // 4. Lista horizontal padrão
  return (
    <div className={`space-y-3 ${densityStyles.gap}`}>
      {products.map((p) => renderCard(p, false, false))}
    </div>
  );
};
