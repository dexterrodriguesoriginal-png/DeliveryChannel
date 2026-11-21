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
  'padaria-do-joao': { status: 'ok', store: { id: 'tenant-padaria-04', slug: 'padaria-do-joao', name: 'Padaria do João', theme: { storeName: 'Padaria do João', primaryColor: '#b45309' } } },
  'adega-premium': { status: 'ok', store: { id: 'tenant-adega-01', slug: 'adega-premium', name: 'Adega Premium', theme: { storeName: 'Adega Premium Jardins', primaryColor: '#15803d' } } },
};
const resolver: StoreResolver = async (slug) => stores[slug] ?? { status: 'not_found' };

let server: Server; let base = '';
beforeAll(async () => {
  const app = express();
  // Ambas as lojas deste fixture não têm logo; iniciais são o fallback legítimo.
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
    // updatedAt (qualquer salvamento do tema) não muda a imagem do ícone: ?v= fica igual.
    expect(vUpdatedChanged).toBe(v1);

    // Item 3: único valor de versão em storeHtml, applyStoreIdentity (identityHash) e serverManifest
    expect(identityHash(baseStore)).toBe(v1);
    const manifest = serverManifest(baseStore);
    expect(manifest.icons[0].src).toBe(`/app/minha-loja/icons/icon-192.png?v=${v1}`);
    const htmlOut = injectStoreHead('<html><head><title>X</title></head></html>', 'minha-loja', baseStore);
    expect(htmlOut).toContain(`/app/minha-loja/icons/icon-192.png?v=${v1}`);
  });

  it('logo configurada: 503 no-store em falha, 200 PNG válido quando recupera, sem fallback em cache', async () => {
    const store = {
      id: 'tenant-real-01', slug: 'loja-real', name: 'Loja Real',
      theme: { storeName: 'Loja Real', logoUrl: 'https://cdn.example/logo-real.svg' },
    };
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="navy"/><circle cx="64" cy="64" r="40" fill="white"/></svg>');
    let fail = true;
    const fetchLogo = vi.fn(async () => {
      if (fail) throw new Error('storage indisponível');
      return { bytes: svg, contentType: 'image/svg+xml' };
    });
    const app = express();
    app.use(createPwaRouter({
      resolveStore: async slug => slug === store.slug ? { status: 'ok', store } : { status: 'not_found' },
      fetchLogo, publicDir: '/nonexistent',
    }));
    const srv = await new Promise<Server>(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const broken = await fetch(`${b}/app/loja-real/icons/icon-192.png`);
      expect(broken.status).toBe(503);
      expect(broken.headers.get('cache-control')).toBe('no-store');
      expect(broken.headers.get('retry-after')).toBeTruthy();
      expect(broken.headers.get('content-type')).not.toContain('image/png');
      const missingManifest = await fetch(`${b}/app/loja-real/manifest.webmanifest`);
      expect(missingManifest.status).toBe(503);
      expect(missingManifest.headers.get('cache-control')).toBe('no-store');
      fail = false;
      const manifest = await (await fetch(`${b}/app/loja-real/manifest.webmanifest`)).json();
      const icon = await fetch(`${b}${manifest.icons[0].src}`);
      expect(icon.status).toBe(200);
      expect(icon.headers.get('content-type')).toBe('image/png');
      expect(icon.headers.get('cache-control')).toBe(IMMUTABLE_ICON_CACHE_CONTROL);
      expect(pngSize(Buffer.from(await icon.arrayBuffer()))).toEqual({ width: 192, height: 192 });
      expect(fetchLogo).toHaveBeenCalledTimes(3);
    } finally { await new Promise<void>(resolve => srv.close(() => resolve())); }
  });

  it('URL da logo idêntica: bytes alterados mudam ?v=; mesmos bytes mantêm ?v= e ícone do cache é atualizado', async () => {
    const sharp = (await import('sharp')).default;
    const make = async (accent: string) => {
      const bg = await sharp({ create: { width: 60, height: 60, channels: 3, background: accent } }).png().toBuffer();
      return sharp({ create: { width: 128, height: 128, channels: 3, background: 'white' } })
        .composite([{ input: bg, left: 34, top: 34 }]).png().toBuffer();
    };
    const first = await make('red');
    const second = await make('blue');
    let image = first;
    let revision = '2026-11-21T10:00:00Z';
    const store = () => ({
      id: 'tenant-same-url', slug: 'same-url', name: 'Same URL',
      theme: { storeName: 'Same URL', logoUrl: 'https://cdn.example/stable.png', updatedAt: revision },
    });
    const fetchLogo = vi.fn(async () => ({ bytes: image, contentType: 'image/png' }));
    const app = express();
    const router = createPwaRouter({
      resolveStore: async slug => slug === 'same-url' ? { status: 'ok', store: store() } : { status: 'not_found' },
      fetchLogo, publicDir: '/nonexistent',
    });
    app.use(router);
    const srv = await new Promise<Server>(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const getManifest = async () => (await fetch(`${b}/app/same-url/manifest.webmanifest`)).json();
    try {
      const v1 = (await getManifest()).icons[0].src;
      const bytes1 = Buffer.from(await (await fetch(`${b}${v1}`)).arrayBuffer());
      expect((await getManifest()).icons[0].src).toBe(v1);
      image = second;
      revision = '2026-11-21T10:01:00Z'; // mesmo caminho, tema persistido
      router.invalidateStore('same-url', store().id);
      const v2 = (await getManifest()).icons[0].src;
      expect(v2).not.toBe(v1);
      const bytes2 = Buffer.from(await (await fetch(`${b}${v2}`)).arrayBuffer());
      expect(bytes2.equals(bytes1)).toBe(false);
      expect((await getManifest()).icons[0].src).toBe(v2);
      expect(fetchLogo).toHaveBeenCalledTimes(2);
    } finally { await new Promise<void>(resolve => srv.close(() => resolve())); }
  });

  it('após invalidar, HTML e manifesto recebem imediatamente nova logo, cor e nome', async () => {
    let revision = '2026-11-21T10:00:00Z';
    let logo = 'https://cdn.example/old.png';
    let color = '#159957';
    let name = 'Loja Inicial';
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><circle cx="64" cy="64" r="35" fill="blue"/></svg>');
    const tenantId = 'tenant-invalidation';
    const resolver: StoreResolver = async slug => slug === 'loja-invalida'
      ? { status: 'ok', store: { id: tenantId, slug, name, updatedAt: revision,
          theme: { storeName: name, logoUrl: logo, statusBarColor: color, navBarColor: color, primaryColor: color, updatedAt: revision } } }
      : { status: 'not_found' };
    const app = express();
    const router = createPwaRouter({ resolveStore: resolver, publicDir: '/nonexistent',
      fetchLogo: async () => ({ bytes: svg, contentType: 'image/svg+xml' }) });
    app.use(router);
    const srv = await new Promise<Server>(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const previous = await (await fetch(`${b}/app/loja-invalida/manifest.webmanifest`)).json();
      const preHtmlStore = await router.lookupStoreForHtml('loja-invalida');
      const firstHtml = injectStoreHead('<html><head><title>X</title></head><body></body></html>', 'loja-invalida', preHtmlStore);
      expect(firstHtml).toContain(color);
      name = 'Loja Atualizada'; color = '#1677b1'; logo = 'https://cdn.example/new.png';
      revision = '2026-11-21T10:02:00Z';
      router.invalidateStore('loja-invalida', tenantId);
      const updated = await (await fetch(`${b}/app/loja-invalida/manifest.webmanifest`)).json();
      const currentHtmlStore = await router.lookupStoreForHtml('loja-invalida');
      const currentHtml = injectStoreHead('<html><head><title>X</title></head><body></body></html>', 'loja-invalida', currentHtmlStore);
      expect(updated.id).toBe(previous.id);
      expect(updated.scope).toBe(previous.scope);
      expect(updated.start_url).toBe(previous.start_url);
      expect(updated.name).toBe(name);
      expect(updated.theme_color).toBe(color);
      expect(updated.icons[0].src).not.toBe(previous.icons[0].src);
      expect(currentHtml).toContain(`<title>${name}</title>`);
      expect(currentHtml).toContain(`content="${color}"`);
      expect(currentHtml).toContain(updated.icons[0].src);
    } finally { await new Promise<void>(resolve => srv.close(() => resolve())); }
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



describe('ícone do totem a partir do logo WebP e fallback colorido', () => {
  it('serve PNG com o logo WebP, não um quadrado branco; sem logo e primária cinza usa a cor do cabeçalho', async () => {
    const sharp = (await import('sharp')).default;
    const mark = await sharp({ create: { width: 60, height: 60, channels: 3, background: '#102a8f' } }).png().toBuffer();
    const webp = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#eeeeee' } })
      .composite([{ input: mark, left: 30, top: 30 }]).webp().toBuffer();

    const logoStore = {
      id: 'tenant-webp-01',
      slug: 'loja-webp',
      name: 'ADEGASSHOW',
      theme: { storeName: 'ADEGASSHOW', primaryColor: '#717179', headerColor: '#a7360f', logoUrl: 'https://cdn.example/logo.webp' },
    };
    const noLogoStore = {
      id: 'tenant-nologo-01',
      slug: 'loja-cinza',
      name: 'ADEGASSHOW',
      theme: { storeName: 'ADEGASSHOW', primaryColor: '#717179', headerColor: '#a7360f' },
    };

    const app = express();
    app.use(createPwaRouter({
      resolveStore: async (slug) => {
        if (slug === 'loja-webp') return { status: 'ok', store: logoStore };
        if (slug === 'loja-cinza') return { status: 'ok', store: noLogoStore };
        return { status: 'not_found' };
      },
      publicDir: '/nonexistent',
      fetchLogo: async () => ({ bytes: webp, contentType: 'image/webp' }),
    }));
    const srv = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      const iconRes = await fetch(`${b}/app/loja-webp/icons/icon-192.png`);
      expect(iconRes.status).toBe(200);
      expect(iconRes.headers.get('content-type')).toBe('image/png');
      const icon = Buffer.from(await iconRes.arrayBuffer());
      expect(pngSize(icon)).toEqual({ width: 192, height: 192 });
      const { isNearlyFlatPng } = await import('../icons');
      expect(await isNearlyFlatPng(icon)).toBe(false);
      const { data, info } = await sharp(icon).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let foundBlue = false;
      for (let i = 0; i < info.width * info.height; i++) {
        const r = data[i * info.channels], g = data[i * info.channels + 1], bl = data[i * info.channels + 2];
        if (r < 40 && g < 60 && bl > 100) foundBlue = true;
      }
      expect(foundBlue).toBe(true);

      const fallbackRes = await fetch(`${b}/app/loja-cinza/icons/icon-192.png`);
      const fallback = Buffer.from(await fallbackRes.arrayBuffer());
      expect(pngSize(fallback)).toEqual({ width: 192, height: 192 });
      const fb = await sharp(fallback).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let foundHeader = false;
      let foundGrey = 0;
      for (let i = 0; i < fb.info.width * fb.info.height; i++) {
        const r = fb.data[i * fb.info.channels], g = fb.data[i * fb.info.channels + 1], bl = fb.data[i * fb.info.channels + 2];
        if (Math.abs(r - 0xa7) < 24 && Math.abs(g - 0x36) < 24 && Math.abs(bl - 0x0f) < 24) foundHeader = true;
        if (Math.abs(r - 0x71) < 8 && Math.abs(g - 0x71) < 8 && Math.abs(bl - 0x79) < 8) foundGrey++;
      }
      expect(foundHeader).toBe(true);
      expect(foundGrey).toBe(0);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});
