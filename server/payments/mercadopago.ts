import { createHash, createHmac } from 'node:crypto';
import { assertNoSplit, ChargeInput, Credentials, PaymentProvider, WebhookInput, PaymentError } from './types';
import { equalHex } from './security';
import { checkoutUrl, jsonHeaders, providerRequest, Transport } from './http';
export class MercadoPago implements PaymentProvider {
  constructor(private env: NodeJS.ProcessEnv, private fetcher: Transport = fetch) {}
  private request(path: string, credentials: Credentials, body?: unknown, key?: string, method?: string) {
    return providerRequest(this.fetcher, 'https://api.mercadopago.com' + path, {
      method: method || (body ? 'POST' : 'GET'), headers: jsonHeaders(credentials.accessToken, key ? { 'X-Idempotency-Key': key } : {}), ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  async connect(input: { code?: string; verifier?: string; redirectUri: string }): Promise<Credentials> {
    return this.token({ grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri, code_verifier: input.verifier });
  }
  async refresh(c: Credentials): Promise<Credentials> { return this.token({ grant_type: 'refresh_token', refresh_token: c.refreshToken }); }
  private async token(data: object): Promise<Credentials> {
    const r = await this.request('/oauth/token', {}, { client_id: this.env.MP_CLIENT_ID, client_secret: this.env.MP_CLIENT_SECRET, test_token: this.env.MP_TEST_TOKEN === 'true', ...data });
    if (!r.access_token || !r.refresh_token || !r.user_id || !Number.isFinite(r.expires_in)) throw new PaymentError('INVALID_OAUTH_RESPONSE', 502);
    return { accessToken: r.access_token, refreshToken: r.refresh_token, accountId: String(r.user_id), expiresAt: Date.now() + r.expires_in * 1000 };
  }
  async disconnect(c: Credentials) {
    if (c.accountId) await providerRequest(this.fetcher, `https://api.mercadolibre.com/users/${encodeURIComponent(c.accountId)}/applications/${encodeURIComponent(this.env.MP_CLIENT_ID!)}`, { method: 'DELETE', headers: jsonHeaders(c.accessToken) });
  }
  async createPixCharge(i: ChargeInput, c: Credentials) {
    assertNoSplit(i);
    const r = await this.request('/v1/payments', c, { transaction_amount: i.amountCents / 100, description: `Pedido ${i.orderId}`, payment_method_id: 'pix', external_reference: i.orderId,
      payer: { email: i.email }, date_of_expiration: new Date(Date.now() + 35 * 60_000).toISOString(), notification_url: i.webhookUrl }, i.idempotencyKey);
    const brcode = r.point_of_interaction?.transaction_data?.qr_code;
    if (!r.id || !brcode || !r.date_of_expiration) throw new PaymentError('INVALID_CHARGE_RESPONSE', 502);
    return { providerPaymentId: String(r.id), brcode, expiresAt: r.date_of_expiration, manualConfirmation: false };
  }
  async createCardCheckout(i: ChargeInput, c: Credentials) {
    assertNoSplit(i);
    const r = await this.request('/checkout/preferences', c, { external_reference: i.orderId,
      items: [{ id: i.orderId, title: 'Pedido na loja', quantity: 1, currency_id: 'BRL', unit_price: i.amountCents / 100 }],
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }, { id: 'atm' }] },
      back_urls: { success: i.returnUrl, failure: i.returnUrl, pending: i.returnUrl }, notification_url: i.webhookUrl }, i.idempotencyKey);
    if (!r.id) throw new PaymentError('INVALID_CHARGE_RESPONSE', 502);
    return { providerPaymentId: `preference:${r.id}`, checkoutUrl: checkoutUrl(this.env.MP_TEST_TOKEN === 'true' ? (r.sandbox_init_point || r.init_point) : r.init_point, ['mercadopago.com.br', 'mercadopago.com']), manualConfirmation: false };
  }
  async getPaymentStatus(id: string, c: Credentials, input?: ChargeInput) {
    // Preferences are not payments. Search by the SERVER's order reference, then fetch the payment.
    if (id.startsWith('preference:')) {
      if (!input) throw new PaymentError('ORDER_REQUIRED');
      const r = await this.request(`/v1/payments/search?external_reference=${encodeURIComponent(input.orderId)}&sort=date_created&criteria=desc`, c);
      const payment = r.results?.find((p: any) => p.status === 'approved') || r.results?.[0];
      if (!payment) return { providerPaymentId: id, orderId: input.orderId, amountCents: input.amountCents, currency: 'BRL', paid: false, rawStatus: 'pending' };
      id = String(payment.id);
    }
    const r = await this.request(`/v1/payments/${encodeURIComponent(id)}`, c);
    return { providerPaymentId: String(r.id), orderId: String(r.external_reference), amountCents: Math.round(Number(r.transaction_amount) * 100), currency: r.currency_id,
      paid: r.status === 'approved' && String(r.collector_id) === c.accountId && Number(r.transaction_amount_refunded || 0) === 0, rawStatus: String(r.status) };
  }
  verifyWebhook(i: WebhookInput) {
    const secret = this.env.MP_WEBHOOK_SECRET;
    const parts = (i.headers['x-signature'] || '').split(',').map(v => v.trim().split('='));
    const ts = parts.find(p => p[0] === 'ts')?.[1]; const signature = parts.find(p => p[0] === 'v1')?.[1];
    const id = i.query['data.id']; const requestId = i.headers['x-request-id'];
    if (!secret || typeof id !== 'string' || !requestId || !ts || !/^\d+$/.test(ts)) return false;
    const timestamp = Number(ts) * (ts.length <= 10 ? 1000 : 1);
    if (Math.abs((i.now ?? Date.now()) - timestamp) > 5 * 60_000) return false;
    return equalHex(signature, createHmac('sha256', secret).update(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex'));
  }
}
export function pkceChallenge(verifier: string) { return createHash('sha256').update(verifier).digest('base64url'); }
