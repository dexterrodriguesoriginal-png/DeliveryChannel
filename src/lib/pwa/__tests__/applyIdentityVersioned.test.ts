// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyStoreIdentity, identityHash } from '../applyStoreIdentity';

const store = { id: 't1', slug: 'mercado-teste-dc', name: 'Mercado Teste DC' };
const inject = (href: string) => {
  const l = document.createElement('link');
  l.rel = 'manifest'; l.href = href; l.setAttribute('href', href); l.setAttribute('data-server-injected', '1');
  document.head.appendChild(l);
  return l;
};
afterEach(() => { document.head.innerHTML = ''; });

describe('applyStoreIdentity com manifesto versionado (experimento)', () => {
  it('mantém o manifesto da versão da logo injetado pelo servidor', async () => {
    const l = inject('/app/mercado-teste-dc~0123456789/manifest.webmanifest');
    const r = await applyStoreIdentity(store);
    expect(r.manifestHref).toBe('/app/mercado-teste-dc~0123456789/manifest.webmanifest');
    expect(l.getAttribute('href')).toBe('/app/mercado-teste-dc~0123456789/manifest.webmanifest');
    expect(document.head.querySelectorAll('link[rel="manifest"]').length).toBe(1);
  });
  it('manifesto base continua igual', async () => {
    inject('/app/mercado-teste-dc/manifest.webmanifest');
    const r = await applyStoreIdentity(store);
    expect(r.manifestHref).toBe('/app/mercado-teste-dc/manifest.webmanifest');
  });
});

describe('applyStoreIdentity e versão verificada do ícone', () => {
  const store = {
    id: 't1',
    slug: 'adega-premium',
    name: 'Adega',
    theme: { storeName: 'Adega', logoUrl: 'https://cdn.example/logo.png', primaryColor: '#15803d' },
  };
  const digest = 'abc123def456abc123def456';
  const weak = `/app/adega-premium/icons/icon-192.png?v=${identityHash(store)}`;
  const strong = `/app/adega-premium/icons/icon-192.png?v=${identityHash({ ...store, iconContentHash: digest })}`;

  afterEach(() => { vi.unstubAllGlobals(); });

  it('não sobrescreve o digest injetado pelo servidor com a versão só da URL', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
    inject('/app/adega-premium/manifest.webmanifest');
    const apple = document.createElement('link');
    apple.rel = 'apple-touch-icon';
    apple.setAttribute('href', strong);
    document.head.appendChild(apple);
    await applyStoreIdentity(store);
    const href = document.head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href');
    expect(href).toBe(strong);
    expect(href).not.toBe(weak);
  });

  it('usa o src do manifesto servido quando os bytes da logo mudam na mesma URL', async () => {
    const next = `/app/adega-premium/icons/icon-192.png?v=${identityHash({ ...store, iconContentHash: 'ffffffffffffffffffffffff' })}`;
    inject('/app/adega-premium/manifest.webmanifest');
    const apple = document.createElement('link');
    apple.rel = 'apple-touch-icon';
    apple.setAttribute('href', strong);
    document.head.appendChild(apple);
    vi.stubGlobal('fetch', async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('manifest.webmanifest')) {
        return new Response(JSON.stringify({
          id: '/app-id/t1',
          short_name: 'Adega',
          icons: [{ src: next, type: 'image/png' }],
        }), { status: 200, headers: { 'content-type': 'application/manifest+json' } });
      }
      return new Response('', { status: 404 });
    });
    await applyStoreIdentity(store);
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(next);
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(next);
  });

  it('não aplica identidade antiga se um tema mais novo já foi aplicado', async () => {
    inject('/app/adega-premium/manifest.webmanifest');
    const storeV1 = {
      ...store,
      name: 'Adega V1',
      theme: { storeName: 'Adega V1', logoUrl: 'https://cdn.example/v1.png', primaryColor: '#15803d' },
    };
    const storeV2 = {
      ...store,
      name: 'Adega V2',
      theme: { storeName: 'Adega V2', logoUrl: 'https://cdn.example/v2.png', primaryColor: '#b91c1c' },
    };
    const iconV2 = `/app/adega-premium/icons/icon-192.png?v=${identityHash({ ...storeV2, iconContentHash: 'bbbbbbbbbbbbbbbbbbbbbbbb' })}`;
    const pending: Array<(value: Response) => void> = [];
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => { pending.push(resolve); }));
    const first = applyStoreIdentity(storeV1);
    await vi.waitFor(() => expect(pending.length).toBe(1));
    const second = applyStoreIdentity(storeV2);
    await vi.waitFor(() => expect(pending.length).toBe(2));
    pending[1](new Response(JSON.stringify({
      id: '/app-id/t1',
      short_name: 'Adega V2',
      icons: [{ src: iconV2, type: 'image/png' }],
    }), { status: 200, headers: { 'content-type': 'application/manifest+json' } }));
    await second;
    expect(document.title).toBe('Adega V2');
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(iconV2);
    expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#b91c1c');
    pending[0](new Response(JSON.stringify({
      id: '/app-id/t1',
      short_name: 'Adega V1',
      icons: [{ src: `/app/adega-premium/icons/icon-192.png?v=${identityHash(storeV1)}`, type: 'image/png' }],
    }), { status: 200, headers: { 'content-type': 'application/manifest+json' } }));
    await first;
    expect(document.title).toBe('Adega V2');
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(iconV2);
    expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#b91c1c');
  });
});
