import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false }));
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
