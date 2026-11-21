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
  theme: { storeName: 'Mercado Teste DC', logoUrl: 'https://cdn.example/logo-v1.png' },
};
const changed: StoreIdentityInput = {
  id: 'tenant-changed', slug: 'loja-nova', name: 'Loja Nova',
  appBaseLogoUrl: '/logo-original.png',
  theme: { storeName: 'Loja Nova', logoUrl: '/logo-nova.png' },
};
const stores: Record<string, StoreIdentityInput> = {
  [real.slug]: real, [test.slug]: test, [changed.slug]: changed,
};
const resolver: StoreResolver = async (slug) => stores[slug]
  ? { status: 'ok', store: stores[slug] } : { status: 'not_found' };
const publicDir = path.resolve(process.cwd(), 'public');

async function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve({
      server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    }));
  });
}
const make = (identityTestSlugs?: string[]) => {
  const router = createPwaRouter({ resolveStore: resolver, publicDir, identityTestSlugs });
  const app = express();
  app.use(router);
  // Simula o index.html do servidor principal, sem redirecionar instalações legadas.
  app.use((req, res) => res.status(200).send('html'));
  return { router, app };
};

let listed: { server: Server; base: string };
let unlisted: { server: Server; base: string };
let router: ReturnType<typeof createPwaRouter>;
beforeAll(async () => {
  const a = make(['mercado-teste-dc']); router = a.router;
  [listed, unlisted] = await Promise.all([listen(a.app), listen(make([]).app)]);
});
afterAll(async () => {
  await Promise.all([listed, unlisted].map(s =>
    new Promise<void>(resolve => s.server.close(() => resolve()))));
});

describe('lista histórica de identidade', () => {
  it('env substitui a lista padrão, mas nunca governa o HTML canônico', () => {
    expect(DEFAULT_IDENTITY_TEST_SLUGS).toEqual(['mercado-teste-dc']);
    expect(resolveIdentityTestSlugs({})).toEqual(['mercado-teste-dc']);
    expect(resolveIdentityTestSlugs({ PWA_IDENTITY_TEST_SLUGS: '' })).toEqual([]);
    expect(router.identityHeadOptions(test, null)).toEqual({});
  });
});

describe('manifesto estável para todas as instalações novas', () => {
  for (const store of [real, test, changed]) {
    it(`/app/${store.slug}/ usa id e scope fixos, mesmo com logo trocada/lista de teste`, async () => {
      const [a, b] = await Promise.all([listed, unlisted].map(s =>
        fetch(`${s.base}/app/${store.slug}/manifest.webmanifest`).then(r => r.json())));
      expect(a).toEqual(serverManifest(store));
      expect(b).toEqual(serverManifest(store));
      expect(a.id).toBe(`/app-id/${store.id}`);
      expect(a.scope).toBe(`/app/${store.slug}/`);
      expect(a.start_url).toBe(`/app/${store.slug}/?source=pwa`);
      expect(router.identityHeadOptions(store, null)).toEqual({});
      const html = injectStoreHead('<html><head></head><body></body></html>', store.slug, store,
        router.identityHeadOptions(store, null));
      expect(html).toContain(`href="/app/${store.slug}/manifest.webmanifest"`);
      expect(html).not.toContain('dc-app-identity');
    });

    it(`/api/pwa/version?slug=${store.slug} não inclui appIdentity`, async () => {
      const json = await fetch(`${listed.base}/api/pwa/version?slug=${store.slug}`).then(r => r.json());
      expect(json.appIdentity).toBeUndefined();
      expect(typeof json.identityVersion).toBe('string');
    });
  }

  it('ícones PNG têm purpose separados e versões derivadas somente da imagem', () => {
    const m = serverManifest(test);
    expect(m.icons).toEqual([
      { src: `/app/mercado-teste-dc/icons/icon-192.png?v=${iconVersion(test)}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/app/mercado-teste-dc/icons/icon-512.png?v=${iconVersion(test)}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `/app/mercado-teste-dc/icons/maskable-512.png?v=${iconVersion(test)}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    expect(m.icons.some(i => i.purpose === 'any maskable')).toBe(false);
    const colorChange = { ...test, theme: { ...test.theme, primaryColor: '#abcdef' } };
    expect(iconVersion(colorChange)).toBe(iconVersion(test));
    expect(iconVersion({ ...test, theme: { ...test.theme, logoUrl: '/different.png' } }))
      .not.toBe(iconVersion(test));
  });
});

describe('compatibilidade permanente dos WebAPKs com ~hash', () => {
  for (const store of [real, test, changed]) {
    it(`mantém id, scope, start_url e related_applications do hash antigo de ${store.slug}`, async () => {
      const hash = '0123456789'; // não precisa corresponder à versão do ícone atual
      for (const server of [listed, unlisted]) {
        const page = await fetch(`${server.base}/app/${store.slug}~${hash}/`, { redirect: 'manual' });
        expect(page.status).toBe(200);
        const response = await fetch(`${server.base}/app/${store.slug}~${hash}/manifest.webmanifest`, { redirect: 'manual' });
        expect(response.status).toBe(200);
        const m = await response.json();
        expect(m).toEqual(identityTestManifest(store, hash));
        expect(m.id).toBe(`/app-id/${store.id}/${hash}`);
        expect(m.scope).toBe(`/app/${store.slug}~${hash}/`);
        expect(m.start_url).toBe(`/app/${store.slug}~${hash}/?source=pwa`);
        expect(m.related_applications).toEqual([{ platform: 'webapp', url: `/app/${store.slug}~${hash}/manifest.webmanifest` }]);
        expect(m.icons).toEqual(serverManifest(store).icons);
      }
      expect(router.identityHeadOptions(store, hash)).toEqual({
        manifestHref: `/app/${store.slug}~${hash}/manifest.webmanifest`,
      });
      const html = injectStoreHead('<html><head></head><body></body></html>', store.slug, store,
        router.identityHeadOptions(store, hash));
      expect(html).toContain(`href="/app/${store.slug}~${hash}/manifest.webmanifest"`);
      expect(html).not.toContain('dc-app-identity');
    });
  }
  it('versões inválidas não são aceitas como hash legado', async () => {
    const res = await fetch(`${listed.base}/app/mercado-teste-dc~XYZ/manifest.webmanifest`);
    expect(res.status).toBe(404);
  });
  it('erro de consulta não força redirecionamento para fora do scope legado', async () => {
    let fail = true;
    const app = express();
    app.use(createPwaRouter({
      resolveStore: async () => fail ? { status: 'error', message: 'timeout' } : { status: 'ok', store: real },
      publicDir, ttlMs: 0,
    }));
    app.use((_req, res) => res.status(200).send('html'));
    const srv = await listen(app);
    try {
      const first = await fetch(`${srv.base}/app/adegasshow~0123456789/`, { redirect: 'manual' });
      expect(first.status).toBe(200);
      fail = false;
      const second = await fetch(`${srv.base}/app/adegasshow~0123456789/`, { redirect: 'manual' });
      expect(second.status).toBe(200);
    } finally { await new Promise<void>(res => srv.server.close(() => res())); }
  });
});
