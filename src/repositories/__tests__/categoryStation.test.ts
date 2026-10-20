import { describe, expect, it } from 'vitest';
import { normalizeCategoryStation } from '../categoryRepository';

describe('category station persistence values', () => {
  it.each([
    ['KITCHEN', 'KITCHEN'],
    ['BAR', 'BAR'],
    [null, null],
    ['INVALID', null],
  ])('normalizes %s', (value, expected) => {
    expect(normalizeCategoryStation(value)).toBe(expected);
  });
});
