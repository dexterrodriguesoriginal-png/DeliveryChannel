// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import React from 'react';
import { bootScreenHtml, DC_BOOT_FADE_MS, DC_BOOT_HIDE_CLASS, DC_BOOT_SCREEN_ID, DC_PRESENTS_TEXT, hideBootScreen } from '../bootScreen';
import { DcBootScreen } from '../../../components/pwa/DcBootScreen';

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

describe('hideBootScreen', () => {
  it('faz fade e remove a #dc-boot do servidor; sem tela, não faz nada', () => {
    vi.useFakeTimers();
    document.body.innerHTML = bootScreenHtml() + '<div id="root"></div>';
    const el = document.getElementById(DC_BOOT_SCREEN_ID)!;
    hideBootScreen(document);
    expect(el.classList.contains(DC_BOOT_HIDE_CLASS)).toBe(true);
    vi.advanceTimersByTime(DC_BOOT_FADE_MS + 60);
    expect(document.getElementById(DC_BOOT_SCREEN_ID)).toBeNull();
    expect(() => hideBootScreen(document)).not.toThrow();
  });
});

describe('DcBootScreen (React) e fim do "AF"', () => {
  it('mostra a mesma apresentação, sem iniciais de outra loja', () => {
    const v = render(<DcBootScreen />);
    expect(v.getByText(DC_PRESENTS_TEXT)).toBeTruthy();
    expect(v.container.textContent).not.toMatch(/\bAF\b/);
  });

  it('nenhuma tela usa mais o selo "AF" fixo', () => {
    const files = ['src/App.tsx', 'src/pages/client/ClientApp.tsx', 'src/components/auth/LoginCard.tsx', 'src/components/auth/EmailConfirmationScreen.tsx', 'src/components/auth/TenantEmailConfirmationScreen.tsx'];
    for (const f of files) {
      const src = fs.readFileSync(path.resolve(process.cwd(), f), 'utf8');
      expect(src, f).not.toMatch(/^\s*AF\s*$/m);
    }
  });

  it('ClientApp tira a tela do servidor quando a vitrine termina de carregar', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/client/ClientApp.tsx'), 'utf8');
    expect(src).toMatch(/useEffect\(\(\) => \{ if \(!isLoadingStore\) hideBootScreen\(\); \}, \[isLoadingStore\]\);/);
    expect(src).toMatch(/if \(isLoadingStore\) \{[\s\S]{0,200}return <DcBootScreen \/>;/);
  });

  it('Google Fonts não seguram a primeira pintura (preload + troca para stylesheet, com noscript)', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).not.toMatch(/<link href="https:\/\/fonts\.googleapis\.com[^>]*rel="stylesheet">/);
    expect(html).toMatch(/<link rel="preload" as="style" href="https:\/\/fonts\.googleapis\.com[^"]+" onload="this\.onload=null;this\.rel='stylesheet'">/);
    expect(html).toMatch(/<noscript><link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/);
  });
});
