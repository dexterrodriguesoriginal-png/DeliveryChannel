import { describe, expect, it } from 'vitest';
import { DEFAULT_MENU_OPTIONS, isValidMenuOptions, normalizeMenuOptions } from '../menuOptions';

describe('menuOptions', () => {
  it('defaults to totem off and 60 s', () => {
    expect(normalizeMenuOptions(undefined)).toEqual(DEFAULT_MENU_OPTIONS);
    expect(normalizeMenuOptions('x')).toEqual({ totemMode: false, idleSeconds: 60, homeLabel: 'Cardápio' });
  });
  it('keeps valid values and drops unknown keys', () => {
    expect(normalizeMenuOptions({ totemMode: true, idleSeconds: 120, evil: '<b>' })).toEqual({ totemMode: true, idleSeconds: 120, homeLabel: 'Cardápio' });
  });
  it('falls back to 60 for out-of-range idle seconds', () => {
    expect(normalizeMenuOptions({ totemMode: true, idleSeconds: 5 }).idleSeconds).toBe(60);
    expect(normalizeMenuOptions({ totemMode: true, idleSeconds: 301 }).idleSeconds).toBe(60);
    expect(normalizeMenuOptions({ totemMode: 'yes', idleSeconds: 45.5 })).toEqual({ totemMode: false, idleSeconds: 60, homeLabel: 'Cardápio' });
  });
  it('validates writes strictly', () => {
    expect(isValidMenuOptions({ totemMode: true, idleSeconds: 30, homeLabel: 'Menu' })).toBe(true);
    expect(isValidMenuOptions({ totemMode: true, idleSeconds: 300, homeLabel: 'Menu' })).toBe(true);
    expect(isValidMenuOptions({ totemMode: true, idleSeconds: 29 })).toBe(false);
    expect(isValidMenuOptions({ totemMode: true, idleSeconds: 301 })).toBe(false);
    expect(isValidMenuOptions({ totemMode: 1, idleSeconds: 60 })).toBe(false);
    expect(isValidMenuOptions({ totemMode: true, idleSeconds: 60, extra: 1 })).toBe(false);
  });
});
