// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient }));

import { createPwaRouter } from '../routes';
import type { StoreResolver } from '../storeSource';
import { createHash } from 'node:crypto';

const TENANT = '69f2f7eb-560c-409c-8d68-cfcfbcbf83f5';
const OTHER = '27b1aaec-eb02-4a1a-93bb-eed4f2b1d0df';
const USER = '11111111-1111-1111-1111-111111111111';
const SLUG = 'loja-cache';

const svgA = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#159957"/></svg>');
const svgB = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#1677b1"/></svg>');
const store = {
  id: TENANT,
  slug: SLUG,
  name: 'Loja Cache',
  theme: { storeName: 'Loja Cache', primaryColor: '#159957', logoUrl: 'https://cdn.example/logo.png' },
};
let logoBytes = svgA;

function clientFor(opts: { user?: { id: string } | null; membership?: { tenant_id: string; role_id: string } | null; membershipError?: boolean } = {}) {
  const user = opts.user === undefined ? { id: USER } : opts.user;
  const membership = opts.membership === undefined
    ? { tenant_id: TENANT, role_id: 'OWNER' }
    : opts.membership;
  const q: Record<string, unknown> = {};
  q.select = vi.fn(() => q);
  q.eq = vi.fn(() => q);
  q.in = vi.fn(() => q);
  q.maybeSingle = vi.fn().mockResolvedValue({
    data: membership,
    error: opts.membershipError || !membership ? { message: 'sem acesso' } : null,
  });
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: 'Sessão inválida' },
      }),
    },
    from: vi.fn(() => q),
  };
}

describe('POST /api/pwa/invalidate', () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_ANON_KEY;
  let server: Server;
  let base = '';
  const resolver: StoreResolver = async (slug) => {
    if (slug === SLUG) return { status: 'ok', store };
    if (slug === 'outra-loja') return { status: 'ok', store: { ...store, id: OTHER, slug: 'outra-loja', name: 'Outra', theme: { storeName: 'Outra', primaryColor: '#159957' } } };
    return { status: 'not_found' };
  };

  beforeAll(async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-test-key';
    logoBytes = svgA;
    const app = express();
    const router = createPwaRouter({
      resolveStore: resolver,
      publicDir: '/nonexistent',
      fetchLogo: async () => ({ bytes: logoBytes, contentType: 'image/svg+xml' }),
    });
    app.use(router);
    await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', () => r()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = prevKey;
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    createClient.mockReset();
    createClient.mockImplementation(() => clientFor());
  });

  async function post(body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${base}/api/pwa/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  it('exige autenticação', async () => {
    const r = await post({ tenantId: TENANT, slug: SLUG });
    expect(r.status).toBe(401);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('rejeita slug ou tenant inválidos', async () => {
    const badSlug = await post({ tenantId: TENANT, slug: 'BAD SLUG' }, { Authorization: 'Bearer tok' });
    expect(badSlug.status).toBe(400);
    const badTenant = await post({ tenantId: 'nao-uuid', slug: SLUG }, { Authorization: 'Bearer tok' });
    expect(badTenant.status).toBe(400);
  });

  it('rejeita origem distinta do host', async () => {
    const r = await post({ tenantId: TENANT, slug: SLUG }, {
      Authorization: 'Bearer tok',
      Origin: 'https://evil.example',
    });
    expect(r.status).toBe(403);
  });

  it('rejeita sessão inválida', async () => {
    createClient.mockImplementation(() => clientFor({ user: null }));
    const r = await post({ tenantId: TENANT, slug: SLUG }, { Authorization: 'Bearer tok' });
    expect(r.status).toBe(401);
  });

  it('rejeita quem não é OWNER ou MANAGER da loja', async () => {
    createClient.mockImplementation(() => clientFor({ membership: null }));
    const none = await post({ tenantId: TENANT, slug: SLUG }, { Authorization: 'Bearer tok' });
    expect(none.status).toBe(403);
    createClient.mockImplementation(() => clientFor({ membership: { tenant_id: TENANT, role_id: 'CASHIER' } }));
    const cashier = await post({ tenantId: TENANT, slug: SLUG }, { Authorization: 'Bearer tok' });
    expect(cashier.status).toBe(403);
  });

  it('não invalida outra loja (slug e tenant precisam bater com o vínculo)', async () => {
    const r = await post({ tenantId: TENANT, slug: 'outra-loja' }, { Authorization: 'Bearer tok' });
    expect(r.status).toBe(403);
    const r2 = await post({ tenantId: OTHER, slug: SLUG }, { Authorization: 'Bearer tok' });
    expect(r2.status).toBe(403);
  });

  it('OWNER e MANAGER da própria loja invalidam o cache da logo', async () => {
    const icon = `${base}/app/${SLUG}/icons/icon-192.png`;
    logoBytes = svgA;
    const first = await fetch(icon);
    expect(first.status).toBe(200);
    const hashA = createHash('sha256').update(Buffer.from(await first.arrayBuffer())).digest('hex');
    logoBytes = svgB;
    const cached = await fetch(icon);
    expect(cached.status).toBe(200);
    expect(createHash('sha256').update(Buffer.from(await cached.arrayBuffer())).digest('hex')).toBe(hashA);

    const owner = await post({ tenantId: TENANT, slug: SLUG }, { Authorization: 'Bearer tok-owner' });
    expect(owner.status).toBe(200);
    expect(await owner.json()).toEqual({ ok: true });
    const afterOwner = await fetch(icon);
    expect(afterOwner.status).toBe(200);
    const hashB = createHash('sha256').update(Buffer.from(await afterOwner.arrayBuffer())).digest('hex');
    expect(hashB).not.toBe(hashA);

    logoBytes = svgA;
    const stillB = await fetch(icon);
    expect(createHash('sha256').update(Buffer.from(await stillB.arrayBuffer())).digest('hex')).toBe(hashB);
    createClient.mockImplementation(() => clientFor({ membership: { tenant_id: TENANT, role_id: 'MANAGER' } }));
    const manager = await post({ tenantId: TENANT, slug: SLUG }, { Authorization: 'Bearer tok-mgr' });
    expect(manager.status).toBe(200);
    const afterMgr = await fetch(icon);
    expect(createHash('sha256').update(Buffer.from(await afterMgr.arrayBuffer())).digest('hex')).toBe(hashA);
  });
});

describe('POST /api/pwa/invalidate — limite de taxa', () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_ANON_KEY;
  let server: Server;
  let base = '';

  beforeAll(async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-test-key';
    const app = express();
    app.use(createPwaRouter({
      resolveStore: async (slug) => slug === SLUG ? { status: 'ok', store } : { status: 'not_found' },
      publicDir: '/nonexistent',
      fetchLogo: async () => { throw new Error('bloqueado'); },
    }));
    await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', () => r()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = prevKey;
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('responde 429 após excesso de tentativas no mesmo IP', async () => {
    createClient.mockImplementation(() => clientFor({ user: null }));
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const r = await fetch(`${base}/api/pwa/invalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ tenantId: TENANT, slug: SLUG }),
      });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
    const last = await fetch(`${base}/api/pwa/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ tenantId: TENANT, slug: SLUG }),
    });
    expect(last.status).toBe(429);
    expect(last.headers.get('retry-after')).toBe('60');
  });
});
