import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME_LABEL, MAX_HOME_LABEL_LENGTH, isValidHomeLabel, sanitizeHomeLabel } from '../homeLabel';

describe('sanitizeHomeLabel', () => {
  it('keeps normal labels', () => {
    expect(sanitizeHomeLabel('Menu')).toBe('Menu');
    expect(sanitizeHomeLabel('Nosso cardápio')).toBe('Nosso cardápio');
  });
  it('defaults when empty or not a string', () => {
    expect(sanitizeHomeLabel('')).toBe(DEFAULT_HOME_LABEL);
    expect(sanitizeHomeLabel('   ')).toBe(DEFAULT_HOME_LABEL);
    expect(sanitizeHomeLabel(undefined)).toBe(DEFAULT_HOME_LABEL);
    expect(sanitizeHomeLabel(42)).toBe(DEFAULT_HOME_LABEL);
  });
  it('strips HTML tags, entities and angle brackets', () => {
    expect(sanitizeHomeLabel('<b>Menu</b>')).toBe('Menu');
    expect(sanitizeHomeLabel('<script>alert(1)</script>Carta')).toBe('alert(1)Carta');
    expect(sanitizeHomeLabel('<img src=x onerror=alert(1)>')).toBe(DEFAULT_HOME_LABEL);
    expect(sanitizeHomeLabel('Menu &lt;x&gt; &amp; mais')).toBe('Menu x mais');
    expect(sanitizeHomeLabel('a < b > c')).toBe('a c');
    expect(sanitizeHomeLabel('<unclosed')).toBe(DEFAULT_HOME_LABEL);
  });
  it('removes control chars and collapses whitespace', () => {
    expect(sanitizeHomeLabel('  Nosso \n\t  menu\u0000 ')).toBe('Nosso menu');
  });
  it('limits to 24 characters', () => {
    const out = sanitizeHomeLabel('x'.repeat(60));
    expect(out).toHaveLength(MAX_HOME_LABEL_LENGTH);
    expect(sanitizeHomeLabel('Cardápio da casa com sabores')).toHaveLength(24);
  });
});

describe('isValidHomeLabel', () => {
  it('accepts clean labels up to 24 chars only', () => {
    expect(isValidHomeLabel('Menu')).toBe(true);
    expect(isValidHomeLabel('x'.repeat(24))).toBe(true);
    expect(isValidHomeLabel('x'.repeat(25))).toBe(false);
    expect(isValidHomeLabel('')).toBe(false);
    expect(isValidHomeLabel('<b>Menu</b>')).toBe(false);
    expect(isValidHomeLabel(' Menu')).toBe(false);
    expect(isValidHomeLabel(null)).toBe(false);
  });
});
