import { describe, expect, it, vi } from 'vitest';
import { PaymentService, assertConfirmation, paymentView } from '../service';
import { PaymentStore, PaymentRow } from '../store';
import { PaymentError, Provider } from '../types';
import { encryptionKey, seal, unseal, signedState, validState, sha256, RateLimiter } from '../security';

const env = { PAYMENTS_PUBLIC_URL: 'https://loja.example', PAYMENTS_ENCRYPTION_KEY: 'ab'.repeat(32), PAYMENTS_STATE_SECRET: 'state-secret-that-is-long-enough-for-production', MP_CLIENT_ID: 'mp-client', MP_CLIENT_SECRET: 'mp-secret', MP_WEBHOOK_SECRET: 'signature-secret', PAGBANK_CLIENT_ID: 'pb-client', PAGBANK_CLIENT_SECRET: 'pb-secret', PAGBANK_PLATFORM_TOKEN: 'platform-token' };
const row = (provider: Provider = 'mercadopago'): PaymentRow => ({ id: 'payment-1', order_id: 'order-1', tenant_id: 'store-1', provider, provider_payment_id: '123', method: 'pix', amount: 12.99, status: 'pending' });
const confirmation = { providerPaymentId: '123', orderId: 'order-1', amountCents: 1299, currency: 'BRL', paid: true, rawStatus: 'approved' };
function fixture(provider: Provider = 'mercadopago') {
  const secrets = new Map<string, string>();
  const account = seal({ accessToken: 'private-token', refreshToken: 'private-refresh', accountId: 'seller', expiresAt: Date.now() + 3600_000 }, encryptionKey(env.PAYMENTS_ENCRYPTION_KEY), `store-1:${provider}`);
  secrets.set(`store-1:${provider}`, account);
  let current: PaymentRow | null = row(provider); let claimed = false;
  const order = { id: 'order-1', tenant_id: 'store-1', total_amount: 12.99, customer_name: 'Ana Silva', customer_email: 'ana@example.com', tenants: { slug: 'minha-loja' }, staffRole: undefined };
  const query = (table: string) => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'orders' ? order : current, error: null }) }; return q; };
  const store = {
    db: { from: vi.fn(query) },
    membership: vi.fn(async (user: string, membership: string) => { if (user !== 'owner' || membership !== 'membership-1') throw new PaymentError('FORBIDDEN', 403); return { tenant_id: 'store-1' }; }),
    order: vi.fn(async (user: string) => { if (!['customer','owner'].includes(user)) throw new PaymentError('ORDER_NOT_FOUND', 404); return { ...order, staffRole: user === 'owner' ? 'OWNER' : undefined }; }),
    configure: vi.fn(async () => {}), accounts: vi.fn(async () => []),
    secret: vi.fn(async (op: string, tenant?: string, p?: string, key?: string, cipher?: string) => {
      const k = op.startsWith('state') ? key! : op.startsWith('webhook') ? `webhook:${key}` : `${tenant}:${p}`;
      if (op === 'get' || op === 'refresh_claim' || op === 'webhook_get') return secrets.get(k) || null;
      if (op === 'set' || op === 'state_put' || op === 'webhook_set') { secrets.set(k, cipher!); return null; }
      if (op === 'delete') { secrets.delete(k); return null; }
      if (op === 'state_take') { const result = secrets.get(k); secrets.delete(k); return result || null; }
      return null;
    }),
    payment: vi.fn(async () => current),
    reserve: vi.fn(async () => { const first = !claimed; claimed = true; return { payment: current!, claimed: first }; }),
    saveCharge: vi.fn(async (_id: string, charge: any) => { current = { ...current!, provider_payment_id: charge.providerPaymentId, brcode: charge.brcode, checkout_url: charge.checkoutUrl, status: charge.manualConfirmation ? 'awaiting_confirmation' : 'pending' }; }),
    confirm: vi.fn(async () => { current = { ...current!, status: 'paid' }; }),
    manualBrcode: vi.fn(async () => 'sql-brcode'),
  };
  const service = new PaymentService(store as unknown as PaymentStore, env);
  return { store, service, secrets, order, setPayment: (value: PaymentRow | null) => { current = value; } };
}

describe('confirmation, isolation and idempotency', () => {
  it.each([{ amountCents: 1298 }, { amountCents: 1300 }, { amountCents: NaN }, { amountCents: 1299.1 }, { orderId: 'other-order' }, { currency: 'USD' }])('rejects a confirmed payment with mismatched data %o', async patch => {
    const { service, store } = fixture(); vi.spyOn(service.adapters.mercadopago, 'getPaymentStatus').mockResolvedValue({ ...confirmation, ...patch });
    await expect(service.status('customer', 'email', 'order-1')).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' }); expect(store.confirm).not.toHaveBeenCalled();
  });
  it('always asks the provider before confirming, and accepts the exact server total', async () => {
    const { service, store } = fixture(); const get = vi.spyOn(service.adapters.mercadopago, 'getPaymentStatus').mockResolvedValue(confirmation);
    expect((await service.status('customer', '', 'order-1'))?.status).toBe('paid');
    expect(get).toHaveBeenCalledWith('123', expect.objectContaining({ accessToken: 'private-token' }), expect.objectContaining({ amountCents: 1299, orderId: 'order-1' }));
    expect(store.confirm).toHaveBeenCalledTimes(1);
    await service.status('customer', '', 'order-1'); expect(store.confirm).toHaveBeenCalledTimes(1);
  });
  it('coalesces concurrent polling and duplicate webhooks', async () => {
    const { service, store } = fixture(); vi.spyOn(service.adapters.mercadopago, 'getPaymentStatus').mockResolvedValue(confirmation);
    await Promise.all([service.status('customer', '', 'order-1'), service.status('customer', '', 'order-1')]);
    expect(store.confirm).toHaveBeenCalledTimes(1);
  });
  it('never marks paid for pending API status even when the webhook body says PAID', async () => {
    const { service, store } = fixture(); vi.spyOn(service.adapters.mercadopago, 'verifyWebhook').mockReturnValue(true);
    vi.spyOn(service.adapters.mercadopago, 'getPaymentStatus').mockResolvedValue({ ...confirmation, paid: false, rawStatus: 'pending' });
    await service.webhook('mercadopago', 'payment-1', { headers: {}, query: {}, rawBody: Buffer.from('{"status":"PAID","amount":12.99}') });
    expect(store.confirm).not.toHaveBeenCalled();
  });
  it('rejects a forged webhook before consulting or updating a payment', async () => {
    const { service, store } = fixture(); const get = vi.spyOn(service.adapters.mercadopago, 'getPaymentStatus');
    await expect(service.webhook('mercadopago', 'payment-1', { headers: {}, query: {}, rawBody: Buffer.from('{}') })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    expect(store.confirm).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });
  it.each(['infinitepay','manual_pix'] as const)('rejects unsigned webhook for %s', async provider => {
    const { service, store } = fixture(provider);
    await expect(service.webhook(provider, 'id', { headers: {}, query: {}, rawBody: Buffer.from('{}') })).rejects.toMatchObject({ code: 'UNSIGNED_WEBHOOK' }); expect(store.confirm).not.toHaveBeenCalled();
  });
  it('validates PagBank with the original signing token after an OAuth refresh, then confirms via the API', async () => {
    const { service, secrets, store } = fixture('pagbank');
    const rawBody = Buffer.from('{"id":"CHAR_actual","status":"PAID"}');
    const { createHash } = await import('node:crypto');
    secrets.set('webhook:payment-1', seal({ accessToken:'original-token' }, encryptionKey(env.PAYMENTS_ENCRYPTION_KEY), 'webhook:payment-1'));
    const get = vi.spyOn(service.adapters.pagbank, 'getPaymentStatus').mockResolvedValue({ ...confirmation, providerPaymentId:'CHAR_actual' });
    await service.webhook('pagbank','payment-1', { headers:{ 'x-authenticity-token':createHash('sha256').update('original-token-').update(rawBody).digest('hex') }, query:{}, rawBody });
    expect(get).toHaveBeenCalledWith('CHAR_actual',expect.objectContaining({ accessToken:'private-token' }),expect.any(Object));
    expect(store.confirm).toHaveBeenCalledTimes(1);
  });
  it('does not create a second charge when the same order is retried', async () => {
    const { service } = fixture(); const create = vi.spyOn(service.adapters.mercadopago, 'createPixCharge').mockResolvedValue({ providerPaymentId: '123', brcode: 'brcode', manualConfirmation: false });
    await service.create('customer', '', 'order-1', 'mercadopago', 'pix'); await service.create('customer', '', 'order-1', 'mercadopago', 'pix'); expect(create).toHaveBeenCalledTimes(1);
  });
  it('another store/customer cannot access or create an order payment', async () => {
    const { service, store } = fixture(); await expect(service.status('another-store-owner', '', 'order-1')).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    await expect(service.create('other-customer', '', 'order-1', 'mercadopago', 'pix')).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' }); expect(store.reserve).not.toHaveBeenCalled();
  });
  it('does not allow the customer to manually confirm', async () => {
    const { service, store, setPayment } = fixture('manual_pix'); setPayment({ ...row('manual_pix'), status: 'awaiting_confirmation' });
    await expect(service.manualConfirm('customer', 'order-1')).rejects.toMatchObject({ code: 'FORBIDDEN' }); expect(store.confirm).not.toHaveBeenCalled();
  });
  it('allows store staff to confirm only a manual provider', async () => {
    const f = fixture('manual_pix'); f.setPayment({ ...row('manual_pix'), status: 'awaiting_confirmation' });
    await f.service.manualConfirm('owner', 'order-1'); expect(f.store.confirm).toHaveBeenCalledWith('payment-1', null, 'owner');
    const mp = fixture(); await expect(mp.service.manualConfirm('owner', 'order-1')).rejects.toMatchObject({ code: 'MANUAL_CONFIRMATION_FORBIDDEN' });
  });
  it('does not return raw provider responses or credentials in the public projection', () => {
    const view = paymentView({ ...row(), raw_status: 'private-provider-response' }, true);
    expect(Object.keys(view!)).toEqual(['id','orderId','provider','method','amount','status','brcode','checkoutUrl','expiresAt','manualConfirmation','canConfirm']);
    expect(JSON.stringify(view)).not.toContain('private'); expect(view?.canConfirm).toBe(false);
  });
});

describe('OAuth state and encryption', () => {
  it('encrypts secrets with a tenant/provider binding and rejects modified ciphertext', () => {
    const key = encryptionKey(env.PAYMENTS_ENCRYPTION_KEY); const cipher = seal({ token: 'SECRET' }, key, 'store-1:mp');
    expect(cipher).not.toContain('SECRET'); expect(unseal(cipher, key, 'store-1:mp')).toEqual({ token: 'SECRET' });
    expect(() => unseal(cipher, key, 'store-2:mp')).toThrow();
    const parts = cipher.split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    expect(() => unseal(parts.join('.'), key, 'store-1:mp')).toThrow();
  });
  it('signs unpredictable single-use states and rejects forged signatures', () => {
    const a = signedState(env.PAYMENTS_STATE_SECRET); const b = signedState(env.PAYMENTS_STATE_SECRET);
    expect(a).not.toBe(b); expect(validState(a, env.PAYMENTS_STATE_SECRET)).toBe(true);
    expect(validState(a, 'other-secret')).toBe(false); expect(validState(a.slice(1), env.PAYMENTS_STATE_SECRET)).toBe(false);
  });
  it('binds OAuth to membership, provider and browser, uses PKCE, and rejects replay', async () => {
    const { service, store } = fixture(); const connect = vi.spyOn(service.adapters.mercadopago, 'connect').mockResolvedValue({ accessToken: 'fresh-secret', refreshToken: 'fresh-refresh', accountId: 'seller' });
    const url = new URL(await service.startConnect('owner', 'membership-1', 'mercadopago', 'browser-cookie'));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256'); expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    const state = url.searchParams.get('state')!;
    await service.finishConnect('mercadopago', state, 'auth-code', 'browser-cookie');
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ code: 'auth-code', verifier: expect.any(String) }));
    expect(store.configure).toHaveBeenLastCalledWith('owner', 'membership-1', 'mercadopago', expect.objectContaining({ status: 'connected' }));
    await expect(service.finishConnect('mercadopago', state, 'auth-code', 'browser-cookie')).rejects.toMatchObject({ code: 'STATE_ALREADY_USED' });
  });
  it.each(['cookie','provider','membership'])('rejects OAuth with wrong %s', async kind => {
    const { service, store } = fixture(); const connect = vi.spyOn(service.adapters.mercadopago, 'connect');
    const url = new URL(await service.startConnect('owner', 'membership-1', 'mercadopago', 'browser-cookie'));
    if (kind === 'membership') store.membership.mockRejectedValue(new PaymentError('FORBIDDEN',403));
    await expect(service.finishConnect(kind === 'provider' ? 'pagbank' : 'mercadopago', url.searchParams.get('state')!, 'code', kind === 'cookie' ? 'wrong-browser' : 'browser-cookie')).rejects.toBeInstanceOf(PaymentError); expect(connect).not.toHaveBeenCalled();
  });
  it('cannot start OAuth for a membership owned by another user', async () => {
    const { service, store } = fixture(); await expect(service.startConnect('attacker','membership-1','mercadopago','cookie')).rejects.toMatchObject({ code: 'FORBIDDEN' }); expect(store.secret).not.toHaveBeenCalled();
  });
  it('coalesces refreshes and persists rotated tokens encrypted', async () => {
    const { service, secrets } = fixture(); secrets.set('store-1:mercadopago', seal({ accessToken: 'old', refreshToken: 'refresh', expiresAt: 1, accountId: 'seller' }, encryptionKey(env.PAYMENTS_ENCRYPTION_KEY), 'store-1:mercadopago'));
    const refresh = vi.spyOn(service.adapters.mercadopago as any, 'refresh').mockResolvedValue({ accessToken: 'new', refreshToken: 'rotated', expiresAt: Date.now()+3600_000, accountId: 'seller' });
    const result = await Promise.all([service.credentials('store-1','mercadopago'),service.credentials('store-1','mercadopago')]);
    expect(refresh).toHaveBeenCalledTimes(1); expect(result[1].accessToken).toBe('new');
    expect(secrets.get('store-1:mercadopago')).not.toContain('rotated');
  });
  it('erases local credentials on disconnect even if provider revocation is unavailable', async () => {
    const { service, store, secrets } = fixture();
    const query: any = { select: () => query, eq: () => query, in: () => query, limit: async () => ({ data:[],error:null }) };
    store.db.from.mockReturnValue(query);
    vi.spyOn(service.adapters.mercadopago,'disconnect').mockRejectedValue(new PaymentError('PROVIDER_UNAVAILABLE',502));
    await expect(service.configure('owner','membership-1','mercadopago',{ action:'disconnect' })).rejects.toMatchObject({ code:'PROVIDER_UNAVAILABLE' });
    expect(secrets.has('store-1:mercadopago')).toBe(false);
    expect(store.configure).toHaveBeenCalledWith('owner','membership-1','mercadopago',{ status:'disconnected' });
  });
  it('shows unavailable when platform credentials are absent', () => {
    const { store } = fixture(); const s = new PaymentService(store as unknown as PaymentStore, { PAYMENTS_PUBLIC_URL: 'https://loja.example' });
    expect(s.available('mercadopago')).toBe(false); expect(s.available('pagbank')).toBe(false); expect(s.available('infinitepay')).toBe(false); expect(s.available('manual_pix')).toBe(true);
  });
  it('fails closed on invalid or insecure production origin', () => {
    const { store } = fixture(); expect(new PaymentService(store as unknown as PaymentStore, { ...env, NODE_ENV:'production', PAYMENTS_PUBLIC_URL:'http://loja.example' }).available('mercadopago')).toBe(false);
  });
  it('bounds rate-limit memory and rejects requests above the limit', () => {
    const limiter = new RateLimiter(2,100,2); expect(limiter.allow('a',0)).toBe(true); expect(limiter.allow('a',1)).toBe(true); expect(limiter.allow('a',2)).toBe(false);
    expect(limiter.allow('b',2)).toBe(true); expect(limiter.allow('c',2)).toBe(false); expect(limiter.allow('c',101)).toBe(true);
  });
});
