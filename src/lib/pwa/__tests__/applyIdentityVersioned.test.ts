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
});
