// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import React from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStoreIdentity, identityHash } from '../applyStoreIdentity';
import {
  PWA_UPDATE_TOAST_TEXT,
  pwaVersionStorageKey,
  registerPwaServiceWorker,
  resetSwUpdateState,
  resolvePwaScope,
  type SwContainerLike,
  type SwRegistrationLike,
  type SwWorkerLike,
} from '../registerSw';

let act: typeof React.act;
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  resetSwUpdateState();
  localStorage.clear();
  sessionStorage.clear();
  document.head.innerHTML = '';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  ({ act } = await import('react'));
  const { createRoot } = await import('react-dom/client');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  resetSwUpdateState();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('escopos isolados por app (loja, garçom, entregador, cozinha)', () => {
  it('resolvePwaScope separa os escopos sem conflito', () => {
    expect(resolvePwaScope('/app/adega-premium')).toBe('/app/adega-premium/');
    expect(resolvePwaScope('/app/adega-premium/produto/1')).toBe('/app/adega-premium/');
    expect(resolvePwaScope('/garcom')).toBe('/garcom');
    expect(resolvePwaScope('/garcom/adega-premium')).toBe('/garcom');
    expect(resolvePwaScope('/entregador')).toBe('/entregador');
    expect(resolvePwaScope('/entregador/corridas')).toBe('/entregador');
    expect(resolvePwaScope('/convite-entregador')).toBe('/entregador');
    expect(resolvePwaScope('/cozinha')).toBe('/cozinha');
    expect(resolvePwaScope('/cozinha/parear')).toBe('/cozinha');
    expect(resolvePwaScope('/')).toBe('/');
  });
});

describe('applyStoreIdentity em runtime — URL estável do manifesto e atualização de ícone/theme-color', () => {
  it('mantém <link rel="manifest"> sem query variável e atualiza icon, apple-touch-icon e theme-color quando a identidade muda', async () => {
    document.head.innerHTML =
      '<link rel="manifest" href="/app/adega-premium/manifest.webmanifest?v=antigo" data-server-injected="1" data-store-slug="adega-premium" />';

    const storeV1 = {
      id: 'tenant-1',
      slug: 'adega-premium',
      name: 'Adega V1',
      theme: { storeName: 'Adega V1', primaryColor: '#15803d', logoUrl: 'https://cdn.example/v1.png' },
    };
    const storeV2 = {
      id: 'tenant-1',
      slug: 'adega-premium',
      name: 'Adega V2',
      theme: { storeName: 'Adega V2', primaryColor: '#b91c1c', logoUrl: 'https://cdn.example/v2.png' },
    };

    await applyStoreIdentity(storeV1);
    const manifestEl = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]')!;
    expect(manifestEl.getAttribute('href')).toBe('/app/adega-premium/manifest.webmanifest');

    const iconV1 = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')?.getAttribute('href');
    const appleV1 = document.head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.getAttribute('href');
    const themeV1 = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.getAttribute('content');
    expect(iconV1).toBe(`/app/adega-premium/icons/icon-192.png?v=${identityHash(storeV1)}`);
    expect(appleV1).toBe(iconV1);
    expect(themeV1).toBe('#15803d');

    await applyStoreIdentity(storeV2);
    expect(manifestEl.getAttribute('href')).toBe('/app/adega-premium/manifest.webmanifest');
    const iconV2 = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')?.getAttribute('href');
    const appleV2 = document.head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.getAttribute('href');
    const themeV2 = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.getAttribute('content');
    expect(iconV2).toBe(`/app/adega-premium/icons/icon-192.png?v=${identityHash(storeV2)}`);
    expect(iconV2).not.toBe(iconV1);
    expect(appleV2).toBe(iconV2);
    expect(themeV2).toBe('#b91c1c');
    expect(document.title).toBe('Adega V2');
  });
});

describe('registro do Service Worker e toast "Nova versão disponível — atualizar"', () => {
  it('exibe toast quando /api/pwa/version muda ou há worker em waiting, e envia SKIP_WAITING ao clicar', async () => {
    const { PwaUpdateToast } = await import('../../../components/pwa/PwaUpdateToast');
    await act(() => {
      root.render(<PwaUpdateToast />);
    });

    const swListeners: Record<string, (() => void)[]> = {};
    const waitingWorker: SwWorkerLike = {
      state: 'installed',
      postMessage: vi.fn(),
    };
    const reg: SwRegistrationLike = {
      scope: '/app/adega-premium/',
      waiting: null,
      update: vi.fn().mockResolvedValue(undefined),
    };
    const sw: SwContainerLike = {
      controller: {},
      register: vi.fn().mockResolvedValue(reg),
      addEventListener: (type, fn) => {
        (swListeners[type] ??= []).push(fn);
      },
    };
    const reload = vi.fn();

    // 1ª abertura grava a versão inicial sem abrir toast
    const fetchV1 = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: 'build-1', identityVersion: 'id-1' }), { status: 200 }),
    );
    await act(async () => {
      await registerPwaServiceWorker({
        pathname: '/app/adega-premium',
        serviceWorker: sw,
        fetchImpl: fetchV1 as unknown as typeof fetch,
        storage: localStorage,
        reload,
      });
    });

    expect(sw.register).toHaveBeenCalledWith('/sw.js', {
      scope: '/app/adega-premium/',
      updateViaCache: 'none',
    });
    expect(container.querySelector('[data-testid="pwa-update-toast"]')).toBeNull();
    expect(localStorage.getItem(pwaVersionStorageKey('/app/adega-premium/'))).toBe('build-1:id-1');

    // 2ª abertura com versão nova na API + worker em waiting -> exibe o toast
    reg.waiting = waitingWorker;
    const fetchV2 = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: 'build-2', identityVersion: 'id-2' }), { status: 200 }),
    );
    await act(async () => {
      await registerPwaServiceWorker({
        pathname: '/app/adega-premium',
        serviceWorker: sw,
        fetchImpl: fetchV2 as unknown as typeof fetch,
        storage: localStorage,
        reload,
      });
    });

    const toast = container.querySelector('[data-testid="pwa-update-toast"]');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain(PWA_UPDATE_TOAST_TEXT);

    // Usuário clica para atualizar -> envia SKIP_WAITING e recarrega no controllerchange
    await act(() => {
      container.querySelector<HTMLElement>('[data-testid="pwa-update-action"]')!.click();
    });
    expect(waitingWorker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(localStorage.getItem(pwaVersionStorageKey('/app/adega-premium/'))).toBe('build-2:id-2');

    await act(() => {
      swListeners.controllerchange?.forEach(fn => fn());
    });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('public/sw.js tem skipWaiting, clients.claim e ignora /api/* e pagamentos', () => {
    const swCode = readFileSync('public/sw.js', 'utf8');
    expect(swCode).toContain('skipWaiting');
    expect(swCode).toContain('clients.claim');
    expect(swCode).toContain("url.pathname.startsWith('/api/')");
    expect(swCode).toContain("url.pathname.includes('/payments')");
    expect(swCode).toContain("url.pathname.endsWith('.webmanifest')");
  });
});

