// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverManifest } from '../../../../server/pwa/routes';
import type { StoreIdentityInput } from '../storeManifest';
import {
  dismissVisualNotice, evaluateVisualNotice, fetchCurrentVisualFingerprint, readVisualRecord,
  recordInstalledVisual, webApkFingerprint, webApkVisualKey,
} from '../webApkVisual';

const store: StoreIdentityInput = {
  id: 'tenant-1', slug: 'adegasshow', name: 'ADEGASSHOW',
  theme: { storeName: 'ADEGASSHOW', logoUrl: 'https://cdn.example/logo-1.png', headerColor: '#ffffff', statusBarColor: '#1b6004', navBarColor: '#1b6004' },
};
const t = (patch: Partial<NonNullable<StoreIdentityInput['theme']>>): StoreIdentityInput => ({ ...store, theme: { ...store.theme, ...patch } });
const fp = (s: StoreIdentityInput) => webApkFingerprint(serverManifest(s));

beforeEach(() => localStorage.clear());

describe('impressão digital do que o WebAPK congela (mesmo manifesto servido)', () => {
  it('muda com a cor da barra de navegação (theme_color/background_color) e com o ícone', () => {
    const base = fp(store);
    expect(base).toBeTruthy();
    expect(fp(t({ navBarColor: '#0b0b0f' }))).not.toBe(base);
    expect(fp(t({ logoUrl: 'https://cdn.example/logo-2.png' }))).not.toBe(base);
  });
  it('não muda com o que o app instalado já atualiza ao vivo (barra de status, tagline)', () => {
    const base = fp(store);
    expect(fp(t({ statusBarColor: '#d4a017' }))).toBe(base);
    expect(fp(t({ tagline: 'nova frase' }))).toBe(base);
  });
  it('ignora origem nas URLs de ícone e maiúsculas nas cores; manifesto sem cores não compara', () => {
    const m = serverManifest(store);
    const abs = { ...m, theme_color: m.theme_color.toUpperCase(), icons: m.icons.map(i => ({ ...i, src: `https://app.example${i.src}` })) };
    expect(webApkFingerprint(abs)).toBe(webApkFingerprint(m));
    expect(webApkFingerprint({ icons: m.icons })).toBeNull();
    expect(webApkFingerprint(null)).toBeNull();
  });
});

describe('decisão do aviso "Visual atualizado"', () => {
  const A = 'fp-a', B = 'fp-b', C = 'fp-c';
  it('navegador comum (não instalado) nunca mostra', () => {
    recordInstalledVisual(localStorage, 'loja', A);
    expect(evaluateVisualNotice(localStorage, 'loja', B, false)).toBe(false);
  });
  it('app aberto sem registro de instalação: grava o atual como base, sem aviso', () => {
    expect(evaluateVisualNotice(localStorage, 'loja', A, true)).toBe(false);
    expect(readVisualRecord(localStorage, 'loja').installed).toBe(A);
    expect(evaluateVisualNotice(localStorage, 'loja', A, true)).toBe(false);
  });
  it('visual mudou desde a instalação: mostra; "Agora não" esconde até mudar de novo', () => {
    recordInstalledVisual(localStorage, 'loja', A);
    expect(evaluateVisualNotice(localStorage, 'loja', B, true)).toBe(true);
    dismissVisualNotice(localStorage, 'loja', B);
    expect(evaluateVisualNotice(localStorage, 'loja', B, true)).toBe(false);
    expect(evaluateVisualNotice(localStorage, 'loja', C, true)).toBe(true);
  });
  it('reinstalar (appinstalled) grava o visual novo e limpa o aviso', () => {
    recordInstalledVisual(localStorage, 'loja', A);
    dismissVisualNotice(localStorage, 'loja', B);
    recordInstalledVisual(localStorage, 'loja', C);
    expect(readVisualRecord(localStorage, 'loja')).toEqual({ installed: C, dismissed: undefined });
    expect(evaluateVisualNotice(localStorage, 'loja', C, true)).toBe(false);
  });
  it('sem impressão digital (falha de rede) não faz nada; lojas não se misturam; registro corrompido é ignorado', () => {
    expect(evaluateVisualNotice(localStorage, 'loja', null, true)).toBe(false);
    expect(localStorage.getItem(webApkVisualKey('loja'))).toBeNull();
    recordInstalledVisual(localStorage, 'loja-1', A);
    expect(evaluateVisualNotice(localStorage, 'loja-2', B, true)).toBe(false);
    localStorage.setItem(webApkVisualKey('x'), '{quebrado');
    expect(readVisualRecord(localStorage, 'x')).toEqual({});
  });
});

describe('fetchCurrentVisualFingerprint', () => {
  const ok = (body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/manifest+json' } }));
  it('lê o manifesto servido da loja sem cache e calcula a impressão digital', async () => {
    const f = ok(serverManifest(store));
    expect(await fetchCurrentVisualFingerprint('adegasshow', 'tenant-1', f as unknown as typeof fetch)).toBe(fp(store));
    expect(f).toHaveBeenCalledWith('/app/adegasshow/manifest.webmanifest', expect.objectContaining({ cache: 'no-cache' }));
  });
  it('manifesto de outra loja, erro HTTP ou rede => null', async () => {
    expect(await fetchCurrentVisualFingerprint('adegasshow', 'outro-tenant', ok(serverManifest(store)) as unknown as typeof fetch)).toBeNull();
    const bad = vi.fn().mockResolvedValue(new Response('x', { status: 503 }));
    expect(await fetchCurrentVisualFingerprint('adegasshow', 'tenant-1', bad as unknown as typeof fetch)).toBeNull();
    const boom = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await fetchCurrentVisualFingerprint('adegasshow', 'tenant-1', boom as unknown as typeof fetch)).toBeNull();
  });
});
