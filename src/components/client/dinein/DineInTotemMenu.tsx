import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Category, Product } from '../../../types';
import type { MenuTheme } from '../../../types/menuTheme';
import { normalizeMenuTheme } from '../../../lib/theme/menuTheme';
import { resolveFontFamilyCss } from '../../../lib/theme/themeEngine';
import { menuOutdoorRepository, type PublicMenuOutdoorSlide } from '../../../repositories/menuOutdoorRepository';
import TotemMenuView from '../totem/TotemMenuView';
import './dineInTotemMenu.css';

export interface DineInTotemMenuProps {
  /** The authority-resolved QR store slug, never the decorative URL slug. */
  storeSlug: string;
  storeTenantId?: string;
  storeName: string;
  logoUrl?: string | null;
  /** Loaded once by the table app and shared with cart hydration and options. */
  categories: Category[];
  products: Product[];
  menuTheme?: MenuTheme;
  cartCount: number;
  productColumns?: 1 | 2 | 3;
  orderingDisabled: boolean;
  busy?: boolean;
  onAddProduct(product: Product): void;
  onOpenProduct(product: Product): void;
  onOpenCart(): void;
  /** Omitido no modo totem: sem navegação de volta do navegador. */
  onBack?(): void;
}

const UNCATEGORIZED_ID = '__dinein_uncategorized';

function presentationCatalog(categories: Category[], products: Product[], tenantId?: string) {
  // Public RPCs already enforce tenant scope; keep malformed/stale mixed catalog
  // entries from crossing stores in the presentation adapter as well.
  const ownTenant = (row: { tenantId?: string }) => !tenantId || !row.tenantId || row.tenantId === tenantId;
  const activeCategories = categories.filter(category => ownTenant(category) && category.isActive !== false);
  const categoryIds = new Set(activeCategories.map(category => category.id));
  const originals = new Map<string, Product>();
  const visibleProducts: Product[] = [];
  let needsFallback = false;
  for (const product of products) {
    if (!ownTenant(product) || product.isActive === false || product.isAvailable === false) continue;
    // A product explicitly assigned to an absent/inactive category must stay
    // hidden. Only genuinely uncategorized legacy catalog entries get a group.
    if (product.categoryId && !categoryIds.has(product.categoryId)) continue;
    originals.set(product.id, product);
    if (!product.categoryId) {
      needsFallback = true;
      visibleProducts.push({ ...product, categoryId: UNCATEGORIZED_ID });
    } else visibleProducts.push(product);
  }
  return {
    categories: needsFallback ? [...activeCategories, {
      id: UNCATEGORIZED_ID, tenantId: tenantId || '', name: 'Destaques',
      isActive: true, order: activeCategories.length ? Math.max(...activeCategories.map(category => category.order || 0)) + 1 : 0,
    }] : activeCategories,
    products: visibleProducts,
    originals,
  };
}

type OutdoorState = { slug: string; slides: PublicMenuOutdoorSlide[]; failed: boolean };

/** Connects public catalog/design/outdoor to the existing table cart callbacks. */
export function DineInTotemMenu({
  storeSlug, storeTenantId, storeName, logoUrl, categories, products, menuTheme,
  cartCount, productColumns = 3, orderingDisabled, busy = false, onAddProduct, onOpenProduct, onOpenCart, onBack,
}: DineInTotemMenuProps) {
  const [outdoor, setOutdoor] = useState<OutdoorState>({ slug: '', slides: [], failed: false });
  const [retry, setRetry] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const catalog = useMemo(() => presentationCatalog(categories, products, storeTenantId), [categories, products, storeTenantId]);
  const theme = useMemo(() => {
    const normalized = normalizeMenuTheme(menuTheme);
    return { ...normalized, fontFamily: resolveFontFamilyCss(normalized.fontFamily) };
  }, [menuTheme]);

  useEffect(() => {
    let current = true;
    setOutdoor({ slug: storeSlug, slides: [], failed: false });
    if (!storeSlug) return () => { current = false; };
    menuOutdoorRepository.getPublicSlides(storeSlug).then(slides => {
      if (current) setOutdoor({ slug: storeSlug, slides, failed: false });
    }).catch(() => {
      if (current) setOutdoor({ slug: storeSlug, slides: [], failed: true });
    });
    return () => { current = false; };
  }, [storeSlug, retry]);

  useLayoutEffect(() => {
    // The separately maintained presenter's public contract has no disabled
    // prop. Synchronize native button semantics in this adapter, preserving
    // navigation and cart controls and guarding callbacks below as well.
    rootRef.current?.querySelectorAll<HTMLButtonElement>('button[data-testid^="add-product-"]').forEach(button => {
      button.disabled = orderingDisabled || busy;
      button.setAttribute('aria-disabled', String(orderingDisabled || busy));
    });
  }, [catalog.products, orderingDisabled, busy, storeSlug]);

  // Account polling and cart updates must not restart the presenter's carousel.
  const outdoorSlides = useMemo(() => outdoor.slug === storeSlug ? outdoor.slides.map(slide => ({
    id: slide.id, imageUrl: slide.imageUrl, videoUrl: slide.videoUrl, youtubeId: slide.youtubeId, title: slide.title,
    imageDurationSeconds: slide.imageDurationSeconds,
    productId: slide.productId && catalog.originals.has(slide.productId) ? slide.productId : undefined,
  })) : [], [outdoor, storeSlug, catalog.originals]);
  const selectProduct = (candidate: Product, callback: (product: Product) => void) => {
    const product = catalog.originals.get(candidate.id);
    if (!orderingDisabled && !busy && product) callback(product);
  };

  return <div ref={rootRef} className="dinein-totem-menu" data-testid="dinein-totem-menu" data-layout={theme.layout}
    data-ordering-disabled={orderingDisabled || busy} style={{ '--dinein-category-active-text': theme.accentText } as React.CSSProperties}
    onKeyDownCapture={event => {
      const target = event.target as HTMLElement;
      // The outdoor's focusable role=button is part of the presenter contract;
      // provide its native-equivalent keyboard activation at the integration seam.
      if ((event.key === 'Enter' || event.key === ' ') && target.matches('[data-testid="outdoor-active-slide"][role="button"]')) {
        event.preventDefault();
        if (!event.repeat) target.click();
      }
    }}>
    {outdoor.slug === storeSlug && outdoor.failed && <div className="dinein-totem-outdoor-notice" aria-label="Destaques indisponíveis" role="status">
      <span>Os destaques estão indisponíveis. Você pode continuar escolhendo no cardápio.</span>
      <button type="button" onClick={() => setRetry(value => value + 1)}>Tentar carregar destaques novamente</button>
    </div>}
    {orderingDisabled && <p className="dinein-totem-ordering-notice" role="status">Pedidos indisponíveis no momento. Você pode continuar consultando o cardápio e sua sacola.</p>}
    <TotemMenuView key={storeSlug} storeName={storeName} logoUrl={logoUrl || undefined}
      categories={catalog.categories} products={catalog.products} outdoorSlides={outdoorSlides}
      theme={theme} cartCount={cartCount} productColumns={productColumns} onAddProduct={product => selectProduct(product, onAddProduct)}
      onOpenProduct={product => selectProduct(product, onOpenProduct)} onOpenCart={onOpenCart} onBack={onBack} />
  </div>;
}
