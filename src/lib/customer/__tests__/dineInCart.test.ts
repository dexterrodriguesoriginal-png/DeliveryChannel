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
});
