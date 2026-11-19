// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { applyStoreIdentity } from '../applyStoreIdentity';

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
