import { describe, it, expect } from 'vitest';
import { buildReorderCart } from '../reorder';
import type { Product, OrderItem } from '../../../types';

const T = 't1';
const prod = (id: string, price: number, extra: Partial<Product> = {}): Product => ({
  id, tenantId: T, categoryId: 'c', name: `Produto ${id}`, description: '', price, imageUrl: '', isAvailable: true, isActive: true, stockQuantity: 10, unit: 'un', ...extra,
});
const item = (productId: string, quantity: number, unitPrice: number, productName = `Produto ${productId}`): OrderItem =>
  ({ productId, productName, quantity, unitPrice, totalPrice: unitPrice * quantity } as OrderItem);

describe('Peça de novo', () => {
  it('usa o preço ATUAL do catálogo e avisa mudança de preço', () => {
    const r = buildReorderCart([item('a', 2, 10)], [prod('a', 12)], T);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].product.price).toBe(12);
    expect(r.lines[0].quantity).toBe(2);
    expect(r.lines[0].origin.source).toBe('catalog');
    expect(r.priceChanged).toEqual([{ name: 'Produto a', before: 10, now: 12 }]);
  });
  it('considera o preço promocional vigente', () => {
    const r = buildReorderCart([item('a', 1, 9)], [prod('a', 12, { promotionalPrice: 9 })], T);
    expect(r.priceChanged).toEqual([]);
  });
  it('deixa de fora produto removido, inativo, esgotado ou de outra loja', () => {
    const r = buildReorderCart(
      [item('x', 1, 5, 'Sumiu'), item('b', 1, 5, 'Inativo'), item('c', 1, 5, 'Esgotado'), item('d', 1, 5, 'Outra loja'), item('a', 1, 10)],
      [prod('b', 5, { isActive: false }), prod('c', 5, { isAvailable: false }), { ...prod('d', 5), tenantId: 'outra' }, prod('a', 10)],
      T
    );
    expect(r.lines.map(l => l.product.id)).toEqual(['a']);
    expect(r.unavailable).toEqual(['Sumiu', 'Inativo', 'Esgotado', 'Outra loja']);
  });
  it('soma o mesmo produto repetido e normaliza quantidade', () => {
    const r = buildReorderCart([item('a', 1, 10), item('a', 2, 10), item('b', 0, 3)], [prod('a', 10), prod('b', 3)], T);
    expect(r.lines.find(l => l.product.id === 'a')?.quantity).toBe(3);
    expect(r.lines.find(l => l.product.id === 'b')?.quantity).toBe(1);
  });
});
