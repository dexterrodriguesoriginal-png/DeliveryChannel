import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Category, Product } from '../../../../types';
import type { MenuTheme } from '../../../../types/menuTheme';
import type { MenuHeaderSettings } from '../../../../lib/menu/menuHeader';
import { DEFAULT_MENU_HEADER } from '../../../../lib/menu/menuHeader';
import { resolveFontFamilyCss } from '../../../../lib/theme/themeEngine';
import type { ThemedProductItem } from '../../../../components/storefront/ThemedProductList';
import { DineInPremiumMenu } from '../../../../components/client/totem/DineInPremiumMenu';

interface Props {
  theme: MenuTheme;
  storeName: string;
  storeLogoUrl?: string;
  storeTagline?: string;
  products: ThemedProductItem[];
  categories: Category[];
  device: 'phone' | 'tablet';
  header?: MenuHeaderSettings;
  productColumns?: 1 | 2 | 3;
}
const noop = () => {};
const priceNumber = (value: string | number) => typeof value === 'number' ? value : Number(value.replace(/[^\d,]/g, '').replace(',', '.')) || 0;

/** The customer menu itself, inside an isolated viewport. Drafts never invoke order callbacks. */
export function MenuThemePreview({ theme, storeName, storeLogoUrl, storeTagline, products, categories, device, header = DEFAULT_MENU_HEADER, productColumns = 2 }: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [frameDocument, setFrameDocument] = useState<Document | null>(null);
  const [width, setWidth] = useState(340);
  const logicalWidth = device === 'phone' ? 390 : 1024;
  const logicalHeight = device === 'phone' ? 844 : 768;
  const scale = Math.min(1, width / logicalWidth);
  useLayoutEffect(() => {
    const measure = () => { if (wrapper.current?.clientWidth) setWidth(wrapper.current.clientWidth); };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (wrapper.current) observer?.observe(wrapper.current);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => {
    if (!frameDocument) return;
    // Vite dev styles and production stylesheet links are copied; CSS stays scoped to the frame.
    const syncStyles = () => {
      frameDocument.head.querySelectorAll('[data-preview-style]').forEach(node => node.remove());
      document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => {
        const clone = node.cloneNode(true) as HTMLElement;
        clone.setAttribute('data-preview-style', '');
        frameDocument.head.appendChild(clone);
      });
    };
    syncStyles();
    const observer = new MutationObserver(syncStyles);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [frameDocument]);
  const tenantId = 'design-preview';
  const previewCategories: Category[] = categories.length ? categories.map(category => ({ ...category, tenantId })) : [{ id: 'preview-category', tenantId, name: 'Destaques', order: 0, isActive: true }];
  const previewProducts: Product[] = products.map(item => ({
    ...item,
    description: item.description || '', imageUrl: item.imageUrl || '',
    tenantId, categoryId: (item as Partial<Product>).categoryId || previewCategories[0].id,
    price: priceNumber(item.price), promotionalPrice: item.promotionalPrice ? priceNumber(item.promotionalPrice) : undefined,
    isActive: true, isAvailable: item.isAvailable !== false, stockQuantity: item.stockQuantity ?? 99, unit: item.unit || 'un',
  }));
  return <div ref={wrapper} className={`menu-design-device menu-design-device-${device}`}>
    <div data-testid="menu-design-preview" data-device={device} data-layout={theme.layout}
      style={{ background: theme.background, fontFamily: resolveFontFamilyCss(theme.fontFamily), '--menu-preview-radius': `${theme.radius}px`, height: logicalHeight * scale, overflow: 'hidden' } as React.CSSProperties}>
      <iframe ref={frame} title="Prévia real do cardápio" srcDoc={'<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="menu-preview-root"></div></body></html>'}
        onLoad={() => setFrameDocument(frame.current?.contentDocument || null)}
        style={{ width: logicalWidth, height: logicalHeight, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
      {frameDocument?.getElementById('menu-preview-root') && createPortal(
        <DineInPremiumMenu preview tenantId={tenantId} storeName={storeName} storeLogoUrl={storeLogoUrl} storeTagline={storeTagline} tableLabel="Mesa · Prévia" categories={previewCategories} products={previewProducts}
          menuTheme={theme} coverUrl={header.coverUrl} categoryMenuMode={header.categoryMenuMode} productColumns={productColumns}
          cartCount={0} orderingDisabled={false} onGoHome={noop} onOpenCart={noop} onOpenTable={noop} onOpenExpenses={noop} onAddProduct={noop} onOpenProduct={noop} />,
        frameDocument.getElementById('menu-preview-root')!)}
    </div>
  </div>;
}
