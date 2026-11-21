// @vitest-environment happy-dom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let act: typeof React.act;
let root: Root;
let container: HTMLDivElement;
let standalone = true;
const HASH = 'bbbbbbbbbb';

async function load() { return import('../AppIdentityUpdate'); }
async function render(el: React.ReactElement) {
  await act(async () => { root.render(el); });
}
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  act = React.act;
  standalone = true;
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    matches: q === '(display-mode: standalone)' ? standalone : false,
    media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {},
    removeEventListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Linux; Android 14) Chrome/144.0 Mobile Safari/537.36',
    configurable: true,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('banner exclusivo de WebAPK legado', () => {
  it('app canônico standalone com logo nova não recebe pill de reinstalação', async () => {
    history.replaceState(null, '', '/app/mercado-teste-dc/?source=pwa');
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" />);
    expect(container.innerHTML).toBe('');
    expect(container.textContent).not.toContain('Baixar versão atualizada');
  });
  it('legado standalone Android recebe banner discreto e abre o canônico', async () => {
    history.replaceState(null, '', `/app/mercado-teste-dc~${HASH}/?reinstall=1`);
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" />);
    expect(container.querySelector('[data-testid="identity-legacy-banner"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('Há uma versão oficial deste app');
    expect(container.textContent).toContain('Abrir app atualizado');
    await act(async () => {
      (container.querySelector('[data-testid="identity-open-canonical"]') as HTMLButtonElement).click();
    });
    expect(open).toHaveBeenCalledWith(`${window.location.origin}/app/mercado-teste-dc/`, '_blank');
    expect(open.mock.calls[0][0]).not.toContain('~');
    expect(open.mock.calls[0][0]).not.toContain('reinstall');
  });
  it('legado no Chrome sem standalone não recebe banner', async () => {
    standalone = false;
    history.replaceState(null, '', `/app/mercado-teste-dc~${HASH}/`);
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" />);
    expect(container.innerHTML).toBe('');
  });
  it('legado iOS não recebe banner', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      configurable: true,
    });
    history.replaceState(null, '', `/app/mercado-teste-dc~${HASH}/`);
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" />);
    expect(container.innerHTML).toBe('');
  });
  it('o usuário pode dispensar o banner sem bloquear a loja', async () => {
    history.replaceState(null, '', `/app/mercado-teste-dc~${HASH}/`);
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" />);
    await act(async () => {
      (container.querySelector('[aria-label="Dispensar aviso"]') as HTMLButtonElement).click();
    });
    expect(container.innerHTML).toBe('');
  });
  it('meta antiga pode ser lida, mas não dispara o banner no caminho canônico', async () => {
    const m = document.createElement('meta'); m.name = 'dc-app-identity'; m.content = HASH;
    document.head.appendChild(m);
    try {
      const { AppIdentityUpdate, readAppIdentityMeta } = await load();
      expect(readAppIdentityMeta()).toBe(HASH);
      history.replaceState(null, '', '/app/mercado-teste-dc/');
      await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" />);
      expect(container.innerHTML).toBe('');
    } finally { m.remove(); }
  });
});
