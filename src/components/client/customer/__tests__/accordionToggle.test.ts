import { describe, it, expect } from 'vitest';
import { shouldAcceptToggle, ACCORDION_ANIM_MS } from '../ui';

describe('acordeão: um toque = uma alternância', () => {
  it('ignora o segundo toque durante a animação e aceita depois', () => {
    expect(shouldAcceptToggle(0, 1000)).toBe(true);
    expect(shouldAcceptToggle(1000, 1040)).toBe(false);
    expect(shouldAcceptToggle(1000, 1000 + ACCORDION_ANIM_MS - 1)).toBe(false);
    expect(shouldAcceptToggle(1000, 1000 + ACCORDION_ANIM_MS)).toBe(true);
  });
});
