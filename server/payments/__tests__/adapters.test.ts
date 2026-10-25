import { describe, expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { MercadoPago, pkceChallenge } from '../mercadopago';
import { PagBank } from '../pagbank';
import { InfinitePay } from '../infinitepay';
import { ManualPix } from '../manualPix';
import { ChargeInput, Credentials, WebhookInput } from '../types';
import { checkoutUrl, providerRequest } from '../http';

const input: ChargeInput = { orderId: 'order-1', amountCents: 1299, method: 'pix', idempotencyKey: 'charge-uuid', email: 'cliente@example.com', name: 'Maria Silva', taxId: '12345678909', webhookUrl: 'https://loja.example/api/payments/webhooks/pagbank/id', returnUrl: 'https://loja.example/app/loja' };
const credentials: Credentials = { accessToken: 'seller-token', refreshToken: 'refresh-token', accountId: 'seller-1' };
const transport = (...responses: unknown[]) => vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200 }));
const bodyOf = (mock: any, call = 0) => JSON.parse(mock.mock.calls[call][1].body);

describe('Mercado Pago adapter', () => {
  it('creates PIX with the seller token, exact total, expiration, order reference and idempotency', async () => {
    const f = transport({ id: 123, date_of_expiration: '2026-10-25T12:00:00Z', point_of_interaction: { transaction_data: { qr_code: 'valid-code' } } });
    expect(await new MercadoPago({}, f).createPixCharge(input, credentials)).toMatchObject({ providerPaymentId: '123', brcode: 'valid-code', manualConfirmation: false });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.mercadopago.com/v1/payments');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer seller-token', 'X-Idempotency-Key': input.idempotencyKey });
    expect(bodyOf(f)).toMatchObject({ transaction_amount: 12.99, external_reference: 'order-1', payment_method_id: 'pix', notification_url: input.webhookUrl });
    expect(bodyOf(f)).not.toHaveProperty('application_fee'); expect(bodyOf(f).date_of_expiration).toBeTruthy();
  });
  it('creates a Checkout Pro preference without receiving card details', async () => {
    const f = transport({ id: 'pref', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=x' });
    expect(await new MercadoPago({}, f).createCardCheckout(input, credentials)).toMatchObject({ providerPaymentId: 'preference:pref', checkoutUrl: expect.any(String) });
    expect(bodyOf(f)).toMatchObject({ external_reference: 'order-1', items: [{ unit_price: 12.99, currency_id: 'BRL', quantity: 1, title: 'Pedido na loja', id: 'order-1' }] });
    expect(bodyOf(f)).not.toHaveProperty('marketplace_fee');
  });
  it('exchanges an authorization code with PKCE and returns server credentials', async () => {
    const f = transport({ access_token: 'new', refresh_token: 'new-refresh', user_id: 42, expires_in: 3600 });
    const p = new MercadoPago({ MP_CLIENT_ID: 'id', MP_CLIENT_SECRET: 'secret' }, f);
    expect(await p.connect({ code: 'code', verifier: 'verifier', redirectUri: 'https://loja/callback' })).toMatchObject({ accessToken: 'new', accountId: '42' });
    expect(bodyOf(f)).toMatchObject({ grant_type: 'authorization_code', code_verifier: 'verifier', client_secret: 'secret' });
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('refreshes tokens with no browser interaction', async () => {
    const f = transport({ access_token: 'new', refresh_token: 'rotated', user_id: 42, expires_in: 3600 });
    await new MercadoPago({}, f).refresh(credentials); expect(bodyOf(f)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-token' });
  });
  it('searches preference payments using the server order and fetches the payment before confirming', async () => {
    const f = transport({ results: [{ id: 123, status: 'approved' }] }, { id: 123, status: 'approved', external_reference: 'order-1', transaction_amount: 12.99, currency_id: 'BRL', collector_id: 'seller-1' });
    expect(await new MercadoPago({}, f).getPaymentStatus('preference:pref', credentials, input)).toMatchObject({ paid: true, providerPaymentId: '123', amountCents: 1299 });
    expect(f.mock.calls).toHaveLength(2);
  });
  it.each([{ collector_id: 'another-seller' }, { transaction_amount_refunded: 5 }, { status: 'pending' }])('does not approve an unsafe payment: %o', async patch => {
    const f = transport({ id: 123, status: 'approved', external_reference: 'order-1', transaction_amount: 12.99, currency_id: 'BRL', collector_id: 'seller-1', ...patch });
    expect((await new MercadoPago({}, f).getPaymentStatus('123', credentials)).paid).toBe(false);
  });
  it('rejects a malformed create response', async () => { await expect(new MercadoPago({}, transport({ id: 1 })).createPixCharge(input, credentials)).rejects.toMatchObject({ code: 'INVALID_CHARGE_RESPONSE' }); });
  it('revokes the specific seller authorization', async () => {
    const f = transport({}); await new MercadoPago({ MP_CLIENT_ID: 'app' }, f).disconnect(credentials);
    expect(f).toHaveBeenCalledWith('https://api.mercadolibre.com/users/seller-1/applications/app', expect.objectContaining({ method: 'DELETE' }));
  });
});

describe('PagBank adapter', () => {
  it('creates an order with PIX QR code in cents', async () => {
    const f = transport({ id: 'ORDE_1', qr_codes: [{ text: 'brcode', expiration_date: '2026-10-25T12:00:00Z' }] });
    expect(await new PagBank({}, f).createPixCharge(input, credentials)).toMatchObject({ providerPaymentId: 'ORDE_1', brcode: 'brcode' });
    expect(bodyOf(f)).toMatchObject({ reference_id: 'order-1', customer: { tax_id: '12345678909' }, qr_codes: [{ amount: { value: 1299 }, expiration_date: expect.any(String) }] });
    expect((f.mock.calls[0] as any)[1].headers).toMatchObject({ Authorization: 'Bearer seller-token', 'x-idempotency-key': 'charge-uuid' });
  });
  it('requires a payer tax ID before calling the API', async () => {
    const f = transport({}); await expect(new PagBank({}, f).createPixCharge({ ...input, taxId: undefined }, credentials)).rejects.toMatchObject({ code: 'TAX_ID_REQUIRED' }); expect(f).not.toHaveBeenCalled();
  });
  it('creates credit card checkout using PAY link and notification URLs', async () => {
    const f = transport({ id: 'CHEC_1', links: [{ rel: 'PAY', href: 'https://pagamento.pagbank.com.br/pagamento?code=1' }] });
    expect((await new PagBank({}, f).createCardCheckout(input, credentials)).checkoutUrl).toContain('pagamento.pagbank');
    expect(bodyOf(f)).toMatchObject({ payment_methods: [{ type: 'CREDIT_CARD' }], payment_notification_urls: [input.webhookUrl], items: [{ unit_amount: 1299, quantity: 1, name: 'Pedido na loja', reference_id: 'order-1' }] });
  });
  it('uses Connect application credentials and rotates refresh tokens', async () => {
    const f = transport({ access_token: 'new', refresh_token: 'new-r', expires_in: 600 }, { access_token: 'next', refresh_token: 'next-r', expires_in: 600 });
    const p = new PagBank({ PAGBANK_CLIENT_ID: 'id', PAGBANK_CLIENT_SECRET: 'secret', PAGBANK_PLATFORM_TOKEN: 'platform' }, f);
    await p.connect({ code: 'authorization-code', redirectUri: 'https://loja/callback' }); await p.refresh(credentials);
    expect((f.mock.calls[0] as any)[1].headers).toMatchObject({ X_CLIENT_ID: 'id', X_CLIENT_SECRET: 'secret', Authorization: 'Bearer platform' });
    expect(bodyOf(f, 1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-token' });
  });
  it('queries an order and requires a paid charge in BRL', async () => {
    const f = transport({ id: 'ORDE_1', reference_id: 'order-1', charges: [{ id: 'CHAR_1', status: 'PAID', amount: { value: 1299, currency: 'BRL' } }] });
    expect(await new PagBank({}, f).getPaymentStatus('ORDE_1', credentials)).toMatchObject({ paid: true, amountCents: 1299, currency: 'BRL', providerPaymentId: 'CHAR_1' });
  });
  it.each(['ACTIVE', 'PAID', 'EXPIRED'])('checkout status %s alone never confirms the order', async status => {
    expect((await new PagBank({}, transport({ id: 'CHEC_1', status, reference_id: 'order-1' })).getPaymentStatus('CHEC_1', credentials)).paid).toBe(false);
  });
  it('does not confirm refunded or duplicate paid charges', async () => {
    const charge = { id: 'CHAR_1', status: 'PAID', amount: { value: 1299, currency: 'BRL', summary: { refunded: 1 } } };
    expect((await new PagBank({}, transport({ id: 'ORDE_1', charges: [charge] })).getPaymentStatus('ORDE_1', credentials)).paid).toBe(false);
  });
  it('rejects a notification URL beyond the provider limit', async () => { await expect(new PagBank({}).createCardCheckout({ ...input, webhookUrl: 'https://example.com/' + 'a'.repeat(100) }, credentials)).rejects.toMatchObject({ code: 'WEBHOOK_URL_TOO_LONG' }); });
});

describe('webhook authenticity', () => {
  const now = 1_700_000_000_000; const ts = '1700000000'; const secret = 'webhook-secret';
  const signature = createHmac('sha256', secret).update(`id:abc123;request-id:req-1;ts:${ts};`).digest('hex');
  const webhook = (): WebhookInput => ({ headers: { 'x-request-id': 'req-1', 'x-signature': `ts=${ts},v1=${signature}` }, query: { 'data.id': 'ABC123' }, rawBody: Buffer.from('{}'), now });
  it('accepts an authenticated Mercado Pago request', () => expect(new MercadoPago({ MP_WEBHOOK_SECRET: secret }).verifyWebhook(webhook())).toBe(true));
  it.each(['missing', 'bad_signature', 'wrong_id', 'wrong_request', 'stale', 'future', 'missing_secret'])('rejects forged MP webhook: %s', kind => {
    const w = webhook();
    if (kind === 'missing') w.headers = {};
    if (kind === 'bad_signature') w.headers['x-signature'] = `ts=${ts},v1=${'0'.repeat(64)}`;
    if (kind === 'wrong_id') w.query['data.id'] = 'tampered';
    if (kind === 'wrong_request') w.headers['x-request-id'] = 'tampered';
    if (kind === 'stale') w.now = now + 301_000;
    if (kind === 'future') w.now = now - 301_000;
    expect(new MercadoPago(kind === 'missing_secret' ? {} : { MP_WEBHOOK_SECRET: secret }).verifyWebhook(w)).toBe(false);
  });
  it('accepts only the exact signed bytes from PagBank', () => {
    const rawBody = Buffer.from('{"id":"order-1","status":"PAID"}');
    const signature = createHash('sha256').update('seller-token-').update(rawBody).digest('hex');
    const w: WebhookInput = { headers: { 'x-authenticity-token': signature }, rawBody, query: {} };
    const p = new PagBank({}); expect(p.verifyWebhook(w, credentials)).toBe(true);
    expect(p.verifyWebhook({ ...w, rawBody: Buffer.from('{ "id":"order-1","status":"PAID"}') }, credentials)).toBe(false);
    expect(p.verifyWebhook(w, { accessToken: 'other-store-token' })).toBe(false);
    expect(p.verifyWebhook(w)).toBe(false);
  });
});

describe('manual adapters and HTTP boundaries', () => {
  it('keeps InfiniteTag server-side and routes directly to that store', async () => {
    const f = transport({ url: 'https://checkout.infinitepay.io/pay/1' }); const p = new InfinitePay(f);
    const c = await p.connect({ infiniteTag: '$minha-loja' }); expect(c).toEqual({ infiniteTag: 'minha-loja' });
    expect(await p.createCardCheckout(input, c)).toMatchObject({ manualConfirmation: true });
    expect(bodyOf(f)).toMatchObject({ handle: 'minha-loja', order_nsu: 'order-1', items: [{ price: 1299, quantity: 1, description: 'Pedido na loja' }] });
    expect(bodyOf(f)).not.toHaveProperty('webhook_url');
    expect((await p.getPaymentStatus('order-1')).paid).toBe(false); expect(p.verifyWebhook()).toBe(false);
  });
  it.each(['', 'a', '../other', 'tag@example.com'])('rejects invalid InfiniteTag %s', async infiniteTag => { await expect(new InfinitePay().connect({ infiniteTag })).rejects.toMatchObject({ code: 'INVALID_TAG' }); });
  it('uses the audited manual BR Code generator and never confirms automatically', async () => {
    const generate = vi.fn(async () => 'brcode-from-sql'); const p = new ManualPix(generate);
    expect(await p.createPixCharge(input)).toMatchObject({ brcode: 'brcode-from-sql', providerPaymentId: input.orderId, manualConfirmation: true });
    expect(generate).toHaveBeenCalledWith(input); expect((await p.getPaymentStatus('order-1')).paid).toBe(false);
    await expect(p.createCardCheckout()).rejects.toMatchObject({ code: 'CARD_UNAVAILABLE' });
  });
  it.each(['https://evil.com/pay', 'javascript:alert(1)', 'http://mercadopago.com.br/pay', 'https://mercadopago.com.br.evil.com/', 'https://user:pass@mercadopago.com.br/'])('rejects unsafe checkout destinations %s', url => { expect(() => checkoutUrl(url, ['mercadopago.com.br'])).toThrow(); });
  it('does not expose a provider error body containing credentials', async () => {
    const f = vi.fn(async () => new Response('secret-token', { status: 400 }));
    await expect(providerRequest(f, 'https://api.example')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: expect.not.stringContaining('secret-token') });
  });
  it('blocks HTTP redirects and sets a timeout', async () => {
    const f = transport({}); await providerRequest(f, 'https://api.example');
    expect(f).toHaveBeenCalledWith('https://api.example', expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
  });
  it.each(['mercadopago','pagbank','infinitepay'])('split remains disabled in %s', async name => {
    const f = transport({}); const adapter = name === 'mercadopago' ? new MercadoPago({}, f) : name === 'pagbank' ? new PagBank({}, f) : new InfinitePay(f);
    await expect(adapter.createCardCheckout({ ...input, applicationFee: 1 }, credentials)).rejects.toMatchObject({ code: 'SPLIT_DISABLED' }); expect(f).not.toHaveBeenCalled();
  });
});
