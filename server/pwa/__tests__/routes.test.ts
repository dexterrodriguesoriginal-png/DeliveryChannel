// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createPwaRouter } from '../routes';
import { pngSize } from '../icons';
import { assertPublicUrl, isPrivateIp } from '../safeFetch';
import { identityFromPayload, isValidSlug, StoreResolver } from '../storeSource';

const stores: Record<string, Awaited<ReturnType<StoreResolver>>> = {
  'padaria-do-joao': { status: 'ok', store: { id: 'tenant-padaria-04', slug: 'padaria-do-joao', name: 'Padaria do João', theme: { storeName: 'Padaria do João', primaryColor: '#b45309', logoUrl: '/logo.png' } } },
  'adega-premium': { status: 'ok', store: { id: 'tenant-adega-01', slug: 'adega-premium', name: 'Adega Premium', theme: { storeName: 'Adega Premium Jardins', primaryColor: '#15803d', logoUrl: 'http://127.0.0.1/x.png' } } },
};
const resolver: StoreResolver = async (slug) => stores[slug] ?? { status: 'not_found' };

let server: Server; let base = '';
beforeAll(async () => {
  const app = express();
  // logo relativo inexistente e logo externo bloqueado => fallback de iniciais
  app.use(createPwaRouter({ resolveStore: resolver, publicDir: '/nonexistent', fetchLogo: async () => { throw new Error('bloqueado'); } }));
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

describe('rotas PWA por loja', () => {
  it('manifesto próprio e separado por loja', async () => {
    const [a, b] = await Promise.all(['padaria-do-joao', 'adega-premium'].map(async s => {
      const r = await fetch(`${base}/app/${s}/manifest.webmanifest`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toMatch(/application\/manifest\+json/);
      return r.json();
    }));
    expect(a.id).toBe('/app-id/tenant-padaria-04');
    expect(a.start_url).toBe('/app/padaria-do-joao/?source=pwa');
    expect(a.scope).toBe('/app/padaria-do-joao/');
    expect(a.name).toBe('Padaria do João');
    expect(b.id).toBe('/app-id/tenant-adega-01');
    expect(b.scope).toBe('/app/adega-premium/');
    expect(b.name).toBe('Adega Premium Jardins');
    expect(a.display).toBe('standalone');
    for (const m of [a, b]) {
      expect(m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}/${i.purpose}`)).toEqual(['192x192/any', '512x512/any', '512x512/maskable']);
      expect(m.icons.every((i: { src: string; type: string }) => i.type === 'image/png' && i.src.startsWith(`/app/${m.scope.split('/')[2]}/icons/`))).toBe(true);
    }
    expect(a.icons[0].src).not.toBe(b.icons[0].src);
  });

  it('ícones PNG válidos com dimensões corretas (fallback de iniciais)', async () => {
    for (const [variant, size] of [['icon-192', 192], ['icon-512', 512], ['maskable-512', 512]] as const) {
      const r = await fetch(`${base}/app/adega-premium/icons/${variant}.png`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/png');
      expect(pngSize(Buffer.from(await r.arrayBuffer()))).toEqual({ width: size, height: size });
    }
  });

  it('loja desconhecida, slug inválido e variante inválida => 404', async () => {
    expect((await fetch(`${base}/app/nao-existe/manifest.webmanifest`)).status).toBe(404);
    expect((await fetch(`${base}/app/Bad_Slug/manifest.webmanifest`)).status).toBe(404);
    expect((await fetch(`${base}/app/..%2Fetc/manifest.webmanifest`)).status).toBe(404);
    expect((await fetch(`${base}/app/adega-premium/icons/outro.png`)).status).toBe(404);
  });
});

describe('validação e isolamento', () => {
  it('slug', () => {
    expect(isValidSlug('padaria-do-joao')).toBe(true);
    for (const s of ['', '-a', 'a-', 'A', 'a_b', 'a/b', 'a'.repeat(65)]) expect(isValidSlug(s)).toBe(false);
  });
  it('payload de outra loja é rejeitado', () => {
    expect(identityFromPayload({ tenant: { id: 't1', slug: 'outra', name: 'X' } }, 'adega-premium')).toBeNull();
    expect(identityFromPayload({ tenant: { id: 't1', slug: 'adega-premium', name: 'X' }, theme: { store_name: 'Y', logo_url: 'https://a/b.png' } }, 'adega-premium'))
      .toMatchObject({ id: 't1', theme: { storeName: 'Y', logoUrl: 'https://a/b.png' } });
  });
});

describe('proteção SSRF do logotipo', () => {
  const pub = async () => ['93.184.216.34'];
  it('bloqueia IPs privados/loopback/link-local', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.5.4', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) expect(isPrivateIp(ip)).toBe(true);
    expect(isPrivateIp('93.184.216.34')).toBe(false);
  });
  it('bloqueia esquemas, hosts e portas não permitidos', async () => {
    for (const u of ['file:///etc/passwd', 'http://localhost/x.png', 'http://169.254.169.254/latest', 'http://[::1]/a', 'https://user:p@ex.com/a.png', 'https://ex.com:8443/a.png', 'http://metadata.google.internal/']) {
      await expect(assertPublicUrl(u, pub)).rejects.toThrow();
    }
    await expect(assertPublicUrl('https://evil.example/a.png', async () => ['10.1.2.3'])).rejects.toThrow();
    await expect(assertPublicUrl('https://cdn.example/a.png', pub)).resolves.toBeInstanceOf(URL);
  });
});
