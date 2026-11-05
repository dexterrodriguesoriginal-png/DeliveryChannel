// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../../types';
const h = vi.hoisted(() => ({ recommend: vi.fn(), impression: vi.fn(), accept: vi.fn(), recordConversion: vi.fn() }));
vi.mock('../../repositories/upsellRepository', () => ({
  normalizeUpsellCart: (items: unknown[]) => items,
  upsellRepository: h,
}));
import { useSmartUpsell, type SmartUpsellOptions } from '../useSmartUpsell';

const burger = { id: 'burger', name: 'Hambúrguer', price: 30, isActive: true, isAvailable: true } as Product;
const drink = { id: 'drink', name: 'Suco', price: 8, isActive: true, isAvailable: true } as Product;
const dessert = { ...drink, id: 'dessert', name: 'Sobremesa' };
const cart = [{ productId: burger.id, quantity: 1 }];
const opts = (patch: Partial<SmartUpsellOptions> = {}): SmartUpsellOptions => ({
  slug: 'loja-a', identityKey: 'customer-a', products: [burger, drink, dessert], channel: 'DELIVERY', hidden: false,
  onAcceptProduct: vi.fn(), ...patch,
});
const reply = (token = 'offer-a', productId = drink.id) => ({ offerToken: token, suggestions: [{ productId, reason: 'Combina com seu pedido' }] });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }
beforeEach(() => {
  Object.values(h).forEach(mock => mock.mockReset());
  h.recommend.mockResolvedValue(reply()); h.impression.mockResolvedValue(undefined); h.accept.mockResolvedValue(undefined); h.recordConversion.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('suggestions presentation and attribution', () => {
  it('requests ranking with public context only and records the shown offer once', async () => {
    const { result } = renderHook(() => useSmartUpsell(opts()));
    await act(async () => { await result.current.notifyAdded(burger, cart); });
    expect(h.recommend).toHaveBeenCalledExactlyOnceWith('loja-a', 'burger', cart, 'DELIVERY');
    expect(result.current.offer?.suggestions[0].product).toBe(drink);
    await waitFor(() => expect(h.impression).toHaveBeenCalledExactlyOnceWith('offer-a'));
  });

  it('does not request consecutive additions of the same product or add via an effect', async () => {
    const { result, rerender } = renderHook(() => useSmartUpsell(opts()));
    expect(h.recommend).not.toHaveBeenCalled();
    await act(async () => { await result.current.notifyAdded(burger, cart); await result.current.notifyAdded(burger, [{ productId: 'burger', quantity: 2 }]); });
    rerender();
    expect(h.recommend).toHaveBeenCalledTimes(1);
  });

  it('removes duplicates, cart products, unavailable and unknown candidates', async () => {
    h.recommend.mockResolvedValue({ offerToken: 'offer', suggestions: [{ productId: 'burger' }, { productId: 'drink' }, { productId: 'drink' }, { productId: 'unknown' }, { productId: 'off' }] });
    const { result } = renderHook(() => useSmartUpsell(opts({ products: [burger, drink, { ...dessert, id: 'off', isAvailable: false }] })));
    await act(async () => { await result.current.notifyAdded(burger, cart); });
    expect(result.current.offer?.suggestions.map(item => item.product.id)).toEqual(['drink']);
  });

  it('does not offer the same suggestion in the next sheet', async () => {
    const { result } = renderHook(() => useSmartUpsell(opts()));
    await act(async () => { await result.current.notifyAdded(burger, cart); });
    act(() => result.current.dismiss());
    await act(async () => { await result.current.notifyAdded(dessert, [...cart, { productId: 'dessert', quantity: 1 }]); });
    expect(h.recommend).toHaveBeenCalledTimes(2);
    expect(result.current.offer).toBeNull();
  });

  it('never opens during checkout or reopens an old response after checkout closes', async () => {
    const pending = deferred<ReturnType<typeof reply>>(); h.recommend.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(({ hidden }) => useSmartUpsell(opts({ hidden })), { initialProps: { hidden: false } });
    let request!: Promise<void>;
    act(() => { request = result.current.notifyAdded(burger, cart); });
    await act(async () => { await Promise.resolve(); });
    rerender({ hidden: true }); rerender({ hidden: false });
    await act(async () => { pending.resolve(reply()); await request; });
    expect(result.current.offer).toBeNull(); expect(h.impression).not.toHaveBeenCalled();
    rerender({ hidden: true });
    await act(async () => { await result.current.notifyAdded(dessert, cart); });
    expect(h.recommend).toHaveBeenCalledTimes(1);
  });

  it.each(['slug', 'identity', 'cartScope'] as const)('discards responses after a change of %s', async field => {
    const pending = deferred<ReturnType<typeof reply>>(); h.recommend.mockReturnValue(pending.promise);
    const initial = opts({ cartScopeKey: 'qr-a' });
    const { result, rerender } = renderHook(properties => useSmartUpsell(properties), { initialProps: initial });
    let request!: Promise<void>;
    act(() => { request = result.current.notifyAdded(burger, cart); });
    await act(async () => { await Promise.resolve(); });
    rerender({ ...initial, ...(field === 'slug' ? { slug: 'loja-b' } : field === 'identity' ? { identityKey: 'customer-b' } : { cartScopeKey: 'qr-b' }) });
    await act(async () => { pending.resolve(reply()); await request; });
    expect(result.current.offer).toBeNull(); expect(h.impression).not.toHaveBeenCalled();
  });

  it('dismiss cancels an unresolved request', async () => {
    const pending = deferred<ReturnType<typeof reply>>(); h.recommend.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useSmartUpsell(opts()));
    let request!: Promise<void>;
    act(() => { request = result.current.notifyAdded(burger, cart); });
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.dismiss());
    await act(async () => { pending.resolve(reply()); await request; });
    expect(result.current.offer).toBeNull();
  });

  it('a deferred add cannot cancel the checkout continuation after the cart was opened', async () => {
    const next = vi.fn();
    h.recommend.mockResolvedValue({ offerToken: null, suggestions: [] });
    const { result } = renderHook(() => useSmartUpsell(opts({ channel: 'TOTEM' })));
    let added!: Promise<void>, checkout!: Promise<void>;
    act(() => {
      added = result.current.notifyAdded(burger, cart);
      result.current.dismiss();
      checkout = result.current.beforeCheckout(cart, next);
    });
    await act(async () => { await Promise.all([added, checkout]); });
    expect(h.recommend).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledOnce();
  });

  it('calls the existing options/cart callback once and attributes only a later real order', async () => {
    const options = opts({ products: [burger, { ...drink, optionGroups: [{ active: true }] } as Product] });
    const { result } = renderHook(() => useSmartUpsell(options));
    await act(async () => { await result.current.notifyAdded(burger, cart); });
    await act(async () => { await Promise.all([result.current.accept(drink), result.current.accept(drink)]); });
    expect(options.onAcceptProduct).toHaveBeenCalledTimes(1); expect(h.accept).toHaveBeenCalledExactlyOnceWith('offer-a', 'drink');
    expect(h.recordConversion).not.toHaveBeenCalled();
    await act(async () => { await result.current.trackOrder('order-created'); await result.current.trackOrder('order-created'); });
    expect(h.recordConversion).toHaveBeenCalledExactlyOnceWith('offer-a', 'order-created');
  });

  it('keeps the cart untouched when acceptance is rejected', async () => {
    const options = opts(); h.accept.mockRejectedValue(new Error('stock changed'));
    const { result } = renderHook(() => useSmartUpsell(options));
    await act(async () => { await result.current.notifyAdded(burger, cart); });
    await act(async () => { await result.current.accept(drink); });
    expect(options.onAcceptProduct).not.toHaveBeenCalled(); expect(result.current.error).toContain('não está disponível');
    await act(async () => { await result.current.trackOrder('order-created'); });
    expect(h.recordConversion).not.toHaveBeenCalled();
  });

  it('preserves anonymous accepted tokens through login in the same bag', async () => {
    const initial = opts({ identityKey: null, cartScopeKey: 'qr-a' });
    const { result, rerender } = renderHook(properties => useSmartUpsell(properties), { initialProps: initial });
    await act(async () => { await result.current.notifyAdded(burger, cart); await result.current.accept(drink); });
    // Accept needs the render with the new offer, as a real click does.
    if (result.current.offer) await act(async () => { await result.current.accept(drink); });
    rerender({ ...initial, identityKey: 'customer-a', hidden: true });
    await act(async () => { await result.current.trackOrder('order-after-login'); });
    expect(h.recordConversion).toHaveBeenCalledExactlyOnceWith('offer-a', 'order-after-login');
  });

  it.each(['customer-b', null])('clears accepted tokens after an authenticated identity changes to %s', async identityKey => {
    const initial = opts();
    const { result, rerender } = renderHook(properties => useSmartUpsell(properties), { initialProps: initial });
    await act(async () => { await result.current.notifyAdded(burger, cart); });
    await act(async () => { await result.current.accept(drink); });
    rerender({ ...initial, identityKey });
    await act(async () => { await result.current.trackOrder('new-customer-order'); });
    expect(h.recordConversion).not.toHaveBeenCalled();
  });

  it('shows a pre-payment offer once in totem and continues only after dismissal', async () => {
    const next = vi.fn(), options = opts({ channel: 'TOTEM' });
    const { result } = renderHook(() => useSmartUpsell(options));
    await act(async () => { await result.current.beforeCheckout(cart, next); });
    expect(result.current.title).toBe('Que tal completar?'); expect(next).not.toHaveBeenCalled();
    act(() => result.current.dismiss()); expect(next).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.beforeCheckout(cart, next); });
    expect(h.recommend).toHaveBeenCalledTimes(1); expect(next).toHaveBeenCalledTimes(2);
  });

  it('accepting before checkout leaves room for required personalization before payment', async () => {
    const next = vi.fn(), options = opts({ channel: 'TOTEM' });
    const { result } = renderHook(() => useSmartUpsell(options));
    await act(async () => { await result.current.beforeCheckout(cart, next); });
    await act(async () => { await result.current.accept(drink); });
    expect(options.onAcceptProduct).toHaveBeenCalledOnce(); expect(next).not.toHaveBeenCalled();
    await act(async () => { await result.current.beforeCheckout([...cart, { productId: 'drink', quantity: 1 }], next); });
    expect(next).toHaveBeenCalledOnce(); expect(h.recommend).toHaveBeenCalledOnce();
  });

  it('fails open for missing configuration and analytics failures never fail an order', async () => {
    h.recommend.mockRejectedValue(new Error('RPC not deployed'));
    const next = vi.fn();
    const { result } = renderHook(() => useSmartUpsell(opts({ channel: 'TOTEM' })));
    await act(async () => { await result.current.beforeCheckout(cart, next); });
    expect(next).toHaveBeenCalledOnce(); expect(result.current.offer).toBeNull();
    await expect(result.current.trackOrder('order')).resolves.toBeUndefined();
  });

  it('clear discards kiosk attribution and resets the next customer bag', async () => {
    const { result } = renderHook(() => useSmartUpsell(opts()));
    await act(async () => { await result.current.notifyAdded(burger, cart); });
    await act(async () => { await result.current.accept(drink); });
    act(() => result.current.clear());
    await act(async () => { await result.current.trackOrder('new-order'); await result.current.notifyAdded(burger, cart); });
    expect(h.recordConversion).not.toHaveBeenCalled(); expect(result.current.offer).not.toBeNull();
  });
});
