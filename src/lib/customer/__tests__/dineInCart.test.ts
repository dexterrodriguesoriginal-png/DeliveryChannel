import { describe, expect, it } from 'vitest';
import type { Product, ProductOptionGroup } from '../../../types';
import {
  addDineInCartLine,
  dineInCartLineUnitPriceCents,
  dineInOptionLabels,
  dineInRoundItem,
  dineInRoundItems,
} from '../dineInCart';

const optionsGroup: ProductOptionGroup = {
  id: 'extras',
  tenantId: 'tenant-1',
  name: 'Adicionais',
  type: 'STANDARD',
  minSelect: 1,
  maxSelect: 2,
  allowRepeat: false,
  pricingRule: 'SUM',
  active: true,
  sort: 0,
  options: [
    { id: 'cheese', tenantId: 'tenant-1', groupId: 'extras', name: 'Queijo', extraPriceCents: 250, active: true, soldOut: false, sort: 0 },
    { id: 'bacon', tenantId: 'tenant-1', groupId: 'extras', name: 'Bacon', extraPriceCents: 400, active: true, soldOut: false, sort: 1 },
  ],
};

const product = {
  id: 'burger-1',
  name: 'Hambúrguer',
  price: 20,
  optionGroups: [optionsGroup],
} as Product;

describe('dine-in cart options', () => {
  it('estima o mesmo preço promocional do totem e soma somente os adicionais escolhidos', () => {
    const promotionalProduct = { ...product, price: 30, promotionalPrice: 20 };
    const cart = addDineInCartLine([], promotionalProduct, [{ groupId: 'extras', optionId: 'cheese', qty: 1 }]);

    expect(dineInCartLineUnitPriceCents(cart[0])).toBe(2250);
    expect(dineInRoundItems(cart)).toEqual([{
      productId: product.id,
      quantity: 1,
      notes: '',
      options: [{ group_id: 'extras', option_id: 'cheese', qty: 1, fraction: null }],
    }]);
    // O preço é uma estimativa visual; submit_round continua calculando o valor no servidor.
    expect(Object.keys(dineInRoundItems(cart)[0]).sort()).toEqual(['notes', 'options', 'productId', 'quantity']);
  });

  it.each([0, -1, 30, 40, Number.NaN, Number.POSITIVE_INFINITY])(
    'ignora a promoção inválida %s e conserva o preço normal com adicionais', promotionalPrice => {
      const cart = addDineInCartLine([], { ...product, price: 30, promotionalPrice }, [{ groupId: 'extras', optionId: 'bacon', qty: 1 }]);
      expect(dineInCartLineUnitPriceCents(cart[0])).toBe(3400);
    }
  );

  it('keeps the same product with different choices on separate lines and merges identical choices', () => {
    const cheese = [{ groupId: 'extras', optionId: 'cheese', qty: 1 }];
    const bacon = [{ groupId: 'extras', optionId: 'bacon', qty: 1 }];
    const cart = addDineInCartLine(
      addDineInCartLine(addDineInCartLine([], product, cheese), product, bacon),
      product,
      [...cheese]
    );

    expect(cart).toHaveLength(2);
    expect(cart.map(line => line.quantity)).toEqual([2, 1]);
    expect(cart.map(dineInCartLineUnitPriceCents)).toEqual([2250, 2400]);
    expect(dineInOptionLabels(product, cart[0].options)).toEqual(['Adicionais: Queijo']);
    expect(dineInRoundItems(cart).map(({ productId, quantity, options }) => ({ productId, quantity, options }))).toEqual([
      { productId: 'burger-1', quantity: 2, options: [{ group_id: 'extras', option_id: 'cheese', qty: 1, fraction: null }] },
      { productId: 'burger-1', quantity: 1, options: [{ group_id: 'extras', option_id: 'bacon', qty: 1, fraction: null }] },
    ]);
  });

  it('sends each configured guest cart line with its selected options', () => {
    const cart = addDineInCartLine([], product, [{ groupId: 'extras', optionId: 'bacon', qty: 1 }]);
    expect(dineInRoundItems(cart)).toEqual([{
      productId: 'burger-1',
      quantity: 1,
      notes: '',
      options: [{ group_id: 'extras', option_id: 'bacon', qty: 1, fraction: null }],
    }]);
  });

  it('preserves waiter add-ons and notes in the submit_round item', () => {
    expect(dineInRoundItem({
      productId: 'burger-1',
      quantity: 2,
      notes: 'Sem cebola',
      options: [{ groupId: 'extras', optionId: 'cheese', qty: 1 }],
    })).toEqual({
      productId: 'burger-1',
      quantity: 2,
      notes: 'Sem cebola',
      options: [{ group_id: 'extras', option_id: 'cheese', qty: 1, fraction: null }],
    });
  });

  it('adds a chosen quantity in a single call', () => {
    const cart = addDineInCartLine([], product, [], 3);
    expect(cart[0].quantity).toBe(3);
    const again = addDineInCartLine(cart, product, [], 2);
    expect(again[0].quantity).toBe(5);
  });
});
