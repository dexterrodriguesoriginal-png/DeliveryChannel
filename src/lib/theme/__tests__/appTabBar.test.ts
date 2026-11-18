import { expect, it } from 'vitest';
import { appTabBarColor } from '../appTabBar';
import { createDefaultThemeTokens, themeToTokens, tokensToTheme } from '../themeEngine';
import { TEMPLATES } from '../templates';

it.each([undefined, '#121245', '#ebc934'])('preserves legacy appearance on publish and freezes it before editing Android navigation (%s)', nav => {
  const legacy = createDefaultThemeTokens();
  legacy.meta = { systemBars: { navBarColor: nav } };
  const expected = nav || legacy.palette.bgHeader;
  const theme = tokensToTheme(legacy, { storeName: 'Loja' });
  const normalized = themeToTokens(theme);
  expect(appTabBarColor(normalized)).toBe(expected);
  normalized.meta!.systemBars = { navBarColor: '#747474' };
  const published = JSON.parse(JSON.stringify(tokensToTheme(normalized, theme)));
  expect(appTabBarColor(themeToTokens(published))).toBe(expected);
});

it('all 500 templates explicitly inherit the header independently of system navigation', () => {
  expect(TEMPLATES).toHaveLength(500);
  for (const template of TEMPLATES) {
    const tokens = structuredClone(template.tokens);
    expect(tokens.meta?.appTabBarColor).toBeNull();
    tokens.meta!.systemBars = { navBarColor: '#747474' };
    expect(appTabBarColor(tokens)).toBe(tokens.palette.bgHeader);
  }
});
