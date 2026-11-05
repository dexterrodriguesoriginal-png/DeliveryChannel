import { describe, expect, it } from 'vitest';
import { addDineInCartLine } from '../dineInCart';
import { restoreDineInCart, saveDineInCart } from '../dineInCartStorage';
import type { Product } from '../../../types';

const product = { id: 'p1', name: 'Chopp', price: 12, isActive: true, isAvailable: true } as Product;
const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, values };
};

describe('Sacola da mesa preservada durante cadastro', () => {
  it('isola por QR e restaura com catálogo/preço atual, sem salvar objeto do produto ou identidade', () => {
    const s = storage();
    saveDineInCart(s, 'mesa-a', addDineInCartLine([], product), true, 1000);
    const raw = [...s.values.values()][0];
    expect(raw).not.toContain('Chopp'); expect(raw).not.toContain('price');
    expect(restoreDineInCart(s, 'mesa-b', [product], 1100).cart).toEqual([]);
    const restored = restoreDineInCart(s, 'mesa-a', [{ ...product, price: 15 }], 1100);
    expect(restored.checkoutPending).toBe(true);
    expect(restored.cart[0].product.price).toBe(15);
  });
  it('não restaura produto removido nem sacola expirada ou corrompida', () => {
    const s = storage();
    saveDineInCart(s, 'mesa-a', addDineInCartLine([], product), true, 1000);
    expect(restoreDineInCart(s, 'mesa-a', [], 1100).cart).toEqual([]);
    expect(restoreDineInCart(s, 'mesa-a', [product], 1000 + 25 * 60 * 60 * 1000).cart).toEqual([]);
    s.values.forEach((_value, key) => s.values.set(key, '{bad json'));
    expect(restoreDineInCart(s, 'mesa-a', [product], 1100).cart).toEqual([]);
  });
  it('remove o rascunho depois do envio para impedir repetição ao voltar do login', () => {
    const s = storage();
    saveDineInCart(s, 'mesa-a', addDineInCartLine([], product), true, 1000);
    saveDineInCart(s, 'mesa-a', [], false, 1100);
    expect(s.values.size).toBe(0);
  });
});

