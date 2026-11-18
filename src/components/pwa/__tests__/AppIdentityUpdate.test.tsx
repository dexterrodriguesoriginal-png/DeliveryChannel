// @vitest-environment happy-dom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let act: typeof React.act;
let root: Root;
let container: HTMLDivElement;
let standalone = true;
const CUR = 'bbbbbbbbbb';

async function load() {
  const mod = await import('../AppIdentityUpdate');
  const st = await import('../../../lib/pwa/installState');
  return { ...mod, st };
}
async function render(el: React.ReactElement) {
  await act(async () => { root.render(el); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  act = React.act;
  localStorage.clear();
  standalone = true;
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    matches: q === '(display-mode: standalone)' ? standalone : false,
    media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 9) Chrome/120.0 Mobile Safari/537.36', configurable: true });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ version: 'x', appIdentity: CUR }) })));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.head.querySelectorAll('meta[name="dc-app-identity"]').forEach(m => m.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('readAppIdentityMeta', () => {
  it('lê só versões válidas', async () => {
    const { readAppIdentityMeta } = await load();
    expect(readAppIdentityMeta()).toBeNull();
    const m = document.createElement('meta'); m.name = 'dc-app-identity'; m.content = CUR; document.head.appendChild(m);
    expect(readAppIdentityMeta()).toBe(CUR);
    m.content = '<script>'; expect(readAppIdentityMeta()).toBeNull();
  });
});

describe('AppIdentityUpdate', () => {
  it('ícone da versão atual: nada aparece e avisa os ícones antigos', async () => {
    history.replaceState(null, '', `/app/mercado-teste-dc~${CUR}/?source=pwa`);
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    expect(container.innerHTML).toBe('');
    expect(localStorage.getItem('dc:app-identity:mercado-teste-dc')).toBe(CUR);
  });

  it('fora do Android (iPhone): nada aparece', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', configurable: true });
    history.replaceState(null, '', '/app/mercado-teste-dc/');
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    expect(container.innerHTML).toBe('');
    standalone = false;
    history.replaceState(null, '', `/app/mercado-teste-dc~${CUR}/?reinstall=1`);
    await render(<AppIdentityUpdate key="b" slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    expect(container.innerHTML).toBe('');
  });

  it('navegador comum sem pedido: nada aparece', async () => {
    standalone = false;
    history.replaceState(null, '', '/app/mercado-teste-dc/');
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    expect(container.innerHTML).toBe('');
  });

  it('ícone antigo: pílula → Atualizar → barra "Atualizando aplicativo..." → abre o Chrome', async () => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/app/mercado-teste-dc/?source=pwa');
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    expect(container.textContent).toContain('Nova versão do app disponível');
    const hrefSet = vi.fn();
    const loc = window.location;
    vi.stubGlobal('location', { ...loc, origin: 'https://deliverychannel.com.br', pathname: loc.pathname, search: loc.search, set href(v: string) { hrefSet(v); }, get href() { return loc.href; } });
    await act(async () => { (container.querySelector('[data-testid="identity-update"]') as HTMLButtonElement).click(); });
    expect(container.textContent).toContain('Atualizando aplicativo...');
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(1300); await Promise.resolve(); await Promise.resolve(); });
    expect(hrefSet).toHaveBeenCalledWith(`intent://deliverychannel.com.br/app/mercado-teste-dc~${CUR}/?reinstall=1#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(`https://deliverychannel.com.br/app/mercado-teste-dc~${CUR}/?reinstall=1`)};end`);
    expect(container.textContent).toContain('Abrindo o Chrome');
    // voltou do Chrome (cancelou lá): a loja fica livre de novo
    const vis = vi.spyOn(document, 'visibilityState', 'get');
    vis.mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    vis.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(container.querySelector('[data-testid="identity-overlay"]')).toBeNull();
    expect(container.textContent).toContain('Nova versão do app disponível');
  });

  it('tela "Abrindo o Chrome" tem Voltar à loja', async () => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/app/mercado-teste-dc/');
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    const loc = window.location;
    vi.stubGlobal('location', { ...loc, origin: 'https://x.com', pathname: loc.pathname, search: loc.search, set href(_v: string) {}, get href() { return loc.href; } });
    await act(async () => { (container.querySelector('[data-testid="identity-update"]') as HTMLButtonElement).click(); });
    await act(async () => { vi.advanceTimersByTime(1300); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { (container.querySelector('[data-testid="identity-back"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="identity-overlay"]')).toBeNull();
  });

  it('ícone antigo com convite no próprio app: usa o prompt nativo', async () => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/app/mercado-teste-dc/');
    const { AppIdentityUpdate, st } = await load();
    st.captureInstallEvents(window);
    const prompt = vi.fn(async () => {});
    const ev = Object.assign(new Event('beforeinstallprompt'), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }) });
    window.dispatchEvent(ev);
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    await act(async () => { (container.querySelector('[data-testid="identity-update"]') as HTMLButtonElement).click(); });
    await act(async () => { vi.advanceTimersByTime(1300); for (let i = 0; i < 5; i++) await Promise.resolve(); });
    expect(prompt).toHaveBeenCalled();
    // aceito ≠ instalado: só manda remover o antigo depois do appinstalled
    expect(container.querySelector('[data-testid="identity-pending"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Pronto!');
    await act(async () => { window.dispatchEvent(new Event('appinstalled')); });
    expect(container.textContent).toContain('Pronto! Nova versão instalada');
    expect(container.querySelector('[data-testid="identity-remove-steps"]')).not.toBeNull();
  });

  it('ícone antigo depois de abrir o novo: "Este ícone é antigo" com abrir novo / remover', async () => {
    history.replaceState(null, '', '/app/mercado-teste-dc/');
    localStorage.setItem('dc:app-identity:mercado-teste-dc', CUR);
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    expect(container.textContent).toContain('Este ícone é antigo');
    expect(container.textContent).toContain('Desinstalar');
    expect(container.querySelector('[data-testid="identity-open-new"]')).not.toBeNull();
  });

  it('aba do Chrome com ?reinstall=1: espera o convite e mostra "Instalar nova versão"', async () => {
    standalone = false;
    history.replaceState(null, '', `/app/mercado-teste-dc~${CUR}/?reinstall=1`);
    const { AppIdentityUpdate, st } = await load();
    st.captureInstallEvents(window);
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    expect(container.querySelector('[data-testid="identity-waiting"]')).not.toBeNull();
    const prompt = vi.fn(async () => {});
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }) }));
    });
    expect(container.querySelector('[data-testid="identity-ready"]')).not.toBeNull();
    await act(async () => { (container.querySelector('[data-testid="identity-install"]') as HTMLButtonElement).click(); for (let i = 0; i < 5; i++) await Promise.resolve(); });
    expect(prompt).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="identity-pending"]')).not.toBeNull();
    await act(async () => { window.dispatchEvent(new Event('appinstalled')); });
    expect(container.querySelector('[data-testid="identity-installed"]')).not.toBeNull();
  });

  it('aceito sem appinstalled em 45 s: não manda remover, explica e deixa fechar', async () => {
    vi.useFakeTimers();
    standalone = false;
    history.replaceState(null, '', `/app/mercado-teste-dc~${CUR}/?reinstall=1`);
    const { AppIdentityUpdate, st } = await load();
    st.captureInstallEvents(window);
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    await act(async () => { window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'accepted' as const }) })); });
    await act(async () => { (container.querySelector('[data-testid="identity-install"]') as HTMLButtonElement).click(); for (let i = 0; i < 5; i++) await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(46000); });
    expect(container.querySelector('[data-testid="identity-slow"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="identity-installed"]')).toBeNull();
    await act(async () => { (Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Fechar') as HTMLButtonElement).click(); });
    expect(container.innerHTML).toBe('');
  });

  it('convite recusado na aba do Chrome: vai para as instruções do menu (com Fechar), não trava', async () => {
    standalone = false;
    history.replaceState(null, '', `/app/mercado-teste-dc~${CUR}/?reinstall=1`);
    const { AppIdentityUpdate, st } = await load();
    st.captureInstallEvents(window);
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    await act(async () => { window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' as const }) })); });
    expect(container.textContent).toContain('Agora não');
    await act(async () => { (container.querySelector('[data-testid="identity-install"]') as HTMLButtonElement).click(); for (let i = 0; i < 5; i++) await Promise.resolve(); });
    expect(container.querySelector('[data-testid="identity-no-prompt"]')).not.toBeNull();
    await act(async () => { (Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Fechar') as HTMLButtonElement).click(); });
    expect(container.innerHTML).toBe('');
  });

  it('aba do Chrome sem convite em 8 s: instruções do menu ⋮', async () => {
    vi.useFakeTimers();
    standalone = false;
    history.replaceState(null, '', `/app/mercado-teste-dc~${CUR}/?reinstall=1`);
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    await act(async () => { vi.advanceTimersByTime(8100); });
    expect(container.querySelector('[data-testid="identity-no-prompt"]')).not.toBeNull();
    expect(container.textContent).toContain('Instalar app');
  });
});
