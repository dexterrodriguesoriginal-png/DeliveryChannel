// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PaymentService } from '../service';
import { PaymentStore } from '../store';
import { TabPixService, TabChargeRow, assertTabConfirmation, tabPixView, tabReference } from '../tabPix';
import { PaymentError } from '../types';
import { createPaymentsRouter } from '../routes';
import { encryptionKey, seal } from '../security';

const env = { PAYMENTS_PUBLIC_URL: 'https://loja.example', PAYMENTS_ENCRYPTION_KEY: 'ab'.repeat(32), PAYMENTS_STATE_SECRET: 'state-secret-that-is-long-enough-for-production', MP_CLIENT_ID: 'mp-client', MP_CLIENT_SECRET: 'mp-secret', MP_WEBHOOK_SECRET: 'signature-secret' };
const TAB = '00000000-0000-4000-8000-0000000000aa'; const CHARGE = '00000000-0000-4000-8000-0000000000bb';
const base = (patch: Partial<TabChargeRow> = {}): TabChargeRow => ({ id: CHARGE, tenant_id: 'store-1', tab_id: TAB, provider: 'mercadopago', provider_payment_id: 'mp-123', amount_cents: 5000, status: 'pending', needs_review: false, brcode: '000201BR', expires_at: new Date(Date.now() + 600_000).toISOString(), ...patch });
const confirmation = { providerPaymentId: 'mp-123', orderId: tabReference(TAB), amountCents: 5000, currency: 'BRL', paid: true, rawStatus: 'approved' };

function fixture(opts: { accounts?: any[]; claimed?: boolean; reserveError?: PaymentError } = {}) {
  let charge = base({ status: 'creating', provider_payment_id: null, brcode: null, expires_at: null });
  const secrets = new Map([['store-1:mercadopago', seal({ accessToken: 'private-token', refreshToken: 'r', accountId: 'seller', expiresAt: Date.now() + 3600_000 }, encryptionKey(env.PAYMENTS_ENCRYPTION_KEY), 'store-1:mercadopago')]]);
  const store = {
    db: { from: vi.fn() },
    user: vi.fn(async (t: string) => { if (t !== 'valid') throw new PaymentError('AUTH_REQUIRED', 401); return { id: 'staff', email: 'caixa@loja.test' }; }),
    reserveTabPix: vi.fn(async (_tab: string, user: string) => { if (opts.reserveError) throw opts.reserveError; if (user === 'stranger') throw new PaymentError('FORBIDDEN', 403); return { charge, claimed: opts.claimed ?? true, slug: 'minha-loja', table_label: 'Mesa 01' }; }),
    accounts: vi.fn(async () => opts.accounts ?? [{ provider: 'mercadopago', status: 'connected', accepts_pix: true, connection_version: 0 }]),
    secret: vi.fn(async (op: string, tenant?: string, p?: string) => (op === 'get' ? secrets.get(`${tenant}:${p}`) || null : null)),
    saveTabCharge: vi.fn(async (_id: string, c: any) => { charge = base({ provider_payment_id: c.providerPaymentId, brcode: c.brcode, expires_at: c.expiresAt }); }),
    failTabCharge: vi.fn(async () => { charge = { ...charge, status: 'failed' }; }),
    confirmTab: vi.fn(async () => { charge = { ...charge, status: 'paid', brcode: null }; return { status: 'paid', closed: true }; }),
    tabCharge: vi.fn(async (_tab: string, user: string) => { if (user === 'stranger') throw new PaymentError('FORBIDDEN', 403); return { charge, tab_status: charge.status === 'paid' ? 'CLOSED' : 'OPEN', slug: 'minha-loja' }; }),
    cancelTabCharge: vi.fn(async (_tab: string, user: string) => { if (user === 'stranger') throw new PaymentError('FORBIDDEN', 403); }),
    tabChargeById: vi.fn(async (id: string) => (id === CHARGE ? charge : null)),
  };
  const payments = new PaymentService(store as unknown as PaymentStore, env);
  const tabs = new TabPixService(payments);
  return { store, payments, tabs, setCharge: (c: TabChargeRow) => { charge = c; } };
}

describe('per-tab PIX creation', () => {
  it('charges the SQL-computed amount, with the tab as the provider reference, and never trusts the client', async () => {
    const { tabs, payments, store } = fixture();
    const create = vi.spyOn(payments.adapters.mercadopago, 'createPixCharge').mockResolvedValue({ providerPaymentId: 'mp-123', brcode: '000201BR', expiresAt: new Date(Date.now() + 600_000).toISOString(), manualConfirmation: false });
    const view = await tabs.create('staff', 'caixa@loja.test', TAB);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ orderId: `tab:${TAB}`, amountCents: 5000, idempotencyKey: CHARGE, method: 'pix',
      webhookUrl: `https://loja.example/api/payments/tab-webhooks/mercadopago/${CHARGE}` }), expect.objectContaining({ accessToken: 'private-token' }));
    expect(store.saveTabCharge).toHaveBeenCalledTimes(1);
    expect(view).toMatchObject({ amountCents: 5000, status: 'pending', brcode: '000201BR' });
    expect(JSON.stringify(view)).not.toMatch(/store-1|mp-123|tenant|provider/);
  });
  it('does not call the provider again for an already live charge', async () => {
    const { tabs, payments, store, setCharge } = fixture({ claimed: false }); setCharge(base());
    const create = vi.spyOn(payments.adapters.mercadopago, 'createPixCharge');
    expect(await tabs.create('staff', 'e@x.test', TAB)).toMatchObject({ status: 'pending' });
    expect(create).not.toHaveBeenCalled(); expect(store.saveTabCharge).not.toHaveBeenCalled();
  });
  it('refuses a store without a connected Mercado Pago account and frees the reserved charge', async () => {
    const { tabs, payments, store } = fixture({ accounts: [{ provider: 'pagbank', status: 'connected', accepts_pix: true }] });
    const create = vi.spyOn(payments.adapters.mercadopago, 'createPixCharge');
    await expect(tabs.create('staff', 'e@x.test', TAB)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_CONNECTED', status: 409 });
    expect(create).not.toHaveBeenCalled(); expect(store.failTabCharge).toHaveBeenCalledTimes(1);
  });
  it('refuses when PIX acceptance is off', async () => {
    const { tabs } = fixture({ accounts: [{ provider: 'mercadopago', status: 'connected', accepts_pix: false }] });
    await expect(tabs.create('staff', 'e@x.test', TAB)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_CONNECTED' });
  });
  it('frees the charge when the provider fails, so staff can retry', async () => {
    const { tabs, payments, store } = fixture();
    vi.spyOn(payments.adapters.mercadopago, 'createPixCharge').mockRejectedValue(new PaymentError('PROVIDER_UNAVAILABLE', 502));
    await expect(tabs.create('staff', 'e@x.test', TAB)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(store.failTabCharge).toHaveBeenCalledTimes(1);
  });
  it('requires a payer e-mail', async () => {
    const { tabs, store } = fixture();
    await expect(tabs.create('staff', '', TAB)).rejects.toMatchObject({ code: 'EMAIL_REQUIRED' }); expect(store.failTabCharge).toHaveBeenCalled();
  });
  it('maps the SQL staff check to a tab-specific 403 and never reaches the provider', async () => {
    const { tabs, payments } = fixture(); const create = vi.spyOn(payments.adapters.mercadopago, 'createPixCharge');
    await expect(tabs.create('stranger', 'e@x.test', TAB)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403, message: expect.stringContaining('cobrar') });
    await expect(tabs.status('stranger', TAB)).rejects.toMatchObject({ status: 403 });
    await expect(tabs.cancel('stranger', TAB)).rejects.toMatchObject({ status: 403 });
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects a malformed tab id before any query', async () => {
    const { tabs, store } = fixture();
    await expect(tabs.create('staff', 'e@x.test', "x'; drop table")).rejects.toMatchObject({ code: 'INVALID_TAB' });
    expect(store.reserveTabPix).not.toHaveBeenCalled();
  });
  it('is unavailable without platform credentials', async () => {
    const f = fixture(); const tabs = new TabPixService(new PaymentService(f.store as unknown as PaymentStore, { PAYMENTS_PUBLIC_URL: 'https://loja.example' }));
    await expect(tabs.create('staff', 'e@x.test', TAB)).rejects.toMatchObject({ code: 'PAYMENTS_UNAVAILABLE', status: 503 });
  });
});

describe('per-tab PIX confirmation', () => {
  it.each([{ amountCents: 4999 }, { amountCents: 5001 }, { amountCents: NaN }, { amountCents: 50.5 }, { orderId: 'tab:other' }, { orderId: 'order-1' }, { currency: 'USD' }, { providerPaymentId: 'mp-other' }])('rejects mismatched provider data %o', async patch => {
    const { tabs, payments, store } = fixture(); vi.spyOn(payments.adapters.mercadopago, 'getPaymentStatus').mockResolvedValue({ ...confirmation, ...patch });
    await expect(tabs.refresh(base())).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' }); expect(store.confirmTab).not.toHaveBeenCalled();
  });
  it('always asks the provider API and confirms the exact charge once, even with polling plus webhook', async () => {
    const { tabs, payments, store } = fixture(); const get = vi.spyOn(payments.adapters.mercadopago, 'getPaymentStatus').mockResolvedValue(confirmation);
    await Promise.all([tabs.refresh(base()), tabs.refresh(base())]);
    expect(get).toHaveBeenCalledWith('mp-123', expect.objectContaining({ accessToken: 'private-token' }));
    expect(store.confirmTab).toHaveBeenCalledTimes(1);
  });
  it('does not confirm a pending provider status, whatever a webhook body claims', async () => {
    const { tabs, payments, store } = fixture(); vi.spyOn(payments.adapters.mercadopago, 'verifyWebhook').mockReturnValue(true);
    vi.spyOn(payments.adapters.mercadopago, 'getPaymentStatus').mockResolvedValue({ ...confirmation, paid: false, rawStatus: 'pending' });
    await tabs.webhook(CHARGE, { headers: {}, query: { 'data.id': 'mp-123' }, rawBody: Buffer.from('{"status":"approved","amount":0.01}') });
    expect(store.confirmTab).not.toHaveBeenCalled();
  });
  it('records a rejected/expired provider status without closing anything', async () => {
    const { tabs, payments, store } = fixture(); vi.spyOn(payments.adapters.mercadopago, 'getPaymentStatus').mockResolvedValue({ ...confirmation, paid: false, rawStatus: 'rejected' });
    await tabs.refresh(base());
    expect(store.confirmTab).toHaveBeenCalledWith(CHARGE, expect.objectContaining({ paid: false, rawStatus: 'rejected' }));
  });
  it('rejects forged webhooks before touching the provider or the database', async () => {
    const { tabs, payments, store } = fixture(); const get = vi.spyOn(payments.adapters.mercadopago, 'getPaymentStatus');
    await expect(tabs.webhook(CHARGE, { headers: {}, query: {}, rawBody: Buffer.from('{}') })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    await expect(tabs.webhook('not-a-uuid', { headers: {}, query: {}, rawBody: Buffer.from('{}') })).rejects.toMatchObject({ code: 'INVALID_WEBHOOK' });
    expect(get).not.toHaveBeenCalled(); expect(store.confirmTab).not.toHaveBeenCalled(); expect(store.tabChargeById).not.toHaveBeenCalled();
  });
  it('rejects a signed webhook for an unknown charge', async () => {
    const { tabs, payments } = fixture(); vi.spyOn(payments.adapters.mercadopago, 'verifyWebhook').mockReturnValue(true);
    await expect(tabs.webhook('00000000-0000-4000-8000-0000000000cc', { headers: {}, query: {}, rawBody: Buffer.from('{}') })).rejects.toMatchObject({ code: 'INVALID_WEBHOOK', status: 401 });
  });
  it('status polling refreshes a pending charge and reports the closed tab', async () => {
    const { tabs, payments, setCharge } = fixture(); setCharge(base());
    vi.spyOn(payments.adapters.mercadopago, 'getPaymentStatus').mockResolvedValue(confirmation);
    expect(await tabs.status('staff', TAB)).toMatchObject({ status: 'paid', tabClosed: true, brcode: null });
  });
  it('late payments of cancelled/expired charges are still checked against the provider', async () => {
    const { tabs, payments, store } = fixture(); vi.spyOn(payments.adapters.mercadopago, 'getPaymentStatus').mockResolvedValue(confirmation);
    await tabs.refresh(base({ status: 'cancelled' }), 'mp-123', true); expect(store.confirmTab).toHaveBeenCalledTimes(1);
  });
  it('already-paid charges are not asked again', async () => {
    const { tabs, payments, store } = fixture(); const get = vi.spyOn(payments.adapters.mercadopago, 'getPaymentStatus');
    await tabs.refresh(base({ status: 'paid' })); expect(get).not.toHaveBeenCalled(); expect(store.confirmTab).not.toHaveBeenCalled();
  });
});

describe('pure helpers', () => {
  it('hides the code once expired, cancelled or paid', () => {
    expect(tabPixView(base())?.brcode).toBe('000201BR');
    expect(tabPixView(base({ expires_at: new Date(Date.now() - 1000).toISOString() }))?.brcode).toBeNull();
    expect(tabPixView(base({ status: 'cancelled' }))?.brcode).toBeNull();
    expect(tabPixView(base({ status: 'paid', needs_review: true, review_reason: 'Total da conta mudou depois do PIX' }), 'OPEN')).toMatchObject({ needsReview: true, tabClosed: false });
    expect(tabPixView(null)).toBeNull();
  });
  it('assertTabConfirmation ignores unpaid confirmations and accepts exact ones', () => {
    expect(() => assertTabConfirmation(base(), { ...confirmation, paid: false, amountCents: 1 })).not.toThrow();
    expect(() => assertTabConfirmation(base(), confirmation)).not.toThrow();
  });
});

describe('HTTP contract', () => {
  const svc = new TabPixService({} as any);
  const tabService = { create: vi.fn(async () => ({ status: 'pending' })), status: vi.fn(async () => ({ status: 'paid' })), cancel: vi.fn(async () => {}), webhook: vi.fn(async () => {}) };
  const service = { origin: 'https://loja.example', store: { user: vi.fn(async (t: string) => { if (t !== 'valid') throw new PaymentError('AUTH_REQUIRED', 401); return { id: 'staff', email: 'caixa@loja.test' }; }) }, available: vi.fn(() => true) };
  let server: Server; let url: string;
  beforeAll(async () => {
    vi.spyOn(TabPixService.prototype, 'create').mockImplementation(tabService.create as any);
    vi.spyOn(TabPixService.prototype, 'status').mockImplementation(tabService.status as any);
    vi.spyOn(TabPixService.prototype, 'cancel').mockImplementation(tabService.cancel as any);
    vi.spyOn(TabPixService.prototype, 'webhook').mockImplementation(tabService.webhook as any);
    const app = express(); app.use('/api/payments', createPaymentsRouter({}, service as unknown as PaymentService));
    await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payments`;
  });
  afterAll(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const auth = { Authorization: 'Bearer valid' };
  it('requires real authentication on every tab route', async () => {
    for (const [method, path] of [['POST', `/tabs/${TAB}/pix`], ['GET', `/tabs/${TAB}/pix`], ['POST', `/tabs/${TAB}/pix/cancel`]] as const) {
      expect((await fetch(url + path, { method })).status).toBe(401);
      expect((await fetch(url + path, { method, headers: { Authorization: 'Bearer forged' } })).status).toBe(401);
    }
    expect(tabService.create).not.toHaveBeenCalled();
  });
  it('rejects malformed ids and ignores any client-sent amount or tenant', async () => {
    expect((await fetch(`${url}/tabs/not-a-uuid/pix`, { method: 'POST', headers: auth })).status).toBe(400);
    const r = await fetch(`${url}/tabs/${TAB}/pix`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 0.01, tenant_id: 'x', status: 'paid' }) });
    expect(r.status).toBe(200); expect(tabService.create).toHaveBeenCalledWith('staff', 'caixa@loja.test', TAB);
  });
  it('serves status and cancel; webhook route needs a signature path and the mercadopago provider', async () => {
    expect((await fetch(`${url}/tabs/${TAB}/pix`, { headers: auth })).status).toBe(200);
    expect((await fetch(`${url}/tabs/${TAB}/pix/cancel`, { method: 'POST', headers: auth })).status).toBe(200);
    expect((await fetch(`${url}/tab-webhooks/pagbank/${CHARGE}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
    expect((await fetch(`${url}/tab-webhooks/mercadopago/not-a-uuid`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
    expect((await fetch(`${url}/tab-webhooks/mercadopago/${CHARGE}?data.id=1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(200);
    expect(tabService.webhook).toHaveBeenCalledWith(CHARGE, expect.objectContaining({ query: { 'data.id': '1' } }));
    void svc;
  });
  it('rejects a cross-origin mutation', async () => {
    expect((await fetch(`${url}/tabs/${TAB}/pix`, { method: 'POST', headers: { ...auth, Origin: 'https://evil.example' } })).status).toBe(403);
  });
});
