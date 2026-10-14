import { describe, it, expect } from 'vitest';
import { fetchServedManifest } from '../applyStoreIdentity';

const store = { id: 'tenant-padaria-04', slug: 'padaria-do-joao', name: 'Padaria do João' };
const resp = (body: unknown, ct = 'application/manifest+json', status = 200) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': ct } })) as unknown as typeof fetch;

describe('fetchServedManifest', () => {
  it('usa o manifesto HTTPS do servidor quando pertence à loja', async () => {
    const r = await fetchServedManifest(store, resp({ id: '/app-id/tenant-padaria-04', short_name: 'Padaria', icons: [{ src: '/app/padaria-do-joao/icons/icon-192.png?v=1', type: 'image/png' }] }));
    expect(r).toEqual({ href: '/app/padaria-do-joao/manifest.webmanifest', shortName: 'Padaria', touchIcon: '/app/padaria-do-joao/icons/icon-192.png?v=1' });
  });
  it('recusa manifesto de outra loja, HTML do SPA (vite sem servidor) ou erro => fallback data:', async () => {
    expect(await fetchServedManifest(store, resp({ id: '/app-id/outra', icons: [{ src: '/x.png', type: 'image/png' }] }))).toBeNull();
    expect(await fetchServedManifest(store, resp('<html>', 'text/html'))).toBeNull();
    expect(await fetchServedManifest(store, resp({}, 'application/manifest+json', 404))).toBeNull();
    expect(await fetchServedManifest(store, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeNull();
  });
});
