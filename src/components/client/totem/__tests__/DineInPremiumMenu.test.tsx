// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Category, Product } from '../../../../types';
import { DEFAULT_MENU_THEME, MENU_TEMPLATES } from '../../../../lib/theme/menuTheme';
import { DineInPremiumMenu } from '../DineInPremiumMenu';
import { DineInPremiumMenuAdapter } from '../DineInPremiumMenuAdapter';
import { DineInExpenses } from '../DineInExpenses';
import type { ExpenseTab } from '../../../../lib/menu/premiumTotem.model';

const tenantId = 'store-1';
const categories: Category[] = [
  { id: 'beer', tenantId, name: 'Cervejas', order: 1, isActive: true },
  { id: 'wine', tenantId, name: 'Vinhos', order: 2, isActive: true },
];
const products: Product[] = [
  { id: 'a', tenantId, categoryId: 'beer', name: 'Cerveja A', description: 'Gelada', price: 10,
    imageUrl: 'https://example.com/a.png', isActive: true, isAvailable: true, stockQuantity: 5, unit: 'un' },
  { id: 'b', tenantId, categoryId: 'wine', name: 'Vinho B', description: 'Seco', price: 50,
    imageUrl: 'https://example.com/b.png', isActive: true, isAvailable: true, stockQuantity: 4, unit: 'un' },
];
const tab = (status: ExpenseTab['status'] = 'OPEN'): ExpenseTab => ({
  status, subtotal: 10, serviceFeePercent: 10, serviceFeeRemoved: false,
  me: { role: 'RESPONSIBLE', approved: true },
  rounds: [{ orderId: 'r1', mine: true, status: 'DELIVERED', subtotal: 10,
    items: [{ name: 'Cerveja A', quantity: 1, unitPrice: 10, totalPrice: 10 }] }],
});
function menuProps(): React.ComponentProps<typeof DineInPremiumMenu> {
  return {
    tenantId, storeName: 'Loja', tableLabel: 'Mesa 04', categories, products,
    menuTheme: DEFAULT_MENU_THEME, cartCount: 3, orderingDisabled: false,
    onGoHome: vi.fn(), onOpenCart: vi.fn(), onOpenTable: vi.fn(), onOpenExpenses: vi.fn(),
    onAddProduct: vi.fn(), onOpenProduct: vi.fn(),
  };
}
function adapterProps(): React.ComponentProps<typeof DineInPremiumMenuAdapter> {
  return {
    ...menuProps(), location: 'TABLE', verifiedSessionId: 'session-1',
    tabSessionId: 'session-1', sessionAuthorized: true, tab: tab(),
    onRequestBill: vi.fn(async () => {}), onCallWaiter: vi.fn(async () => {}),
    onReopenBill: vi.fn(async () => {}), onRefreshExpenses: vi.fn(async () => {}),
  };
}
afterEach(cleanup);

describe('totem premium touch menu', () => {
  it('uses ONLY store theme tokens for buttons, category, prices and footer', () => {
    for (const templateId of ['oceano', 'horta', 'noturno']) {
      const theme = MENU_TEMPLATES.find(item => item.id === templateId)!.theme;
      const view = render(<DineInPremiumMenu {...menuProps()} menuTheme={theme} />);
      const root = screen.getByTestId('dinein-premium-kiosk') as HTMLElement;
      expect(root.style.getPropertyValue('--dc-kiosk-accent')).toBe(theme.accent);
      expect(root.style.getPropertyValue('--dc-kiosk-accent-text')).toBe(theme.accentText);
      expect(root.style.getPropertyValue('--dc-kiosk-category-active')).toBe(theme.categoryActiveBg);
      expect(root.style.getPropertyValue('--dc-kiosk-text')).toBe(theme.text);
      expect(root.style.getPropertyValue('--dc-kiosk-surface')).toBe(theme.surface);
      expect(screen.getByTestId('kiosk-nav-account')).toBeTruthy();
      view.unmount();
    }
  });

  it('places uploaded category photo and name SIDE BY SIDE, and falls back to only name', () => {
    const withPhoto = {...categories[0], imageUrl: 'https://example.com/beer.webp'};
    const p = menuProps();
    const view = render(<DineInPremiumMenu {...p} categories={[withPhoto, categories[1]]} />);
    const beer = screen.getByRole('button', {name: /Cervejas/});
    expect(beer.querySelector('img')?.getAttribute('src')).toBe(withPhoto.imageUrl);
    expect(beer.querySelector('.dc-kiosk-category-label')?.textContent).toBe('Cervejas');
    const wine = screen.getByRole('button', {name: /Vinhos/});
    expect(wine.querySelector('img')).toBeNull();
    expect(wine.querySelector('.dc-kiosk-category-label')?.textContent).toBe('Vinhos');
    view.unmount();
  });

  it('keeps the number of cards per row under owner configuration', () => {
    const p = menuProps();
    const view = render(<DineInPremiumMenu {...p} productColumns={2} />);
    expect((screen.getByTestId('kiosk-products-grid') as HTMLElement).style.gridTemplateColumns)
      .toContain('repeat(2');
    view.unmount();
  });

  it('moves waiter, bill, expenses, account into the hamburger and triggers original callbacks', () => {
    const p = menuProps();
    const onOpenBill = vi.fn(), onCallWaiter = vi.fn(), onOpenAccount = vi.fn();
    const view = render(<DineInPremiumMenu {...p} onOpenBill={onOpenBill}
      onCallWaiter={onCallWaiter} onOpenAccount={onOpenAccount} />);
    fireEvent.click(screen.getByTestId('kiosk-hamburger'));
    expect(screen.getByRole('navigation', {name: 'Ações do cardápio'})).toBeTruthy();
    fireEvent.click(screen.getByTestId('kiosk-action-waiter'));
    expect(onCallWaiter).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId('kiosk-hamburger'));
    fireEvent.click(screen.getByTestId('kiosk-action-bill'));
    expect(onOpenBill).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId('kiosk-nav-account'));
    expect(onOpenAccount).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('blocks forbidden waiter/bill actions when no authorized session', () => {
    const onOpenBill = vi.fn(), onCallWaiter = vi.fn();
    const view = render(<DineInPremiumMenu {...menuProps()}
      canCallWaiter={false} canRequestBill={false}
      onOpenBill={onOpenBill} onCallWaiter={onCallWaiter} />);
    fireEvent.click(screen.getByTestId('kiosk-hamburger'));
    const bill = screen.getByTestId('kiosk-action-bill') as HTMLButtonElement;
    const waiter = screen.getByTestId('kiosk-action-waiter') as HTMLButtonElement;
    expect(bill.disabled).toBe(true);
    expect(waiter.disabled).toBe(true);
    fireEvent.click(bill);
    fireEvent.click(waiter);
    expect(onOpenBill).not.toHaveBeenCalled();
    expect(onCallWaiter).not.toHaveBeenCalled();
    view.unmount();
  });

  it('shows shop/table, selected products and required bottom navigation', () => {
    render(<DineInPremiumMenu {...menuProps()} />);
    expect(screen.getByRole('heading', { name: 'Loja' })).toBeTruthy();
    expect(screen.getByText('Cerveja A')).toBeTruthy();
    expect(screen.getByTestId('kiosk-nav-account').textContent).toContain('Minha conta');
    expect(screen.getByTestId('kiosk-hamburger')).toBeTruthy();
    expect(screen.queryByTestId('kiosk-nav-expenses')).toBeNull();
    expect(screen.getByLabelText('3 itens')).toBeTruthy();
  });

  it('switches category and forwards original product to existing cart', () => {
    const p = menuProps();
    render(<DineInPremiumMenu {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Vinhos/ }));
    expect(screen.getByText('Vinho B')).toBeTruthy();
    expect(screen.queryByText('Cerveja A')).toBeNull();
    fireEvent.click(screen.getByTestId('kiosk-add-b'));
    expect(p.onAddProduct).toHaveBeenCalledExactlyOnceWith(products[1]);
  });

  it('opens the existing customization modal instead of directly adding products with options', () => {
    const p = menuProps();
    const optionsProduct = {
      ...products[0],
      id: 'options',
      name: 'Cerveja Personalizada',
      optionGroups: [{ id: 'group', active: true }] as unknown as Product['optionGroups'],
    };
    p.products = [optionsProduct];
    const view = render(<DineInPremiumMenu {...p} />);
    fireEvent.click(screen.getByTestId('kiosk-add-options'));
    expect(p.onOpenProduct).toHaveBeenCalledExactlyOnceWith(optionsProduct);
    expect(p.onAddProduct).not.toHaveBeenCalled();
    view.unmount();
  });

  it('blocks disabled ordering', () => {
    const p = menuProps();
    render(<DineInPremiumMenu {...p} orderingDisabled />);
    const add = screen.getByTestId('kiosk-add-a') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.click(add);
    expect(p.onAddProduct).not.toHaveBeenCalled();
  });

  it('does not display foreign-tenant items', () => {
    const p = menuProps();
    const foreign = { ...products[0], id: 'c', tenantId: 'other', name: 'Privado' };
    render(<DineInPremiumMenu {...p} products={[...products, foreign]} />);
    expect(screen.queryByText('Privado')).toBeNull();
  });
});

describe('totem premium authorized expenses', () => {
  it('blocks unauthorized access without querying or showing values', () => {
    const p = adapterProps();
    render(<DineInPremiumMenuAdapter {...p} sessionAuthorized={false} tab={null} />);
    fireEvent.click(screen.getByTestId('kiosk-hamburger'));
    fireEvent.click(screen.getByTestId('kiosk-action-expenses'));
    expect(screen.queryByText('Cerveja A')).toBeNull();
    expect(p.onRefreshExpenses).not.toHaveBeenCalled();
    expect(screen.getByTestId('kiosk-expenses-locked')).toBeTruthy();
  });

  it('opens expenses only after backend-bound session refresh', async () => {
    const p = adapterProps();
    render(<DineInPremiumMenuAdapter {...p} />);
    fireEvent.click(screen.getByTestId('kiosk-hamburger'));
    fireEvent.click(screen.getByTestId('kiosk-action-expenses'));
    await waitFor(() => expect(p.onRefreshExpenses).toHaveBeenCalledOnce());
    expect(await screen.findByTestId('kiosk-expenses')).toBeTruthy();
  });

  it('does not leak previous session after a late refresh', async () => {
    const p = adapterProps();
    let finish!: () => void;
    p.onRefreshExpenses = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = render(<DineInPremiumMenuAdapter {...p} />);
    fireEvent.click(screen.getByTestId('kiosk-hamburger'));
    fireEvent.click(screen.getByTestId('kiosk-action-expenses'));
    expect(p.onRefreshExpenses).toHaveBeenCalledOnce();
    view.rerender(<DineInPremiumMenuAdapter {...p} verifiedSessionId="session-2"
      tabSessionId="session-2" resetKey={2} tab={tab()} />);
    await act(async () => { finish(); });
    expect(screen.getByTestId('dinein-premium-kiosk')).toBeTruthy();
    expect(screen.queryByTestId('kiosk-expenses')).toBeNull();
  });

  it('only asks for bill and never performs a client-side close', async () => {
    const request = vi.fn(async (_: 'CARD' | 'PIX' | 'CAIXA') => {});
    const p: React.ComponentProps<typeof DineInExpenses> = {
      tab: tab(), tableLabel: 'Mesa 04', onBack: vi.fn(), menuTheme: DEFAULT_MENU_THEME,
      onRequestBill: request, onCallWaiter: vi.fn(async () => {}),
      onReopenBill: vi.fn(async () => {}),
    };
    render(<DineInExpenses {...p} />);
    fireEvent.click(screen.getByTestId('kiosk-request-bill'));
    fireEvent.click(screen.getByRole('button', { name: /PIX na mesa/i }));
    fireEvent.click(screen.getByTestId('kiosk-confirm-payment-choice'));
    await waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith('PIX'));
  });

  it('hides checkout and reopening while payment is pending', () => {
    render(<DineInExpenses tab={{...tab('AWAITING_PAYMENT'),pixStatus:'pending'}}
      tableLabel="Mesa 04" onBack={vi.fn()} onRequestBill={vi.fn(async () => {})}
      onCallWaiter={vi.fn(async () => {})} onReopenBill={vi.fn(async () => {})} />);
    expect(screen.queryByTestId('kiosk-request-bill')).toBeNull();
    expect(screen.queryByRole('button', { name: /Reabrir comanda/i })).toBeNull();
  });
});
