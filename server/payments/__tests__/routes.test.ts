// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPaymentsRouter } from '../routes';
import { PaymentService } from '../service';
import { PaymentError } from '../types';

const orderId = '00000000-0000-4000-8000-000000000001'; const membership = '00000000-0000-4000-8000-000000000002';
const service = {
  origin: 'https://loja.example',
  store: {
    user: vi.fn(async (token: string) => { if (token !== 'valid-session') throw new PaymentError('AUTH_REQUIRED',401,'Entre na sua conta.'); return { id: 'user', email:'cliente@example.com' }; }),
    membership: vi.fn(async (_user: string, id: string) => { if (id !== membership) throw new PaymentError('FORBIDDEN',403); return { tenant_id: 'tenant-derived-from-membership' }; }),
    accounts: vi.fn(async () => []), publicAccounts: vi.fn(async () => []),
  },
  available: vi.fn(() => true), configure: vi.fn(async () => {}), create: vi.fn(async () => ({ status:'pending' })),
  status: vi.fn(async () => ({ status:'paid' })), manualConfirm: vi.fn(async () => {}),
  startConnect: vi.fn(async () => 'https://auth.mercadopago.com.br/authorization?state=signed'),
  finishConnect: vi.fn(async () => {}), webhook: vi.fn(async (_provider:string,_id:string,_input:any) => {}),
};
let server: Server; let base: string;
beforeAll(async () => {
  const app = express(); app.use('/api/payments',createPaymentsRouter({}, service as unknown as PaymentService));
  app.use('/unconfigured',createPaymentsRouter({}));
  await new Promise<void>((resolve,reject) => { server = app.listen(0,'127.0.0.1',resolve); server.once('error',reject); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
const req = (path: string, body?: unknown, headers: Record<string,string> = {}) => fetch(base + '/api/payments' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type':'application/json' }), ...headers }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) });
const auth = { Authorization:'Bearer valid-session' };

describe('payment HTTP authorization and contracts', () => {
  it('works without platform credentials and preserves checkout fallback', async () => {
    const r = await fetch(base+'/unconfigured/options/loja'); expect(r.status).toBe(200); expect(await r.json()).toEqual({ accounts:[] });
  });
  it.each(['/accounts', `/orders/${orderId}`])('requires actual Supabase authentication for %s', async path => {
    expect((await req(path)).status).toBe(401); expect((await req(path,undefined,{ Authorization:'Bearer forged' })).status).toBe(401);
  });
  it('derives the store from an authenticated membership, with no tenant_id selector', async () => {
    const r = await req('/accounts',undefined,{ ...auth,'X-Membership-Id':membership }); expect(r.status).toBe(200);
    expect(service.store.accounts).toHaveBeenCalledWith('tenant-derived-from-membership');
  });
  it('rejects a foreign membership', async () => {
    expect((await req('/accounts',undefined,{ ...auth,'X-Membership-Id':'00000000-0000-4000-8000-000000000099' })).status).toBe(403);
  });
  it('ignores client amounts, payment status, tokens and tenant_id', async () => {
    const r = await req(`/orders/${orderId}`,{ provider:'mercadopago',method:'pix',tenant_id:'attacker',amount:0.01,status:'paid',access_token:'attacker-token' },auth);
    expect(r.status).toBe(200); expect(service.create).toHaveBeenCalledWith('user','cliente@example.com',orderId,'mercadopago','pix',undefined);
  });
  it.each([{ card:{ number:'4111111111111111',cvv:'123' } },{ cardNumber:'4111111111111111' },{ extra:{ cvc:'123' } }])('rejects card details before invoking an adapter: %o', async forbidden => {
    const before = service.create.mock.calls.length;
    const r = await req(`/orders/${orderId}`,{ provider:'mercadopago',method:'card',...forbidden },auth);
    expect(r.status).toBe(400); expect((await r.json()).code).toBe('CARD_DETAILS_FORBIDDEN');
    expect(service.create.mock.calls).toHaveLength(before);
  });
  it('rejects cross-origin mutations', async () => {
    const before = service.create.mock.calls.length;
    expect((await req(`/orders/${orderId}`,{ provider:'mercadopago',method:'pix' },{ ...auth, Origin:'https://evil.example' })).status).toBe(403);
    expect(service.create.mock.calls).toHaveLength(before);
  });
  it('sets a secure, HttpOnly and SameSite OAuth cookie', async () => {
    const r = await req('/accounts/mercadopago/connect',{}, { ...auth,'X-Membership-Id':membership }); expect(r.status).toBe(200);
    const cookie = r.headers.get('set-cookie'); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=Lax');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('does not reveal OAuth codes or credentials in callback HTML', async () => {
    const r = await req('/oauth/mercadopago/callback?state=state&code=secret-authorization-code',undefined,{ Cookie:'payment_oauth=browser-cookie' });
    expect(r.status).toBe(200); const html = await r.text(); expect(html).not.toContain('secret-authorization-code');
    expect(service.finishConnect).toHaveBeenCalledWith('mercadopago','state','secret-authorization-code','browser-cookie');
  });
  it('passes the original webhook bytes, without authentication cookies', async () => {
    const raw = '{ "status" : "PAID", "amount": 0.01 }';
    service.webhook.mockImplementationOnce(async (provider,id,input) => { expect(provider).toBe('pagbank'); expect(id).toBe(orderId); expect(input.rawBody).toEqual(Buffer.from(raw)); expect(input.headers['x-authenticity-token']).toBe('signature'); });
    const r = await fetch(`${base}/api/payments/webhooks/pagbank/${orderId}`, { method:'POST',headers:{ 'Content-Type':'application/json','X-Authenticity-Token':'signature' },body:raw });
    expect(r.status).toBe(200);
    expect(service.webhook).toHaveBeenCalledWith('pagbank',orderId,expect.objectContaining({ rawBody:Buffer.alloc(Buffer.byteLength(raw)),headers:expect.objectContaining({ 'x-authenticity-token':'signature' }) }));
  });
  it('rejects an unrecognized provider and malformed order', async () => {
    expect((await req('/orders/not-a-uuid',{ provider:'mercadopago',method:'pix' },auth)).status).toBe(400);
    expect((await req(`/orders/${orderId}`,{ provider:'evil',method:'pix' },auth)).status).toBe(400);
  });
  it('never reflects an internal exception with provider credentials', async () => {
    service.status.mockRejectedValueOnce(new Error('SECRET_PROVIDER_TOKEN'));
    const r = await req(`/orders/${orderId}`,undefined,auth); expect(r.status).toBe(500); expect(await r.text()).not.toContain('SECRET_PROVIDER_TOKEN');
  });
});
