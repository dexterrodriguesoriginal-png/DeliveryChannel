import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOTEM_WELCOME,
  normalizeTotemWelcome,
  resolvedTotemButtonColors,
  totemButtonContrastWarning,
} from '../totemWelcome';

describe('normalizeTotemWelcome', () => {
  it('returns defaults for empty or unknown payloads', () => {
    expect(normalizeTotemWelcome(null)).toEqual({ ...DEFAULT_TOTEM_WELCOME, slides: [] });
    expect(normalizeTotemWelcome({ unexpected: 1, buttonText: '  Peça agora <loja> ' }).buttonText).toBe('Peça agora loja');
  });

  it('accepts snake_case aliases and keeps only https slides', () => {
    const settings = normalizeTotemWelcome({
      button_text: 'Peça agora',
      button_style: 'PILL',
      button_bg_color: '#112233',
      button_text_color: '#ffffff',
      image_seconds: 8,
      idle_seconds: 120,
      slides: [
        { url: 'https://cdn.example/storage/v1/object/public/marketing-public/t/a.jpg', kind: 'IMAGE' },
        { url: 'javascript:alert(1)', kind: 'IMAGE' },
        { url: 'http://insecure.example/a.jpg', kind: 'IMAGE' },
      ],
    });
    expect(settings.buttonText).toBe('Peça agora');
    expect(settings.buttonStyle).toBe('PILL');
    expect(settings.buttonBg).toBe('#112233');
    expect(settings.buttonFg).toBe('#ffffff');
    expect(settings.imageSeconds).toBe(8);
    expect(settings.idleSeconds).toBe(120);
    expect(settings.slides).toEqual([
      { url: 'https://cdn.example/storage/v1/object/public/marketing-public/t/a.jpg', kind: 'IMAGE' },
    ]);
  });

  it('clamps times and falls back invalid colors to theme (null)', () => {
    const settings = normalizeTotemWelcome({
      imageSeconds: 1,
      idleSeconds: 10,
      buttonBg: 'red',
      buttonFg: '#fff',
      buttonStyle: 'WIDE',
    });
    expect(settings.imageSeconds).toBe(2);
    expect(settings.idleSeconds).toBe(30);
    expect(settings.buttonBg).toBeNull();
    expect(settings.buttonFg).toBeNull();
    expect(settings.buttonStyle).toBe('BAR');
  });
});

describe('totem button colors and contrast', () => {
  const theme = { accent: '#1D4ED8', accentText: '#FFFFFF' };

  it('uses theme colors when custom ones are null', () => {
    const colors = resolvedTotemButtonColors({ ...DEFAULT_TOTEM_WELCOME, slides: [] }, theme);
    expect(colors).toEqual({ background: '#1D4ED8', color: '#FFFFFF', fromTheme: true });
    expect(totemButtonContrastWarning(colors.color, colors.background)).toBeNull();
  });

  it('warns when custom colors are unreadable', () => {
    expect(totemButtonContrastWarning('#FFFF00', '#FFFFFF')).toMatch(/ilegível/);
    expect(totemButtonContrastWarning('#777777', '#555555')).toMatch(/baixo|ilegível/);
  });
});
