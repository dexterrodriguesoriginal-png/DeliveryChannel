// @vitest-environment happy-dom
import React from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeforeInstallPromptEvent } from '../../../lib/pwa/installState';

let state: typeof import('../../../lib/pwa/installState');
let act: typeof React.act;
let root: Root;
let container: HTMLDivElement;
let standalone: boolean;
let installHandlers: [string, EventListener][];

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T16:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  localStorage.clear(); sessionStorage.clear();
  window.history.replaceState(null, '', '/entregador/convite/test-token');
  document.head.innerHTML = '<link rel="manifest" href="/driver.webmanifest">';
  Object.defineProperty(window, 'onbeforeinstallprompt', { configurable: true, value: null });
  standalone = false;
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({ matches: standalone }) as MediaQueryList);
  state = await import('../../../lib/pwa/installState');
  const add = vi.spyOn(window, 'addEventListener');
  state.captureInstallEvents(window);
  installHandlers = add.mock.calls.map(([name, handler]) => [name, handler as EventListener]);
  ({ act } = await import('react'));
  const { createRoot } = await import('react-dom/client');
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  for (const [name, handler] of installHandlers) window.removeEventListener(name, handler);
  container.remove();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const query = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const percent = () => Number(query('install-percent')?.dataset.percent);
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

async function render(audience: 'driver' | 'customer' = 'driver') {
  const { InstallDriverAppHint } = await import('../InstallDriverAppHint');
  const { InstallStoreAppHint } = await import('../../client/InstallStoreAppHint');
  if (audience === 'customer') window.history.replaceState(null, '', '/app/loja/');
  await act(() => root.render(audience === 'driver' ? <InstallDriverAppHint />
    : <InstallStoreAppHint tenantId="loja" storeName="Loja" color="#f59e0b" />));
}

async function offer() {
  let choose!: (choice: { outcome: 'accepted' | 'dismissed' }) => void;
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: new Promise<{ outcome: 'accepted' | 'dismissed' }>(resolve => { choose = resolve; }),
  }) as BeforeInstallPromptEvent;
  await act(() => { window.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  return { event, choose };
}

async function accept() {
  const { event, choose } = await offer();
  await act(() => { query('install-primary')!.click(); });
  await act(async () => { choose({ outcome: 'accepted' }); });
  return event;
}

describe('instalação compartilhada do entregador e do cliente', () => {
  it.each(['driver', 'customer'] as const)('%s: clique abre prompt direto, sem instruções; aceite inicia a barra', async audience => {
    await render(audience);
    await advance(1200); // cobre também o convite de visita, além da barra persistente
    const { event, choose } = await offer();
    expect(query('install-instructions')).toBeNull();
    expect(event.prompt).not.toHaveBeenCalled();
    await act(() => {
      query('install-primary')!.click();
      expect(event.prompt).toHaveBeenCalledOnce(); // ainda dentro do clique, antes de qualquer await
      query('install-primary')!.click(); // evento de uso único, inclusive enquanto userChoice está pendente
    });
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(query('install-instructions')).toBeNull();
    expect(container.textContent).not.toMatch(/2 toques|Adicionar à tela inicial/);
    expect(query('install-progress')).toBeNull();
    await act(async () => { choose({ outcome: 'accepted' }); });
    expect(query('install-progress')?.dataset.phase).toBe('installing');
    expect(percent()).toBe(0);
    expect(query('open-installed-app')).toBeNull();
    expect(container.textContent).not.toContain('Abrir app');
    expect(state.isMarkedInstalled(localStorage, audience === 'driver' ? 'driver-app' : 'loja')).toBe(false);
  });

  it('appinstalled precoce respeita 75 s e só então libera Abrir app para /entregador', async () => {
    await render(); await accept();
    await advance(2000);
    await act(() => { window.dispatchEvent(new Event('appinstalled')); });
    await advance(6000); expect(percent()).toBe(40);
    await advance(20_000); expect(percent()).toBe(55);
    await advance(17_000); expect(percent()).toBe(76);
    await advance(29_999);
    expect(percent()).toBeLessThan(100);
    expect(query('open-installed-app')).toBeNull();
    await advance(1);
    expect(percent()).toBe(100);
    expect(query('install-progress')?.dataset.phase).toBe('done');
    expect(query('open-installed-app')?.textContent).toBe('Abrir app');
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    await act(() => { query('open-installed-app')!.click(); });
    expect(assign).toHaveBeenCalledWith(`${window.location.origin}/entregador`);
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/driver.webmanifest');
  });

  it('aceite e passagem do tempo não confirmam instalação; confirmação tardia finaliza em 3 s', async () => {
    await render(); await accept();
    await advance(200_000);
    expect(percent()).toBe(90);
    expect(query('open-installed-app')).toBeNull();
    expect(state.isMarkedInstalled(localStorage, 'driver-app')).toBe(false);
    await act(() => { window.dispatchEvent(new Event('appinstalled')); });
    await advance(2999);
    expect(percent()).toBeLessThan(100);
    expect(query('open-installed-app')).toBeNull();
    await advance(1);
    expect(percent()).toBe(100);
    expect(query('open-installed-app')).not.toBeNull();
  });

  it('standalone também confirma, mantendo o mesmo tempo mínimo', async () => {
    await render(); await accept();
    await advance(10_000);
    standalone = true;
    await act(() => { window.dispatchEvent(new Event('focus')); });
    expect(state.isMarkedInstalled(localStorage, 'driver-app')).toBe(true);
    await advance(64_999);
    expect(query('open-installed-app')).toBeNull();
    await advance(1);
    expect(percent()).toBe(100);
    expect(query('open-installed-app')).not.toBeNull();
  });

  it('recusa mantém a web, sem barra, instruções ou marca de instalação', async () => {
    await render();
    const { choose } = await offer();
    await act(() => { query('install-primary')!.click(); });
    await act(async () => { choose({ outcome: 'dismissed' }); });
    expect(query('install-progress')).toBeNull();
    expect(query('install-instructions')).toBeNull();
    expect(query('open-installed-app')).toBeNull();
    expect(state.isMarkedInstalled(localStorage, 'driver-app')).toBe(false);
  });

  it('Chrome aguardando evento não cai em instruções; evento posterior permite prompt no próximo clique', async () => {
    await render();
    await act(() => { query('install-primary')!.click(); });
    expect(query('install-native-notice')).not.toBeNull();
    expect(query('install-instructions')).toBeNull();
    const { event } = await offer();
    expect(query('install-native-notice')).toBeNull();
    await act(() => { query('install-primary')!.click(); });
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(query('install-instructions')).toBeNull();
  });

  it('falha no prompt nativo permite tentar novamente sem instruções intermediárias', async () => {
    await render();
    const { event } = await offer();
    vi.mocked(event.prompt).mockRejectedValueOnce(new Error('Prompt unavailable'));
    await act(() => { query('install-primary')!.click(); });
    expect(query('install-native-notice')).not.toBeNull();
    expect(query('install-instructions')).toBeNull();
    expect(query('install-progress')).toBeNull();
    await accept();
    expect(query('install-progress')).not.toBeNull();
  });

  it('Safari iOS sem API mostra instruções somente após o clique', async () => {
    Reflect.deleteProperty(window, 'onbeforeinstallprompt');
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone Version/17.0 Mobile Safari/604.1');
    await render();
    expect(query('install-instructions')).toBeNull();
    await act(() => { query('install-primary')!.click(); });
    expect(query('install-instructions')?.textContent).toContain('Adicionar à Tela de Início');
    expect(query('install-progress')).toBeNull();
    expect(query('open-installed-app')).toBeNull();
  });
});
