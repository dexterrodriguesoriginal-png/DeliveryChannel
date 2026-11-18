// @vitest-environment node
import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createPwaRouter, iconVersion, identityVersion, serverManifest, serverTotemManifest } from '../routes';
import { injectStoreHead } from '../storeHtml';
import { identityHash } from '../../../src/lib/pwa/applyStoreIdentity';
import { storeIconVersion, type StoreIdentityInput } from '../../../src/lib/pwa/storeManifest';
import { injectTotemHead } from '../../../src/lib/pwa/totemManifest';

type Theme = NonNullable<StoreIdentityInput['theme']>;
const withLogo: StoreIdentityInput = {
  id: 'tenant-1', slug: 'adegasshow', name: 'ADEGASSHOW',
  theme: {
    storeName: 'ADEGASSHOW', logoUrl: 'https://cdn.example/t1/theme/logo-1700000000000.png',
    primaryColor: '#f3ebf0', backgroundColor: '#f1d4eb', headerColor: '#ffffff',
    statusBarColor: '#1b6004', navBarColor: '#1b6004', tagline: 'x', shortName: 'Adega', updatedAt: '2026-11-17T00:00:00Z',
  },
};
const noLogo: StoreIdentityInput = { ...withLogo, theme: { ...withLogo.theme, logoUrl: undefined, headerColor: '#7c2d12' } };
const t = (s: StoreIdentityInput, patch: Partial<Theme>): StoreIdentityInput => ({ ...s, theme: { ...s.theme, ...patch } });

// Mudanças que NÃO alteram a imagem do ícone de uma loja com logo.
const colorAndMetaChanges: Partial<Theme>[] = [
  { navBarColor: '#ff0000' },
  { statusBarColor: '#00ff00' },
  { navBarColor: undefined, statusBarColor: undefined },
  { headerColor: '#123456' },
  { primaryColor: '#abcdef' },
  { backgroundColor: '#000000' },
  { tagline: 'nova frase' },
  { shortName: 'Outro' },
  { updatedAt: '2026-11-18T01:00:00Z' },
];

describe('versão do ícone (?v=) estável: só muda quando a imagem do ícone muda', () => {
  it('loja com logo: trocar cores de barras/tema, tagline, nome curto ou updatedAt não muda o ?v=', () => {
    const v = iconVersion(withLogo);
    for (const patch of colorAndMetaChanges) expect(iconVersion(t(withLogo, patch))).toBe(v);
    // Trocar o modelo inteiro (todas as cores de uma vez) também não muda.
    expect(iconVersion(t(withLogo, { primaryColor: '#111111', backgroundColor: '#222222', headerColor: '#333333', statusBarColor: '#444444', navBarColor: '#555555' }))).toBe(v);
  });
  it('loja com logo: muda quando o logo muda', () => {
    expect(iconVersion(t(withLogo, { logoUrl: 'https://cdn.example/t1/theme/logo-1800000000000.png' }))).not.toBe(iconVersion(withLogo));
  });
  it('loja sem logo (ícone de iniciais): muda com o nome e com a cor do ícone, não com barras', () => {
    const v = iconVersion(noLogo);
    // cabeçalho vivo é a cor do ícone de iniciais: barras/fundo/updatedAt não mexem nele
    for (const patch of [{ navBarColor: '#ff0000' }, { statusBarColor: '#00ff00' }, { backgroundColor: '#000000' }, { updatedAt: 'z' }, { tagline: 'y' }])
      expect(iconVersion(t(noLogo, patch))).toBe(v);
    expect(iconVersion(t(noLogo, { storeName: 'Outra Loja' }))).not.toBe(v);
    expect(iconVersion(t(noLogo, { headerColor: '#1d4ed8' }))).not.toBe(v);
    // cabeçalho branco (cor fraca): o ícone usa a cor de status; então a versão acompanha a cor de status
    const weak = t(noLogo, { headerColor: '#ffffff' });
    expect(iconVersion(t(weak, { statusBarColor: '#b91c1c' }))).not.toBe(iconVersion(weak));
  });
  it('lojas diferentes nunca compartilham versão', () => {
    expect(iconVersion({ ...withLogo, id: 'tenant-2' })).not.toBe(iconVersion(withLogo));
  });
  it('mesmo ?v= em manifesto (app e totem), HTML da loja, HTML do totem e no navegador', () => {
    const v = storeIconVersion(withLogo);
    expect(identityHash(withLogo)).toBe(v);
    for (const icon of serverManifest(withLogo).icons) expect(icon.src.endsWith(`?v=${v}`)).toBe(true);
    for (const icon of serverTotemManifest(withLogo).icons) expect(icon.src.endsWith(`?v=${v}`)).toBe(true);
    expect(injectStoreHead('<html><head><title>x</title></head></html>', 'adegasshow', withLogo)).toContain(`icon-192.png?v=${v}`);
    expect(injectTotemHead('<html><head><title>x</title></head></html>', 'adegasshow', 'Totem', withLogo)).toContain(`icon-192.png?v=${v}`);
  });
  it('id, start_url, scope e URL do manifesto não mudam com as cores', () => {
    const a = serverManifest(withLogo);
    const b = serverManifest(t(withLogo, { navBarColor: '#ff0000', statusBarColor: '#00ff00', headerColor: '#123456' }));
    expect(b.id).toBe(a.id);
    expect(b.start_url).toBe(a.start_url);
    expect(b.scope).toBe(a.scope);
    expect(b.related_applications).toEqual(a.related_applications);
    expect(b.icons).toEqual(a.icons);
  });
  it('/api/pwa/version continua avisando o app aberto quando as cores mudam', () => {
    expect(identityVersion(t(withLogo, { navBarColor: '#ff0000' }))).not.toBe(identityVersion(withLogo));
    expect(identityVersion(t(withLogo, { updatedAt: 'outro' }))).not.toBe(identityVersion(withLogo));
  });
});

describe('bytes do ícone iguais quando só as cores mudam (sem aviso de troca de ícone no Android)', () => {
  async function iconBytes(store: StoreIdentityInput, logo: Buffer | null, variant = 'icon-192') {
    const app = express();
    app.use(createPwaRouter({
      resolveStore: async () => ({ status: 'ok', store }),
      publicDir: '/nonexistent',
      fetchLogo: async () => { if (!logo) throw new Error('sem logo'); return { bytes: logo, contentType: 'image/svg+xml' }; },
    }));
    const server = await new Promise<import('node:http').Server>((r) => { const sv = app.listen(0, '127.0.0.1', () => r(sv)); });
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const res = await fetch(`${base}/app/${store.slug}/icons/${variant}.png?v=${iconVersion(store)}`);
      expect(res.status).toBe(200);
      return Buffer.from(await res.arrayBuffer());
    } finally { server.close(); }
  }
  const logoSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#15803d"/><circle cx="32" cy="32" r="20" fill="#fde047"/></svg>');
  it('logo: mesmos bytes e mesmo ?v= trocando barras e modelo', async () => {
    const changed = t(withLogo, { navBarColor: '#ff0000', statusBarColor: '#00ff00', headerColor: '#123456', primaryColor: '#abcdef', updatedAt: 'n' });
    for (const variant of ['icon-192', 'icon-512', 'maskable-512']) {
      const [a, b] = [await iconBytes(withLogo, logoSvg, variant), await iconBytes(changed, logoSvg, variant)];
      expect(a.equals(b)).toBe(true);
    }
    expect(iconVersion(changed)).toBe(iconVersion(withLogo));
  });
  it('iniciais: mesmos bytes trocando barras; bytes diferentes quando a cor do ícone muda (e o ?v= também)', async () => {
    const base = await iconBytes(noLogo, null);
    expect((await iconBytes(t(noLogo, { navBarColor: '#ff0000', statusBarColor: '#00ff00' }), null)).equals(base)).toBe(true);
    const recolored = t(noLogo, { headerColor: '#1d4ed8' });
    expect((await iconBytes(recolored, null)).equals(base)).toBe(false);
    expect(iconVersion(recolored)).not.toBe(iconVersion(noLogo));
  });
});
