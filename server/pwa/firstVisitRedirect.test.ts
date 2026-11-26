// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPwaRouter } from './routes';
import { storeAppIdentity } from '../../src/lib/pwa/storeManifest';

describe('first visit PWA redirect', () => {
  const logo = Buffer.from('test logo bytes');
  const store = {
    id: 'tenant-test', slug: 'loja', name: 'Loja',
    appBaseLogoUrl: 'https://example.com/old.png',
    theme: { logoUrl: 'https://example.com/new.png' },
  };
  let server: Server;
  let origin: string;
  let scope: string;
  beforeAll(async () => {
    const app = express();
    const router = createPwaRouter({
      publicDir: process.cwd(),
      resolveStore: async (slug) => slug === store.slug
        ? { status: 'ok', store } : { status: 'not_found' },
      fetchLogo: async () => ({ bytes: logo, contentType: 'image/png' }),
    });
    const verified = await router.lookupStoreForHtml(store.slug);
    expect(verified?.iconContentHash).toBeTruthy();
    scope = '/app/loja~' + storeAppIdentity(verified!) + '/';
    app.use(router);
    app.get('/app/*', (_req, res) => res.type('html').send('<html>store</html>'));
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  });
  const get = (path: string) => fetch(origin + path, { redirect: 'manual' });

  it.each(['/app/loja', '/app/loja/'])('redirects %s directly and preserves query', async (path) => {
    const query = '?utm_source=qr&tag=a%20b&tag=c';
    const res = await get(path + query);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(scope + query);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it.each(['source=pwa', 'mesa=1', 'mesa=', 'preview=1', 'atualizar=1', 'instalar=1', 'reinstall=1'])(
    'preserves HTML for %s', async (query) => {
      const res = await get('/app/loja/?' + query);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('location')).toBeNull();
    },
  );
  it('does not redirect versioned paths', async () => {
    for (const path of [scope, '/app/loja~0123456789/']) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    }
  });
  it('preserves the versioned manifest', async () => {
    const res = await get(scope + 'manifest.webmanifest');
    expect(res.status).toBe(200);
    expect((await res.json()).scope).toBe(scope);
  });
});
