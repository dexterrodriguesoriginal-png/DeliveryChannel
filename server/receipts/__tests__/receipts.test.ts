// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createReceiptsRouter } from '../routes';
import { receiptContent, receiptProvider, ResendReceiptProvider } from '../provider';
import { ReceiptService } from '../service';
import { receiptStorageError, SupabaseReceiptStore } from '../store';
import { ReceiptError, type ReceiptStore, type TabReceipt } from '../types';

const tabId = '00000000-0000-4000-8000-000000000001';
const receipt: TabReceipt = {
  attempt_id: '00000000-0000-4000-8000-000000000002', recipient_email: 'joao@cliente.example',
  store_name: 'Loja <script>unsafe</script>', table_label: 'Mesa 5',
  items: [{ name: 'Café & bolo', quantity: 2, unit_price: 10, total_price: 20 }],
  service_fee_cents: 200, total_cents: 2200, method: 'PIX',
  paid_at: '2026-11-04T01:00:00Z', charge_id: '00000000-0000-4000-8000-000000000003',
};
const store: ReceiptStore = {
  user: vi.fn(async token => {
    if (token !== 'valid-session') throw new ReceiptError('AUTH_REQUIRED', 401, 'Entre na sua conta.');
    return { id: 'verified-actor' };
  }),
  reserve: vi.fn(async () => receipt), finish: vi.fn(async () => {}),
};
const provider = { send: vi.fn(async (_receipt: TabReceipt) => {}) };
let server: Server; let base: string;
beforeAll(async () => {
  const app = express();
  app.use('/configured', createReceiptsRouter({ PAYMENTS_PUBLIC_URL: 'https://loja.example' }, new ReceiptService(store, provider)));
  app.use('/missing', createReceiptsRouter({}, new ReceiptService(store, null)));
  await new Promise<void>((resolve, reject) => { server = app.listen(0, '127.0.0.1', resolve); server.once('error', reject); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
const request = (path = `/configured/tabs/${tabId}`, body: unknown = {}, headers: Record<string, string> = { Authorization: 'Bearer valid-session' }) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('tab receipt HTTP security', () => {
  it('requires a verified Supabase user before reserving an email', async () => {
    const before = vi.mocked(store.reserve).mock.calls.length;
    expect((await request(undefined, {}, {})).status).toBe(401);
    expect((await request(undefined, {}, { Authorization: 'Bearer forged-session' })).status).toBe(401);
    expect(vi.mocked(store.reserve).mock.calls).toHaveLength(before);
  });
  it('ignores arbitrary address/tenant/payment input and returns only sent status', async () => {
    const response = await request(undefined, { email: 'attacker@example.com', tenant_id: 'foreign', paid: true, total: 1 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: true });
    expect(store.reserve).toHaveBeenLastCalledWith(tabId, 'verified-actor');
    expect(provider.send).toHaveBeenLastCalledWith(receipt);
    expect(store.finish).toHaveBeenLastCalledWith(receipt.attempt_id, true);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('returns a clear missing-provider state only after SQL has authorized staff and reserved an attempt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await request(`/missing/tabs/${tabId}`);
    expect(await response.json()).toEqual({ sent: false, reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' });
    expect(store.reserve).toHaveBeenLastCalledWith(tabId, 'verified-actor');
    expect(store.finish).toHaveBeenLastCalledWith(receipt.attempt_id, false, 'EMAIL_PROVIDER_NOT_CONFIGURED');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('EMAIL_PROVIDER_NOT_CONFIGURED'));
    warn.mockRestore();
  });
  it('validates and forwards overrideEmail when Enviar para outro email is used', async () => {
    const bad = await request(undefined, { overrideEmail: 'not-an-email' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe('INVALID_EMAIL');
    const ok = await request(undefined, { overrideEmail: '  Outro@Dominio.com.br ' });
    expect(ok.status).toBe(200);
    expect(store.reserve).toHaveBeenLastCalledWith(tabId, 'verified-actor', 'outro@dominio.com.br');
  });
  it('refuses staff from another store even when email is unconfigured', async () => {
    vi.mocked(store.reserve).mockRejectedValueOnce(receiptStorageError({ code: '42501', message: 'secret customer email' }));
    const response = await request(`/missing/tabs/${tabId}`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Você não tem permissão para enviar este comprovante.', code: 'FORBIDDEN' });
  });
  it('preserves the persistent SQL rate limit without calling the provider again', async () => {
    const before = provider.send.mock.calls.length;
    vi.mocked(store.reserve).mockRejectedValueOnce(receiptStorageError({ message: 'Muitos envios de comprovante. Aguarde.' }));
    const response = await request();
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('RATE_LIMITED');
    expect(provider.send.mock.calls).toHaveLength(before);
  });
  it('rejects cross-origin writes and invalid tab identifiers before reading any recipient', async () => {
    const before = vi.mocked(store.reserve).mock.calls.length;
    expect((await request(undefined, {}, { Authorization: 'Bearer valid-session', Origin: 'https://evil.example' })).status).toBe(403);
    expect((await request('/configured/tabs/not-a-uuid')).status).toBe(400);
    expect(vi.mocked(store.reserve).mock.calls).toHaveLength(before);
  });
  it('audits provider failure with a fixed reason and never reflects its sensitive exception', async () => {
    provider.send.mockRejectedValueOnce(new Error('joao@cliente.example SECRET_RESEND_KEY'));
    const response = await request();
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).not.toContain('joao@cliente.example'); expect(body).not.toContain('SECRET_RESEND_KEY');
    expect(store.finish).toHaveBeenLastCalledWith(receipt.attempt_id, false, 'PROVIDER_ERROR');
  });
});

describe('receipt provider boundary', () => {
  it('stays disabled until both server-only env variables are configured', () => {
    expect(receiptProvider({})).toBeNull();
    expect(receiptProvider({ RESEND_API_KEY: 'test-key' })).toBeNull();
    expect(receiptProvider({ RECEIPT_FROM: 'Loja <receipt@example.com>' })).toBeNull();
  });
  it('sends the validated server recipient to the fixed Resend endpoint with no redirects', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }));
    await new ResendReceiptProvider('test-key', 'Loja <receipt@example.com>', fetcher as typeof fetch).send(receipt);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails'); expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body as string).to).toEqual([receipt.recipient_email]);
    expect(init.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': `tab-receipt/${receipt.attempt_id}` }));
  });
  it('renders the complete receipt while escaping shop and item HTML, with no phone, CPF or recipient in content', () => {
    const content = receiptContent(receipt);
    expect(content.html).toContain('&lt;script&gt;unsafe&lt;/script&gt;'); expect(content.html).not.toContain('<script>');
    for (const value of ['Mesa 5', 'Café', 'Taxa de serviço', '22,00', 'PIX', '03/11/2026', receipt.charge_id]) expect(content.text).toContain(value);
    expect(content.text).not.toContain(receipt.recipient_email); expect(content.text).not.toMatch(/CPF|telefone/i);
  });
  it('does not parse provider response bodies or expose their content on HTTP errors', async () => {
    const response = new Response('SECRET_EMAIL_AND_TOKEN', { status: 429 });
    const read = vi.spyOn(response, 'json');
    const adapter = new ResendReceiptProvider('test-key', 'receipt@example.com', vi.fn(async () => response));
    await expect(adapter.send(receipt)).rejects.toMatchObject({ code: 'RECEIPT_PROVIDER_ERROR', status: 502 });
    expect(read).not.toHaveBeenCalled();
  });
  it('passes only the authenticated actor and tab to the service-role gateway', async () => {
    const rpc = vi.fn(async () => ({ data: receipt, error: null }));
    const gateway = new SupabaseReceiptStore({ rpc } as any);
    expect(await gateway.reserve(tabId, 'verified-actor')).toEqual(receipt);
    expect(rpc).toHaveBeenCalledWith('reserve_tab_receipt', { p_tab: tabId, p_user: 'verified-actor' });
    await gateway.finish(receipt.attempt_id, false, 'EMAIL_PROVIDER_NOT_CONFIGURED');
    expect(rpc).toHaveBeenLastCalledWith('finish_tab_receipt', { p_attempt: receipt.attempt_id, p_sent: false, p_reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' });
  });
});
