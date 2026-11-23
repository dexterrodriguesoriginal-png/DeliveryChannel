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
});

describe('VersionInstallScreen', () => {
  const options = {
    standalone: false, runningIdentity: '0123456789',
    currentIdentity: '0123456789', search: '?instalar=1', previewMode: false,
  };

  it('só é elegível na aba normal, no hash atual e com ?instalar=1', () => {
    expect(shouldShowVersionInstallScreen(options)).toBe(true);
    expect(shouldShowVersionInstallScreen({ ...options, standalone: true })).toBe(false);
    expect(shouldShowVersionInstallScreen({ ...options, runningIdentity: 'aaaaaaaaaa' })).toBe(false);
    expect(shouldShowVersionInstallScreen({ ...options, runningIdentity: null })).toBe(false);
    expect(shouldShowVersionInstallScreen({ ...options, currentIdentity: null })).toBe(false);
    expect(shouldShowVersionInstallScreen({ ...options, search: '' })).toBe(false);
    expect(shouldShowVersionInstallScreen({ ...options, search: '?instalar=0' })).toBe(false);
    expect(shouldShowVersionInstallScreen({ ...options, previewMode: true })).toBe(false);
  });

  it('mostra somente nome, logo e um botão Instalar; bloqueia demais avisos', () => {
    const ui = render(<VersionInstallScreen storeName="Mercado Sol"
      logoUrl="https://cdn.example/mercado.png" />);
    expect(ui.getByTestId('version-install-screen')).toBeTruthy();
    expect(ui.getByRole('heading', { name: 'Mercado Sol' })).toBeTruthy();
    expect(ui.getByRole('img', { name: 'Mercado Sol' })).toBeTruthy();
    expect(ui.getByRole('button', { name: 'Instalar' })).toBeTruthy();
    expect(ui.getByTestId('version-install-screen').querySelectorAll('button')).toHaveLength(1);
    expect(ui.queryByTestId('version-install-no-prompt')).toBeNull();
    expect(getIconNoticeVisible()).toBe(true);
    expect(getReplacedScreenVisible()).toBe(true);
    ui.unmount();
    expect(getIconNoticeVisible()).toBe(false);
    expect(getReplacedScreenVisible()).toBe(false);
  });

  it('sem beforeinstallprompt por 8 segundos mostra a única orientação alternativa', async () => {
    vi.useFakeTimers();
    const ui = render(<VersionInstallScreen storeName="Mercado Sol" />);
    expect(REINSTALL_PROMPT_WAIT_MS).toBe(8000);
    await act(async () => { vi.advanceTimersByTime(REINSTALL_PROMPT_WAIT_MS); });
    const guide = ui.getByTestId('version-install-no-prompt');
    expect(guide.textContent).toBe(INSTALL_NO_PROMPT_TEXT);
    expect(guide.textContent).toBe('Toque em ⋮ e em Abrir no Chrome');
    expect(ui.getByTestId('version-install-screen').querySelectorAll('p')).toHaveLength(1);
  });

  it('ClientApp entrega tema à tela e não monta avisos visuais em aba versionada', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/client/ClientApp.tsx'), 'utf8');
    expect(src).toContain('shouldShowVersionInstallScreen({');
    expect(src).toContain('<div style={activeCssVars}>');
    expect(src).toContain('<VersionInstallScreen');
    expect(src).toContain('(!runningIdentity || standalone) && <StoreVisualUpdateNotice');
    expect(src).toContain("!iconNoticeVisible && isLogoConfirmed(theme) && <InstallStoreAppHint");
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
