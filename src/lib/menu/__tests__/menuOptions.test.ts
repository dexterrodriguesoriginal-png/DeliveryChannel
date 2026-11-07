import { describe, expect, it } from 'vitest';
import { DEFAULT_MENU_OPTIONS, isValidMenuOptions, normalizeMenuOptions } from '../menuOptions';

describe('menuOptions', () => {
  it('defaults to totem off and 60 s', () => {
    expect(normalizeMenuOptions(undefined)).toEqual(DEFAULT_MENU_OPTIONS);
    expect(normalizeMenuOptions('x')).toEqual(DEFAULT_MENU_OPTIONS);
  });
  it('keeps valid values and drops unknown keys', () => {
    expect(normalizeMenuOptions({ totemMode: true, idleSeconds: 120, evil: '<b>' })).toEqual({ ...DEFAULT_MENU_OPTIONS, totemMode: true, idleSeconds: 120 });
  });
  it('falls back to 60 for out-of-range idle seconds', () => {
    expect(normalizeMenuOptions({ totemMode: true, idleSeconds: 5 }).idleSeconds).toBe(60);
    expect(normalizeMenuOptions({ totemMode: true, idleSeconds: 301 }).idleSeconds).toBe(60);
    expect(normalizeMenuOptions({ totemMode: 'yes', idleSeconds: 45.5 })).toEqual(DEFAULT_MENU_OPTIONS);
  });
  it('isolates service mode, columns and banner reuse with safe defaults', () => {
    expect(normalizeMenuOptions({ serviceMode: 'COUNTER', productColumns: 2, reuseAppBanners: true })).toMatchObject({
      serviceMode: 'COUNTER', productColumns: 2, reuseAppBanners: true,
    });
    expect(normalizeMenuOptions({ serviceMode: 'INVALID', productColumns: 7, reuseAppBanners: 'true' })).toMatchObject({
      serviceMode: 'TABLE', productColumns: 3, reuseAppBanners: false,
    });
    expect(isValidMenuOptions({ ...DEFAULT_MENU_OPTIONS, serviceMode: 'BOTH', productColumns: 1 })).toBe(true);
    expect(isValidMenuOptions({ ...DEFAULT_MENU_OPTIONS, productColumns: 7 })).toBe(false);
    expect(isValidMenuOptions({ ...DEFAULT_MENU_OPTIONS, productColumns: '2' })).toBe(false);
    expect(isValidMenuOptions({ ...DEFAULT_MENU_OPTIONS, productColumns: true })).toBe(false);
    expect(isValidMenuOptions({ ...DEFAULT_MENU_OPTIONS, reuseAppBanners: 'yes' })).toBe(false);
  });
  it('validates writes strictly', () => {
    expect(isValidMenuOptions({ ...DEFAULT_MENU_OPTIONS, totemMode: true, idleSeconds: 30, homeLabel: 'Menu' })).toBe(true);
    expect(isValidMenuOptions({ ...DEFAULT_MENU_OPTIONS, totemMode: true, idleSeconds: 300, homeLabel: 'Menu' })).toBe(true);
    expect(isValidMenuOptions({ totemMode: true, idleSeconds: 29 })).toBe(false);
    expect(isValidMenuOptions({ totemMode: true, idleSeconds: 301 })).toBe(false);
    expect(isValidMenuOptions({ totemMode: 1, idleSeconds: 60 })).toBe(false);
    expect(isValidMenuOptions({ totemMode: true, idleSeconds: 60, extra: 1 })).toBe(false);
  });
});
