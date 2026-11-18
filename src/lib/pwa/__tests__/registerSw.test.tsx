// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import React from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStoreIdentity, identityHash } from '../applyStoreIdentity';
import {
  AUTO_RELOAD_GUARD_KEY,
  AUTO_RELOAD_GUARD_MS,
  PWA_UPDATE_TOAST_TEXT,
  REFRESH_FALLBACK_MS,
  RESUME_CHECK_MIN_MS,
  refreshInstalledApp,
  applySwUpdate,
  claimAutoReload,
  isAutoReloadSafe,
  isSwUpdateAvailable,
  pwaVersionStorageKey,
  registerPwaServiceWorker,
  resetSwUpdateState,
  resolvePwaScope,
  setPwaAutoReloadBlocked,
  type AutoUpdateWindowLike,
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
    expect(resolvePwaScope('/totem/adegasshow')).toBe('/');
    expect(resolvePwaScope('/totem/adegasshow/?install=1')).toBe('/');
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

describe('registro do Service Worker: versão nova em toda abertura, recarga automática segura', () => {
  type Listeners = Record<string, ((e?: any) => void)[]>;
  function setup(opts: { controller?: boolean; pathname?: string; search?: string; active?: unknown } = {}) {
    const swListeners: Listeners = {};
    const docListeners: Listeners = {};
    const winListeners: Listeners = {};
    const reg: SwRegistrationLike = { scope: '/app/adega-premium/', waiting: null, update: vi.fn().mockResolvedValue(undefined) };
    const sw: SwContainerLike = {
      controller: opts.controller === false ? null : {},
      register: vi.fn().mockResolvedValue(reg),
      addEventListener: (type, fn) => { (swListeners[type] ??= []).push(fn); },
    };
    const doc = {
      visibilityState: 'visible',
      activeElement: opts.active ?? null,
      addEventListener: (type: string, fn: () => void) => { (docListeners[type] ??= []).push(fn); },
    };
    const self = {};
    const win: AutoUpdateWindowLike = {
      location: { pathname: opts.pathname ?? '/app/adega-premium/', search: opts.search ?? '' },
      document: doc,
      addEventListener: (type, fn) => { (winListeners[type] ??= []).push(fn); },
      top: self, self,
    };
    const reload = vi.fn();
    let now = 1_000_000;
    let remote = { version: 'build-1', identityVersion: 'id-1' };
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify(remote), { status: 200 }));
    const run = () => registerPwaServiceWorker({
      pathname: win.location!.pathname!, serviceWorker: sw, fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: localStorage, session: sessionStorage, reload, win, now: () => now,
    });
    const resume = async () => { docListeners.visibilitychange?.forEach(fn => fn()); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); };
    return {
      reg, sw, doc, win, reload, fetchImpl, run, resume, swListeners, docListeners, winListeners,
      setRemote: (v: typeof remote) => { remote = v; },
      advance: (ms: number) => { now += ms; },
    };
  }

  it('abertura: registra o SW sem cache HTTP, procura sw.js novo e grava a versão (página recém-carregada já é a nova)', async () => {
    const t = setup();
    await t.run();
    expect(t.sw.register).toHaveBeenCalledWith('/sw.js', { scope: '/app/adega-premium/', updateViaCache: 'none' });
    expect(t.reg.update).toHaveBeenCalled();
    expect(localStorage.getItem(pwaVersionStorageKey('/app/adega-premium/'))).toBe('build-1:id-1');
    // Nova abertura (cold start) com versão nova: só atualiza o registro, sem toast e sem recarregar.
    t.setRemote({ version: 'build-2', identityVersion: 'id-1' });
    await t.run();
    expect(localStorage.getItem(pwaVersionStorageKey('/app/adega-premium/'))).toBe('build-2:id-1');
    expect(isSwUpdateAvailable()).toBe(false);
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('ao voltar para o app com versão nova: confere de novo e recarrega UMA vez (anti-loop), sem nova recarga em seguida', async () => {
    const t = setup();
    await t.run();
    t.advance(RESUME_CHECK_MIN_MS + 1);
    t.setRemote({ version: 'build-2', identityVersion: 'id-1' });
    await t.resume();
    expect(t.reload).toHaveBeenCalledOnce();
    expect(localStorage.getItem(pwaVersionStorageKey('/app/adega-premium/'))).toBe('build-2:id-1');
    expect(Number(sessionStorage.getItem(AUTO_RELOAD_GUARD_KEY))).toBeGreaterThan(0);
    // Outra versão logo depois (ainda na janela anti-loop): não recarrega de novo, mostra o toast.
    t.advance(RESUME_CHECK_MIN_MS + 1);
    t.setRemote({ version: 'build-3', identityVersion: 'id-1' });
    await t.resume();
    expect(t.reload).toHaveBeenCalledOnce();
    expect(isSwUpdateAvailable()).toBe(true);
  });

  it('outra aba aberta depois do deploy grava a versão nova: esta página antiga ainda detecta ao voltar', async () => {
    const t = setup();
    await t.run();
    // Outra aba (documento novo) já gravou a versão nova no localStorage compartilhado.
    localStorage.setItem(pwaVersionStorageKey('/app/adega-premium/'), 'build-2:id-1');
    t.advance(RESUME_CHECK_MIN_MS + 1);
    t.setRemote({ version: 'build-2', identityVersion: 'id-1' });
    await t.resume();
    expect(t.reload).toHaveBeenCalledOnce();
  });

  it('versão igual à carregada ao voltar: não recarrega nem mostra toast', async () => {
    const t = setup();
    await t.run();
    t.advance(RESUME_CHECK_MIN_MS + 1);
    await t.resume();
    expect(t.reload).not.toHaveBeenCalled();
    expect(isSwUpdateAvailable()).toBe(false);
  });

  it('verificações ao voltar são espaçadas (sem rajada ao alternar apps)', async () => {
    const t = setup();
    await t.run();
    const calls = t.fetchImpl.mock.calls.length;
    await t.resume();
    expect(t.fetchImpl.mock.calls.length).toBe(calls);
    t.advance(RESUME_CHECK_MIN_MS + 1);
    await t.resume();
    expect(t.fetchImpl.mock.calls.length).toBe(calls + 1);
  });

  it.each([
    ['checkout aberto', () => setPwaAutoReloadBlocked('client-app', true), {}],
    ['campo de texto em edição', () => {}, { active: { tagName: 'INPUT', type: 'text' } }],
    ['QR de mesa (?mesa=)', () => {}, { search: '?mesa=abc' }],
    ['painel (fora do app da loja)', () => {}, { pathname: '/' }],
  ])('não recarrega sozinho com %s: mostra o toast e só atualiza ao clicar', async (_label, block, o) => {
    const t = setup(o as any);
    block();
    await t.run();
    t.advance(RESUME_CHECK_MIN_MS + 1);
    t.setRemote({ version: 'build-2', identityVersion: 'id-1' });
    await t.resume();
    expect(t.reload).not.toHaveBeenCalled();
    expect(isSwUpdateAvailable()).toBe(true);
    applySwUpdate();
    expect(t.reload).toHaveBeenCalledOnce();
  });

  it('worker novo em waiting: ativa na hora (SKIP_WAITING) e recarrega uma vez no controllerchange', async () => {
    const t = setup();
    const waiting: SwWorkerLike = { state: 'installed', postMessage: vi.fn() };
    t.reg.waiting = waiting;
    await t.run();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    t.swListeners.controllerchange?.forEach(fn => fn());
    expect(t.reload).toHaveBeenCalledOnce();
    // Segundo controllerchange (ex.: outro worker) não recarrega de novo.
    t.swListeners.controllerchange?.forEach(fn => fn());
    expect(t.reload).toHaveBeenCalledOnce();
  });

  it('primeira instalação do SW (sem controller): clients.claim não recarrega a página', async () => {
    const t = setup({ controller: false });
    await t.run();
    t.swListeners.controllerchange?.forEach(fn => fn());
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('toast manual continua funcionando: clique envia SKIP_WAITING e recarrega no controllerchange', async () => {
    const { PwaUpdateToast } = await import('../../../components/pwa/PwaUpdateToast');
    await act(() => { root.render(<PwaUpdateToast />); });
    const t = setup();
    setPwaAutoReloadBlocked('client-app', true);
    const waiting: SwWorkerLike = { state: 'installed', postMessage: vi.fn() };
    await act(async () => { await t.run(); });
    t.reg.waiting = waiting;
    t.advance(RESUME_CHECK_MIN_MS + 1);
    t.setRemote({ version: 'build-2', identityVersion: 'id-2' });
    await act(async () => { await t.resume(); });
    const toast = container.querySelector('[data-testid="pwa-update-toast"]');
    expect(toast?.textContent).toContain(PWA_UPDATE_TOAST_TEXT);
    await act(() => { container.querySelector<HTMLElement>('[data-testid="pwa-update-action"]')!.click(); });
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    await act(() => { t.swListeners.controllerchange?.forEach(fn => fn()); });
    expect(t.reload).toHaveBeenCalledOnce();
  });

  it('worker que esperava já ativou sozinho com o checkout aberto: o clique no toast recarrega na hora', async () => {
    const t = setup();
    setPwaAutoReloadBlocked('client-app', true);
    await t.run();
    const waiting: SwWorkerLike = { state: 'installed', postMessage: vi.fn() };
    t.reg.waiting = waiting;
    t.advance(RESUME_CHECK_MIN_MS + 1);
    t.setRemote({ version: 'build-2', identityVersion: 'id-1' });
    await t.resume();
    expect(isSwUpdateAvailable()).toBe(true);
    waiting.state = 'activated';
    t.reg.waiting = null;
    t.swListeners.controllerchange?.forEach(fn => fn());
    expect(t.reload).not.toHaveBeenCalled();
    applySwUpdate();
    expect(waiting.postMessage).not.toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(t.reload).toHaveBeenCalledOnce();
  });

  it('refreshInstalledApp ("Atualizar app"): ativa o worker em espera, limpa o Cache Storage, mantém localStorage e recarrega uma vez', async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      await t.run();
      localStorage.setItem('adegafood_cart_tenant-1', '[{"id":"p1"}]');
      localStorage.setItem('sb-qjm-auth-token', 'sessao');
      const waiting: SwWorkerLike = { state: 'installed', postMessage: vi.fn() };
      t.reg.waiting = waiting;
      const cacheStorage = { keys: vi.fn().mockResolvedValue(['a', 'b']), delete: vi.fn().mockResolvedValue(true) };
      await refreshInstalledApp({ cacheStorage, reload: t.reload });
      expect(t.reg.update).toHaveBeenCalled();
      expect(cacheStorage.delete).toHaveBeenCalledWith('a');
      expect(cacheStorage.delete).toHaveBeenCalledWith('b');
      expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
      expect(t.reload).not.toHaveBeenCalled();
      t.swListeners.controllerchange?.forEach(fn => fn());
      expect(t.reload).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(REFRESH_FALLBACK_MS + 1);
      expect(t.reload).toHaveBeenCalledOnce();
      expect(localStorage.getItem('adegafood_cart_tenant-1')).toBe('[{"id":"p1"}]');
      expect(localStorage.getItem('sb-qjm-auth-token')).toBe('sessao');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshInstalledApp sem worker em espera recarrega na hora; sem controllerchange recarrega pelo tempo limite', async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      await t.run();
      await refreshInstalledApp({ cacheStorage: null, reload: t.reload });
      expect(t.reload).toHaveBeenCalledOnce();
      const waiting: SwWorkerLike = { state: 'installed', postMessage: vi.fn() };
      t.reg.waiting = waiting;
      await refreshInstalledApp({ cacheStorage: null, reload: t.reload });
      expect(t.reload).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(REFRESH_FALLBACK_MS + 1);
      expect(t.reload).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('claimAutoReload: no máximo uma recarga por janela; sem sessionStorage não recarrega', () => {
    expect(claimAutoReload(sessionStorage, 10_000)).toBe(true);
    expect(claimAutoReload(sessionStorage, 10_000 + AUTO_RELOAD_GUARD_MS - 1)).toBe(false);
    expect(claimAutoReload(sessionStorage, 10_000 + AUTO_RELOAD_GUARD_MS)).toBe(true);
    expect(claimAutoReload(null, 1)).toBe(false);
  });

  it('isAutoReloadSafe: só no app da loja visível, fora de iframe (prévia do painel)', () => {
    const self = {};
    const base = { location: { pathname: '/app/x/', search: '' }, document: { visibilityState: 'visible', activeElement: null }, top: self, self };
    expect(isAutoReloadSafe(base)).toBe(true);
    expect(isAutoReloadSafe({ ...base, top: {} })).toBe(false);
    expect(isAutoReloadSafe({ ...base, document: { visibilityState: 'hidden' } })).toBe(false);
    expect(isAutoReloadSafe({ ...base, document: { visibilityState: 'visible', activeElement: { tagName: 'TEXTAREA' } } })).toBe(false);
    expect(isAutoReloadSafe({ ...base, document: { visibilityState: 'visible', activeElement: { tagName: 'BUTTON' } } })).toBe(true);
    expect(isAutoReloadSafe(null)).toBe(false);
  });

  it('public/sw.js ativa na hora (skipWaiting no install), clients.claim, não faz cache e não intercepta nada (sem handler de fetch)', () => {
    const swCode = readFileSync('public/sw.js', 'utf8');
    expect(swCode).toMatch(/addEventListener\('install', \(\) => \{\s*self\.skipWaiting\(\);/);
    expect(swCode).not.toContain('respondWith');
    expect(swCode).not.toContain('caches.open');
    expect(swCode).toContain('skipWaiting');
    expect(swCode).toContain('clients.claim');
    // Partida a frio: sem 'fetch' o Chrome não liga o worker a cada navegação; /api/* e pagamentos vão direto à rede.
    expect(swCode).not.toMatch(/addEventListener\(\s*['"]fetch['"]/);
    expect(swCode).not.toMatch(/onfetch/);
    // Aviso de atualização (PR #59/#60): continua avisando a página e aceitando SKIP_WAITING de workers antigos.
    expect(swCode).toContain("type: 'SW_ACTIVATED'");
    expect(swCode).toContain("data.type === 'SKIP_WAITING'");
  });
});

