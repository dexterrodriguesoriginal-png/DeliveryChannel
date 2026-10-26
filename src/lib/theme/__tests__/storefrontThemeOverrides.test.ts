// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { themeToTokens, getSurfaceBackgroundStyle, generateCssVariables } from '../themeEngine';
import { shouldRefreshTheme, subscribeThemeRefresh, THEME_REFRESH_MIN_MS } from '../silentThemeRefresh';

// Formato real salvo em produção (ADEGASSHOW, 26/10): fundo geral em gradiente + paleta editada.
const saved = {
  primaryColor: '#991b1b',
  tokens: {
    version: 1,
    palette: { primary: '#991b1b', bgGeneral: '#fffaf5', bgHeader: '#ffffff', textTitle: '#1c1917', textSecondary: '#57534e' },
    backgrounds: {
      general: { type: 'gradient-linear', color: '#fffaf5', gradientStops: 2, gradientColors: ['#dd7106', '#166534'], positionX: 50, positionY: 50, zoom: 100 },
      header: { type: 'solid', color: '#ffffff' }, card: { type: 'solid', color: '#ffffff' },
    },
  },
} as any;

describe('vitrine aplica as edições salvas por cima do modelo', () => {
  it('fundo geral em gradiente salvo vira background-image na vitrine', () => {
    const tokens = themeToTokens(saved);
    const style = getSurfaceBackgroundStyle(tokens.backgrounds.general, tokens.palette.bgGeneral);
    expect(String(style.backgroundImage)).toMatch(/linear-gradient\(.*#dd7106.*#166534/);
    expect(generateCssVariables(tokens)['--dc-text-title' as keyof object]).toBe('#1c1917');
  });

  it('ClientApp usa o fundo completo do tema e cores do tema no cabeçalho (sem cores fixas)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../pages/client/ClientApp.tsx'), 'utf8');
    expect(src).toContain('getSurfaceBackgroundStyle(activeTokens.backgrounds.general');
    const header = src.slice(src.indexOf('data-testid="store-header-title"'), src.indexOf('data-testid="store-header-title"') + 900);
    expect(header).toContain('var(--dc-text-title)');
    expect(header).not.toMatch(/text-gray-900|text-emerald-700/);
    const bar = src.slice(src.indexOf('data-testid="staff-preview-bar"'), src.indexOf('data-testid="staff-preview-bar"') + 1500);
    expect(bar).toContain('var(--dc-primary)');
    expect(bar).not.toMatch(/bg-slate-950|bg-emerald-700/);
  });
});

describe('atualização silenciosa do tema', () => {
  it('só atualiza com a tela visível e após 30 s', () => {
    expect(shouldRefreshTheme(0, THEME_REFRESH_MIN_MS + 1, true)).toBe(true);
    expect(shouldRefreshTheme(0, THEME_REFRESH_MIN_MS - 1, true)).toBe(false);
    expect(shouldRefreshTheme(0, THEME_REFRESH_MIN_MS + 1, false)).toBe(false);
  });
  it('dispara ao voltar para a aba (visibilitychange) e ao focar, e limpa os ouvintes', () => {
    const fn = vi.fn();
    const stop = subscribeThemeRefresh(window, document, fn);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
    window.dispatchEvent(new Event('focus'));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
