// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PhonePreview, fitScale, PHONE_W, PHONE_H, PHONE_BEZEL, NAV_H } from '../PhonePreview';
import { createDefaultThemeTokens } from '../../../lib/theme/themeEngine';
import { tokensToTheme } from '../../../lib/theme/themeEngine';

afterEach(cleanup);
const withBars = (bars?: { statusBarColor?: string; navBarColor?: string }) => {
  const t = createDefaultThemeTokens({ storeName: 'Loja' } as any);
  t.palette.bgHeader = '#111827';
  t.meta = { ...(t.meta || {}), ...(bars ? { systemBars: bars } : {}) };
  return tokensToTheme(t, { storeName: 'Loja' });
};
const rgb = (hex: string) => hex;

describe('celular inteiro com barras do Android', () => {
  it('mostra barra de status e barra de navegação com as cores escolhidas (ao vivo)', () => {
    const ui = render(<PhonePreview storeSlug="x" theme={withBars({ statusBarColor: '#d4a017', navBarColor: '#0b0b0f' })} />);
    expect((ui.getByTestId('phone-status-bar') as HTMLElement).style.backgroundColor).toBe(rgb('#d4a017'));
    expect((ui.getByTestId('phone-nav-bar') as HTMLElement).style.backgroundColor).toBe(rgb('#0b0b0f'));
    ui.rerender(<PhonePreview storeSlug="x" theme={withBars({ statusBarColor: '#ffffff', navBarColor: '#ffffff' })} />);
    expect((ui.getByTestId('phone-status-bar') as HTMLElement).style.backgroundColor).toBe(rgb('#ffffff'));
    expect((ui.getByTestId('phone-nav-bar') as HTMLElement).style.backgroundColor).toBe(rgb('#ffffff'));
  });
  it('sem escolha, as duas barras seguem a cor do cabeçalho', () => {
    const ui = render(<PhonePreview storeSlug="x" theme={withBars()} />);
    expect((ui.getByTestId('phone-status-bar') as HTMLElement).style.backgroundColor).toBe(rgb('#111827'));
    expect((ui.getByTestId('phone-nav-bar') as HTMLElement).style.backgroundColor).toBe(rgb('#111827'));
  });
  it('o iframe do app fica entre as barras e o celular tem proporção real (~9:19,5)', () => {
    const ui = render(<PhonePreview storeSlug="x" theme={withBars()} />);
    const frame = ui.getByTestId('store-replica-frame') as HTMLIFrameElement;
    expect(frame.style.width).toBe(`${PHONE_W}px`);
    expect(parseInt(frame.style.height)).toBe(PHONE_H - 34 - NAV_H);
    expect(PHONE_W / PHONE_H).toBeCloseTo(9 / 19.5, 1);
  });
});

describe('cabe sempre inteiro (1366x768, 1280x720, 1024x576)', () => {
  const outerW = PHONE_W + PHONE_BEZEL * 2, outerH = PHONE_H + PHONE_BEZEL * 2;
  it.each([[400, 430], [380, 400], [283, 250]])('coluna %ix%i: o aparelho escalado nunca passa da área', (w, h) => {
    const s = fitScale(w, h, outerW, outerH);
    expect(outerW * s).toBeLessThanOrEqual(w + 0.5);
    expect(outerH * s).toBeLessThanOrEqual(h + 0.5);
    expect(s).toBeLessThanOrEqual(1);
  });
  it('nunca amplia além de 100%', () => expect(fitScale(2000, 2000, outerW, outerH)).toBe(1));
});
