import { describe, expect, it } from 'vitest';
import { kioskProductGridColumns } from '../kioskProductGrid';

describe('kioskProductGridColumns', () => {
  it('honra exatamente o 1/2/3 do dono, sem mínimo de 150px', () => {
    expect(kioskProductGridColumns(3)).toBe('repeat(3, minmax(0, 1fr))');
    expect(kioskProductGridColumns(2)).toBe('repeat(2, minmax(0, 1fr))');
    expect(kioskProductGridColumns(1)).toBe('repeat(1, minmax(0, 1fr))');
    expect(kioskProductGridColumns(3)).not.toContain('150px');
    expect(kioskProductGridColumns(3)).not.toContain('auto-fill');
  });
});
