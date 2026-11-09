// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  createPwaRouter,
  HASHED_ASSET_RE,
  iconVersion,
  IMMUTABLE_ICON_CACHE_CONTROL,
  resolveBuildVersion,
   serverManifest,
  staticAssetCacheControl,
} from '../routes';
import { injectStoreHead } from '../storeHtml';
import { identityHash } from '../../../src/lib/pwa/applyStoreIdentity';
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

  it('manifesto do totem é um app separado, fullscreen, com ícones 192 e 512', async () => {
    const r = await fetch(`${base}/totem/adega-premium/manifest.webmanifest`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/application\/manifest\+json/);
    expect(r.headers.get('cache-control')).toBe('no-cache');
    const m = await r.json();
    expect(m.id).toBe('/totem-id/tenant-adega-01');
    expect(m.start_url).toBe('/totem/adega-premium/?source=pwa');
    expect(m.scope).toBe('/totem/adega-premium/');
    expect(m.display).toBe('fullscreen');
    expect(m.name).toBe('Adega Premium Jardins — Totem');
    expect(m.short_name).toBe('Totem');
    expect(m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}/${i.purpose}`)).toEqual(['192x192/any', '512x512/any', '512x512/maskable']);
    expect(m.related_applications).toEqual([{ platform: 'webapp', url: '/totem/adega-premium/manifest.webmanifest' }]);
    const app = await (await fetch(`${base}/app/adega-premium/manifest.webmanifest`)).json();
    expect(m.id).not.toBe(app.id);
    expect(m.start_url).not.toBe(app.start_url);
  });

  it('ícones PNG válidos com dimensões corretas (fallback de iniciais nunca usa cache immutable)', async () => {
    const adegaStore = (stores['adega-premium'] as { status: 'ok'; store: any }).store;
    const currentVer = iconVersion(adegaStore);
    for (const [variant, size] of [['icon-192', 192], ['icon-512', 512], ['maskable-512', 512]] as const) {
      const rNoV = await fetch(`${base}/app/adega-premium/icons/${variant}.png`);
      expect(rNoV.status).toBe(200);
      expect(rNoV.headers.get('content-type')).toBe('image/png');
      expect(rNoV.headers.get('cache-control')).toBe('no-cache');
      expect(pngSize(Buffer.from(await rNoV.arrayBuffer()))).toEqual({ width: size, height: size });

      // Mesmo com ?v= igual à versão atual, como o logo falhou (fallback de iniciais), deve ser no-cache
      const rFallbackWithV = await fetch(`${base}/app/adega-premium/icons/${variant}.png?v=${currentVer}`);
      expect(rFallbackWithV.status).toBe(200);
      expect(rFallbackWithV.headers.get('cache-control')).toBe('no-cache');
    }
  });

  it('manifesto tem Cache-Control: no-cache, URL estável em related_applications e versão única entre storeHtml, applyStoreIdentity e manifest', async () => {
    const r = await fetch(`${base}/app/padaria-do-joao/manifest.webmanifest`);
    expect(r.headers.get('cache-control')).toBe('no-cache');
    const m = await r.json();
    expect(m.related_applications).toEqual([{ platform: 'webapp', url: '/app/padaria-do-joao/manifest.webmanifest' }]);

    const baseStore = {
      id: 'tenant-1',
      slug: 'minha-loja',
      name: 'Minha Loja',
      theme: { storeName: 'Minha Loja', primaryColor: '#15803d', logoUrl: 'https://cdn.example/logo-v1.png', updatedAt: '2026-11-01T00:00:00Z' },
    };
    const v1 = iconVersion(baseStore);
    const vLogoChanged = iconVersion({ ...baseStore, theme: { ...baseStore.theme, logoUrl: 'https://cdn.example/logo-v2.png' } });
    const vUpdatedChanged = iconVersion({ ...baseStore, theme: { ...baseStore.theme, updatedAt: '2026-11-03T12:00:00Z' } });
    expect(vLogoChanged).not.toBe(v1);
    expect(vUpdatedChanged).not.toBe(v1);

    // Item 3: único valor de versão em storeHtml, applyStoreIdentity (identityHash) e serverManifest
    expect(identityHash(baseStore)).toBe(v1);
    const manifest = serverManifest(baseStore);
    expect(manifest.icons[0].src).toBe(`/app/minha-loja/icons/icon-192.png?v=${v1}`);
    const htmlOut = injectStoreHead('<html><head><title>X</title></head></html>', 'minha-loja', baseStore);
    expect(htmlOut).toContain(`/app/minha-loja/icons/icon-192.png?v=${v1}`);
  });

  it('item 1 e 2: /api/pwa/version e manifest nunca baixam logo; ícones fazem cache do logo por (store.id, logoUrl) e só usam immutable quando v===atual E logo real carregou', async () => {
    const store = {
      id: 'tenant-real-01',
      slug: 'loja-real',
      name: 'Loja Real',
      theme: {
        storeName: 'Loja Real',
        primaryColor: '#15803d',
        logoUrl: 'https://cdn.example/logo-real.svg',
        updatedAt: '2026-11-04T00:00:00Z',
      },
    };
    const validSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#15803d"/><circle cx="64" cy="64" r="40" fill="#ffffff"/></svg>',
    );
    let failLogoDownload = false;
    const fetchLogoSpy = vi.fn(async () => {
      if (failLogoDownload) throw new Error('falha temporária de rede');
      return { bytes: validSvg, contentType: 'image/svg+xml' };
    });

    const app2 = express();
    app2.use(
      createPwaRouter({
        resolveStore: async (slug) => (slug === 'loja-real' ? { status: 'ok', store } : { status: 'not_found' }),
        publicDir: '/nonexistent',
        fetchLogo: fetchLogoSpy,
      }),
    );
    const srv2 = await new Promise<Server>((r) => {
      const s = app2.listen(0, '127.0.0.1', () => r(s));
    });
    try {
      const b2 = `http://127.0.0.1:${(srv2.address() as AddressInfo).port}`;
      const ver = iconVersion(store);

      // 1) /api/pwa/version e /manifest.webmanifest NUNCA chamam fetchLogo
      const verRes = await fetch(`${b2}/api/pwa/version?slug=loja-real`);
      expect(verRes.status).toBe(200);
      const manifestRes = await fetch(`${b2}/app/loja-real/manifest.webmanifest`);
      expect(manifestRes.status).toBe(200);
      expect(fetchLogoSpy).toHaveBeenCalledTimes(0);

      // 2) Se o download do logo falhar, serve fallback com no-cache e NÃO guarda fallback no iconCache
      failLogoDownload = true;
      const fallbackRes = await fetch(`${b2}/app/loja-real/icons/icon-192.png?v=${ver}`);
      expect(fallbackRes.status).toBe(200);
      expect(fallbackRes.headers.get('cache-control')).toBe('no-cache');
      const fallbackBytes = Buffer.from(await fallbackRes.arrayBuffer());
      expect(fetchLogoSpy).toHaveBeenCalledTimes(1);

      // 3) Quando o logo volta a responder, não fica preso no fallback: baixa 1 única vez e reutiliza em todas as variantes
      failLogoDownload = false;
      const wrongVRes = await fetch(`${b2}/app/loja-real/icons/icon-192.png?v=versao-antiga`);
      expect(wrongVRes.status).toBe(200);
      expect(wrongVRes.headers.get('cache-control')).toBe('no-cache');
      const realBytes192 = Buffer.from(await wrongVRes.arrayBuffer());
      expect(realBytes192.equals(fallbackBytes)).toBe(false);
      expect(fetchLogoSpy).toHaveBeenCalledTimes(2);

      // Com ?v= igual à versão atual e logo real carregado => immutable, sem novo download
      const ok192 = await fetch(`${b2}/app/loja-real/icons/icon-192.png?v=${ver}`);
      const ok512 = await fetch(`${b2}/app/loja-real/icons/icon-512.png?v=${ver}`);
      const okMaskable = await fetch(`${b2}/app/loja-real/icons/maskable-512.png?v=${ver}`);
      expect(ok192.headers.get('cache-control')).toBe(IMMUTABLE_ICON_CACHE_CONTROL);
      expect(ok512.headers.get('cache-control')).toBe(IMMUTABLE_ICON_CACHE_CONTROL);
      expect(okMaskable.headers.get('cache-control')).toBe(IMMUTABLE_ICON_CACHE_CONTROL);
      // Mesmo renderizando 512 e maskable-512, o logo veio do logoCache em memória (sem chamadas extras ao fetchLogo)
      expect(fetchLogoSpy).toHaveBeenCalledTimes(2);
    } finally {
      await new Promise<void>((r) => srv2.close(() => r()));
    }
  });

  it('item 4 e 6: staticAssetCacheControl aplica immutable só em arquivos com hash (excluindo /assets/aistudio) e resolveBuildVersion não usa dc-pwa-v1 fixo', () => {
    expect(HASHED_ASSET_RE.test('index-AbCd1234.js')).toBe(true);
    expect(HASHED_ASSET_RE.test('style-9f8e7d6c.css')).toBe(true);
    expect(HASHED_ASSET_RE.test('logo.png')).toBe(false);

    expect(staticAssetCacheControl('/workspace/dist/assets/index-AbCd1234.js')).toBe(IMMUTABLE_ICON_CACHE_CONTROL);
    expect(staticAssetCacheControl('/workspace/dist/assets/font-12345678.woff2')).toBe(IMMUTABLE_ICON_CACHE_CONTROL);
    expect(staticAssetCacheControl('/workspace/dist/assets/aistudio/preview.png')).toBeNull();
    expect(staticAssetCacheControl('/workspace/dist/assets/aistudio/chunk-AbCd1234.js')).toBeNull();
    expect(staticAssetCacheControl('/workspace/dist/assets/sem-hash.png')).toBeNull();
    expect(staticAssetCacheControl('/workspace/dist/index.html')).toBe('no-cache');
    expect(staticAssetCacheControl('/workspace/dist/manifest.json')).toBe('no-cache');
    expect(staticAssetCacheControl('/workspace/dist/garcom.webmanifest')).toBe('no-cache');
    expect(staticAssetCacheControl('/workspace/dist/sw.js')).toBe('no-cache');

    const resolved = resolveBuildVersion('/nonexistent', {});
    expect(resolved).toBeTruthy();
    expect(resolved).not.toBe('dc-pwa-v1');
    expect(resolveBuildVersion('/nonexistent', { COMMIT_SHA: 'abc1234def' })).toBe('abc1234def');
  });

  it('endpoint /api/pwa/version responde com Cache-Control no-store e versão da loja', async () => {
    const r = await fetch(`${base}/api/pwa/version?slug=padaria-do-joao`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('no-cache');
    const body = await r.json();
    expect(typeof body.version).toBe('string');
    expect(body.slug).toBe('padaria-do-joao');
    expect(typeof body.identityVersion).toBe('string');
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

