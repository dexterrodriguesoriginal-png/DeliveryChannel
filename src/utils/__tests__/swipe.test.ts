import { describe, it, expect } from 'vitest';
import { detectSwipeIntent, swipeDirection, wrapIndex } from '../swipe';
describe('swipe do carrossel', () => {
  it('esquerda avança, direita volta', () => {
    expect(swipeDirection(-80, 5)).toBe('next');
    expect(swipeDirection(80, 5)).toBe('prev');
  });
  it('abaixo do limiar não navega', () => { expect(swipeDirection(-30, 0)).toBeNull(); });
  it('gesto vertical não navega (rolagem)', () => {
    expect(swipeDirection(-60, 90)).toBeNull();
    expect(detectSwipeIntent(4, 40)).toBe('vertical');
    expect(detectSwipeIntent(3, 2)).toBe('pending');
  });
  it('índice circular', () => { expect(wrapIndex(-1, 3)).toBe(2); expect(wrapIndex(3, 3)).toBe(0); expect(wrapIndex(0, 0)).toBe(0); });
});
