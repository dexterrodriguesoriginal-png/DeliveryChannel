import { ScaledPreview } from '../../../../components/common/ScaledPreview';
import { useEffect, useRef, useState } from 'react';
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
/** Parses "19.90", "19,90", "R$ 1.234,56" and "1,234.56" into a number. */
export const priceNumber = (value: string | number): number => {
  if (typeof value === 'number') return value;
  const cleaned = value.replace(/[^\d.,]/g, '');
  const decimalAt = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  if (decimalAt < 0) return Number(cleaned) || 0;
  const fraction = cleaned.slice(decimalAt + 1);
  const integer = cleaned.slice(0, decimalAt).replace(/[.,]/g, '');
  // Prices have at most 2 decimals: a trailing group of 3 digits ("1.234") is a thousands separator.
  if (fraction.length === 3) return Number(integer + fraction) || 0;
  return Number(`${integer || '0'}.${fraction}`) || 0;
};

/** The customer menu itself, inside an isolated viewport. Drafts never invoke order callbacks. */
export function MenuThemePreview({ theme, storeName, storeLogoUrl, storeTagline, products, categories, device, header = DEFAULT_MENU_HEADER, productColumns = 2 }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [frameDocument, setFrameDocument] = useState<Document | null>(null);
  const logicalWidth = device === 'phone' ? 390 : 1024;
  const logicalHeight = device === 'phone' ? 844 : 768;
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
  return <ScaledPreview width={logicalWidth + 16} height={logicalHeight + 16}><div style={{ width: logicalWidth + 16, height: logicalHeight + 16, maxWidth: 'none', borderWidth: 8 }} className={`menu-design-device menu-design-device-${device}`}>
    <div data-testid="menu-design-preview" data-device={device} data-layout={theme.layout}
      style={{ background: theme.background, fontFamily: resolveFontFamilyCss(theme.fontFamily), '--menu-preview-radius': `${theme.radius}px`, height: logicalHeight, overflow: 'hidden' } as React.CSSProperties}>
      <iframe ref={frame} title="Prévia real do cardápio" srcDoc={'<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="menu-preview-root"></div></body></html>'}
        onLoad={() => setFrameDocument(frame.current?.contentDocument || null)}
        style={{ width: logicalWidth, height: logicalHeight, border: 0, transformOrigin: 'top left' }} />
      {frameDocument?.getElementById('menu-preview-root') && createPortal(
        <DineInPremiumMenu preview tenantId={tenantId} storeName={storeName} storeLogoUrl={storeLogoUrl} storeTagline={storeTagline} tableLabel="Mesa · Prévia" categories={previewCategories} products={previewProducts}
          menuTheme={theme} coverUrl={header.coverUrl} categoryMenuMode={header.categoryMenuMode} productColumns={productColumns}
          cartCount={0} orderingDisabled={false} onGoHome={noop} onOpenCart={noop} onOpenTable={noop} onOpenExpenses={noop} onAddProduct={noop} onOpenProduct={noop} />,
        frameDocument.getElementById('menu-preview-root')!)}
    </div>
  </div></ScaledPreview>;
}
