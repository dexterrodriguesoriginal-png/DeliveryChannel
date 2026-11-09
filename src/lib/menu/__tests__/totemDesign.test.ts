import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOTEM_DESIGN, TOTEM_COLOR_KEYS, designFromPreset, isValidTotemDesign,
  normalizeTotemDesign, totemDesignCssVars,
} from '../totemDesign';

describe('totemDesign', () => {
  it('accepts the server default and rejects a bad hex', () => {
    expect(isValidTotemDesign(DEFAULT_TOTEM_DESIGN)).toBe(true);
    expect(isValidTotemDesign({ ...DEFAULT_TOTEM_DESIGN, colors: { ...DEFAULT_TOTEM_DESIGN.colors, pageBg: 'red' } })).toBe(false);
  });

  it('restores a preset and keeps unknown keys out of normalize', () => {
    const oceano = designFromPreset('oceano');
    expect(oceano.preset).toBe('oceano');
    expect(oceano.colors.pageBg).toMatch(/^#/);
    const cleaned = normalizeTotemDesign({ ...oceano, extra: 1, colors: { ...oceano.colors, pageBg: '#ABCDEF', nope: '#000000' } });
    expect(cleaned.colors.pageBg.toUpperCase()).toBe('#ABCDEF');
    expect('nope' in cleaned.colors).toBe(false);
    expect(TOTEM_COLOR_KEYS.every(key => key in cleaned.colors)).toBe(true);
  });

  it('exposes CSS variables for the totem cardápio', () => {
    const vars = totemDesignCssVars(DEFAULT_TOTEM_DESIGN);
    expect(vars['--dc-kiosk-bg']).toBe('#0B0F14');
    expect(vars['--dc-totem-checkout-bg']).toBe('#176444');
    expect(vars['--dc-kiosk-radius']).toBe('16px');
  });
});
