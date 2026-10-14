import { describe, it, expect, vi } from 'vitest';
import { buildOpenAppIntent, openInstalledApp, detectInstalledApp, OPEN_APP_FALLBACK_MS } from '../openInstalledApp';
import { buildStoreManifest } from '../storeManifest';

const mkEnv = (ua: string, vis = 'visible') => {
  const timers: (() => void)[] = [];
  const env = { location: { href: '', origin: 'https://deliverychannel.ai.studio', assign: vi.fn() }, document: { visibilityState: vis }, userAgent: ua, setTimeout: (f: () => void, ms: number) => { expect(ms).toBe(OPEN_APP_FALLBACK_MS); timers.push(f); } };
  return { env, timers };
};

describe('openInstalledApp', () => {
  it('monta intent VIEW sem package com fallback https', () => {
    const i = buildOpenAppIntent('https://x.ai.studio/app/bar/?source=pwa')!;
    expect(i).toBe('intent://x.ai.studio/app/bar/?source=pwa#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=https%3A%2F%2Fx.ai.studio%2Fapp%2Fbar%2F%3Fsource%3Dpwa;end');
    expect(buildOpenAppIntent('http://localhost/app/x/')).toBeNull();
  });
  it('Android: tenta intent e, se a página continuar visível, abre start_url', () => {
    const { env, timers } = mkEnv('Mozilla/5.0 (Linux; Android 14) Chrome/130');
    expect(openInstalledApp('/app/bar/?source=pwa', env)).toBe('intent');
    expect(env.location.href.startsWith('intent://deliverychannel.ai.studio/app/bar/')).toBe(true);
    timers[0]();
    expect(env.location.assign).toHaveBeenCalledWith('https://deliverychannel.ai.studio/app/bar/?source=pwa');
  });
  it('Android: não navega de novo se o app abriu (página oculta)', () => {
    const { env, timers } = mkEnv('Android', 'hidden');
    openInstalledApp('/app/bar/', env); timers[0]();
    expect(env.location.assign).not.toHaveBeenCalled();
  });
  it('fora do Android: navega para start_url', () => {
    const { env } = mkEnv('iPhone');
    expect(openInstalledApp('/app/bar/', env)).toBe('navigate');
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
