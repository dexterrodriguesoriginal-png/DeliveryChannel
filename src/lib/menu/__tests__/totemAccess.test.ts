import { describe, expect, it } from 'vitest';
import { totemPublicUrl, totemInstallUrl, totemQrFileName, normalizeTotemSlug } from '../totemAccess';

describe('totemPublicUrl', () => {
  it('builds the totem link from the current origin and store slug', () => {
    expect(totemPublicUrl('https://deliverychannel.example', 'adegasshow')).toBe(
      'https://deliverychannel.example/totem/adegasshow',
    );
  });

  it('strips a trailing slash, lowercases the slug, and keeps the origin only', () => {
    expect(totemPublicUrl('https://loja.exemplo.com.br/', 'AdegasShow')).toBe(
      'https://loja.exemplo.com.br/totem/adegasshow',
    );
    expect(totemPublicUrl('https://loja.exemplo.com.br/app', 'adegasshow')).toBe(
      'https://loja.exemplo.com.br/totem/adegasshow',
    );
  });

  it('builds the install link with ?install=1', () => {
    expect(totemInstallUrl('https://deliverychannel.example', 'adegasshow')).toBe(
      'https://deliverychannel.example/totem/adegasshow/?install=1',
    );
    expect(totemInstallUrl('', 'adegasshow')).toBe('');
  });

  it('returns an empty string for an invalid slug or origin', () => {
    expect(totemPublicUrl('https://loja.exemplo.com.br', '')).toBe('');
    expect(totemPublicUrl('https://loja.exemplo.com.br', '../evil')).toBe('');
    expect(totemPublicUrl('https://loja.exemplo.com.br', 'a')).toBe('');
    expect(totemPublicUrl('javascript:alert(1)', 'adegasshow')).toBe('');
    expect(totemPublicUrl('', 'adegasshow')).toBe('');
  });
});

describe('totemQrFileName', () => {
  it('names the PNG after the slug', () => {
    expect(totemQrFileName('AdegasShow')).toBe('totem-adegasshow.png');
    expect(totemQrFileName('???')).toBe('totem.png');
  });
});

describe('normalizeTotemSlug', () => {
  it('trims and lowercases', () => {
    expect(normalizeTotemSlug('  Adega-Show  ')).toBe('adega-show');
  });
});
