// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../../../types';
import { DEFAULT_MENU_THEME } from '../../../lib/theme/menuTheme';
import { DEFAULT_TOTEM_WELCOME } from '../../../lib/menu/totemWelcome';

const h = vi.hoisted(() => ({
  loadStore: vi.fn(),
  loadWelcome: vi.fn(),
  loadHeader: vi.fn(),
  outdoor: vi.fn(),
  modules: vi.fn(),
  options: vi.fn(),
}));

vi.mock('../../../repositories/publicStoreRepository', () => ({
  publicStoreRepository: { loadPublicStore: (...args: unknown[]) => h.loadStore(...args) },
}));
vi.mock('../../../repositories/totemWelcomeRepository', () => ({
  totemWelcomeRepository: { loadPublic: (...args: unknown[]) => h.loadWelcome(...args) },
}));
vi.mock('../../../repositories/menuHeaderRepository', () => ({
  menuHeaderRepository: { loadPublic: (...args: unknown[]) => h.loadHeader(...args) },
}));
vi.mock('../../../repositories/menuOutdoorRepository', () => ({
  menuOutdoorRepository: { getPublicSlides: (...args: unknown[]) => h.outdoor(...args) },
}));
vi.mock('../../../repositories/tenantModuleRepository', () => ({
  tenantModuleRepository: { getPublicEnabled: (...args: unknown[]) => h.modules(...args) },
}));
vi.mock('../../../repositories/productOptionRepository', () => ({
  productOptionRepository: { getPublicForProducts: (...args: unknown[]) => h.options(...args) },
}));

import { TotemSalaoApp } from '../TotemSalaoApp';
import { resetTotemFullscreenSession } from '../../../lib/menu/fullscreen';


const products: Product[] = [
  { id: 'juice', tenantId: 'tn', categoryId: 'drinks', name: 'Suco da casa', description: 'Frutas', price: 12,
    imageUrl: 'https://example.com/suco.webp', isActive: true, isAvailable: true, stockQuantity: 0, unit: 'copo' },
];

function stubDisplayMode(standalone = false, fullscreen = false) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches:
        (standalone && query.includes('display-mode: standalone'))
        || (fullscreen && query.includes('display-mode: fullscreen')),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; },
    }),
  });
}

beforeEach(() => {
  resetTotemFullscreenSession();
  stubDisplayMode(false);
  try { sessionStorage.setItem('dc_totem_continue_browser_cafe-da-praca', '1'); } catch { /* ignore */ }
  h.loadStore.mockReset(); h.loadWelcome.mockReset(); h.loadHeader.mockReset();
  h.outdoor.mockReset(); h.modules.mockReset(); h.options.mockReset();
  h.modules.mockResolvedValue(new Set());
  h.options.mockResolvedValue(new Map());
  h.loadHeader.mockResolvedValue({ coverUrl: null, categoryMenuMode: 'ICON' });
  h.outdoor.mockResolvedValue([]);
  h.loadWelcome.mockResolvedValue({
    ...DEFAULT_TOTEM_WELCOME,
    slides: [{ url: 'https://cdn.example/promo.jpg', kind: 'IMAGE' }],
    idleSeconds: 30,
    buttonText: 'Toque para começar',
  });
  h.loadStore.mockResolvedValue({
    status: 'ok',
    data: {
      tenant: { id: 'tn', name: 'Café da Praça' },
      theme: { storeName: 'Café da Praça' },
      menuTheme: DEFAULT_MENU_THEME,
      menuOptions: { totemMode: true, serviceMode: 'BOTH', productColumns: 3, reuseAppBanners: false, idleSeconds: 60, homeLabel: 'Início' },
      categories: [{ id: 'drinks', tenantId: 'tn', name: 'Bebidas', isActive: true, order: 0 }],
      products,
      offers: [],
    },
  });
});
afterEach(cleanup);

async function startMenu() {
  render(<TotemSalaoApp slug="cafe-da-praca" />);
  await screen.findByTestId('totem-capa');
  fireEvent.click(screen.getByTestId('totem-capa-cta'));
  return screen.findByTestId('dinein-premium-kiosk');
}

describe('TotemSalaoApp', () => {
  it('opens the welcome capa first and enters the cardápio without the app nav', async () => {
    const menu = await startMenu();
    expect(menu.getAttribute('data-variant')).toBe('totem');
    expect(screen.queryByTestId('totem-capa')).toBeNull();
    expect(screen.queryByTestId('kiosk-nav-home')).toBeNull();
    expect(screen.queryByTestId('kiosk-nav-cart')).toBeNull();
    expect(screen.queryByTestId('kiosk-nav-table')).toBeNull();
    expect(screen.queryByTestId('kiosk-nav-account')).toBeNull();
    expect(screen.queryByTestId('kiosk-header')).toBeNull();
    expect(menu.getAttribute('data-order')).toBe('false');
    expect(screen.getByTestId('totem-order-panel').getAttribute('data-visible')).toBe('false');
    expect(h.loadStore).toHaveBeenCalledWith('cafe-da-praca');
    expect(h.loadWelcome).toHaveBeenCalledWith('cafe-da-praca');
  });

  it('adds items on the order panel and returns to the capa after idle, clearing the cart', async () => {
    vi.useFakeTimers();
    try {
      render(<TotemSalaoApp slug="cafe-da-praca" />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByTestId('totem-capa')).toBeTruthy();
      fireEvent.click(screen.getByTestId('totem-capa-cta'));
      expect(screen.getByTestId('dinein-premium-kiosk')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Adicionar Suco da casa' }));
      expect(screen.getByTestId('dinein-premium-kiosk').getAttribute('data-order')).toBe('true');
      expect(screen.getByTestId('totem-order-panel').getAttribute('data-visible')).toBe('true');
      expect(screen.getByTestId('totem-order-subtotal').textContent).toMatch(/12/);
      act(() => { vi.advanceTimersByTime(30000); });
      expect(screen.getByText('Ainda está aí?')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(10000); });
      expect(screen.getByTestId('totem-capa')).toBeTruthy();
      fireEvent.click(screen.getByTestId('totem-capa-cta'));
      expect(screen.getByTestId('dinein-premium-kiosk').getAttribute('data-order')).toBe('false');
      expect(screen.getByTestId('totem-order-panel').getAttribute('data-visible')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not return to the capa while checkout review is open', async () => {
    vi.useFakeTimers();
    try {
      render(<TotemSalaoApp slug="cafe-da-praca" />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      fireEvent.click(screen.getByTestId('totem-capa-cta'));
      fireEvent.click(screen.getByRole('button', { name: 'Adicionar Suco da casa' }));
      fireEvent.click(screen.getByTestId('totem-order-checkout'));
      expect(screen.getByTestId('totem-checkout-review')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(120000); });
      expect(screen.getByTestId('totem-checkout-review')).toBeTruthy();
      expect(screen.queryByText('Ainda está aí?')).toBeNull();
      expect(screen.queryByTestId('totem-capa')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it('requests fullscreen only once on the capa CTA in a browser tab', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request });
    render(<TotemSalaoApp slug="cafe-da-praca" />);
    await screen.findByTestId('totem-capa');
    fireEvent.click(screen.getByTestId('totem-capa-cta'));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('touchstart'));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not request fullscreen when the totem already runs as an installed PWA', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request });
    stubDisplayMode(true);
    render(<TotemSalaoApp slug="cafe-da-praca" />);
    await screen.findByTestId('totem-capa');
    fireEvent.click(screen.getByTestId('totem-capa-cta'));
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByTestId('dinein-premium-kiosk')).toBeTruthy();
  });
});
