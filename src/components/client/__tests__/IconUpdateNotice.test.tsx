// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { IconUpdateNotice, chromeIconUpdateIntent, getIconNoticeVisible, storeIconUpdateUrl } from '../IconUpdateNotice';
import fs from 'node:fs';
import path from 'node:path';

const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/144.0 Mobile Safari/537.36';
const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const VERSION = '0123456789';
const slug = 'adega-show';
function standalone(enabled: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: enabled && query === '(display-mode: standalone)', media: query,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(),
    removeEventListener: vi.fn(), dispatchEvent: vi.fn(), onchange: null,
  }) as unknown as MediaQueryList);
}
beforeEach(() => {
  standalone(true);
  window.history.replaceState(null, '', '/app/adega-show/');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('aviso único da instalação anterior', () => {
  it('mostra só título e um botão na instalação Android', () => {
    const ui = render(<IconUpdateNotice slug={slug} currentIdentity={VERSION} userAgent={android} />);
    const notice = ui.getByTestId('icon-update-notice');
    expect(notice.textContent).toContain('Atualize para a nova versão');
    expect(notice.textContent).not.toMatch(/ícone|logo|tela inicial/i);
    expect(notice.querySelectorAll('a,button')).toHaveLength(1);
    expect(ui.getByRole('link', { name: 'Atualizar' })).toBeTruthy();
    expect(getIconNoticeVisible()).toBe(true);
  });
  it('não monta aviso na aba normal', () => {
    standalone(false);
    const ui = render(<IconUpdateNotice slug={slug} currentIdentity={VERSION} userAgent={android} />);
    expect(ui.queryByTestId('icon-update-notice')).toBeNull();
    expect(getIconNoticeVisible()).toBe(false);
  });
  it('Android abre a URL HTTPS da nova instalação, com intent Chrome e fallback correspondente', () => {
    const navigate = vi.fn();
    const ui = render(<IconUpdateNotice slug={slug} currentIdentity={VERSION} userAgent={android} onNavigate={navigate} />);
    const url = `https://${window.location.host}/app/adega-show~0123456789/`;
    const expected = `intent://${window.location.host}/app/adega-show~0123456789/#Intent;scheme=https;package=com.android.chrome;launchFlags=0x10000000;S.browser_fallback_url=${encodeURIComponent(url)};end`;
    expect(storeIconUpdateUrl(slug, VERSION, window.location.origin)).toBe(url);
    expect(chromeIconUpdateIntent(slug, VERSION, window.location.origin)).toBe(expected);
    fireEvent.click(ui.getByRole('link', { name: 'Atualizar' }));
    expect(navigate).toHaveBeenCalledWith(expected);
    const anchor = ui.getByTestId('icon-update-open-chrome') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe(expected);
    expect(anchor.target).toBe('_blank');
    expect(anchor.rel).toContain('noopener');
    expect(expected).not.toMatch(/atualizar-app|reinstall=1|icone|logo/i);
  });
  it('em 1,5s mostra copiar link só se permaneceu visível e standalone', async () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('navigator', { userAgent: android, clipboard });
    const ui = render(<IconUpdateNotice slug={slug} currentIdentity={VERSION} onNavigate={navigate} />);
    fireEvent.click(ui.getByRole('link', { name: 'Atualizar' }));
    expect(ui.queryByTestId('icon-update-fallback')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(ui.getByTestId('icon-update-fallback').textContent).toContain('Para atualizar, abra este link no Chrome');
    fireEvent.click(ui.getByRole('button', { name: 'Copiar link' }));
    await act(async () => { await Promise.resolve(); });
    expect(clipboard.writeText).toHaveBeenCalledWith(`https://${window.location.host}/app/adega-show~0123456789/`);
  });
  it('não mostra fallback se visibilitychange informou que o Chrome abriu', async () => {
    vi.useFakeTimers();
    const ui = render(<IconUpdateNotice slug={slug} currentIdentity={VERSION} userAgent={android} onNavigate={vi.fn()} />);
    fireEvent.click(ui.getByRole('link', { name: 'Atualizar' }));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { vi.advanceTimersByTime(1900); });
    expect(ui.queryByTestId('icon-update-fallback')).toBeNull();
    visibility.mockRestore();
  });
  it('webview mostra o fallback imediato', () => {
    const ui = render(<IconUpdateNotice slug={slug} currentIdentity={VERSION}
      userAgent="Mozilla/5.0 (Linux; Android 14; wv) Instagram" onNavigate={vi.fn()} />);
    fireEvent.click(ui.getByRole('link', { name: 'Atualizar' }));
    expect(ui.getByTestId('icon-update-fallback')).toBeTruthy();
  });
  it('iOS usa o botão Atualizar para copiar o link HTTPS da nova versão', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('navigator', { userAgent: ios, clipboard });
    const ui = render(<IconUpdateNotice slug={slug} currentIdentity={VERSION} />);
    expect(ui.queryByRole('link', { name: 'Atualizar' })).toBeNull();
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    await act(async () => { await Promise.resolve(); });
    expect(clipboard.writeText).toHaveBeenCalledWith(`https://${window.location.host}/app/adega-show~0123456789/`);
  });
  it('ClientApp não monta aviso de legado sobre o app ~hash atual, nem o guia de remoção', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/client/ClientApp.tsx'), 'utf8');
    expect(client).toContain("appStatus === 'update-available'");
    expect(client).toContain("appStatus === 'old-icon'");
    expect(client).toContain("appStatus === 'current'");
    expect(client).not.toContain('legacyIdentity && <AppIdentityUpdate');
    expect(client).not.toContain('IconUpdateBrowserGuide');
    expect(client).toContain("!iconNoticeVisible && <StoreVisualUpdateNotice");
    const toast = fs.readFileSync(path.resolve(process.cwd(), 'src/components/pwa/PwaUpdateToast.tsx'), 'utf8');
    expect(toast).toContain('if (!visible || iconNoticeVisible) return null');
  });
});
