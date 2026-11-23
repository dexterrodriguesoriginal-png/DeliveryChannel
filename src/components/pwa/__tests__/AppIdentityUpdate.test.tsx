// @vitest-environment happy-dom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppIdentityUpdate, readAppIdentityMeta } from '../AppIdentityUpdate';
import { getIconNoticeVisible, getReplacedScreenVisible } from '../../client/IconUpdateNotice';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await React.act(async () => {
    root.render(<AppIdentityUpdate slug="loja" currentIdentity="0123456789" />);
  });
}
describe('instalação antiga substituída', () => {
  it('ClientApp fornece as variáveis do tema ao retorno bloqueante antes da tela normal', () => {
    const client = readFileSync(resolve(process.cwd(), 'src/pages/client/ClientApp.tsx'), 'utf8');
    expect(client).toMatch(/if \(appStatus === 'old-icon' && currentIdentity\)\s*\{\s*return <div style=\{activeCssVars\}><AppIdentityUpdate/);
    expect(client.indexOf("if (appStatus === 'old-icon'")).toBeLessThan(client.indexOf('className="min-h-screen pb-44'));
  });

  it('CookieBanner global não é renderizado quando a tela bloqueante está visível', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toContain('useSyncExternalStore(subscribeReplacedScreen, getReplacedScreenVisible');
    expect(app).toContain('return updateOverlayVisible ? null : <CookieBanner />');
    expect(app).toContain('<CookieBannerWhenAvailable />');
    const blocked = readFileSync(resolve(process.cwd(), 'src/components/pwa/AppIdentityUpdate.tsx'), 'utf8');
    expect(blocked).toContain('setIconNoticeVisible(true)');
    expect(blocked).toContain('setIconNoticeVisible(false)');
    expect(blocked).toContain('setReplacedScreenVisible(true)');
    expect(blocked).toContain('setReplacedScreenVisible(false)');
    expect(app).not.toContain('subscribeIconNotice, getIconNoticeVisible');
  });


  it('marca ambos os estados somente enquanto a tela bloqueante está montada', async () => {
    expect(getReplacedScreenVisible()).toBe(false);
    expect(getIconNoticeVisible()).toBe(false);
    await render();
    expect(getReplacedScreenVisible()).toBe(true);
    expect(getIconNoticeVisible()).toBe(true);
    await React.act(async () => { root.render(null); });
    expect(getReplacedScreenVisible()).toBe(false);
    expect(getIconNoticeVisible()).toBe(false);
  });

  it('lê só hashes de dez caracteres na meta da identidade', () => {
    const meta = document.createElement('meta');
    meta.name = 'dc-app-identity';
    meta.content = '0123456789';
    document.head.appendChild(meta);
    try {
      expect(readAppIdentityMeta()).toBe('0123456789');
      meta.content = 'invalid';
      expect(readAppIdentityMeta()).toBeNull();
    } finally { meta.remove(); }
  });

  it('bloqueia a tela toda, mostra o texto exato e somente um link HTTPS relativo para a nova versão', async () => {
    await render();
    const screen = container.querySelector('[data-testid="identity-replaced-screen"]') as HTMLElement;
    expect(screen).toBeTruthy();
    expect(screen.style.position).toBe('fixed');
    expect(screen.style.inset).toMatch(/^0(px)?$/);
    expect(screen.textContent).toContain('Esta versão foi substituída. A nova versão já está instalada no seu celular. Remova esta versão e abra a nova.');
    const links = screen.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('Abrir nova versão');
    expect(links[0].getAttribute('href')).toBe('/app/loja~0123456789/?source=pwa');
    expect(screen.querySelector('button')).toBeNull();
    expect(screen.innerHTML).not.toContain('intent://');
  });
});
