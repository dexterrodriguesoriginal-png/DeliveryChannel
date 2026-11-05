// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../../../../types';
import type { UpsellOffer } from '../../../../types/upsell';
import { UpsellSheet } from '../UpsellSheet';
const drink = { id: 'drink', name: 'Suco da casa', price: 12, promotionalPrice: 9, imageUrl: '/suco.webp', optionGroups: [] } as unknown as Product;
const offer = (quantity = 1): UpsellOffer => ({ offerToken: 'offer', suggestions: Array.from({ length: quantity }, (_, i) => ({ product: { ...drink, id: `drink-${i}`, name: i ? `Suco ${i}` : drink.name } })) });
afterEach(cleanup);
describe('optional complement sheet', () => {
  it('shows up to three products and adds through the existing callback without changing price', () => {
    const onAccept = vi.fn(), value = offer(4);
    render(<UpsellSheet offer={value} onAccept={onAccept} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Leve também' });
    expect(within(dialog).getAllByRole('article')).toHaveLength(3);
    expect(within(dialog).getAllByText('R$ 9,00')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Levar Suco da casa' }));
    expect(onAccept).toHaveBeenCalledExactlyOnceWith(value.suggestions[0].product);
    expect(value.suggestions[0].product.price).toBe(12);
  });
  it('keeps required options with the original product for the caller to customize', () => {
    const value = offer(); value.suggestions[0].product.optionGroups = [{ active: true }] as Product['optionGroups'];
    const onAccept = vi.fn();
    render(<UpsellSheet offer={value} onAccept={onAccept} onClose={vi.fn()} />);
    expect(screen.getByText('Personalize antes de adicionar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Levar Suco da casa' }));
    expect(onAccept).toHaveBeenCalledExactlyOnceWith(value.suggestions[0].product);
  });
  it('can be dismissed through escape or continue without adding', () => {
    const onClose = vi.fn(), onAccept = vi.fn();
    render(<UpsellSheet offer={offer()} title="Que tal completar?" onAccept={onAccept} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o pedido' }));
    expect(onClose).toHaveBeenCalledTimes(2); expect(onAccept).not.toHaveBeenCalled();
  });
  it('disables duplicate clicks and preserves retryable error feedback', () => {
    const onClose = vi.fn(), onAccept = vi.fn();
    render(<UpsellSheet offer={offer()} busy error="Sugestão indisponível" onAccept={onAccept} onClose={onClose} />);
    expect(screen.getByRole('alert').textContent).toContain('Sugestão indisponível');
    fireEvent.click(screen.getByRole('button', { name: 'Levar Suco da casa' })); fireEvent.keyDown(document, { key: 'Escape' });
    expect(onAccept).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });
  it('does not create an empty or hidden checkout dialog', () => {
    render(<UpsellSheet offer={null} onAccept={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
