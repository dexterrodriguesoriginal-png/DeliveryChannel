// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createPwaRouter } from '../routes';
import type { StoreResolver } from '../storeSource';

const resolver: StoreResolver = async (slug) => slug === 'adegasshow'
  ? { status: 'ok', store: { id: 'tenant-1', slug: 'adegasshow', name: 'Adega', theme: { storeName: 'Adega' } } }
  : { status: 'not_found' };

let server: Server; let base = '';
beforeAll(async () => {
  const app = express();
  app.use(createPwaRouter({ resolveStore: resolver, publicDir: '/nonexistent', fetchLogo: async () => { throw new Error('x'); } }));
  app.get('*', (req, res) => { res.status(200).type('text/plain').send(`spa:${req.originalUrl}`); });
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

const get = (p: string) => fetch(`${base}${p}`, { redirect: 'manual' });

describe('vitrine sempre dentro do scope do app (/app/<slug>/)', () => {
  it('/app/<slug> redireciona para /app/<slug>/ mantendo a query', async () => {
    for (const [from, to] of [
      ['/app/adegasshow', '/app/adegasshow/'],
      ['/app/adegasshow?mesa=tok123', '/app/adegasshow/?mesa=tok123'],
      ['/app/adegasshow?preview=1&code=abc', '/app/adegasshow/?preview=1&code=abc'],
      ['/app/loja-desconhecida', '/app/loja-desconhecida/'],
    ]) {
      const r = await get(from);
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe(to);
    }
  });

  it('não redireciona o endereço canônico, manifesto, ícones nem outras rotas', async () => {
    for (const p of ['/app/adegasshow/', '/app/adegasshow/?source=pwa', '/totem/adegasshow', '/garcom']) {
      const r = await get(p);
      expect(r.status).toBe(200);
      expect(await r.text()).toBe(`spa:${p}`);
    }
    const m = await get('/app/adegasshow/manifest.webmanifest');
    expect(m.status).toBe(200);
    expect((await m.json()).scope).toBe('/app/adegasshow/');
    const i = await get('/app/adegasshow/icons/icon-192.png');
    expect(i.status).toBe(200);
    expect(i.headers.get('content-type')).toBe('image/png');
  });

  it('POST não é redirecionado', async () => {
    const r = await fetch(`${base}/app/adegasshow`, { method: 'POST', redirect: 'manual' });
    expect(r.status).not.toBe(302);
  });

  it('nunca gera redirect para outro host', async () => {
    for (const p of ['/app/%2F%2Fevil.example', '/app/@evil.example?x=//evil']) {
      const r = await get(p);
      const loc = r.headers.get('location') || '';
      if (loc) { expect(loc.startsWith('/app/')).toBe(true); expect(loc.startsWith('//')).toBe(false); }
    }
  });
});
