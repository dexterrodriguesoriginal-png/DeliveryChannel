// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createPwaRouter, serverManifest } from '../routes';
import { pngSize } from '../icons';
import { DEFAULT_SPLASH_TEST_SLUGS, resolveSplashTestSlugs, SPLASH_TEST_COLOR } from '../splashTest';
import type { StoreResolver } from '../storeSource';
import type { StoreIdentityInput } from '../../../src/lib/pwa/storeManifest';

const real: StoreIdentityInput = {
  id: 'tenant-real-01', slug: 'adegasshow', name: 'Adega Show',
  theme: { storeName: 'Adega Show', primaryColor: '#7c3aed', navBarColor: '#1d4ed8', statusBarColor: '#111827' },
};
const test: StoreIdentityInput = {
  id: 'tenant-test-01', slug: 'mercado-teste-dc', name: 'Mercado Teste DC',
  theme: { storeName: 'Mercado Teste DC', primaryColor: '#0ea5e9', navBarColor: '#f8fafc' },
};
const stores: Record<string, StoreIdentityInput> = { [real.slug]: real, [test.slug]: test };
const resolver: StoreResolver = async (slug) => (stores[slug] ? { status: 'ok', store: stores[slug] } : { status: 'not_found' });

// Saída ATUAL (origin/main 957cc56) do manifesto de uma loja fora da lista — não pode mudar nenhum byte.
const REAL_MANIFEST_NOW = '{"id":"/app-id/tenant-real-01","name":"Adega Show","short_name":"Adega Show","description":"Peça online em Adega Show","start_url":"/app/adegasshow/?source=pwa","scope":"/app/adegasshow/","display":"standalone","orientation":"portrait","background_color":"#1d4ed8","theme_color":"#1d4ed8","lang":"pt-BR","icons":[{"src":"/app/adegasshow/icons/icon-192.png?v=__V__","sizes":"192x192","type":"image/png","purpose":"any"},{"src":"/app/adegasshow/icons/icon-512.png?v=__V__","sizes":"512x512","type":"image/png","purpose":"any"},{"src":"/app/adegasshow/icons/maskable-512.png?v=__V__","sizes":"512x512","type":"image/png","purpose":"maskable"}],"launch_handler":{"client_mode":["navigate-existing","auto"]},"handle_links":"preferred","related_applications":[{"platform":"webapp","url":"/app/adegasshow/manifest.webmanifest"}],"prefer_related_applications":false}';

function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  return new Promise(r => { const server = app.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })); });
}

let withList: { server: Server; base: string };
let without: { server: Server; base: string };
beforeAll(async () => {
  const publicDir = path.resolve(process.cwd(), 'public');
  const a = express(); a.use(createPwaRouter({ resolveStore: resolver, publicDir, fetchLogo: async () => { throw new Error('x'); }, splashTestSlugs: ['mercado-teste-dc'] }));
  const b = express(); b.use(createPwaRouter({ resolveStore: resolver, publicDir, fetchLogo: async () => { throw new Error('x'); } }));
  [withList, without] = await Promise.all([listen(a), listen(b)]);
});
afterAll(async () => { await Promise.all([withList, without].map(s => new Promise<void>(r => s.server.close(() => r())))); });

describe('lista de slugs do experimento da splash', () => {
  it('padrão desligado (abertura só com a logo da loja); env definida liga', () => {
    expect(DEFAULT_SPLASH_TEST_SLUGS).toEqual([]);
    expect(resolveSplashTestSlugs({})).toEqual([]);
    expect(resolveSplashTestSlugs({ PWA_SPLASH_TEST_SLUGS: '' })).toEqual([]);
    expect(resolveSplashTestSlugs({ PWA_SPLASH_TEST_SLUGS: ' a-teste, b-teste  c ' })).toEqual(['a-teste', 'b-teste', 'c']);
  });
});

describe('manifesto fora da lista: idêntico ao atual', () => {
  it('serverManifest sem opção = mesmos bytes de antes', () => {
    const now = JSON.stringify(serverManifest(real));
    const v = /v=([0-9a-f]+)/.exec(now)![1];
    expect(now).toBe(REAL_MANIFEST_NOW.replace(/__V__/g, v));
    expect(JSON.stringify(serverManifest(real, { splashTest: false }))).toBe(now);
  });

  it('rota servida com e sem lista retorna os mesmos bytes para loja real', async () => {
    const [x, y] = await Promise.all([withList, without].map(s => fetch(`${s.base}/app/adegasshow/manifest.webmanifest`).then(r => r.text())));
    expect(x).toBe(y);
    expect(x).toBe(JSON.stringify(serverManifest(real)));
  });

  it('loja de teste sem lista configurada continua com o manifesto normal', async () => {
    const t = await fetch(`${without.base}/app/mercado-teste-dc/manifest.webmanifest`).then(r => r.text());
    expect(t).toBe(JSON.stringify(serverManifest(test)));
  });

  it('ícones do experimento não existem para loja fora da lista', async () => {
    for (const v of ['splash-store-maskable-332', 'splash-dc-maskable-1024']) {
      expect((await fetch(`${withList.base}/app/adegasshow/icons/${v}.png`)).status).toBe(404);
      expect((await fetch(`${without.base}/app/mercado-teste-dc/icons/${v}.png`)).status).toBe(404);
    }
  });
});

describe('manifesto da loja de teste', () => {
  it('nome da loja, #121212 e dois maskable (loja 332, Delivery Channel 1024)', async () => {
    const m = await fetch(`${withList.base}/app/mercado-teste-dc/manifest.webmanifest`).then(r => r.json());
    const normal = serverManifest(test);
    expect(m.name).toBe('Mercado Teste DC');
    expect(m.short_name).toBe('Mercado Teste DC');
    expect(m.theme_color).toBe(SPLASH_TEST_COLOR);
    expect(m.background_color).toBe('#121212');
    const { icons, theme_color: _t, background_color: _b, ...rest } = m;
    const { icons: _i, theme_color: _t2, background_color: _b2, ...restNormal } = normal;
    expect(rest).toEqual(restNormal);
    expect(icons.map((i: { src: string; sizes: string; purpose: string }) => `${i.src.split('?')[0].split('/').pop()}|${i.sizes}|${i.purpose}`)).toEqual([
      'icon-192.png|192x192|any',
      'icon-512.png|512x512|any',
      'splash-store-maskable-332.png|332x332|maskable',
      'splash-dc-maskable-1024.png|1024x1024|maskable',
    ]);
  });

  it('serve os PNGs com o tamanho declarado', async () => {
    for (const [v, size] of [['splash-store-maskable-332', 332], ['splash-dc-maskable-1024', 1024]] as const) {
      const r = await fetch(`${withList.base}/app/mercado-teste-dc/icons/${v}.png`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/png');
      expect(pngSize(Buffer.from(await r.arrayBuffer()))).toEqual({ width: size, height: size });
    }
  });

  // Réplica de blink::ManifestIconSelector::FindBestMatchingIcon + regras do Chrome Android:
  // launcher = maskable, ideal 83dp, mínimo 83px (installable_icon_fetcher.cc);
  // splash = maskable primeiro, ideal 128dp, mínimo 16dp (shortcut_info.cc UpdateBestSplashIcon).
  function pick(icons: { src: string; sizes: string; purpose: string }[], purpose: string, ideal: number, min: number) {
    let best: string | null = null; let bestDelta = Number.MIN_SAFE_INTEGER;
    for (const i of icons) {
      if (i.purpose !== purpose) continue;
      const h = Number(i.sizes.split('x')[1]);
      if (h < min) continue;
      const d = h - ideal;
      if (d < 0 && bestDelta > 0) continue;
      if (bestDelta === Number.MIN_SAFE_INTEGER || (d > 0 && bestDelta < 0) || Math.abs(d) <= Math.abs(bestDelta)) { bestDelta = d; best = i.src; }
    }
    return best;
  }
  it.each([2.625, 2.75, 3, 3.5, 4])('densidade %s: launcher = loja, splash = Delivery Channel', (density) => {
    const icons = serverManifest(test, { splashTest: true }).icons as { src: string; sizes: string; purpose: string }[];
    const launcher = pick(icons, 'maskable', Math.round(83 * density), 83);
    const splash = pick(icons, 'maskable', Math.round(128 * density), Math.round(16 * density));
    expect(launcher).toMatch(/splash-store-maskable-332/);
    expect(splash).toMatch(/splash-dc-maskable-1024/);
  });
});
