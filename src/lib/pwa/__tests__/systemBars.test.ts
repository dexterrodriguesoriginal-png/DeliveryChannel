import { describe, it, expect } from 'vitest';
import { resolveSystemBars, normalizeBarColor, isDarkColor, BAR_PRESETS, systemBarsFromTokens } from '../systemBars';
import { buildStoreManifest } from '../storeManifest';

describe('cores das barras do sistema', () => {
  it('padrão = cor do cabeçalho; escolhas da loja têm prioridade', () => {
    expect(resolveSystemBars({ headerColor: '#111827', primaryColor: '#b91c1c' })).toMatchObject({ status: '#111827', nav: '#111827', colorScheme: 'dark' });
    expect(resolveSystemBars({ headerColor: '#111827', statusBarColor: '#D4A017', navBarColor: '#ffffff' })).toMatchObject({ status: '#d4a017', nav: '#ffffff', colorScheme: 'light' });
  });
  it('só aceita hex válido (3 ou 6 dígitos)', () => {
    expect(normalizeBarColor('#abc')).toBe('#aabbcc');
    for (const bad of ['red', 'url(x)', '#12', '#gggggg', '', null, 42]) expect(normalizeBarColor(bad)).toBeNull();
  });
  it('tem atalho dourado e detecta claro/escuro', () => {
    expect(BAR_PRESETS.find((p) => p.id === 'dourado')?.color).toBe('#d4a017');
    expect(isDarkColor('#0b0b0f')).toBe(true);
    expect(isDarkColor('#ffffff')).toBe(false);
  });
  it('lê dos tokens: palette.bgHeader + meta.systemBars', () => {
    const b = systemBarsFromTokens({ palette: { bgHeader: '#101010' }, meta: { systemBars: { statusBarColor: '#d4a017' } } });
    expect(b.status).toBe('#d4a017');
    expect(b.nav).toBe('#101010');
  });
  it('manifesto: theme_color = status, background_color = navegação', () => {
    const m = buildStoreManifest({ id: 't', slug: 's', name: 'S', theme: { primaryColor: '#b91c1c', headerColor: '#111827', statusBarColor: '#d4a017', navBarColor: '#0b0b0f' } }, 'https://x.app');
    expect(m.theme_color).toBe('#d4a017');
    expect(m.background_color).toBe('#0b0b0f');
  });
});
