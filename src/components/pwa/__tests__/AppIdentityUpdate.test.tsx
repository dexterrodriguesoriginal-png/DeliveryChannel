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

  it('ícone antigo: pílula → Baixar versão atualizada → abre janela nova fora do app (não intent://) com a página de instalação', async () => {
    history.replaceState(null, '', '/app/mercado-teste-dc/?source=pwa');
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    expect(container.textContent).toContain('Nova versão do app');
    expect(container.querySelector('[data-testid="identity-update"]')!.textContent).toBe('Baixar versão atualizada');
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    await act(async () => { (container.querySelector('[data-testid="identity-update"]') as HTMLButtonElement).click(); });
    expect(open).toHaveBeenCalledWith(`${window.location.origin}/app/mercado-teste-dc~${CUR}/?reinstall=1`, '_blank');
    expect(container.textContent).toContain('Página de instalação aberta');
    expect(container.querySelector('[data-testid="identity-back"]')).not.toBeNull();
    // voltou (cancelou lá): a loja fica livre de novo
    const vis = vi.spyOn(document, 'visibilityState', 'get');
    vis.mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    vis.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(container.querySelector('[data-testid="identity-overlay"]')).toBeNull();
    expect(container.querySelector('[data-testid="identity-pill"]')).not.toBeNull();
  });

  it('janela nova bloqueada: abre a página de instalação aqui mesmo (https comum)', async () => {
    history.replaceState(null, '', '/app/mercado-teste-dc/');
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    vi.spyOn(window, 'open').mockReturnValue(null);
    const hrefSet = vi.fn();
    const loc = window.location;
    vi.stubGlobal('location', { ...loc, origin: 'https://deliverychannel.ai.studio', pathname: loc.pathname, search: loc.search, set href(v: string) { hrefSet(v); }, get href() { return loc.href; } });
    await act(async () => { (container.querySelector('[data-testid="identity-update"]') as HTMLButtonElement).click(); });
    expect(hrefSet).toHaveBeenCalledWith(`https://deliverychannel.ai.studio/app/mercado-teste-dc~${CUR}/?reinstall=1`);
  });

  it('tela de abertura tem Voltar à loja', async () => {
    history.replaceState(null, '', '/app/mercado-teste-dc/');
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    vi.spyOn(window, 'open').mockReturnValue({} as Window);
    await act(async () => { (container.querySelector('[data-testid="identity-update"]') as HTMLButtonElement).click(); });
    await act(async () => { (container.querySelector('[data-testid="identity-back"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="identity-overlay"]')).toBeNull();
  });

  it('ícone antigo com convite no próprio app: usa o prompt nativo; só o appinstalled libera "Abrir a nova"', async () => {
    history.replaceState(null, '', '/app/mercado-teste-dc/');
    const { AppIdentityUpdate, st } = await load();
    st.captureInstallEvents(window);
    const prompt = vi.fn(async () => {});
    const ev = Object.assign(new Event('beforeinstallprompt'), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }) });
    window.dispatchEvent(ev);
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    await act(async () => { (container.querySelector('[data-testid="identity-update"]') as HTMLButtonElement).click(); for (let i = 0; i < 5; i++) await Promise.resolve(); });
    expect(prompt).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="identity-pending"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Pronto!');
    const hrefSet = vi.fn();
    const loc = window.location;
    vi.stubGlobal('location', { ...loc, origin: 'https://deliverychannel.ai.studio', pathname: loc.pathname, search: loc.search, set href(v: string) { hrefSet(v); }, get href() { return loc.href; } });
    await act(async () => { window.dispatchEvent(new Event('appinstalled')); });
    expect(container.textContent).toContain('Pronto!');
    // appinstalled pelo convite do próprio app antigo também confirma a versão nova
    expect(localStorage.getItem('dc:app-identity:mercado-teste-dc')).toBe(CUR);
    expect(container.textContent).not.toMatch(/Desinstalar|Remover|toque e segure/i);
    // "Abrir a nova": link https comum (o Chrome entrega ao app instalado dono do endereço), nunca intent://
    await act(async () => { (container.querySelector('[data-testid="identity-open-new"]') as HTMLButtonElement).click(); });
    expect(hrefSet).toHaveBeenCalledWith(`https://deliverychannel.ai.studio/app/mercado-teste-dc~${CUR}/?source=pwa`);
  });

  it('página de instalação aberta DENTRO da janela do app antigo (display-mode standalone): mostra a instalação e não marca nada', async () => {
    vi.useFakeTimers();
    standalone = true;
    history.replaceState(null, '', `/app/mercado-teste-dc~${CUR}/?reinstall=1`);
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    expect(container.querySelector('[data-testid="identity-reinstall"]')).not.toBeNull();
    expect(container.textContent).toContain('Instalar app');
    expect(container.textContent).toContain('Baixar pelo Google Chrome');
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(localStorage.getItem('dc:app-identity:mercado-teste-dc')).toBeNull();
  });

  it('versão atual aberta por navegação vinda do app antigo (com referrer): não marca como instalada', async () => {
    history.replaceState(null, '', `/app/mercado-teste-dc~${CUR}/?source=pwa`);
    vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://deliverychannel.ai.studio/app/mercado-teste-dc/');
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    expect(localStorage.getItem('dc:app-identity:mercado-teste-dc')).toBeNull();
  });

  it('ícone antigo depois de abrir o novo: uma linha "pode apagar" + Abrir a nova, sem instruções', async () => {
    history.replaceState(null, '', '/app/mercado-teste-dc/');
    localStorage.setItem('dc:app-identity:mercado-teste-dc', CUR);
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    expect(container.textContent).toContain('Esta versão é antiga, pode apagar');
    expect(container.textContent).not.toMatch(/Desinstalar|toque e segure/i);
    expect(container.querySelector('[data-testid="identity-open-new"]')!.textContent).toBe('Abrir a nova');
    expect(container.querySelector('ol')).toBeNull();
  });

  it('aba do Chrome com ?reinstall=1: espera o convite e mostra "Instalar"', async () => {
    standalone = false;
    history.replaceState(null, '', `/app/mercado-teste-dc~${CUR}/?reinstall=1`);
    const { AppIdentityUpdate, st } = await load();
    st.captureInstallEvents(window);
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    expect(container.querySelector('[data-testid="identity-reinstall"]')).not.toBeNull();
    const prompt = vi.fn(async () => {});
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }) }));
    });
    expect(container.querySelector('[data-testid="identity-install"]')).not.toBeNull();
    await act(async () => { (container.querySelector('[data-testid="identity-install"]') as HTMLButtonElement).click(); for (let i = 0; i < 5; i++) await Promise.resolve(); });
    expect(prompt).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="identity-pending"]')).not.toBeNull();
    await act(async () => { window.dispatchEvent(new Event('appinstalled')); });
    expect(container.querySelector('[data-testid="identity-installed"]')).not.toBeNull();
    // appinstalled confirma: o ícone antigo passa a mostrar "pode apagar" + "Abrir a nova"
    expect(localStorage.getItem('dc:app-identity:mercado-teste-dc')).toBe(CUR);
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
    expect(container.textContent).toContain('Instalar app');
    await act(async () => { (container.querySelector('[data-testid="identity-install"]') as HTMLButtonElement).click(); for (let i = 0; i < 5; i++) await Promise.resolve(); });
    expect(container.querySelector('[data-testid="identity-no-prompt"]')).not.toBeNull();
    await act(async () => { (Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Fechar') as HTMLButtonElement).click(); });
    expect(container.innerHTML).toBe('');
  });

  it('reinstall: nome da loja e dois botões aparecem imediatamente, sem barra nem mensagem de atualização', async () => {
    standalone = false;
    history.replaceState(null, '', `/app/mercado-teste-dc~${CUR}/?reinstall=1`);
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    expect(container.textContent).toContain('Mercado');
    expect(container.querySelector('[data-testid="identity-install"]')?.textContent).toBe('Instalar app');
    expect(container.querySelector('[data-testid="identity-chrome"]')?.textContent?.trim()).toBe('Baixar pelo Google Chrome');
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.textContent).not.toContain('Atualizando aplicativo');
  });

  it('página ?reinstall=1: instalado pelo menu ⋮ (appinstalled sem tocar no botão) mostra Pronto e marca a versão', async () => {
    standalone = false;
    history.replaceState(null, '', `/app/mercado-teste-dc~${CUR}/?reinstall=1`);
    const { AppIdentityUpdate, st } = await load();
    st.captureInstallEvents(window);
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    await act(async () => { window.dispatchEvent(new Event('appinstalled')); });
    expect(container.querySelector('[data-testid="identity-installed"]')).not.toBeNull();
    expect(localStorage.getItem('dc:app-identity:mercado-teste-dc')).toBe(CUR);
  });

  it('link Android abre Chrome com package e fallback HTTPS original', async () => {
    standalone = false;
    history.replaceState(null, '', `/app/mercado-teste-dc~${CUR}/?reinstall=1`);
    const loc = window.location;
    vi.stubGlobal('location', { ...loc, origin: 'https://deliverychannel.ai.studio', pathname: loc.pathname, search: loc.search, href: loc.href });
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    const href = (container.querySelector('[data-testid="identity-chrome"]') as HTMLAnchorElement).getAttribute('href')!;
    const https = `https://deliverychannel.ai.studio/app/mercado-teste-dc~${CUR}/?reinstall=1`;
    expect(href).toBe(`intent://deliverychannel.ai.studio/app/mercado-teste-dc~${CUR}/?reinstall=1#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(https)};end`);
    expect(href).toContain('package=com.android.chrome');
    expect(href).toContain(`S.browser_fallback_url=${encodeURIComponent(https)}`);
    expect(href).toMatch(/^intent:\/\//);
  });

  it('sem convite: ao clicar Instalar espera 3 s e então orienta pelo menu ⋮', async () => {
    vi.useFakeTimers();
    standalone = false;
    history.replaceState(null, '', `/app/mercado-teste-dc~${CUR}/?reinstall=1`);
    const { AppIdentityUpdate } = await load();
    await render(<AppIdentityUpdate slug="mercado-teste-dc" storeName="Mercado" initialIdentity={CUR} />);
    await act(async () => { (container.querySelector('[data-testid="identity-install"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="identity-no-prompt"]')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(3100); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="identity-no-prompt"]')).not.toBeNull();
    expect(container.textContent).toContain('⋮');
    expect(localStorage.getItem('dc:app-identity:mercado-teste-dc')).toBeNull();
  });
});
