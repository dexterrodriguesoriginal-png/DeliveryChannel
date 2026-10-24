import { describe, expect, it } from 'vitest';
import { StoreFeedback, validFeedback } from '../model';
const row: StoreFeedback = {
  id: 'a',
  type: 'sugestao',
  area: null,
  rating: null,
  message: 'Uma boa sugestão.',
  day: '2026-10-25',
  is_read: false,
  archived: false,
};
describe('feedback validation', () => {
  it.each([10, 1000])(
    'accepts a message of %i Unicode characters and optional fields',
    (n) => {
      expect(validFeedback({ ...row, message: '🙂'.repeat(n) })).toBe(true);
    },
  );
  it.each([0, 9, 1001])('rejects messages with %i characters', (n) => {
    expect(validFeedback({ ...row, message: 'a'.repeat(n) })).toBe(false);
  });
  it('rejects non-string enum values without coercing objects', () => {
    expect(validFeedback({ ...row, type: { toString: null } })).toBe(false);
    expect(validFeedback({ ...row, area: { toString: null } })).toBe(false);
  });
});
