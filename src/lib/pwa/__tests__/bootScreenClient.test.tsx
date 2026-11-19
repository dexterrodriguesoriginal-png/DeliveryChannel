// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import React from 'react';
import { storeBootScreenHtml, STORE_BOOT_FADE_MS, STORE_BOOT_HIDE_CLASS, STORE_BOOT_SCREEN_ID, hideBootScreen } from '../bootScreen';
import { StoreLoadingScreen } from '../../../components/pwa/StoreLoadingScreen';

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

describe('hideBootScreen', () => {
  it('faz fade e remove a #store-boot do servidor; sem tela, não faz nada', () => {
    vi.useFakeTimers();
    document.body.innerHTML = storeBootScreenHtml({ background: '#0a5c36', iconUrl: '/app/x/icons/icon-192.png?v=1', name: 'Loja' }) + '<div id="root"></div>';
    const el = document.getElementById(STORE_BOOT_SCREEN_ID)!;
    hideBootScreen(document);
    expect(el.classList.contains(STORE_BOOT_HIDE_CLASS)).toBe(true);
    vi.advanceTimersByTime(STORE_BOOT_FADE_MS + 60);
    expect(document.getElementById(STORE_BOOT_SCREEN_ID)).toBeNull();
    expect(() => hideBootScreen(document)).not.toThrow();
  });
});

describe('StoreLoadingScreen (React) e fim do "AF"', () => {
  it('neutro: sem "Delivery Channel apresenta" nem iniciais de outra loja', () => {
    const v = render(<StoreLoadingScreen />);
    expect(v.container.textContent).toBe('');
    expect(v.container.innerHTML).not.toContain('Delivery Channel');
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
    expect(src).toMatch(/if \(isLoadingStore\) \{[\s\S]{0,200}return <StoreLoadingScreen \/>;/);
  });

  it('Google Fonts não seguram a primeira pintura (preload + troca para stylesheet, com noscript)', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).not.toMatch(/<link href="https:\/\/fonts\.googleapis\.com[^>]*rel="stylesheet">/);
    expect(html).toMatch(/<link rel="preload" as="style" href="https:\/\/fonts\.googleapis\.com[^"]+" onload="this\.onload=null;this\.rel='stylesheet'">/);
    expect(html).toMatch(/<noscript><link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/);
  });
});
