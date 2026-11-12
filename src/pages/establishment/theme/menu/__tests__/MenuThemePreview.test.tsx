// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const capture = vi.hoisted(() => ({ props: null as Record<string, any> | null }));
vi.mock('../../../../../components/client/totem/DineInPremiumMenu', () => ({ DineInPremiumMenu: (props: Record<string, any>) => { capture.props = props; return <div>{props.storeName}</div>; } }));
import { MenuThemePreview } from '../MenuThemePreview';
import { DEFAULT_MENU_THEME } from '../../../../../lib/theme/menuTheme';
afterEach(cleanup);
it('uses the real customer menu contract and updates cover, category images and columns without publishing', () => {
  const base = { theme: { ...DEFAULT_MENU_THEME }, storeName: 'Loja real', categories: [{ id: 'wine', tenantId: 'tenant-real', name: 'Vinhos', order: 0, isActive: true, imageUrl: 'https://example.com/wine.png' }], products: [{ id: 'bottle', categoryId: 'wine', name: 'Vinho real', price: 20 }], device: 'phone' as const };
  const view = render(<MenuThemePreview {...base} />);
  const frame = view.getByTitle('Prévia real do cardápio') as HTMLIFrameElement;
  frame.contentDocument!.body.innerHTML = '<div id="menu-preview-root"></div>';
  fireEvent.load(frame);
  expect(capture.props?.preview).toBe(true);
  expect(capture.props?.products[0]).toMatchObject({ id: 'bottle', categoryId: 'wine', price: 20 });
  expect(capture.props?.categories[0].imageUrl).toBe('https://example.com/wine.png');
  view.rerender(<MenuThemePreview {...base} device="tablet" header={{ coverUrl: 'https://example.com/cover.png', categoryMenuMode: 'IMAGE' }} productColumns={3} />);
  expect(frame.style.width).toBe('1024px');
  expect(capture.props).toMatchObject({ coverUrl: 'https://example.com/cover.png', categoryMenuMode: 'IMAGE', productColumns: 3 });
  expect(capture.props?.onAddProduct(base.products[0])).toBeUndefined();
});
