// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createPwaRouter, iconVersion, identityTestManifest, serverManifest } from '../routes';
import { DEFAULT_IDENTITY_TEST_SLUGS, resolveIdentityTestSlugs } from '../identityTest';
import { injectStoreHead } from '../storeHtml';
import type { StoreResolver } from '../storeSource';
import type { StoreIdentityInput } from '../../../src/lib/pwa/storeManifest';

const real: StoreIdentityInput = {
  id: 'tenant-real-01', slug: 'adegasshow', name: 'Adega Show',
  theme: { storeName: 'Adega Show', primaryColor: '#7c3aed', navBarColor: '#1d4ed8', statusBarColor: '#111827', logoUrl: '/nao-existe.png' },
};
const test: StoreIdentityInput = {
  id: 'tenant-test-01', slug: 'mercado-teste-dc', name: 'Mercado Teste DC',
  theme: { storeName: 'Mercado Teste DC', primaryColor: '#0ea5e9', navBarColor: '#f8fafc', logoUrl: 'https://cdn.example/logo-v1.png' },
};
const stores: Record<string, StoreIdentityInput> = { [real.slug]: real, [test.slug]: test };
const resolver: StoreResolver = async (slug) => (stores[slug] ? { status: 'ok', store: stores[slug] } : { status: 'not_found' });

function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  return new Promise(r => { const server = app.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })); });
}
const publicDir = path.resolve(process.cwd(), 'public');
const mk = (identityTestSlugs?: string[]) => {
  const a = express();
  a.use(createPwaRouter({ resolveStore: resolver, publicDir, fetchLogo: async () => { throw new Error('x'); }, identityTestSlugs }));
  return a;
};
let withList: { server: Server; base: string };
let without: { server: Server; base: string };
let routerWith: ReturnType<typeof createPwaRouter>;
beforeAll(async () => {
  routerWith = createPwaRouter({ resolveStore: resolver, publicDir, fetchLogo: async () => { throw new Error('x'); }, identityTestSlugs: ['mercado-teste-dc'] });
  const a = express(); a.use(routerWith);
  [withList, without] = await Promise.all([listen(a), listen(mk())]);
});
afterAll(async () => { await Promise.all([withList, without].map(s => new Promise<void>(r => s.server.close(() => r())))); });

const iv = iconVersion(test);

describe('lista do experimento de identidade', () => {
  it('padrão só a loja de teste; env substitui (vazia desliga)', () => {
    expect(DEFAULT_IDENTITY_TEST_SLUGS).toEqual(['mercado-teste-dc']);
    expect(resolveIdentityTestSlugs({})).toEqual(['mercado-teste-dc']);
    expect(resolveIdentityTestSlugs({ PWA_IDENTITY_TEST_SLUGS: '' })).toEqual([]);
  });
});

describe('lojas reais: nada muda', () => {
  it('manifesto base igual com e sem lista (mesmos bytes)', async () => {
    const [x, y] = await Promise.all([withList, without].map(s => fetch(`${s.base}/app/adegasshow/manifest.webmanifest`).then(r => r.text())));
    expect(x).toBe(y);
    expect(x).toBe(JSON.stringify(serverManifest(real)));
  });
  it('endereço versionado de loja real volta ao endereço normal (302), manifesto versionado não existe', async () => {
    const r = await fetch(`${withList.base}/app/adegasshow~0123456789/?source=pwa`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/app/adegasshow/?source=pwa');
    const m = await fetch(`${withList.base}/app/adegasshow~0123456789/manifest.webmanifest`, { redirect: 'manual' });
    expect(m.status).toBe(302);
    expect(m.headers.get('location')).toBe('/app/adegasshow/manifest.webmanifest');
  });
  it('/api/pwa/version sem appIdentity para loja real', async () => {
    const j = await fetch(`${withList.base}/api/pwa/version?slug=adegasshow`).then(r => r.json());
    expect(j.appIdentity).toBeUndefined();
  });
  it('identityHeadOptions vazio para loja real', () => {
    expect(routerWith.identityHeadOptions(real, null)).toEqual({});
    expect(routerWith.identityHeadOptions(real, '0123456789')).toEqual({});
  });
  it('HTML de loja real sem opções de identidade = igual ao atual', () => {
    const html = '<html><head><title>x</title></head><body></body></html>';
    expect(injectStoreHead(html, real.slug, real, {})).toBe(injectStoreHead(html, real.slug, real));
    expect(injectStoreHead(html, real.slug, real)).not.toContain('dc-app-identity');
  });
});

describe('loja de teste', () => {
  it('manifesto base continua igual (app antigo segue funcionando)', async () => {
    const t = await fetch(`${withList.base}/app/mercado-teste-dc/manifest.webmanifest`).then(r => r.text());
    expect(t).toBe(JSON.stringify(serverManifest(test)));
  });
  it('manifesto versionado: id/start_url/scope próprios da versão da logo', async () => {
    const m = await fetch(`${withList.base}/app/mercado-teste-dc~${iv}/manifest.webmanifest`).then(r => r.json());
    expect(m.id).toBe(`/app-id/tenant-test-01/${iv}`);
    expect(m.start_url).toBe(`/app/mercado-teste-dc~${iv}/?source=pwa`);
    expect(m.scope).toBe(`/app/mercado-teste-dc~${iv}/`);
    expect(m.related_applications).toEqual([{ platform: 'webapp', url: `/app/mercado-teste-dc~${iv}/manifest.webmanifest` }]);
    expect(m.icons).toEqual(serverManifest(test).icons);
    expect(m).toEqual(identityTestManifest(test, iv));
    // fora do scope antigo: o Chrome não acha que "já está instalado"
    expect(m.start_url.startsWith('/app/mercado-teste-dc/')).toBe(false);
  });
  it('sem a lista, endereço versionado volta ao normal', async () => {
    const r = await fetch(`${without.base}/app/mercado-teste-dc~${iv}/`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/app/mercado-teste-dc/');
  });
  it('versão inválida não vira identidade', async () => {
    expect((await fetch(`${withList.base}/app/mercado-teste-dc~XYZ/manifest.webmanifest`)).status).toBe(404);
  });
  it('/api/pwa/version traz appIdentity atual', async () => {
    const j = await fetch(`${withList.base}/api/pwa/version?slug=mercado-teste-dc`).then(r => r.json());
    expect(j.appIdentity).toBe(iv);
    expect(typeof j.identityVersion).toBe('string');
  });
  it('identityHeadOptions: manifesto da versão pedida (ou da atual) e meta da atual', () => {
    expect(routerWith.identityHeadOptions(test, null)).toEqual({ manifestHref: `/app/mercado-teste-dc~${iv}/manifest.webmanifest`, appIdentity: iv });
    expect(routerWith.identityHeadOptions(test, 'aaaaaaaaaa')).toEqual({ manifestHref: '/app/mercado-teste-dc~aaaaaaaaaa/manifest.webmanifest', appIdentity: iv });
  });
  it('HTML injeta manifesto versionado e meta dc-app-identity', () => {
    const html = '<html><head><title>x</title></head><body></body></html>';
    const out = injectStoreHead(html, test.slug, test, routerWith.identityHeadOptions(test, null));
    expect(out).toContain(`<link rel="manifest" href="/app/mercado-teste-dc~${iv}/manifest.webmanifest"`);
    expect(out).toContain(`<meta name="dc-app-identity" content="${iv}" />`);
  });
  it('logo nova = versão nova', () => {
    const v2 = iconVersion({ ...test, theme: { ...test.theme, logoUrl: 'https://cdn.example/logo-v2.png' } });
    expect(v2).toMatch(/^[0-9a-f]{10}$/);
    expect(v2).not.toBe(iv);
  });
});

describe('todas as lojas: botão só depois de a loja TROCAR a logo (appBaseLogoUrl)', () => {
  const base = 'https://cdn.example/logo-original.png';
  const unchanged: StoreIdentityInput = { id: 'tenant-u', slug: 'loja-igual', name: 'Loja Igual', appBaseLogoUrl: base, theme: { storeName: 'Loja Igual', logoUrl: base } };
  const changed: StoreIdentityInput = { id: 'tenant-c', slug: 'loja-nova', name: 'Loja Nova', appBaseLogoUrl: base, theme: { storeName: 'Loja Nova', logoUrl: 'https://cdn.example/logo-nova.png' } };
  const all: Record<string, StoreIdentityInput> = { [real.slug]: real, [unchanged.slug]: unchanged, [changed.slug]: changed };
  const r = createPwaRouter({ resolveStore: async (s) => (all[s] ? { status: 'ok', store: all[s] } : { status: 'not_found' }), publicDir, fetchLogo: async () => { throw new Error('x'); }, identityTestSlugs: ['mercado-teste-dc'] });
  let srv: { server: Server; base: string };
  beforeAll(async () => { const a = express(); a.use(r); srv = await listen(a); });
  afterAll(async () => { await new Promise<void>(res => srv.server.close(() => res())); });
  const cv = iconVersion(changed);

  it('loja que nunca trocou a logo (sem appBaseLogoUrl): manifesto, HTML e versão como antes', async () => {
    expect(r.identityHeadOptions(real, null)).toEqual({});
    const j = await fetch(`${srv.base}/api/pwa/version?slug=adegasshow`).then(x => x.json());
    expect(j.appIdentity).toBeUndefined();
    expect(await fetch(`${srv.base}/app/adegasshow/manifest.webmanifest`).then(x => x.text())).toBe(JSON.stringify(serverManifest(real)));
    expect((await fetch(`${srv.base}/app/adegasshow~0123456789/`, { redirect: 'manual' })).status).toBe(302);
  });

  it('logo igual à do app instalado: sem botão, manifesto base', async () => {
    expect(r.identityHeadOptions(unchanged, null)).toEqual({});
    const j = await fetch(`${srv.base}/api/pwa/version?slug=loja-igual`).then(x => x.json());
    expect(j.appIdentity).toBeUndefined();
    expect(await fetch(`${srv.base}/app/loja-igual/manifest.webmanifest`).then(x => x.text())).toBe(JSON.stringify(serverManifest(unchanged)));
  });

  it('logo trocada: versão nova (app antigo vê o botão) e manifesto versionado', async () => {
    expect(r.identityHeadOptions(changed, null)).toEqual({ manifestHref: `/app/loja-nova~${cv}/manifest.webmanifest`, appIdentity: cv });
    const j = await fetch(`${srv.base}/api/pwa/version?slug=loja-nova`).then(x => x.json());
    expect(j.appIdentity).toBe(cv);
    const m = await fetch(`${srv.base}/app/loja-nova~${cv}/manifest.webmanifest`).then(x => x.json());
    expect(m).toEqual(identityTestManifest(changed, cv));
    // o manifesto sem versão (o do app instalado) continua sendo servido
    expect(await fetch(`${srv.base}/app/loja-nova/manifest.webmanifest`).then(x => x.text())).toBe(JSON.stringify(serverManifest(changed)));
  });

  it('voltou para a logo original: app versionado mantém o manifesto dele, sem botão', () => {
    expect(r.identityHeadOptions(unchanged, 'aaaaaaaaaa')).toEqual({ manifestHref: '/app/loja-igual~aaaaaaaaaa/manifest.webmanifest' });
  });
});
