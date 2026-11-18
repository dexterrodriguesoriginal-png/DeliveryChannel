import { expect, it } from 'vitest';
import { appTabBarColor, hasCustomAppTabBarColor } from '../appTabBar';
import { createDefaultThemeTokens, themeToTokens, tokensToTheme } from '../themeEngine';
import { TEMPLATES } from '../templates';

it.each([undefined, '#121245', '#ebc934'])('sem cor própria (tema antigo %s): segue a barra de navegação, inclusive depois de editá-la', nav => {
  const legacy = createDefaultThemeTokens();
  legacy.meta = { systemBars: { navBarColor: nav } };
  const theme = tokensToTheme(legacy, { storeName: 'Loja' });
  const normalized = themeToTokens(theme);
  expect(appTabBarColor(normalized)).toBe(nav || legacy.palette.bgHeader);
  expect(hasCustomAppTabBarColor(normalized)).toBe(false);
  normalized.meta!.systemBars = { navBarColor: '#747474' };
  const published = JSON.parse(JSON.stringify(tokensToTheme(normalized, theme)));
  expect(appTabBarColor(themeToTokens(published))).toBe('#747474');
});

it('cor própria salva da barra de ícones é sempre respeitada (não muda com a navegação)', () => {
  const tokens = createDefaultThemeTokens();
  tokens.meta = { appTabBarColor: '#d4a017', systemBars: { navBarColor: '#0b0b0f' } };
  const theme = tokensToTheme(tokens, { storeName: 'Loja' });
  const back = themeToTokens(JSON.parse(JSON.stringify(theme)));
  expect(appTabBarColor(back)).toBe('#d4a017');
  expect(hasCustomAppTabBarColor(back)).toBe(true);
  back.meta!.systemBars = { navBarColor: '#1d4ed8' };
  expect(appTabBarColor(back)).toBe('#d4a017');
});

it('cor inválida salva cai no padrão (barra de navegação)', () => {
  const tokens = createDefaultThemeTokens();
  tokens.meta = { appTabBarColor: 'red;}', systemBars: { navBarColor: '#0b0b0f' } };
  expect(appTabBarColor(tokens)).toBe('#0b0b0f');
});

it('os 500 modelos não fixam cor de ícones: seguem a navegação (e o cabeçalho sem navegação própria)', () => {
  expect(TEMPLATES).toHaveLength(500);
  for (const template of TEMPLATES) {
    const tokens = structuredClone(template.tokens);
    expect(tokens.meta?.appTabBarColor).toBeNull();
    tokens.meta!.systemBars = { navBarColor: '#747474' };
    expect(appTabBarColor(tokens)).toBe('#747474');
    tokens.meta!.systemBars = {};
    expect(appTabBarColor(tokens)).toBe(tokens.palette.bgHeader);
  }
});
