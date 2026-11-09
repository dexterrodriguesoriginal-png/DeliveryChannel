import { describe, it, expect, vi } from 'vitest';
import { consumeOpenAttempt, rememberOpenAttempt, buildOpenAppIntent, openInstalledApp, detectInstalledApp, OPEN_APP_FALLBACK_MS } from '../openInstalledApp';
import { buildStoreManifest } from '../storeManifest';

const mkEnv = (ua: string, vis = 'visible', popup: { closed?: boolean } | null = { closed: false }) => {
  const timers: (() => void)[] = [];
  const open = vi.fn(() => popup);
  const env = {
    location: { href: '', origin: 'https://deliverychannel.ai.studio', assign: vi.fn() },
    document: { visibilityState: vis },
    userAgent: ua,
    setTimeout: (f: () => void, ms: number) => { expect(ms).toBe(OPEN_APP_FALLBACK_MS); timers.push(f); },
    open,
  };
  return { env, timers, open };
};

describe('openInstalledApp', () => {
  it('monta intent VIEW sem package com fallback https', () => {
    const i = buildOpenAppIntent('https://x.ai.studio/app/bar/?source=pwa')!;
    expect(i).toBe('intent://x.ai.studio/app/bar/?source=pwa#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=https%3A%2F%2Fx.ai.studio%2Fapp%2Fbar%2F%3Fsource%3Dpwa;end');
    expect(buildOpenAppIntent('http://localhost/app/x/')).toBeNull();
  });
  it('com popup liberado, abre start_url em _blank e não mexe na aba atual', () => {
    const { env, open } = mkEnv('Mozilla/5.0 (Linux; Android 14) Chrome/130');
    expect(openInstalledApp('/app/bar/?source=pwa', env)).toBe('popup');
    expect(open).toHaveBeenCalledWith('https://deliverychannel.ai.studio/app/bar/?source=pwa', '_blank', 'noopener,noreferrer');
    expect(env.location.href).toBe('');
    expect(env.location.assign).not.toHaveBeenCalled();
  });
  it('Android com popup bloqueado tenta intent; se a página continuar visível, mostra a orientação (sem assign)', () => {
    const { env, timers, open } = mkEnv('Mozilla/5.0 (Linux; Android 14) Chrome/130', 'visible', null);
    expect(openInstalledApp('/app/bar/?source=pwa', env)).toBe('intent');
    expect(open).toHaveBeenCalled();
    expect(env.location.href.startsWith('intent://deliverychannel.ai.studio/app/bar/')).toBe(true);
    const onStillVisible = vi.fn();
    const blocked = mkEnv('Android', 'visible', null);
    openInstalledApp('/app/bar/', { ...blocked.env, onStillVisible });
    blocked.timers[0]();
    expect(onStillVisible).toHaveBeenCalledOnce();
    expect(blocked.env.location.assign).not.toHaveBeenCalled();
    void timers;
  });
  it('Android: não mostra orientação se o app abriu (página oculta)', () => {
    const { env, timers } = mkEnv('Android', 'hidden', null);
    const onStillVisible = vi.fn();
    openInstalledApp('/app/bar/', { ...env, onStillVisible });
    timers[0]();
    expect(onStillVisible).not.toHaveBeenCalled();
    expect(env.location.assign).not.toHaveBeenCalled();
  });
  it('fora do Android, com popup bloqueado, mostra a orientação e não faz assign (botão morto)', () => {
    const { env, open } = mkEnv('iPhone', 'visible', null);
    const onStillVisible = vi.fn();
    expect(openInstalledApp('/app/bar/', { ...env, onStillVisible })).toBe('navigate');
    expect(open).toHaveBeenCalledWith('https://deliverychannel.ai.studio/app/bar/', '_blank', 'noopener,noreferrer');
    expect(onStillVisible).toHaveBeenCalledOnce();
    expect(env.location.assign).not.toHaveBeenCalled();
  });
  it('orientação sobrevive ao fallback, só na mesma aba/app e por poucos segundos', () => {
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    rememberOpenAttempt(storage, 'driver', 1000);
    expect(consumeOpenAttempt(storage, 'store', 2000)).toBe(false);
    expect(consumeOpenAttempt(storage, 'driver', 2000)).toBe(true);
    expect(consumeOpenAttempt(storage, 'driver', 2000)).toBe(false);
    rememberOpenAttempt(storage, 'driver', 1000);
    expect(consumeOpenAttempt(storage, 'driver', 12000)).toBe(false);
  });
  it('detecção sem API retorna false; com webapp retorna true', async () => {
    expect(await detectInstalledApp({} as Navigator)).toBe(false);
    expect(await detectInstalledApp({ getInstalledRelatedApps: async () => [{ platform: 'webapp' }] } as unknown as Navigator)).toBe(true);
  });
  it('manifesto tem link capturing e auto-referência', () => {
    const m = buildStoreManifest({ id: 't1', slug: 'bar', name: 'Bar' }, '');
    expect(m.handle_links).toBe('preferred');
    expect(m.launch_handler.client_mode[0]).toBe('navigate-existing');
    expect(m.related_applications).toEqual([{ platform: 'webapp', url: '/app/bar/manifest.webmanifest' }]);
  });
});
