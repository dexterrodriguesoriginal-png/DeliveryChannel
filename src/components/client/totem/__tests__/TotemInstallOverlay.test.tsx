// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { persistInstallStart } from '../../../../lib/pwa/installProgress';

const { flags, promptFn, openInstalledApp } = vi.hoisted(() => {
  const promptFn = vi.fn(async () => undefined);
  const openInstalledApp = vi.fn();
  const flags = {
    standalone: false,
    platform: 'android-chrome' as string,
    installed: false,
    deferred: null as null | { prompt: typeof promptFn; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> },
  };
  return { flags, promptFn, openInstalledApp };
});

vi.mock('../../../../lib/pwa/installState', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/pwa/installState')>('../../../../lib/pwa/installState');
  return {
    ...actual,
    getDeferredPrompt: () => flags.deferred,
    wasAppInstalledEvent: () => flags.installed,
    clearDeferredPrompt: () => { flags.deferred = null; },
    subscribeInstall: (listener: () => void) => {
      const timer = window.setInterval(listener, 20);
      return () => window.clearInterval(timer);
    },
    supportsNativeInstall: () => flags.platform !== 'ios-safari' && flags.platform !== 'ios-other',
    isStandalone: () => flags.standalone,
    detectPlatform: () => flags.platform,
  };
});

vi.mock('../../../../lib/pwa/openInstalledApp', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/pwa/openInstalledApp')>('../../../../lib/pwa/openInstalledApp');
  return {
    ...actual,
    openInstalledApp: (...args: unknown[]) => openInstalledApp(...args),
  };
});

import { TotemInstallOverlay, TOTEM_CONTINUE_KEY } from '../TotemInstallOverlay';

const props = {
  slug: 'adegasshow',
  tenantId: 'tn',
  storeName: 'Adegas Show',
};

beforeEach(() => {
  flags.standalone = false;
  flags.platform = 'android-chrome';
  flags.installed = false;
  flags.deferred = null;
  promptFn.mockClear();
  openInstalledApp.mockClear();
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => cleanup());

describe('TotemInstallOverlay', () => {
  it('shows the install overlay on a normal browser visit, even without ?install=1', () => {
    render(<TotemInstallOverlay {...props} search="" />);
    expect(screen.getByTestId('totem-install-overlay')).toBeTruthy();
    expect(screen.getByTestId('totem-install-cta').textContent).toContain('Instalar totem');
    expect(screen.getByTestId('totem-install-continue').textContent).toContain('Continuar no navegador');
  });

  it('stays hidden in an already-installed fullscreen/standalone totem', () => {
    flags.standalone = true;
    render(<TotemInstallOverlay {...props} search="?install=1" />);
    expect(screen.queryByTestId('totem-install-overlay')).toBeNull();
  });

  it('hides after Continuar no navegador unless ?install=1 is present', () => {
    const view = render(<TotemInstallOverlay {...props} search="" />);
    fireEvent.click(screen.getByTestId('totem-install-continue'));
    expect(sessionStorage.getItem(TOTEM_CONTINUE_KEY('adegasshow'))).toBe('1');
    expect(screen.queryByTestId('totem-install-overlay')).toBeNull();

    view.unmount();
    render(<TotemInstallOverlay {...props} search="?install=1" />);
    expect(screen.getByTestId('totem-install-overlay')).toBeTruthy();
  });

  it('shows the iOS Share fallback instead of a native install button', () => {
    flags.platform = 'ios-safari';
    render(<TotemInstallOverlay {...props} search="" />);
    expect(screen.getByTestId('totem-install-ios').textContent).toMatch(/Adicionar à Tela de Início/);
    expect(screen.queryByTestId('totem-install-cta')).toBeNull();
    expect(screen.getByTestId('totem-install-continue')).toBeTruthy();
  });

  it('starts the estimated-time bar after the user accepts the native prompt', async () => {
    flags.deferred = { prompt: promptFn, userChoice: Promise.resolve({ outcome: 'accepted' }) };
    render(<TotemInstallOverlay {...props} search="?install=1" />);
    fireEvent.click(screen.getByTestId('totem-install-cta'));
    await waitFor(() => expect(promptFn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('install-progress')).toBeTruthy());
    expect(screen.getByTestId('totem-install-overlay').getAttribute('data-phase')).toBe('installing');
    expect(screen.getByTestId('install-progress').textContent).toMatch(/Instalando/);
  });

  it('shows the installing bar when forced for preview', () => {
    render(<TotemInstallOverlay {...props} forcePhase="installing" search="" />);
    expect(screen.getByTestId('install-progress')).toBeTruthy();
    expect(screen.getByText(/Instalando/)).toBeTruthy();
    expect(screen.getByTestId('install-progress-bar')).toBeTruthy();
  });

  it('on appinstalled shows ready copy, tries to open the totem, and offers Abrir totem if still visible', async () => {
    persistInstallStart(sessionStorage, 'totem:tn', Date.now() - 1000);
    flags.installed = true;
    render(<TotemInstallOverlay {...props} search="?install=1" />);
    await waitFor(() => expect(openInstalledApp).toHaveBeenCalled());
    expect(screen.getByTestId('totem-install-overlay').getAttribute('data-phase')).toBe('opening');
    expect(screen.getByText(/Pronto! Abrindo o totem/)).toBeTruthy();
    const openLink = screen.getByTestId('totem-install-open');
    expect(openLink.tagName).toBe('A');
    expect(openLink.getAttribute('target')).toBe('_blank');
    expect(openLink.getAttribute('href')).toBeTruthy();
    expect(openLink.textContent).toContain('Abrir totem');
    expect(screen.getByTestId('totem-install-open-hint').textContent).toMatch(/Abra o app Totem na tela inicial/);
    const opts = openInstalledApp.mock.calls[0]?.[1] as { onStillVisible?: () => void } | undefined;
    act(() => { opts?.onStillVisible?.(); });
    expect(screen.getByTestId('totem-install-overlay').getAttribute('data-phase')).toBe('done');
    expect(screen.getByTestId('totem-install-open').textContent).toContain('Abrir totem');
    expect(screen.getByTestId('totem-install-open-hint').textContent).toMatch(/Abra o app Totem na tela inicial/);
  });

  it('uses a vivid theme color when the store primary is the grey #717179', () => {
    render(<TotemInstallOverlay {...props} accent="#717179" search="" />);
    const cta = screen.getByTestId('totem-install-cta') as HTMLButtonElement;
    expect(cta.style.background.toLowerCase()).toBe('#176444');
    expect(cta.style.background.toLowerCase()).not.toBe('#717179');
  });

  it('renders the store logo in the overlay', () => {
    render(<TotemInstallOverlay {...props} logoUrl="https://cdn.example.com/loja.webp" search="" />);
    const img = document.querySelector('.dc-totem-install-logo') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/loja.webp');
  });

  it('keeps the theme-colored button while waiting for beforeinstallprompt', () => {
    render(<TotemInstallOverlay {...props} accent="#a7360f" search="" />);
    fireEvent.click(screen.getByTestId('totem-install-cta'));
    expect(screen.getByTestId('totem-install-waiting').textContent).toMatch(/Preparando a instalação/);
    const cta = screen.getByTestId('totem-install-cta') as HTMLButtonElement;
    expect((cta as HTMLButtonElement).style.background.toLowerCase()).toBe('#a7360f');
    expect(cta.getAttribute('aria-busy')).toBe('true');
  });

  it('when the totem is already installed, explains how to open or reinstall instead of a stuck grey button', async () => {
    render(<TotemInstallOverlay {...props} forceInstalled accent="#a7360f" search="" />);
    expect(screen.getByTestId('totem-install-overlay').getAttribute('data-already-installed')).toBe('true');
    expect(screen.getByTestId('totem-install-already').textContent).toMatch(
      /já está instalado neste aparelho/,
    );
    const cta = screen.getByTestId('totem-install-cta');
    expect(cta.textContent).toContain('Abrir totem');
    expect((cta as HTMLButtonElement).style.background.toLowerCase()).toBe('#a7360f');
    expect(screen.queryByTestId('totem-install-waiting')).toBeNull();
    expect(screen.queryByTestId('totem-install-notice')).toBeNull();
    fireEvent.click(cta);
    await waitFor(() => expect(openInstalledApp).toHaveBeenCalled());
  });
});
