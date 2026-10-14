import { describe, it, expect, vi } from 'vitest';
import { detectPlatform, isStandalone, promoVisibility, hasSeenInstallModal, markInstallModalSeen, isMarkedInstalled, markInstalled, installKeys } from '../installState';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

describe('installState', () => {
  it('chaves por loja são distintas', () => {
    expect(installKeys('a').modalSeen).not.toBe(installKeys('b').modalSeen);
    const s = mem(); markInstallModalSeen(s, 'a');
    expect(hasSeenInstallModal(s, 'a')).toBe(true); expect(hasSeenInstallModal(s, 'b')).toBe(false);
  });
  it('fechar modal não marca como instalado', () => {
    const s = mem(); markInstallModalSeen(s, 'a');
    expect(isMarkedInstalled(s, 'a')).toBe(false);
    markInstalled(s, 'a'); expect(isMarkedInstalled(s, 'a')).toBe(true); expect(isMarkedInstalled(s, 'b')).toBe(false);
  });
  it('visibilidade', () => {
    const b = { installed: false, standalone: false, modalSeen: false, checkoutOpen: false };
    expect(promoVisibility(b)).toBe('modal');
    expect(promoVisibility({ ...b, modalSeen: true })).toBe('banner');
    expect(promoVisibility({ ...b, checkoutOpen: true })).toBe('none');
    expect(promoVisibility({ ...b, installed: true })).toBe('none');
    expect(promoVisibility({ ...b, standalone: true })).toBe('none');
  });
  it('plataformas', () => {
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36')).toBe('android-chrome');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36')).toBe('android-other');
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('ios-safari');
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/129.0 Mobile/15E148 Safari/604.1')).toBe('ios-other');
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64) Chrome/129.0 Safari/537.36')).toBe('desktop');
  });
  it('standalone', () => {
    expect(isStandalone({ matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }) })).toBe(true);
    expect(isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } })).toBe(true);
    expect(isStandalone({ matchMedia: () => ({ matches: false }), navigator: {} })).toBe(false);
  });
});

import { captureInstallEvents as _cap, getDeferredPrompt as _get, clearDeferredPrompt as _clr, inviteSurface, shouldSuppressNativeInfobar } from '../installState';
describe('prioridade ao card nativo do Chrome', () => {
  const base = { installed: false, standalone: false, hidden: false, inviteOpen: false, nativeAvailable: false, barDismissed: false };
  it('com evento nativo: nada fixo; no convite, card que chama prompt()', () => {
    expect(inviteSurface({ ...base, nativeAvailable: true })).toBe('fallback-bar');
    expect(inviteSurface({ ...base, nativeAvailable: true, inviteOpen: true })).toBe('native-card');
  });
  it('sem evento: barra escura persistente (dispensável) e card próprio no convite', () => {
    expect(inviteSurface(base)).toBe('fallback-bar');
    expect(inviteSurface({ ...base, barDismissed: true })).toBe('fallback-bar');
    expect(inviteSurface({ ...base, barDismissed: true, inviteOpen: true })).toBe('fallback-card');
  });
  it('instalado, standalone ou checkout: nada', () => {
    for (const k of ['installed', 'standalone', 'hidden'] as const) expect(inviteSurface({ ...base, inviteOpen: true, nativeAvailable: true, [k]: true })).toBe('none');
  });
  it('1ª ocorrência na sessão não chama preventDefault; as seguintes chamam; evento guardado', () => {
    expect(shouldSuppressNativeInfobar(false)).toBe(false);
    const handlers: Record<string, (e: Event) => void> = {};
    const store = new Map<string, string>();
    const w = { addEventListener: (n: string, h: (e: Event) => void) => { handlers[n] = h; }, location: { pathname: '/loja/adega-premium' },
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } } as unknown as Window;
    _cap(w);
    const mk = () => { const e = { preventDefault: vi.fn(), prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' }) }; return e; };
    const e1 = mk(); handlers.beforeinstallprompt(e1 as unknown as Event);
    expect(e1.preventDefault).not.toHaveBeenCalled(); expect(_get()).toBe(e1);
    const e2 = mk(); handlers.beforeinstallprompt(e2 as unknown as Event);
    expect(e2.preventDefault).not.toHaveBeenCalled(); expect(_get()).toBe(e2);
    _clr(); expect(_get()).toBeNull();
  });
});

describe('marca de instalado com validade', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
  it('valor legado "1" não oculta mais o convite', () => {
    const s = mem(); s.setItem(installKeys('a').installed, '1');
    expect(isMarkedInstalled(s, 'a')).toBe(false);
  });
  it('expira após 30 dias sem abrir pelo ícone', () => {
    const s = mem(); markInstalled(s, 'a', 1_000);
    expect(isMarkedInstalled(s, 'a', 1_000 + 29 * 864e5)).toBe(true);
    expect(isMarkedInstalled(s, 'a', 1_000 + 31 * 864e5)).toBe(false);
  });
});

import { installPhaseCopy, nextInstallPhase } from '../installState';
describe('acompanhamento da instalação', () => {
  it('aceite → instalando; appinstalled → pronto; recusa → normal; 3 min → conferir tela', () => {
    expect(nextInstallPhase('idle', 'accepted')).toBe('installing');
    expect(nextInstallPhase('installing', 'slow-timeout')).toBe('slow');
    expect(nextInstallPhase('slow', 'appinstalled')).toBe('done');
    expect(nextInstallPhase('idle', 'dismissed')).toBe('idle');
    expect(nextInstallPhase('idle', 'slow-timeout')).toBe('idle');
  });
  it('textos sem porcentagem', () => {
    const c = installPhaseCopy('installing', 'Bar do Beto')!;
    expect(c.title).toBe('Instalando o app Bar do Beto…');
    expect(c.subtitle).toMatch(/até 2 minutos/);
    expect(installPhaseCopy('done', 'Bar do Beto')!.title).toBe('Pronto! O app Bar do Beto está na sua tela inicial');
    expect(installPhaseCopy('slow', 'X')!.subtitle).toMatch(/Confira sua tela inicial/);
    expect(installPhaseCopy('idle', 'X')).toBeNull();
    for (const p of ['installing', 'slow', 'done'] as const) expect(installPhaseCopy(p, 'X')!.title).not.toMatch(/100/);
  });
});

import { estimatedInstallPercent } from '../installState';
describe('porcentagem estimada da instalação', () => {
  it('começa rápido, chega a 90% em ~90 s e para; 100% só com appinstalled', () => {
    expect(estimatedInstallPercent(0, null)).toBe(0);
    expect(estimatedInstallPercent(20_000, null)).toBeGreaterThan(40);
    expect(estimatedInstallPercent(60_000, null)).toBe(90);
    expect(estimatedInstallPercent(10 * 60_000, null)).toBe(90);
  });
  it('appinstalled cedo não salta: sobe gradual até 100% só aos 75 s', () => {
    const at1 = estimatedInstallPercent(1_000, 1_000);
    expect(at1).toBeLessThan(10);
    let prev = 0;
    for (let t = 1_000; t <= 75_000; t += 1_000) { const p = estimatedInstallPercent(t, 1_000); expect(p).toBeGreaterThanOrEqual(prev); prev = p; }
    expect(estimatedInstallPercent(59_000, 1_000)).toBeLessThan(100);
    expect(estimatedInstallPercent(60_000, 1_000)).toBeLessThan(100);
    expect(estimatedInstallPercent(74_000, 1_000)).toBeLessThan(100);
    expect(estimatedInstallPercent(75_000, 1_000)).toBe(100);
  });
  it('appinstalled tardio: de 90% a 100% em 8 s, sem salto', () => {
    expect(estimatedInstallPercent(120_000, 120_000)).toBe(90);
    expect(estimatedInstallPercent(124_000, 120_000)).toBe(95);
    expect(estimatedInstallPercent(128_000, 120_000)).toBe(100);
  });
});
