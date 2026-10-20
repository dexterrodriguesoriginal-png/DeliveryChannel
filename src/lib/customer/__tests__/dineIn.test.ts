import { describe, expect, it } from 'vitest';
import { billSplitAmounts, parseTenderCents, splitAmountCents, tenderStatus } from '../dineIn';

describe('dine-in bill helpers', () => {
  it('splits integer cents evenly without losing remainder cents', () => {
    expect(splitAmountCents(1000, 3)).toEqual([333, 333, 334]);
    expect(splitAmountCents(1001, 2)).toEqual([500, 501]);
    expect(splitAmountCents(0, 4)).toEqual([0, 0, 0, 0]);
  });

  it('supports paying all, equal split, and another share amount', () => {
    expect(billSplitAmounts(1001, 'ALL', 2, 250)).toEqual([1001]);
    expect(billSplitAmounts(1001, 'EQUAL', 2, 0)).toEqual([500, 501]);
    expect(billSplitAmounts(1001, 'CUSTOM', 2, 250)).toEqual([250]);
  });

  it('rejects invalid equal-part counts and totals', () => {
    expect(() => splitAmountCents(100, 0)).toThrow(RangeError);
    expect(() => splitAmountCents(-1, 2)).toThrow(RangeError);
    expect(() => splitAmountCents(100, 1.5)).toThrow(RangeError);
  });

  it('parses Brazilian tender values and validates cash is enough to cover the bill', () => {
    expect(parseTenderCents('R$ 1.234,56')).toBe(123456);
    expect(parseTenderCents('100,00')).toBe(10000);
    expect(parseTenderCents('')).toBeNull();
    expect(parseTenderCents('-10,00')).toBeNull();
    expect(tenderStatus(5000, null)).toBe('missing');
    expect(tenderStatus(5000, 4999)).toBe('insufficient');
    expect(tenderStatus(5000, 5000)).toBe('ok');
  });
});
