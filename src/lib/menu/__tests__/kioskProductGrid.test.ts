import { describe, expect, it } from 'vitest';
import { KIOSK_PRODUCT_CARD_MIN_PX, kioskProductGridColumns } from '../kioskProductGrid';

describe('kioskProductGridColumns', () => {
  it('nunca deixa o card mais estreito que 150px e respeita o máximo do dono', () => {
    const three = kioskProductGridColumns(3);
    expect(three.startsWith('repeat(auto-fill, minmax(')).toBe(true);
    expect(three).toContain(`${KIOSK_PRODUCT_CARD_MIN_PX}px`);
    expect(three).toContain('/ 3)');
    expect(three).not.toMatch(/repeat\(3,/);

    const two = kioskProductGridColumns(2);
    expect(two).toContain('/ 2)');
    expect(two).toContain('auto-fill');

    const one = kioskProductGridColumns(1);
    expect(one).toContain('/ 1)');
  });
});
