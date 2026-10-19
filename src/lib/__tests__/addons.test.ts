import { describe, expect, it } from 'vitest';
import { optionPriceCents, validateOptionSelection } from '../addons';
import type { ProductOptionGroup } from '../../types';

const group = (overrides: Partial<ProductOptionGroup> = {}): ProductOptionGroup => ({
  id: 'group-1', tenantId: 'tenant-1', name: 'Adicionais', type: 'STANDARD',
  minSelect: 1, maxSelect: 5, allowRepeat: false, pricingRule: 'SUM', active: true, sort: 0,
  options: [
    { id: 'bacon', tenantId: 'tenant-1', groupId: 'group-1', name: 'Bacon', extraPriceCents: 400, active: true, soldOut: false, sort: 0 },
    { id: 'queijo', tenantId: 'tenant-1', groupId: 'group-1', name: 'Queijo', extraPriceCents: 250, active: true, soldOut: false, sort: 1 },
    { id: 'tomate', tenantId: 'tenant-1', groupId: 'group-1', name: 'Tomate', extraPriceCents: 0, active: true, soldOut: false, sort: 2 },
  ],
  ...overrides,
});

describe('product add-on selection', () => {
  it('blocks a required group until the minimum is selected and enforces its maximum', () => {
    const g = group();
    expect(validateOptionSelection([g], []).valid).toBe(false);
    expect(validateOptionSelection([g], [{ groupId: g.id, optionId: 'bacon', qty: 1 }]).valid).toBe(true);
    expect(validateOptionSelection([g], [
      { groupId: g.id, optionId: 'bacon', qty: 1 },
      { groupId: g.id, optionId: 'queijo', qty: 1 },
      { groupId: g.id, optionId: 'tomate', qty: 1 },
      { groupId: g.id, optionId: 'x', qty: 1 },
      { groupId: g.id, optionId: 'y', qty: 1 },
      { groupId: g.id, optionId: 'z', qty: 1 },
    ]).valid).toBe(false);
  });

  it('sums extras and uses the configured half-and-half price rule', () => {
    const standard = group();
    expect(optionPriceCents([standard], [
      { groupId: standard.id, optionId: 'bacon', qty: 1 },
      { groupId: standard.id, optionId: 'queijo', qty: 2 },
    ])).toBe(900);

    const split = group({ type: 'FLAVOR_SPLIT', name: 'Sabores', minSelect: 1, maxSelect: 2, pricingRule: 'HIGHEST' });
    const choices = [
      { groupId: split.id, optionId: 'bacon', qty: 1, fraction: 0.5 },
      { groupId: split.id, optionId: 'queijo', qty: 1, fraction: 0.5 },
    ];
    expect(optionPriceCents([split], choices)).toBe(400);
    expect(optionPriceCents([{ ...split, pricingRule: 'AVERAGE' }], choices)).toBe(325);
    expect(optionPriceCents([{ ...split, options: [
      { ...split.options[0], extraPriceCents: 401 },
      { ...split.options[1], extraPriceCents: 250 },
    ], pricingRule: 'AVERAGE' }], choices)).toBe(326);
  });
});
