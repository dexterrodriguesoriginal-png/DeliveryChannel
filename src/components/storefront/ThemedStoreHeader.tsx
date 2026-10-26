/**
 * ThemedStoreHeader — Componente de cabeçalho de vitrine compartilhado
 * Renderiza a identidade visual da loja respeitando rigorosamente tokens.layout.headerStyle:
 * - 'classic': banner superior com logo na esquerda e dados alinhados
 * - 'centered-logo': logo centralizada, nome e bio alinhados ao centro
 * - 'banner-overlay': banner expandido com gradiente de overlay e informações sobrepostas
 * - 'compact': barra horizontal reduzida e ágil
 */

import React from 'react';
import { ThemeTokens } from '../../types/theme';
import { Clock, Store } from 'lucide-react';

export interface ThemedStoreHeaderProps {
  storeName: string;
  tagline?: string;
  logoUrl?: string;
  bannerUrl?: string;
  statusText?: string;
  isOpen?: boolean;
  tokens: ThemeTokens;
  rightAction?: React.ReactNode;
  onSearchClick?: () => void;
}

export const ThemedStoreHeader: React.FC<ThemedStoreHeaderProps> = ({
  storeName,
  tagline,
  logoUrl,
  bannerUrl,
  statusText = 'Preparo: 30 min • Entrega Grátis',
  isOpen = true,
  tokens,
  rightAction,
}) => {
  const p = tokens.palette;
  const layout = tokens.layout || {
    productLayout: 'grid-2',
    photoSize: 'medium',
    photoRatio: 'square',
    headerStyle: 'classic',
    categoryStyle: 'pill',
    density: 'standard',
  };

  const headerStyle = layout.headerStyle || 'classic';

  const containerStyle: React.CSSProperties = {
    backgroundColor: 'var(--dc-bg-header-color, #ffffff)',
    backgroundImage: 'var(--dc-bg-header, none)',
    borderColor: 'var(--dc-border, #e2e8f0)',
  };

  const storeTitleStyle: React.CSSProperties = {
    color: 'var(--dc-text-title, #0f172a)',
    fontFamily: 'var(--dc-heading-font-family, var(--dc-font-family, sans-serif))',
    fontWeight: 'var(--dc-title-weight, 700)',
    letterSpacing: 'var(--dc-letter-spacing, normal)',
  };

  const secondaryTextStyle: React.CSSProperties = {
    color: 'var(--dc-text-secondary, #64748b)',
    fontFamily: 'var(--dc-font-family, sans-serif)',
  };

  // 1. Centered Logo Style
  if (headerStyle === 'centered-logo') {
    return (
      <header
        data-testid="preview-header"
        className="w-full border-b shadow-xs py-4 px-4 flex flex-col items-center text-center space-y-2 select-none"
        style={containerStyle}
      >
        <div className="relative">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={storeName}
              className="w-14 h-14 rounded-2xl object-cover shadow-sm border border-black/10"
            />
          ) : (
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-sm"
              style={{ backgroundColor: 'var(--dc-primary, #15803d)' }}
            >
              <Store className="w-7 h-7" />
            </div>
          )}
          {isOpen && (
            <span
              className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white"
              title="Aberto para pedidos"
            />
          )}
        </div>

        <div className="space-y-0.5">
          <h1
            data-testid="preview-store-title"
            className="text-base font-extrabold truncate"
            style={storeTitleStyle}
          >
            {storeName}
          </h1>
          {tagline && (
            <p className="text-xs line-clamp-1 opacity-90" style={secondaryTextStyle}>
              {tagline}
            </p>
          )}
          <p
            data-testid="preview-text-secondary"
            className="text-[11px] flex items-center justify-center gap-1 pt-0.5"
            style={secondaryTextStyle}
          >
            <Clock
              data-testid="preview-icon-clock"
              className="w-3 h-3"
              style={{ color: 'var(--dc-icon-color, #64748b)' }}
            />
            <span>{statusText}</span>
          </p>
        </div>

        {rightAction && (
          <div data-testid="preview-action-button" className="pt-1">
            {rightAction}
          </div>
        )}
      </header>
    );
  }

  // 2. Banner Overlay Style
  if (headerStyle === 'banner-overlay' && bannerUrl) {
    return (
      <header
        data-testid="preview-header"
        className="w-full relative shadow-xs overflow-hidden border-b select-none"
        style={containerStyle}
      >
        <div className="relative w-full h-36 sm:h-44">
          <img src={bannerUrl} alt={storeName} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/10 flex flex-col justify-end p-4 text-white">
            <div className="flex items-end justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={storeName}
                    className="w-12 h-12 rounded-xl object-cover border-2 border-white shadow-md shrink-0"
                  />
                ) : null}
                <div className="min-w-0">
                  <h1
                    data-testid="preview-store-title"
                    className="text-lg font-black truncate drop-shadow-sm text-white"
                  >
                    {storeName}
                  </h1>
                  {tagline && <p className="text-xs text-white/90 truncate">{tagline}</p>}
                  <p
                    data-testid="preview-text-secondary"
                    className="text-[11px] text-white/80 flex items-center gap-1 pt-0.5"
                  >
                    <Clock
                      data-testid="preview-icon-clock"
                      className="w-3 h-3 text-white/80"
                    />
                    <span>{statusText}</span>
                  </p>
                </div>
              </div>

              {rightAction && (
                <div data-testid="preview-action-button" className="shrink-0">
                  {rightAction}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
    );
  }

  // 3. Compact Style
  if (headerStyle === 'compact') {
    return (
      <header
        data-testid="preview-header"
        className="w-full border-b shadow-2xs px-3 py-2 flex items-center justify-between gap-2 select-none"
        style={containerStyle}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={storeName}
              className="w-8 h-8 rounded-lg object-cover border border-black/10 shrink-0"
            />
          ) : (
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
              style={{ backgroundColor: 'var(--dc-primary, #15803d)' }}
            >
              <Store className="w-4 h-4" />
            </div>
          )}
          <div className="min-w-0">
            <h1
              data-testid="preview-store-title"
              className="text-xs font-black truncate leading-tight flex items-center gap-1.5"
              style={storeTitleStyle}
            >
              <span>{storeName}</span>
              {isOpen && <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block shrink-0" />}
            </h1>
            <p
              data-testid="preview-text-secondary"
              className="text-[10px] truncate"
              style={secondaryTextStyle}
            >
              {statusText}
            </p>
          </div>
        </div>

        {rightAction && (
          <div data-testid="preview-action-button" className="shrink-0">
            {rightAction}
          </div>
        )}
      </header>
    );
  }

  // 4. Classic Style (Padrão Oficial)
  return (
    <header
      data-testid="preview-header"
      className="w-full border-b shadow-xs px-4 py-3 flex items-center justify-between gap-3 select-none"
      style={containerStyle}
    >
      <div className="flex items-center gap-3 min-w-0">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={storeName}
            className="w-10 h-10 rounded-xl object-cover border border-black/10 shrink-0 shadow-2xs"
          />
        ) : (
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 shadow-2xs"
            style={{ backgroundColor: 'var(--dc-primary, #15803d)' }}
          >
            <Store className="w-5 h-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1
            data-testid="preview-store-title"
            className="text-sm font-extrabold truncate flex items-center gap-1.5"
            style={storeTitleStyle}
          >
            <span>{storeName}</span>
            {isOpen && (
              <span
                className="w-2 h-2 rounded-full bg-emerald-500 inline-block shrink-0"
                title="Aberto para pedidos"
              />
            )}
          </h1>
          <p
            data-testid="preview-text-secondary"
            className="text-[11px] truncate flex items-center gap-1"
            style={secondaryTextStyle}
          >
            <Clock
              data-testid="preview-icon-clock"
              className="w-3 h-3"
              style={{ color: 'var(--dc-icon-color, #64748b)' }}
            />
            <span>{statusText}</span>
          </p>
        </div>
      </div>

      {rightAction && (
        <div data-testid="preview-action-button" className="shrink-0">
          {rightAction}
        </div>
      )}
    </header>
  );
};
