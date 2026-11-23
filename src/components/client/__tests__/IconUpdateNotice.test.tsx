// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { IconUpdateNotice, experimentalUpdateUrl, getUpdateOpenMode, getIconNoticeVisible, getReplacedScreenVisible, storeIconUpdateUrl, UPDATE_OPEN_MODE_KEY } from '../IconUpdateNotice';
import type { StoreIdentityInput } from '../../../lib/pwa/storeManifest';
import fs from 'node:fs';
import path from 'node:path';

const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/144.0 Mobile Safari/537.36';
const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const VERSION = '0123456789';
const slug = 'adega-show';
const store: StoreIdentityInput = {
  id: 'tenant-a', slug, name: 'Adega Show',
  appBaseLogoUrl: 'https://cdn.example/logo-original.png',
  logoConfirmedUrl: 'https://cdn.example/logo-atual.png',
  appBaseNavColor: '#334455', iconContentHash: '0123456789abcdef01234567',
  theme: { storeName: 'Adega Show', logoUrl: 'https://cdn.example/logo-atual.png',
    navBarColor: '#556677', headerColor: '#112233', statusBarColor: '#445566' },
};
function standalone(enabled: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: enabled && query === '(display-mode: standalone)', media: query,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(),
    removeEventListener: vi.fn(), dispatchEvent: vi.fn(), onchange: null,
  }) as unknown as MediaQueryList);
}
beforeEach(() => {
  localStorage.clear();
  standalone(true);
  window.history.replaceState(null, '', '/app/adega-show/');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('aviso único da instalação anterior', () => {
  it('mostra só título e um botão na instalação Android', () => {
    const ui = render(<IconUpdateNotice store={store} currentIdentity={VERSION} userAgent={android} />);
    const notice = ui.getByTestId('icon-update-notice');
    expect(notice.textContent).toContain('Atualize para a nova versão');
    expect(notice.textContent).not.toMatch(/ícone|logo|tela inicial/i);
    expect(notice.querySelectorAll('a,button')).toHaveLength(1);
    expect(ui.getByRole('button', { name: 'Atualizar' })).toBeTruthy();
    expect(getIconNoticeVisible()).toBe(true);
    expect(getReplacedScreenVisible()).toBe(false);
  });
  it('não monta aviso na aba normal', () => {
    standalone(false);
    const ui = render(<IconUpdateNotice store={store} currentIdentity={VERSION} userAgent={android} />);
    expect(ui.queryByTestId('icon-update-notice')).toBeNull();
    expect(getIconNoticeVisible()).toBe(false);
  });
  it('modo padrão window abre HTTPS da versão em nova janela, sem intent', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const ui = render(<IconUpdateNotice store={store} currentIdentity={VERSION} userAgent={android} />);
    const installUrl = `https://${window.location.host}/app/adega-show~0123456789/?instalar=1`;
    expect(getUpdateOpenMode()).toBe('window');
    expect(storeIconUpdateUrl(slug, VERSION, window.location.origin)).toBe(installUrl);
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    expect(open).toHaveBeenCalledWith(installUrl, '_blank', 'noopener');
    expect(ui.queryByTestId('icon-update-fallback')).toBeNull();
    expect(installUrl).not.toMatch(/ícone|icone|logo|reinstall/i);
  });
  it('janela bloqueada retorna para location.href na mesma janela', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const assigned = vi.fn();
    const original = window.location;
    vi.stubGlobal('location', { ...original, origin: original.origin, host: original.host,
      set href(value: string) { assigned(value); }, get href() { return original.href; } });
    const ui = render(<IconUpdateNotice store={store} currentIdentity={VERSION} userAgent={android} />);
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(assigned).toHaveBeenCalledWith(`https://${original.host}/app/adega-show~0123456789/?instalar=1`);
  });
  it('chrome-component usa intent VIEW/BROWSABLE com componente e fallback idêntico', async () => {
    localStorage.setItem(UPDATE_OPEN_MODE_KEY, 'chrome-component');
    const navigate = vi.fn();
    const ui = render(<IconUpdateNotice store={store} currentIdentity={VERSION} userAgent={android} onNavigate={navigate} />);
    const url = `https://${window.location.host}/app/adega-show~0123456789/?instalar=1`;
    const expected = `intent://${window.location.host}/app/adega-show~0123456789/?instalar=1#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;component=com.android.chrome/com.google.android.apps.chrome.Main;launchFlags=0x10000000;S.browser_fallback_url=${encodeURIComponent(url)};end`;
    expect(experimentalUpdateUrl('chrome-component', url)).toBe(expected);
    vi.useFakeTimers();
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    expect(navigate).toHaveBeenCalledWith(expected);
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(ui.getByTestId('icon-update-fallback').textContent).toContain('Para atualizar, abra este link no Chrome');
    vi.useRealTimers();
    expect(expected).not.toMatch(/ícone|icone|logo/i);
  });
  it('googlechrome-scheme é permitido apenas com override válido', () => {
    localStorage.setItem(UPDATE_OPEN_MODE_KEY, 'googlechrome-scheme');
    expect(getUpdateOpenMode()).toBe('googlechrome-scheme');
    const navigate = vi.fn();
    const ui = render(<IconUpdateNotice store={store} currentIdentity={VERSION} userAgent={android} onNavigate={navigate} />);
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    const url = `https://${window.location.host}/app/adega-show~0123456789/?instalar=1`;
    expect(navigate).toHaveBeenCalledWith(`googlechrome://navigate?url=${encodeURIComponent(url)}`);
    expect(experimentalUpdateUrl('googlechrome-scheme', url)).toBe(`googlechrome://navigate?url=${encodeURIComponent(url)}`);
  });
  it('override inválido volta ao modo window', () => {
    localStorage.setItem(UPDATE_OPEN_MODE_KEY, 'invalid');
    expect(getUpdateOpenMode()).toBe('window');
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const ui = render(<IconUpdateNotice store={store} currentIdentity={VERSION} userAgent={android} />);
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    expect(open).toHaveBeenCalledWith(expect.stringContaining('?instalar=1'), '_blank', 'noopener');
  });
  it('não mostra fallback quando aplicativo ficou oculto após modo experimental', async () => {
    localStorage.setItem(UPDATE_OPEN_MODE_KEY, 'chrome-component');
    vi.useFakeTimers();
    const ui = render(<IconUpdateNotice store={store} currentIdentity={VERSION} userAgent={android} onNavigate={vi.fn()} />);
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { vi.advanceTimersByTime(1900); });
    expect(ui.queryByTestId('icon-update-fallback')).toBeNull();
    visibility.mockRestore();
    vi.useRealTimers();
  });
  it('webview com modo experimental mostra fallback imediato', () => {
    localStorage.setItem(UPDATE_OPEN_MODE_KEY, 'chrome-component');
    const ui = render(<IconUpdateNotice store={store} currentIdentity={VERSION}
      userAgent="Mozilla/5.0 (Linux; Android 14; wv) Instagram" onNavigate={vi.fn()} />);
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    expect(ui.getByTestId('icon-update-fallback')).toBeTruthy();
  });
  it('iOS usa o botão Atualizar para copiar o link HTTPS da nova versão', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('navigator', { userAgent: ios, clipboard });
    const ui = render(<IconUpdateNotice store={store} currentIdentity={VERSION} />);
    expect(ui.queryByRole('link', { name: 'Atualizar' })).toBeNull();
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    await act(async () => { await Promise.resolve(); });
    expect(clipboard.writeText).toHaveBeenCalledWith(`https://${window.location.host}/app/adega-show~0123456789/`);
    const notice = ui.getByTestId('icon-update-notice');
    expect(notice.textContent).toContain('Link copiado. Abra no Safari para instalar a nova versão.');
    expect(notice.textContent).not.toMatch(/ícone|icone|logo|tela inicial/i);
    expect(notice.querySelectorAll('button,a')).toHaveLength(1);
    expect(getReplacedScreenVisible()).toBe(false);
  });
  it('iOS mostra endereço HTTPS selecionável se copiar falhar', async () => {
    const clipboard = { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) };
    vi.stubGlobal('navigator', { userAgent: ios, clipboard });
    const ui = render(<IconUpdateNotice store={store} currentIdentity={VERSION} />);
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    await act(async () => { await Promise.resolve(); });
    const notice = ui.getByTestId('icon-update-notice');
    expect(notice.textContent).toContain('Abra este endereço no Safari para instalar a nova versão.');
    expect(notice.textContent).toContain(`https://${window.location.host}/app/adega-show~0123456789/`);
    expect(notice.querySelector('.select-text')?.textContent).toBe(`https://${window.location.host}/app/adega-show~0123456789/`);
    expect(notice.textContent).not.toMatch(/ícone|icone|logo|tela inicial/i);
    expect(notice.querySelectorAll('button,a')).toHaveLength(1);
    expect(getReplacedScreenVisible()).toBe(false);
  });
  it('redirecionamento para versão nova respeita reloadUnsafe e ocorre apenas uma vez', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/client/ClientApp.tsx'), 'utf8');
    const guardIndex = client.indexOf('const reloadUnsafe =');
    const redirectIndex = client.indexOf('const versionedRedirectStarted = useRef(false);');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(redirectIndex).toBeGreaterThan(guardIndex);
    const effectEnd = '}, [previewMode, standalone, currentIdentity, slug, isLoadingStore, storeData, runningIdentity, reloadUnsafe]);';
    expect(client.indexOf(effectEnd, redirectIndex)).toBeGreaterThan(redirectIndex);
    const redirect = client.slice(redirectIndex, client.indexOf(effectEnd, redirectIndex) + effectEnd.length);
    expect(redirect).toContain('if (previewMode || standalone || !currentIdentity || !slug || isLoadingStore || !storeData || reloadUnsafe) return;');
    expect(redirect).toContain("new URLSearchParams(window.location.search).has('mesa')");
    expect(redirect).toContain("new URLSearchParams(window.location.search).get('preview') === '1'");
    expect(redirect).toContain('versionedRedirectStarted.current) return;');
    expect(redirect).toContain('versionedRedirectStarted.current = true;');
    expect(redirect).toContain('window.location.replace(destination);');
    expect(redirect).toContain('runningIdentity, reloadUnsafe]);');
    expect(client.match(/window.location.replace\(destination\)/g)).toHaveLength(1);
  });
  it('ClientApp não monta aviso de legado sobre o app ~hash atual, nem o guia de remoção', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/client/ClientApp.tsx'), 'utf8');
    expect(client).toContain("appStatus === 'update-available'");
    expect(client).toContain("appStatus === 'old-icon'");
    expect(client).toContain("appStatus === 'current'");
    expect(client).not.toContain('legacyIdentity && <AppIdentityUpdate');
    expect(client).not.toContain('IconUpdateBrowserGuide');
    expect(client).toContain("!iconNoticeVisible && (!runningIdentity || standalone) && <StoreVisualUpdateNotice");
    const toast = fs.readFileSync(path.resolve(process.cwd(), 'src/components/pwa/PwaUpdateToast.tsx'), 'utf8');
    expect(toast).toContain('if (!visible || iconNoticeVisible) return null');
  });
});
