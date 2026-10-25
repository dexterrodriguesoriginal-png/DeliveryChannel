import { createHash } from 'node:crypto';
import { assertNoSplit, ChargeInput, Credentials, PaymentProvider, WebhookInput, PaymentError } from './types';
import { equalHex } from './security';
import { checkoutUrl, jsonHeaders, providerRequest, Transport } from './http';
export class PagBank implements PaymentProvider {
  constructor(private env: NodeJS.ProcessEnv, private fetcher: Transport = fetch) {}
  get base() { return this.env.PAGBANK_SANDBOX === 'true' ? 'https://sandbox.api.pagseguro.com' : 'https://api.pagseguro.com'; }
  private request(path: string, c: Credentials, body?: unknown, key?: string, oauth = false) {
    return providerRequest(this.fetcher, this.base + path, { method: body ? 'POST' : 'GET',
      headers: jsonHeaders(oauth ? this.env.PAGBANK_PLATFORM_TOKEN : c.accessToken, { ...(key ? { 'x-idempotency-key': key } : {}), ...(oauth ? { X_CLIENT_ID: this.env.PAGBANK_CLIENT_ID!, X_CLIENT_SECRET: this.env.PAGBANK_CLIENT_SECRET! } : {}) }),
      ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async connect(i: { code?: string; redirectUri: string }): Promise<Credentials> {
    return this.token('/oauth2/token', { grant_type: 'authorization_code', code: i.code, redirect_uri: i.redirectUri });
  }
  async refresh(c: Credentials) { return this.token('/oauth2/refresh', { grant_type: 'refresh_token', refresh_token: c.refreshToken }); }
  private async token(path: string, data: object): Promise<Credentials> {
    const r = await this.request(path, {}, data, undefined, true);
    if (!r.access_token || !r.refresh_token || !Number.isFinite(r.expires_in)) throw new PaymentError('INVALID_OAUTH_RESPONSE', 502);
    return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: Date.now() + r.expires_in * 1000, accountId: r.account_id };
  }
  async disconnect(c: Credentials) { await this.request('/oauth2/revoke', {}, { token: c.accessToken, token_type_hint: 'access_token' }, undefined, true); }
  async createPixCharge(i: ChargeInput, c: Credentials) {
    assertNoSplit(i);
    if (i.webhookUrl.length > 100) throw new PaymentError('WEBHOOK_URL_TOO_LONG', 503, 'O endereço de pagamentos precisa ser configurado pela plataforma.');
    if (!i.taxId || !/^\d{11}(\d{3})?$/.test(i.taxId)) throw new PaymentError('TAX_ID_REQUIRED', 400, 'Informe o CPF ou CNPJ do pagador para gerar o PIX.');
    const r = await this.request('/orders', c, { reference_id: i.orderId, customer: { name: i.name, email: i.email, tax_id: i.taxId },
      items: [{ name: 'Pedido na loja', quantity: 1, unit_amount: i.amountCents }], qr_codes: [{ amount: { value: i.amountCents }, expiration_date: new Date(Date.now() + 30 * 60_000).toISOString() }], notification_urls: [i.webhookUrl] }, i.idempotencyKey);
    if (!r.id || !r.qr_codes?.[0]?.text || !r.qr_codes[0].expiration_date) throw new PaymentError('INVALID_CHARGE_RESPONSE', 502);
    return { providerPaymentId: r.id, brcode: r.qr_codes[0].text, expiresAt: r.qr_codes[0].expiration_date, manualConfirmation: false };
  }
  async createCardCheckout(i: ChargeInput, c: Credentials) {
    assertNoSplit(i);
    if (i.webhookUrl.length > 100) throw new PaymentError('WEBHOOK_URL_TOO_LONG', 503, 'O endereço de pagamentos precisa ser configurado pela plataforma.');
    const r = await this.request('/checkouts', c, { reference_id: i.orderId, customer_modifiable: true,
      items: [{ reference_id: i.orderId, name: 'Pedido na loja', quantity: 1, unit_amount: i.amountCents }], payment_methods: [{ type: 'CREDIT_CARD' }],
      redirect_url: i.returnUrl, return_url: i.returnUrl, notification_urls: [i.webhookUrl], payment_notification_urls: [i.webhookUrl] }, i.idempotencyKey);
    if (!r.id) throw new PaymentError('INVALID_CHARGE_RESPONSE', 502);
    return { providerPaymentId: r.id, checkoutUrl: checkoutUrl(r.links?.find((l: any) => l.rel === 'PAY')?.href, ['pagseguro.uol.com.br', 'pagbank.com.br']), manualConfirmation: false };
  }
  async getPaymentStatus(id: string, c: Credentials) {
    const path = id.startsWith('CHEC_') ? '/checkouts/' : id.startsWith('ORDE_') ? '/orders/' : '/charges/';
    const r = await this.request(path + encodeURIComponent(id), c);
    // A paid checkout status alone isn't proof: require an associated PAID charge with its amount/currency.
    const charges = path === '/charges/' ? [r] : [...(r.charges || []), ...(r.orders || []).flatMap((o: any) => o.charges || []), ...(r.payments || []).flatMap((p: any) => p.charges || (p.id?.startsWith('CHAR_') ? [p] : []))];
    const paid = charges.filter((p: any) => p.status === 'PAID' && Number(p.amount?.summary?.refunded || 0) === 0);
    const p = paid[0] || charges[0];
    return { providerPaymentId: String(p?.id || r.id), orderId: String(r.reference_id), amountCents: Number(p?.amount?.value || 0), currency: p?.amount?.currency || '', paid: paid.length === 1, rawStatus: String(p?.status || r.status || 'WAITING') };
  }
  verifyWebhook(i: WebhookInput, c?: Credentials) {
    // PagBank signs SHA256(token + '-' + the unmodified HTTP body), not an HMAC.
    const token = c?.accessToken;
    return !!token && equalHex(i.headers['x-authenticity-token'], createHash('sha256').update(token + '-').update(i.rawBody).digest('hex'));
  }
}
