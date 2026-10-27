import React, { useMemo, useState } from 'react';
import { Home, Search, ShoppingBag, Smartphone, Monitor } from 'lucide-react';
import { TenantTheme } from '../../../types';
import {
  themeToTokens,
  generateCssVariables,
  getSurfaceBackgroundStyle,
} from '../../../lib/theme/themeEngine';
import { ThemedStoreHeader } from '../../storefront/ThemedStoreHeader';
import { ThemedProductList, ThemedProductItem } from '../../storefront/ThemedProductList';
import { sampleProducts } from '../../../lib/theme/previewProducts';
import { PhonePreview } from '../../common/PhonePreview';

export interface LiveStorePreviewProps {
  theme: TenantTheme;
  storeSlug?: string;
  isOpen?: boolean;
  defaultMode?: 'mobile' | 'desktop';
  products?: ThemedProductItem[];
  segmentId?: string;
  compact?: boolean;
  /** Ocupa toda a altura do pai (coluna fixa do editor): o celular inteiro cabe sem cortar. */
  fill?: boolean;
  maxProducts?: number;
}

/** Shared storefront rendering, isolated to the preview's own CSS variables. */
export function StorefrontPreview({
  theme,
  products,
  segmentId,
  isOpen = true,
  maxProducts = 4,
}: LiveStorePreviewProps) {
  const tokens = useMemo(() => themeToTokens(theme), [theme]);
  const p = tokens.palette;
  const items = useMemo(
    () => (products?.length ? products : sampleProducts(segmentId)).slice(0, maxProducts),
    [products, segmentId, maxProducts]
  );
  const [category, setCategory] = useState('Todos');
  const layout = tokens.layout;
  return (
    <div
      data-testid="preview-general-surface"
      className="min-w-0"
      style={
        {
          ...generateCssVariables(tokens),
          ...getSurfaceBackgroundStyle(tokens.backgrounds.general, p.bgGeneral),
          color: p.textMain,
          fontFamily: 'var(--dc-font-family)',
        } as React.CSSProperties
      }
    >
      <ThemedStoreHeader
        tokens={tokens}
        storeName={theme.storeName || 'Sua loja'}
        tagline={theme.tagline}
        logoUrl={theme.logoUrl}
        bannerUrl={theme.bannerUrl}
        isOpen={isOpen}
        statusText={isOpen ? 'Aberto para pedidos · 30–45 min' : 'Fechado no momento'}
      />
      <div className="space-y-3 p-3">
        <div
          data-testid="preview-search-bar"
          className="flex items-center gap-2 rounded-xl border bg-white p-2.5 text-xs"
          style={{ backgroundColor: '#ffffff', borderColor: p.border, color: p.textSecondary }}
        >
          <Search data-testid="preview-icon-search" size={14} style={{ color: p.iconColor }} />{' '}
          Buscar na loja
        </div>
        <div
          data-testid="preview-promo-banner"
          className="rounded-xl p-3"
          style={{ backgroundColor: p.primary, color: p.buttonText }}
        >
          <span className="text-[10px] font-bold uppercase tracking-widest">Feito para você</span>
          <p className="mt-1 text-sm font-bold">{theme.tagline || 'Seus favoritos estão aqui.'}</p>
          <span
            className="mt-2 inline-block rounded-full px-2 py-1 text-[10px]"
            style={{ backgroundColor: p.secondary }}
          >
            Peça direto na nossa loja
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {['Todos', 'Destaques', 'Novidades'].map((label) => (
            <button
              key={label}
              data-testid="preview-category-btn"
              type="button"
              onClick={() => setCategory(label)}
              aria-pressed={category === label}
              className="px-3 py-1.5 text-[11px]"
              style={{
                backgroundColor: p.categoryBg,
                color: p.textTitle,
                border: `1px solid ${p.border}`,
                borderRadius:
                  layout?.categoryStyle === 'tabs-underline'
                    ? 0
                    : layout?.categoryStyle === 'pill'
                      ? 999
                      : 8,
                borderBottom: category === label ? `2px solid ${p.iconColor}` : undefined,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <ThemedProductList
          products={category === 'Destaques' ? items.slice(0, 2) : items}
          tokens={tokens}
          isEmulatorPreview
        />
      </div>
      <div
        data-testid="preview-bottom-menu"
        className="flex items-center justify-around border-t py-3"
        style={{ backgroundColor: p.bgMenu, borderColor: p.border }}
      >
        {[
          [Home, 'Início', 'home'],
          [Search, 'Buscar', 'search'],
          [ShoppingBag, 'Sacola', 'bag'],
        ].map(([Icon, label, key]) => {
          const Glyph = Icon as typeof Home;
          return (
            <div key={String(key)} className="flex flex-col items-center gap-1">
              <Glyph
                size={16}
                data-testid={`preview-icon-nav-${key}`}
                style={{ color: p.iconColor }}
              />
              <span
                data-testid="preview-nav-label"
                className="text-[10px]"
                style={{ color: p.textSecondary }}
              >
                {String(label)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const LiveStorePreview: React.FC<LiveStorePreviewProps> = ({
  defaultMode = 'mobile',
  compact,
  fill,
  ...props
}) => {
  const [mode, setMode] = useState(defaultMode);
  return (
    <div data-testid="live-store-preview" className={`w-full min-w-0 ${fill ? 'flex h-full min-h-0 flex-col' : ''}`}>
      {!compact && (
        <div className="mb-2 flex flex-none flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span className="font-semibold">Sua loja, ao vivo</span>
          <div className="flex gap-1">
            {(['mobile', 'desktop'] as const).map((value) => (
              <button
                type="button"
                key={value}
                data-testid={`preview-mode-${value}`}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={`rounded-lg p-2 ${mode === value ? 'bg-white text-emerald-800 shadow-sm' : ''}`}
              >
                {value === 'mobile' ? (
                  <Smartphone size={15} aria-label="Celular" />
                ) : (
                  <Monitor size={15} aria-label="Computador" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      {props.storeSlug ? (
        // Réplica idêntica: o app real do cliente com o tema em rascunho (ADENDO 1).
        <div className={fill ? 'relative min-h-0 flex-1' : ''}>
          <PhonePreview theme={props.theme} storeSlug={props.storeSlug} mode={mode} fill={fill} reservedHeight={compact ? 330 : 260} />
        </div>
      ) : (
      <div className={`theme-phone mx-auto ${mode === 'desktop' ? 'theme-phone-desktop' : ''}`}>
        <div className="theme-phone-camera" aria-hidden="true" />
        <div className="theme-phone-screen">
          <StorefrontPreview {...props} maxProducts={2} />
        </div>
      </div>
      )}
    </div>
  );
};
