// @vitest-environment happy-dom
import React from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INSTALL_DURATION_MS,
  INSTALL_PROGRESS_TITLE,
  INSTALL_SEGMENTS,
  OPEN_APP_BUTTON_LABEL,
  formatInstallCountdown,
  persistInstallStart,
  progressAt,
  readPersistedInstallStart,
} from '../installProgress';

let act: typeof React.act;
let root: Root;
let container: HTMLDivElement;
let reducedMotion = false;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  sessionStorage.clear();
  reducedMotion = false;
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? reducedMotion : false,
  }) as MediaQueryList);
  ({ act } = await import('react'));
  const { createRoot } = await import('react-dom/client');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const query = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('installProgress — lógica pura progressAt(ms)', () => {
  it('é monotônica de 0 a 60 000 ms e nunca atinge 100% antes de 60 000 ms', () => {
    expect(progressAt(-500)).toBe(0);
    expect(progressAt(0)).toBe(0);
    let prev = 0;
    for (let t = 0; t < INSTALL_DURATION_MS; t += 100) {
      const p = progressAt(t);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeLessThan(100);
      prev = p;
    }
    expect(progressAt(58_500)).toBeLessThanOrEqual(98);
    expect(progressAt(59_000)).toBe(99);
    expect(progressAt(59_999)).toBe(99);
    expect(progressAt(60_000)).toBe(100);
    expect(progressAt(90_000)).toBe(100);
  });

  it('alterna velocidades: rápido → devagar → rápido → devagar', () => {
    const rate = (a: number, b: number) => (progressAt(b) - progressAt(a)) / ((b - a) / 1000);
    const segRates = INSTALL_SEGMENTS.map(s => rate(s.startMs, s.endMs));
    expect(segRates).toHaveLength(4);
    // Seg 0 (rápido) > Seg 1 (devagar) < Seg 2 (rápido) > Seg 3 (devagar)
    expect(segRates[0]).toBeGreaterThan(segRates[1] * 2);
    expect(segRates[2]).toBeGreaterThan(segRates[1] * 2);
    expect(segRates[2]).toBeGreaterThan(segRates[3] * 2);
  });

  it('formata contagem regressiva corretamente (ex.: 1:00, 0:42, 0:00)', () => {
    expect(formatInstallCountdown(0)).toBe('1:00');
    expect(formatInstallCountdown(18_000)).toBe('0:42');
    expect(formatInstallCountdown(55_000)).toBe('0:05');
    expect(formatInstallCountdown(60_000)).toBe('0:00');
  });

  it('persiste o início em sessionStorage sem sobrescrever em chamadas subsequentes', () => {
    const first = persistInstallStart(sessionStorage, 'app-1', 1000);
    expect(first).toBe(1000);
    expect(readPersistedInstallStart(sessionStorage, 'app-1')).toBe(1000);
    const second = persistInstallStart(sessionStorage, 'app-1', 5000);
    expect(second).toBe(1000);
  });
});

describe('InstallProgress — componente reutilizável com fake timers', () => {
  it('mostra "Tempo estimado de instalação", contagem regressiva, acessibilidade, nunca "Instalando", e botão "Abrir o app" só em 60 s', async () => {
    const { InstallProgress } = await import('../../../components/pwa/InstallProgress');
    await act(() => {
      root.render(<InstallProgress appId="cozinha-app" appName="Cozinha" startPath="/cozinha" />);
    });

    expect(container.textContent).toContain(INSTALL_PROGRESS_TITLE);
    expect(container.textContent).not.toMatch(/Instalando/i);
    expect(query('install-countdown')?.textContent).toBe('1:00');
    expect(query('open-installed-app')).toBeNull();

    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');

    await advance(18_000);
    expect(query('install-countdown')?.textContent).toBe('0:42');
    expect(Number(bar.getAttribute('aria-valuenow'))).toBe(progressAt(18_000));
    expect(query('open-installed-app')).toBeNull();
    expect(container.textContent).not.toMatch(/Instalando/i);

    // Re-render / remontagem não reinicia a barra graças ao sessionStorage
    await act(() => {
      root.render(<InstallProgress key="remount" appId="cozinha-app" appName="Cozinha" startPath="/cozinha" />);
    });
    expect(query('install-countdown')?.textContent).toBe('0:42');
    expect(Number(container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'))).toBe(progressAt(18_000));

    // Aos 59 999 ms ainda não chegou a 100% nem mostrou o botão
    await advance(41_999);
    expect(Number(container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'))).toBe(99);
    expect(query('open-installed-app')).toBeNull();

    // Exatamente em 60 000 ms: 100% e botão "Abrir o app"
    await advance(1);
    expect(Number(container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'))).toBe(100);
    expect(query('install-countdown')?.textContent).toBe('0:00');
    expect(query('open-installed-app')?.textContent).toBe(OPEN_APP_BUTTON_LABEL);
    expect(container.textContent).not.toMatch(/Instalando/i);

    const openBtn = query('open-installed-app')!;
    expect(openBtn.tagName).toBe('A');
    expect(openBtn.getAttribute('target')).toBe('_blank');
    expect(openBtn.getAttribute('rel')).toMatch(/noopener/);
    expect(openBtn.getAttribute('href')).toBe(`${window.location.origin}/cozinha`);
    expect(query('open-app-hint')?.textContent).toMatch(/Abra o app Cozinha na tela inicial/);
  });

  it('respeita prefers-reduced-motion (sem transição suave, mas mantendo 60 s)', async () => {
    reducedMotion = true;
    const { InstallProgress } = await import('../../../components/pwa/InstallProgress');
    await act(() => {
      root.render(<InstallProgress appId="garcom-app" appName="Garçom" startPath="/garcom" />);
    });
    const fill = query('install-progress-bar')!;
    expect(fill.dataset.reducedMotion).toBe('true');
    expect(fill.className).toContain('transition-none');
    expect(fill.className).not.toContain('duration-300');

    await advance(59_999);
    expect(query('open-installed-app')).toBeNull();
    await advance(1);
    expect(query('open-installed-app')?.textContent).toBe('Abrir o app');
  });

  it('WaiterInstallCard inicia a barra de 60 s ao aceitar beforeinstallprompt ou receber appinstalled', async () => {
    const state = await import('../installState');
    state.captureInstallEvents(window);
    const { WaiterInstallCard } = await import('../../../pages/waiter/WaiterInstallCard');
    await act(() => {
      root.render(<WaiterInstallCard alwaysShow />);
    });

    let choose!: (c: { outcome: 'accepted' | 'dismissed' }) => void;
    const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: new Promise<{ outcome: 'accepted' | 'dismissed' }>(r => { choose = r; }),
    });
    await act(() => { window.dispatchEvent(ev); });
    await act(() => { query('waiter-install-btn')!.click(); });
    await act(async () => { choose({ outcome: 'accepted' }); });

    expect(query('install-progress')).not.toBeNull();
    expect(container.textContent).toContain('Tempo estimado de instalação');
    expect(container.textContent).not.toMatch(/Instalando/i);
    await advance(60_000);
    expect(query('open-installed-app')?.textContent).toBe('Abrir o app');
  });
});

