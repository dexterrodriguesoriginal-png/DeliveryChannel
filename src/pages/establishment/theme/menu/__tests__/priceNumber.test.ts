import { expect, it } from 'vitest';
import { priceNumber } from '../MenuThemePreview';

it('parses dot and comma decimals to the same value', () => {
  expect(priceNumber('19.90')).toBe(19.9);
  expect(priceNumber('19,90')).toBe(19.9);
  expect(priceNumber('R$ 19,90')).toBe(19.9);
  expect(priceNumber('R$ 1.234,56')).toBe(1234.56);
  expect(priceNumber('1,234.56')).toBe(1234.56);
  expect(priceNumber('20')).toBe(20);
  expect(priceNumber(19.9)).toBe(19.9);
  expect(priceNumber('abc')).toBe(0);
});
