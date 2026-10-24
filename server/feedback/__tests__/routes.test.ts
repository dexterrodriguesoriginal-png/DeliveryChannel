import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc, auth: { getUser } }),
}));
import { createFeedbackRouter, feedbackHash } from '../routes';
const secret = 'test-only-feedback-secret-at-least-32-chars';
const input = {
  type: 'sugestao',
  message: 'Gostaria de mais opções.',
  area: null,
  rating: null,
};
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(
    createFeedbackRouter({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only',
      FEEDBACK_HASH_SECRET: secret,
    }),
  );
  app.use('/unconfigured', createFeedbackRouter({}));
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null });
  getUser.mockReset().mockResolvedValue({
    data: { user: { id: 'verified-user' } },
    error: null,
  });
});
function send(
  body: unknown = input,
  headers: Record<string, string> = {},
  path = '/api/store-feedback/loja-a',
) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
describe('feedback submission boundary', () => {
  it('allows visitors and ignores spoofed identities, tenant UUIDs and forwarded IP headers', async () => {
    const r = await send(
      {
        ...input,
        tenant_id: 'other-store',
        sender_hash: 'fake',
        user_id: 'fake',
      },
      { 'X-Forwarded-For': '8.8.8.8' },
    );
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(getUser).not.toHaveBeenCalled();
    const params = rpc.mock.calls[0][1];
    expect(rpc.mock.calls[0][0]).toBe('submit_store_feedback');
    expect(params.p_store_slug).toBe('loja-a');
    expect(params).not.toHaveProperty('tenant_id');
    expect(params).not.toHaveProperty('user_id');
    expect(params.p_sender_hash).toBe(params.p_ip_hash);
    expect(params.p_ip_hash).toBe(
      feedbackHash(
        secret,
        new Date().toISOString().slice(0, 10),
        'loja-a',
        'ip',
        '127.0.0.1',
      ),
    );
  });
  it('allows omitted optional rating and area fields', async () => {
    const response = await send({
      type: 'sugestao',
      message: 'Gostaria de mais opções.',
    });
    expect(response.status).toBe(201);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_area: null,
      p_rating: null,
    });
  });
  it('authenticates JWTs server-side and enforces both account and network counters', async () => {
    const r = await send(input, { Authorization: 'Bearer verified-token' });
    expect(r.status).toBe(201);
    expect(getUser).toHaveBeenCalledWith('verified-token');
    const params = rpc.mock.calls[0][1];
    expect(params.p_sender_hash).not.toBe(params.p_ip_hash);
    expect(params.p_sender_hash).toBe(
      feedbackHash(
        secret,
        new Date().toISOString().slice(0, 10),
        'loja-a',
        'user',
        'verified-user',
      ),
    );
    expect(JSON.stringify(params)).not.toContain('verified-user');
  });
  it.each([null, { is_anonymous: true, id: 'anon' }])(
    'does not silently downgrade an invalid session to a visitor: %s',
    async (user) => {
      getUser.mockResolvedValue({
        data: { user },
        error: user ? null : { message: 'expired' },
      });
      const r = await send(input, { Authorization: 'Bearer invalid-token' });
      expect(r.status).toBe(401);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it('rejects malformed authorization', async () => {
    expect((await send(input, { Authorization: 'Basic bad' })).status).toBe(
      401,
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, message: 'curta' },
    { ...input, rating: 6 },
    { ...input, rating: 1.5 },
    { ...input, area: 'unknown' },
    { ...input, type: 'constructor' },
  ])('rejects invalid payloads', async (body) => {
    expect((await send(body)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects oversized bodies without echoing private message text', async () => {
    const response = await send({
      ...input,
      message: 'private-content'.repeat(1000),
    });
    expect(response.status).toBe(413);
    expect(await response.text()).not.toContain('private-content');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON without echoing the request', async () => {
    const response = await fetch(base + '/api/store-feedback/loja-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'private-content{',
    });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private-content');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('maps the atomic daily quota to 429 and hides database internals', async () => {
    rpc.mockResolvedValue({
      error: { code: 'P0001', message: 'internal ip/hash/user' },
    });
    const r = await send();
    expect(r.status).toBe(429);
    expect(await r.text()).not.toContain('internal');
  });
  it('fails closed without server configuration', async () => {
    expect(
      (await send(input, {}, '/unconfigured/api/store-feedback/loja-a')).status,
    ).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('does not disclose unexpected errors', async () => {
    rpc.mockRejectedValue(new Error('secret'));
    const r = await send();
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain('secret');
  });
});
describe('keyed sender hash', () => {
  it('separates stores, days, users and IPs, and cannot be computed without the secret', () => {
    const h = feedbackHash(secret, '2026-10-24', 'a', 'user', 'u');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(
      new Set([
        h,
        feedbackHash(secret, '2026-10-25', 'a', 'user', 'u'),
        feedbackHash(secret, '2026-10-24', 'b', 'user', 'u'),
        feedbackHash(secret, '2026-10-24', 'a', 'ip', 'u'),
        feedbackHash('different', '2026-10-24', 'a', 'user', 'u'),
      ]).size,
    ).toBe(5);
  });
});
