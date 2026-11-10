// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KioskProductSheet } from '../KioskProductSheet';
import type { Product } from '../../../../types';

const colors = {
  surface: '#111111',
  text: '#f8f8f8',
  accent: '#1D4ED8',
  accentText: '#ffffff',
};

function product(partial: Partial<Product> = {}): Product {
  return {
    id: 'artesanal',
    tenantId: 't',
    categoryId: 'beer',
    name: 'Cerveja Artesanal',
    description: 'India Pale Ale com aroma cítrico e amargor marcante.',
    price: 24.9,
    promotionalPrice: 19.9,
    imageUrl: 'https://cdn.example.com/ipa.jpg',
    isActive: true,
    isAvailable: true,
    stockQuantity: 10,
    unit: 'un',
    ...partial,
  };
}

describe('KioskProductSheet', () => {
  afterEach(() => cleanup());

  it('shows the large photo, full description, promo price and a close control', () => {
    render(
      <KioskProductSheet
        product={product()}
        layout="sheet"
        colors={colors}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kiosk-product-sheet').getAttribute('data-layout')).toBe('sheet');
    expect(screen.getByTestId('kiosk-product-sheet-name').textContent).toBe('Cerveja Artesanal');
    expect(screen.getByTestId('kiosk-product-sheet-description').textContent).toMatch(/India Pale Ale/);
    expect(screen.getByTestId('kiosk-product-sheet-original').textContent).toMatch(/24/);
    expect(screen.getByTestId('kiosk-product-sheet-price').textContent).toMatch(/19/);
    expect((screen.getByRole('img', { name: 'Cerveja Artesanal' }) as HTMLImageElement).src)
      .toBe('https://cdn.example.com/ipa.jpg');
    expect(screen.getByTestId('kiosk-product-sheet-close').getAttribute('aria-label')).toBe('Fechar');
  });

  it('confirms the chosen quantity through existing cart options', () => {
    const onConfirm = vi.fn();
    render(
      <KioskProductSheet
        product={product()}
        layout="modal"
        colors={colors}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByTestId('kiosk-product-sheet').getAttribute('data-layout')).toBe('modal');
    fireEvent.click(screen.getByTestId('kiosk-product-sheet-qty-inc'));
    fireEvent.click(screen.getByTestId('kiosk-product-sheet-qty-inc'));
    expect(screen.getByTestId('kiosk-product-sheet-qty').textContent).toContain('3');
    fireEvent.click(screen.getByTestId('kiosk-product-sheet-add'));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(3, []);
  });
});
