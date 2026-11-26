// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INSTALL_NO_PROMPT_TEXT, INSTALL_READY_TEXT, REINSTALL_PROMPT_WAIT_MS,
  shouldShowVersionInstallScreen, VersionInstallScreen,
} from '../VersionInstallScreen';
import { captureInstallEvents, clearDeferredPrompt } from '../../../lib/pwa/installState';
import { getIconNoticeVisible, getReplacedScreenVisible } from '../../client/IconUpdateNotice';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

beforeEach(() => clearDeferredPrompt());
afterEach(() => {
  cleanup();
  clearDeferredPrompt();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('VersionInstallScreen', () => {
  const options = {
    standalone: false, runningIdentity: '0123456789',
    currentIdentity: '0123456789', search: '?instalar=1', previewMode: false,
  };

  it('é elegível no hash atual com ?instalar=1, inclusive se o display-mode diz standalone', () => {
    expect(shouldShowVersionInstallScreen(options)).toBe(true);
    expect(shouldShowVersionInstallScreen({ ...options, standalone: true })).toBe(true);
    expect(shouldShowVersionInstallScreen({ ...options, runningIdentity: 'aaaaaaaaaa' })).toBe(false);
    expect(shouldShowVersionInstallScreen({ ...options, runningIdentity: null })).toBe(false);
    expect(shouldShowVersionInstallScreen({ ...options, currentIdentity: null })).toBe(false);
    expect(shouldShowVersionInstallScreen({ ...options, search: '' })).toBe(false);
    expect(shouldShowVersionInstallScreen({ ...options, search: '?source=pwa' })).toBe(false);
    expect(shouldShowVersionInstallScreen({ ...options, search: '?instalar=0' })).toBe(false);
    expect(shouldShowVersionInstallScreen({ ...options, previewMode: true })).toBe(false);
  });

  it('sem prompt mostra a orientação, Copiar link e Compartilhar, e bloqueia demais avisos', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    window.history.replaceState(null, '', '/app/mercado-sol~0123456789/?instalar=1');
    const ui = render(<VersionInstallScreen storeName="Mercado Sol"
      logoUrl="https://cdn.example/mercado.png" />);
    expect(ui.getByTestId('version-install-screen')).toBeTruthy();
    expect(ui.getByRole('heading', { name: 'Mercado Sol' })).toBeTruthy();
    expect(ui.getByRole('img', { name: 'Mercado Sol' })).toBeTruthy();
    expect(ui.queryByRole('button', { name: 'Instalar' })).toBeNull();
    expect(ui.getByTestId('version-install-no-prompt').textContent)
      .toBe('Toque em ⋮ no canto de cima e depois em "Abrir no Chrome"');
    expect(ui.getByTestId('version-install-copy-link').textContent).toContain('Copiar link');
    expect(ui.getByTestId('version-install-share').textContent).toContain('Compartilhar');
    await act(async () => {
      fireEvent.click(ui.getByTestId('version-install-copy-link'));
      await Promise.resolve();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.href);
    await act(async () => {
      fireEvent.click(ui.getByTestId('version-install-share'));
      await Promise.resolve();
    });
    expect(share).toHaveBeenCalledWith({ title: 'Mercado Sol', url: window.location.href });
    expect(getIconNoticeVisible()).toBe(true);
    expect(getReplacedScreenVisible()).toBe(true);
    ui.unmount();
    expect(getIconNoticeVisible()).toBe(false);
    expect(getReplacedScreenVisible()).toBe(false);
  });

  it('orientação fica visível imediatamente e continua após 8 segundos sem prompt', async () => {
    vi.useFakeTimers();
    const ui = render(<VersionInstallScreen storeName="Mercado Sol" />);
    expect(REINSTALL_PROMPT_WAIT_MS).toBe(8000);
    expect(ui.getByTestId('version-install-no-prompt').textContent).toBe(INSTALL_NO_PROMPT_TEXT);
    expect(ui.queryByTestId('version-install-button')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(REINSTALL_PROMPT_WAIT_MS); });
    expect(ui.getByTestId('version-install-no-prompt').textContent)
      .toBe('Toque em ⋮ no canto de cima e depois em "Abrir no Chrome"');
    vi.useRealTimers();
  });

  it('ClientApp trata ?instalar=1 como sessão explícita e não grava a identidade', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/client/ClientApp.tsx'), 'utf8');
    expect(src).toContain('shouldShowVersionInstallScreen({');
    expect(src).toContain('<div style={activeCssVars}>');
    expect(src).toContain('<VersionInstallScreen');
    expect(src).toContain('reinstallRequested: isInstallSession(window.location.search)');
    expect(src).toContain('if (isInstallSession(window.location.search) || isVisualUpdateSession(window.location.search)) return;');
    expect(src).toContain('(!runningIdentity || standalone) && <StoreVisualUpdateNotice');
    expect(src).toContain('!isVisualUpdateSession(window.location.search) && !iconNoticeVisible');
    expect(src).toContain("!iconNoticeVisible && isLogoConfirmed(theme) && <InstallStoreAppHint");
    const toast = readFileSync(resolve(process.cwd(), 'src/components/pwa/PwaUpdateToast.tsx'), 'utf8');
    expect(toast).toContain('isInstallSession(window.location.search)');
    const main = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8');
    expect(main).toContain('applyInstallSessionFromLocation(window)');
  });

  it('com prompt, Instalar é a ação principal; dispensado volta à orientação', async () => {
    captureInstallEvents(window);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt, userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    });
    const ui = render(<VersionInstallScreen storeName="Mercado Sol" />);
    expect(ui.queryByRole('button', { name: 'Instalar' })).toBeNull();
    await act(async () => { window.dispatchEvent(ev); });
    const install = ui.getByRole('button', { name: 'Instalar' }) as HTMLButtonElement;
    expect(install.disabled).toBe(false);
    expect(ui.queryByTestId('version-install-no-prompt')).toBeNull();
    await act(async () => {
      fireEvent.click(install);
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(ui.getByTestId('version-install-no-prompt').textContent).toBe(INSTALL_NO_PROMPT_TEXT);
    expect(ui.queryByTestId('version-install-success')).toBeNull();
  });

  // Mantido no final: appinstalled é um sinal global compartilhado pela origem.
  it('prompt aceito aguarda appinstalled antes de mostrar Pronto', async () => {
    captureInstallEvents(window);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    const ui = render(<VersionInstallScreen storeName="Mercado Sol" />);
    await act(async () => { window.dispatchEvent(ev); });
    const install = ui.getByRole('button', { name: 'Instalar' }) as HTMLButtonElement;
    expect(install.disabled).toBe(false);
    expect(ui.queryByTestId('version-install-no-prompt')).toBeNull();
    await act(async () => {
      fireEvent.click(install);
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(ui.queryByTestId('version-install-success')).toBeNull();
    await act(async () => { window.dispatchEvent(new Event('appinstalled')); });
    expect(ui.getByTestId('version-install-success').textContent).toBe(INSTALL_READY_TEXT);
    expect(ui.queryByRole('button', { name: 'Instalar' })).toBeNull();
  });
});
