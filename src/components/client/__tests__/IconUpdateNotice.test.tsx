// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import {
  IconUpdateNotice, IconUpdateBrowserGuide, IconUpdateGuidePage, chromeIconUpdateIntent,
  iconUpdateDismissKey, ICON_UPDATE_TEXT, getIconNoticeVisible,
} from '../IconUpdateNotice';
import { storeIconVersion, type StoreIdentityInput } from '../../../lib/pwa/storeManifest';
import { clearDeferredPrompt } from '../../../lib/pwa/installState';
import fs from 'node:fs';
import path from 'node:path';

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
    expect(ui.getByText('Atualize para a nova versão')).toBeTruthy();
    expect(ui.getByTestId('icon-update-notice').textContent).not.toMatch(/ícone|logo|tela inicial/i);
    expect(ui.getByRole('link', { name: 'Atualizar' })).toBeTruthy();
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
    fireEvent.click(ui.getByRole('button', { name: 'Dispensar aviso de atualização' }));
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
    fireEvent.click(ui.getByRole('link', { name: 'Atualizar' }));
    const canonical = `https://${window.location.host}/atualizar-app/adega-show`;
    const expected = `intent://${window.location.host}/atualizar-app/adega-show#Intent;scheme=https;package=com.android.chrome;launchFlags=0x10000000;S.browser_fallback_url=${encodeURIComponent(canonical)};end`;
    expect(chromeIconUpdateIntent(store.slug, window.location.origin)).toBe(expected);
    expect(navigate).toHaveBeenCalledWith(expected);
    const anchor = ui.getByTestId('icon-update-open-chrome') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe(expected);
    expect(anchor.target).toBe('_blank');
    expect(anchor.rel).toContain('noopener');
  });
  it('mostra fallback em 1,5s quando o WebAPK continua standalone e visível', async () => {
    vi.useFakeTimers();
    try {
      const navigate = vi.fn();
      const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
      vi.stubGlobal('navigator', { userAgent: android, clipboard });
      const ui = render(<IconUpdateNotice store={store} userAgent={android} onNavigate={navigate} />);
      fireEvent.click(ui.getByRole('link', { name: 'Atualizar' }));
      expect(ui.queryByTestId('icon-update-fallback')).toBeNull();
      await act(async () => { vi.advanceTimersByTime(1500); });
      expect(ui.getByTestId('icon-update-fallback').textContent).toContain('Para atualizar, abra este link no Chrome');
      fireEvent.click(ui.getByRole('button', { name: 'Copiar link' }));
      await act(async () => { await Promise.resolve(); });
      expect(clipboard.writeText).toHaveBeenCalledWith(
        `https://${window.location.host}/atualizar-app/adega-show`
      );
    } finally { vi.useRealTimers(); }
  });

  it('não mostra fallback quando visibilitychange indica que saiu do app', async () => {
    vi.useFakeTimers();
    try {
      const navigate = vi.fn();
      const ui = render(<IconUpdateNotice store={store} userAgent={android} onNavigate={navigate} />);
      fireEvent.click(ui.getByRole('link', { name: 'Atualizar' }));
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
    fireEvent.click(ui.getByRole('link', { name: 'Atualizar' }));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('package=com.android.chrome;'));
    expect(ui.getByTestId('icon-update-fallback').textContent).toContain('Abrir no Chrome');
  });

  it('guia abre em qualquer aba comum, inclusive navegador Android sem Chrome/', () => {
    setStandalone(false);
    const samsung = 'Mozilla/5.0 (Linux; Android 14) SamsungBrowser/27.0';
    vi.stubGlobal('navigator', { userAgent: samsung });
    window.history.replaceState(null, '', '/atualizar-app/adega-show');
    const ui = render(<IconUpdateBrowserGuide slug="adega-show" />);
    expect(ui.getByTestId('icon-update-guide').textContent).toContain('Passo 1.');
  });

  it('iPhone mostra instruções do Safari e copia o link da loja', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('navigator', { clipboard, userAgent: ios });
    const ui = render(<IconUpdateNotice store={store} userAgent={ios} />);
    expect(ui.queryByRole('link', { name: 'Atualizar' })).toBeNull();
    expect(ui.getByText('Atualize para a nova versão')).toBeTruthy();
    expect(ui.queryByText(/Abra-o no Safari/)).toBeNull();
    expect(ui.getByTestId('icon-update-notice').textContent).not.toMatch(/ícone|logo|tela inicial/i);
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(
      `${window.location.origin}/app/adega-show/`
    ));
  });
  it('link do guia fora do scope aponta para a loja, sem instalar o app global', () => {
    const ui = render(<IconUpdateBrowserGuide slug="adega-show" storeName="Adega Show"
      logoUrl="https://cdn.example/logo.png" />);
    const guide = ui.getByTestId('icon-update-guide');
    expect(guide.textContent).toContain('Passo 1.');
    expect(guide.textContent).toContain('Passo 2.');
    expect(guide.textContent).toContain('Remova a versão antiga do app (toque e segure o app na tela inicial e escolha Remover/Desinstalar).');
    expect(guide.textContent).not.toContain('Se não aparecer a instalação');
    expect(guide.textContent).toContain('Se aparecer Abrir em vez de Instalar');
    const install = ui.getByRole('link', { name: 'Instalar aplicativo' }) as HTMLAnchorElement;
    expect(install.getAttribute('href')).toBe('/app/adega-show/');
    expect(ui.getByAltText('Imagem de Adega Show')).toBeTruthy();
    expect(guide.textContent).toContain('Atualize o app Adega Show');
    expect(guide.textContent).toContain('Remova a versão antiga do app');
    expect(guide.textContent).toContain('Toque em Instalar aplicativo.');
    expect(guide.textContent).not.toMatch(/ícone|logo/i);
  });

  it('rota dedicada /atualizar-app/:slug monta guia independente do scope', async () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(src).toContain('IconUpdateGuidePage slug={slug}');
    expect(src).toContain('atualizar-app');
    const ui = render(<IconUpdateGuidePage slug="adega-show" />);
    expect(ui.getByTestId('icon-update-guide-page')).toBeTruthy();
    expect(ui.getByRole('link', { name: 'Instalar aplicativo' }).getAttribute('href')).toBe('/app/adega-show/');
  });

  it('esconde as outras notificações enquanto o aviso de ícone estiver na tela', async () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/client/ClientApp.tsx'), 'utf8');
    const toast = fs.readFileSync(path.resolve(process.cwd(), 'src/components/pwa/PwaUpdateToast.tsx'), 'utf8');
    expect(client).toContain('!iconNoticeVisible && <StoreVisualUpdateNotice');
    expect(toast).toContain('if (!visible || iconNoticeVisible) return null');
    const ui = render(<IconUpdateNotice store={store} userAgent={android} />);
    await waitFor(() => expect(getIconNoticeVisible()).toBe(true));
    fireEvent.click(ui.getByRole('button', { name: 'Dispensar aviso de atualização' }));
    await waitFor(() => expect(getIconNoticeVisible()).toBe(false));
  });

});
