// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import {
  IconUpdateNotice, IconUpdateBrowserGuide, chromeIconUpdateIntent,
  iconUpdateDismissKey, ICON_UPDATE_TEXT,
} from '../IconUpdateNotice';
import { storeIconVersion, type StoreIdentityInput } from '../../../lib/pwa/storeManifest';
import { captureInstallEvents, clearDeferredPrompt } from '../../../lib/pwa/installState';

const A = 'https://cdn.example/loja-a.png';
const B = 'https://cdn.example/loja-b.png';
const store: StoreIdentityInput = {
  id: 'tenant-1', slug: 'adega-show', name: 'Adega Show',
  appBaseLogoUrl: A, logoConfirmedUrl: B, theme: { logoUrl: B },
};
const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/144.0 Mobile Safari/537.36';
const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const setStandalone = (enabled: boolean) => vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
  matches: enabled && query === '(display-mode: standalone)', media: query,
  addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(),
  removeEventListener: vi.fn(), dispatchEvent: vi.fn(), onchange: null,
}) as unknown as MediaQueryList);

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/app/adega-show/');
  setStandalone(true);
});
afterEach(() => { cleanup(); clearDeferredPrompt(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('aviso para atualizar ícone do PWA', () => {
  it('aparece instalado no Android quando a logo mudou e foi confirmada', () => {
    const ui = render(<IconUpdateNotice store={store} userAgent={android} />);
    expect(ui.getByTestId('icon-update-notice').textContent).toContain(ICON_UPDATE_TEXT);
    expect(ui.getByRole('button', { name: 'Atualizar ícone' })).toBeTruthy();
  });
  it('não aparece em aba normal nem se logo não mudou ou ainda não foi confirmada', () => {
    setStandalone(false);
    const ui = render(<IconUpdateNotice store={store} userAgent={android} />);
    expect(ui.queryByTestId('icon-update-notice')).toBeNull();
    cleanup();
    setStandalone(true);
    const same = render(<IconUpdateNotice store={{ ...store, appBaseLogoUrl: B }} userAgent={android} />);
    expect(same.queryByTestId('icon-update-notice')).toBeNull();
    cleanup();
    const pending = render(<IconUpdateNotice store={{ ...store, logoConfirmedUrl: A }} userAgent={android} />);
    expect(pending.queryByTestId('icon-update-notice')).toBeNull();
  });
  it('dispensa só a versão atual e volta quando a logo muda novamente', async () => {
    const ui = render(<IconUpdateNotice store={store} userAgent={android} />);
    fireEvent.click(ui.getByRole('button', { name: 'Dispensar aviso' }));
    const key = iconUpdateDismissKey(store.id, storeIconVersion(store));
    expect(localStorage.getItem(key)).toBe('1');
    expect(ui.queryByTestId('icon-update-notice')).toBeNull();
    cleanup();
    const again = render(<IconUpdateNotice store={store} userAgent={android} />);
    await waitFor(() => expect(again.queryByTestId('icon-update-notice')).toBeNull());
    cleanup();
    const newer = { ...store, logoConfirmedUrl: 'https://cdn.example/loja-c.png',
      theme: { logoUrl: 'https://cdn.example/loja-c.png' } };
    const changed = render(<IconUpdateNotice store={newer} userAgent={android} />);
    expect(changed.getByTestId('icon-update-notice')).toBeTruthy();
  });
  it('botão Android monta o intent:// com Chrome, origem da loja e query correta', () => {
    const navigate = vi.fn();
    const ui = render(<IconUpdateNotice store={store} userAgent={android} onNavigate={navigate} />);
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar ícone' }));
    const canonical = `https://${window.location.host}/app/adega-show/?atualizar_icone=1`;
    const expected = `intent://${window.location.host}/app/adega-show/?atualizar_icone=1#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(canonical)};end`;
    expect(chromeIconUpdateIntent(store.slug, window.location.origin)).toBe(expected);
    expect(navigate).toHaveBeenCalledWith(expected);
  });
  it('mostra fallback em 1,5s quando o WebAPK continua standalone e visível', async () => {
    vi.useFakeTimers();
    try {
      const navigate = vi.fn();
      const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
      vi.stubGlobal('navigator', { userAgent: android, clipboard });
      const ui = render(<IconUpdateNotice store={store} userAgent={android} onNavigate={navigate} />);
      fireEvent.click(ui.getByRole('button', { name: 'Atualizar ícone' }));
      expect(ui.queryByTestId('icon-update-fallback')).toBeNull();
      await act(async () => { vi.advanceTimersByTime(1500); });
      expect(ui.getByTestId('icon-update-fallback').textContent).toContain('Abrir no Chrome');
      fireEvent.click(ui.getByRole('button', { name: 'Copiar link' }));
      await act(async () => { await Promise.resolve(); });
      expect(clipboard.writeText).toHaveBeenCalledWith(
        `https://${window.location.host}/app/adega-show/?atualizar_icone=1`
      );
    } finally { vi.useRealTimers(); }
  });

  it('não mostra fallback quando visibilitychange indica que saiu do app', async () => {
    vi.useFakeTimers();
    try {
      const navigate = vi.fn();
      const ui = render(<IconUpdateNotice store={store} userAgent={android} onNavigate={navigate} />);
      fireEvent.click(ui.getByRole('button', { name: 'Atualizar ícone' }));
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      fireEvent(document, new Event('visibilitychange'));
      await act(async () => { vi.advanceTimersByTime(1800); });
      expect(ui.queryByTestId('icon-update-fallback')).toBeNull();
      visibility.mockRestore();
    } finally { vi.useRealTimers(); }
  });

  it('webview conhecido exibe o caminho alternativo sem esperar o timer', () => {
    const webview = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Instagram';
    const navigate = vi.fn();
    const ui = render(<IconUpdateNotice store={store} userAgent={webview} onNavigate={navigate} />);
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar ícone' }));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('package=com.android.chrome;'));
    expect(ui.getByTestId('icon-update-fallback').textContent).toContain('Abrir no Chrome');
  });

  it('guia abre em qualquer aba comum, inclusive navegador Android sem Chrome/', () => {
    setStandalone(false);
    const samsung = 'Mozilla/5.0 (Linux; Android 14) SamsungBrowser/27.0';
    vi.stubGlobal('navigator', { userAgent: samsung });
    window.history.replaceState(null, '', '/app/adega-show/?atualizar_icone=1');
    const ui = render(<IconUpdateBrowserGuide />);
    expect(ui.getByTestId('icon-update-guide').textContent).toContain('Passo 1.');
  });

  it('iPhone mostra instruções do Safari e copia o link da loja', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('navigator', { clipboard, userAgent: ios });
    const ui = render(<IconUpdateNotice store={store} userAgent={ios} />);
    expect(ui.queryByRole('button', { name: 'Atualizar ícone' })).toBeNull();
    expect(ui.getByText(/Abra no Safari/)).toBeTruthy();
    fireEvent.click(ui.getByRole('button', { name: 'Copiar link' }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(
      `${window.location.origin}/app/adega-show/`
    ));
  });
  it('Chrome externo aciona o evento beforeinstallprompt já capturado', async () => {
    setStandalone(false);
    window.history.replaceState(null, '', '/app/adega-show/?atualizar_icone=1');
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: android });
    captureInstallEvents(window);
    const ui = render(<IconUpdateBrowserGuide />);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    await act(async () => { window.dispatchEvent(event); });
    const button = ui.getByRole('button', { name: 'Instalar aplicativo' }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  });

  it('Chrome externo com parâmetro apresenta guia superior e usa beforeinstallprompt quando disponível', async () => {
    setStandalone(false);
    window.history.replaceState(null, '', '/app/adega-show/?atualizar_icone=1');
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: android });
    const ui = render(<IconUpdateBrowserGuide />);
    const guide = ui.getByTestId('icon-update-guide');
    expect(guide.className).toContain('top-');
    expect(guide.textContent).toContain('Passo 1.');
    expect(guide.textContent).toContain('Passo 2.');
    expect(guide.textContent).toContain('Se aparecer Abrir em vez de Instalar');
    expect((ui.getByRole('button', { name: 'Instalar aplicativo' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
