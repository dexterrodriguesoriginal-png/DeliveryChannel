import { paymentLog } from './privacy';
import { resolveServerPublicConfig } from '../config/publicConfig';
import { randomBytes } from 'node:crypto';
import { MercadoPago, pkceChallenge } from './mercadopago';
import { PagBank } from './pagbank';
import { InfinitePay } from './infinitepay';
import { ManualPix } from './manualPix';
import { ChargeInput, Confirmation, Credentials, Method, PaymentError, PaymentProvider, Provider, WebhookInput } from './types';
import { PaymentRow, PaymentStore } from './store';
import { encryptionKey, seal, sha256, signedState, unseal, validState } from './security';
import type { Transport } from './http';

interface OAuthState { userId: string; membership: string; provider: Provider; verifier: string; cookieHash: string; version: number; }
export const canManage = (role?: string) => role === 'OWNER' || role === 'MANAGER';
export function assertConfirmation(p: PaymentRow, c: Confirmation) {
  if (!c.paid) return;
  if (c.orderId !== p.order_id || c.currency !== 'BRL' || !Number.isSafeInteger(c.amountCents) || c.amountCents !== Math.round(Number(p.amount) * 100)) {
    throw new PaymentError('PAYMENT_MISMATCH', 409, 'O pagamento recebido não corresponde ao valor do pedido. Fale com a loja.');
  }
  if (!c.providerPaymentId) throw new PaymentError('PAYMENT_MISMATCH', 409);
}
export function paymentView(p: PaymentRow | null, staff = false) {
  if (!p) return null;
  return { id: p.id, orderId: p.order_id, provider: p.provider, method: p.method, amount: Number(p.amount), status: p.status,
    brcode: p.brcode || null, checkoutUrl: p.checkout_url || null, expiresAt: p.expires_at || null,
    manualConfirmation: p.provider === 'manual_pix' || p.provider === 'infinitepay',
    canConfirm: staff && p.status === 'awaiting_confirmation' && ['manual_pix', 'infinitepay'].includes(p.provider) };
}
export class PaymentService {
  readonly adapters: Record<Provider, PaymentProvider>;
  private refreshes = new Map<string, Promise<Credentials>>();
  private confirmations = new Map<string, { at: number; pending: Promise<void> }>();
  constructor(readonly store: PaymentStore, readonly env: NodeJS.ProcessEnv, fetcher?: Transport) {
    this.adapters = { mercadopago: new MercadoPago(env, fetcher), pagbank: new PagBank(env, fetcher), infinitepay: new InfinitePay(fetcher), manual_pix: new ManualPix(i => store.manualBrcode(i.orderId)) };
  }
  get origin() {
    try {
      const url = new URL(resolveServerPublicConfig(this.env).PAYMENTS_PUBLIC_URL);
      if (url.protocol === 'https:' || (this.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) return url.origin;
    } catch { /* unavailable */ }
    throw new PaymentError('PAYMENTS_UNAVAILABLE', 503, 'Pagamentos online em breve.');
  }
  available(p: Provider): boolean {
    try {
      this.origin;
      if (p === 'manual_pix') return true;
      encryptionKey(this.env.PAYMENTS_ENCRYPTION_KEY);
      if (p === 'infinitepay') return true;
      if (!this.env.PAYMENTS_STATE_SECRET || this.env.PAYMENTS_STATE_SECRET.length < 32) return false;
      return p === 'mercadopago' ? !!(this.env.MP_CLIENT_ID && this.env.MP_CLIENT_SECRET && this.env.MP_WEBHOOK_SECRET)
        : !!(this.env.PAGBANK_CLIENT_ID && this.env.PAGBANK_CLIENT_SECRET && this.env.PAGBANK_PLATFORM_TOKEN);
    } catch { return false; }
  }
  async credentials(tenant: string, provider: Provider): Promise<Credentials> {
    if (provider === 'manual_pix') return {};
    const context = `${tenant}:${provider}`;
    const cipher = await this.store.secret('get', tenant, provider);
    if (!cipher) throw new PaymentError('ACCOUNT_NOT_CONNECTED', 409, 'Conecte a conta da loja para receber pagamentos.');
    const credentials = unseal<Credentials>(cipher, encryptionKey(this.env.PAYMENTS_ENCRYPTION_KEY), context);
    if (!credentials.expiresAt || credentials.expiresAt > Date.now() + 120_000) return credentials;
    let refresh = this.refreshes.get(context);
    if (!refresh) {
      refresh = (async () => {
        const claimed = await this.store.secret('refresh_claim', tenant, provider);
        if (!claimed) throw new PaymentError('REFRESH_IN_PROGRESS', 503, 'A conexão está sendo atualizada. Tente novamente em instantes.');
        try {
          const current = unseal<Credentials>(claimed, encryptionKey(this.env.PAYMENTS_ENCRYPTION_KEY), context);
          if ((current.expiresAt || 0) > Date.now() + 120_000) { await this.store.secret('refresh_release', tenant, provider, claimed); return current; }
          if (!current.refreshToken || !['mercadopago','pagbank'].includes(provider)) throw new PaymentError('RECONNECT_REQUIRED', 409, 'Conecte novamente sua conta.');
          const renewed = await (this.adapters[provider] as MercadoPago | PagBank).refresh(current);
          const next = { ...current, ...renewed };
          await this.saveCredentials(tenant, provider, next, claimed);
          return next;
        } catch (e) { await this.store.secret('refresh_release', tenant, provider, claimed); throw e; }
      })();
      this.refreshes.set(context, refresh);
      void refresh.finally(() => this.refreshes.delete(context)).catch(() => {});
    }
    return refresh;
  }
  private saveCredentials(tenant: string, provider: Provider, c: Credentials, expectedCipher: string) {
    return this.store.secret('set', tenant, provider, expectedCipher, seal(c, encryptionKey(this.env.PAYMENTS_ENCRYPTION_KEY), `${tenant}:${provider}`));
  }
  async startConnect(userId: string, membership: string, provider: Provider, cookie: string) {
    const member = await this.store.membership(userId, membership);
    if (!this.available(provider) || !['mercadopago','pagbank'].includes(provider)) throw new PaymentError('PAYMENTS_UNAVAILABLE', 503, 'Este provedor estará disponível em breve.');
    await this.store.configure(userId, membership, provider, { status:'disconnected' });
    const version = (await this.store.accounts(member.tenant_id)).find(a => a.provider === provider)?.connection_version ?? 0;
    const state = signedState(this.env.PAYMENTS_STATE_SECRET!);
    const verifier = randomBytes(48).toString('base64url');
    await this.store.secret('state_put', member.tenant_id, provider, sha256(state), seal({ userId, membership, provider, verifier, cookieHash: sha256(cookie), version }, encryptionKey(this.env.PAYMENTS_ENCRYPTION_KEY), state));
    const uri = `${this.origin}/api/payments/oauth/${provider}/callback`;
    const url = new URL(provider === 'mercadopago' ? 'https://auth.mercadopago.com.br/authorization' : this.env.PAGBANK_SANDBOX === 'true' ? 'https://connect.sandbox.pagbank.com.br/oauth2/authorize' : 'https://connect.pagbank.com.br/oauth2/authorize');
    url.search = new URLSearchParams({ client_id: (provider === 'mercadopago' ? this.env.MP_CLIENT_ID : this.env.PAGBANK_CLIENT_ID)!, response_type: 'code', redirect_uri: uri, state }).toString();
    if (provider === 'mercadopago') {
      url.searchParams.set('platform_id', 'mp'); url.searchParams.set('code_challenge', pkceChallenge(verifier)); url.searchParams.set('code_challenge_method', 'S256');
    } else url.searchParams.set('scope', 'payments.read payments.create checkout.create checkout.view accounts.read');
    return url.href;
  }
  async finishConnect(provider: Provider, state: string, code: string, cookie: string) {
    if (!this.available(provider) || !validState(state, this.env.PAYMENTS_STATE_SECRET!) || !cookie || !code || code.length > 2048) throw new PaymentError('INVALID_STATE', 403, 'Conexão expirada. Inicie novamente.');
    const cipher = await this.store.secret('state_take', undefined, undefined, sha256(state));
    if (!cipher) throw new PaymentError('STATE_ALREADY_USED', 403, 'Conexão expirada. Inicie novamente.');
    const payload = unseal<OAuthState>(cipher, encryptionKey(this.env.PAYMENTS_ENCRYPTION_KEY), state);
    if (payload.provider !== provider || payload.cookieHash !== sha256(cookie)) throw new PaymentError('INVALID_STATE', 403);
    const membership = await this.store.membership(payload.userId, payload.membership);
    const c = await this.adapters[provider].connect({ code, verifier: payload.verifier, redirectUri: `${this.origin}/api/payments/oauth/${provider}/callback` });
    await this.store.completeConnection(payload.userId, payload.membership, provider, seal(c, encryptionKey(this.env.PAYMENTS_ENCRYPTION_KEY), `${membership.tenant_id}:${provider}`), payload.version);
  }
  async configure(userId: string, membershipId: string, provider: Provider, body: Record<string, unknown>) {
    const membership = await this.store.membership(userId, membershipId);
    if (body.action === 'disconnect') {
      // The SQL status trigger atomically erases credentials, webhook tokens and pending OAuth states.
      const cipher = provider === 'manual_pix' ? null : await this.store.secret('get', membership.tenant_id, provider);
      await this.store.configure(userId, membershipId, provider, { status:'disconnected' });
      if (cipher) {
        try { await this.adapters[provider].disconnect(unseal<Credentials>(cipher, encryptionKey(this.env.PAYMENTS_ENCRYPTION_KEY), `${membership.tenant_id}:${provider}`)); }
        catch { paymentLog('revocation_failed'); } // Local deletion is already committed; no raw error or token is logged.
      }
      return;
    }
    if (!this.available(provider)) throw new PaymentError('PAYMENTS_UNAVAILABLE', 503, 'Este provedor estará disponível em breve.');
    if (body.action === 'connect') {
      let credentials: Credentials | null = null;
      if (provider === 'infinitepay') credentials = await this.adapters.infinitepay.connect({ infiniteTag: String(body.infiniteTag || ''), redirectUri:'' });
      else if (provider === 'manual_pix') {
        const { data, error } = await this.store.db.from('tenant_payment_settings').select('pix_enabled').eq('tenant_id', membership.tenant_id).maybeSingle();
        if (error || !data?.pix_enabled) throw new PaymentError('PIX_SETTINGS_REQUIRED',409,'Cadastre e ative a chave PIX manual antes de conectar.');
      } else throw new PaymentError('USE_OAUTH');
      await this.store.configure(userId, membershipId, provider, { status:'disconnected' });
      const version = (await this.store.accounts(membership.tenant_id)).find(a => a.provider === provider)?.connection_version ?? 0;
      await this.store.completeConnection(userId, membershipId, provider, credentials ? seal(credentials, encryptionKey(this.env.PAYMENTS_ENCRYPTION_KEY), `${membership.tenant_id}:${provider}`) : null, version);
      return;
    }
    const accounts = await this.store.accounts(membership.tenant_id);
    if (!accounts.some(a => a.provider === provider && a.status === 'connected')) throw new PaymentError('ACCOUNT_NOT_CONNECTED', 409);
    const changes: Record<string, unknown> = {};
    for (const field of ['is_primary','accepts_pix','accepts_card']) if (typeof body[field] === 'boolean') changes[field] = body[field];
    if (provider === 'manual_pix') changes.accepts_card = false;
    if (typeof body.account_label === 'string') changes.account_label = body.account_label.trim().slice(0,80);
    await this.store.configure(userId, membershipId, provider, changes);
  }
  private input(order: any, payment: PaymentRow, email: string, taxId?: string): ChargeInput {
    const slug = order.tenants?.slug;
    return { orderId: order.id, amountCents: Math.round(Number(order.total_amount) * 100), method: payment.method,
      idempotencyKey: payment.id, email: payment.method === 'pix' && ['mercadopago','pagbank'].includes(payment.provider) ? order.customer_email || email : '',
      name: payment.method === 'pix' && payment.provider === 'pagbank' ? order.customer_name : '',
      taxId: payment.method === 'pix' && payment.provider === 'pagbank' ? taxId : undefined,
      webhookUrl: `${this.origin}/api/payments/webhooks/${payment.provider}/${payment.id}`,
      returnUrl: `${this.origin}/app/${encodeURIComponent(slug)}` };
  }
  async create(userId: string, email: string, orderId: string, provider: Provider, method: Method, taxId?: string) {
    const order = await this.store.order(userId, orderId, method === 'pix' && ['mercadopago','pagbank'].includes(provider));
    if (!this.available(provider)) throw new PaymentError('PAYMENTS_UNAVAILABLE', 503);
    if (provider === 'pagbank' && method === 'pix' && (!taxId || !/^\d{11}(\d{3})?$/.test(taxId))) throw new PaymentError('TAX_ID_REQUIRED', 400, 'Informe o CPF ou CNPJ do pagador para gerar o PIX.');
    const { payment, claimed } = await this.store.reserve(orderId, userId, provider, method);
    if (payment.anonymized_at || !payment.tenant_id || !payment.order_id) throw new PaymentError('PAYMENT_UNAVAILABLE',409);
    if (!claimed) return paymentView(payment, canManage(order.staffRole));
    const input = this.input(order, payment, email, taxId);
    if (!input.email && method === 'pix' && provider === 'mercadopago') throw new PaymentError('EMAIL_REQUIRED', 400, 'Cadastre um e-mail para gerar o pagamento.');
    const adapter = this.adapters[provider];
    const c = await this.credentials(payment.tenant_id, provider);
    if (provider === 'pagbank') await this.store.secret('webhook_set', undefined, undefined, payment.id, seal({ accessToken: c.accessToken }, encryptionKey(this.env.PAYMENTS_ENCRYPTION_KEY), `webhook:${payment.id}`));
    const charge = await (method === 'pix' ? adapter.createPixCharge(input, c) : adapter.createCardCheckout(input, c));
    await this.store.saveCharge(payment.id, charge);
    return paymentView(await this.store.payment(orderId), canManage(order.staffRole));
  }
  async refresh(p: PaymentRow, order: any, email: string, paymentHint?: string, webhook = false) {
    if (p.anonymized_at || !p.order_id || !p.tenant_id || p.status !== 'pending' || !p.provider_payment_id || ['manual_pix','infinitepay'].includes(p.provider)) return;
    // Coalesce client polling + webhook retries and cap memory. SQL makes confirmation idempotent.
    const confirmationKey = p.id + (webhook ? ':webhook:' + (paymentHint || '') : '');
    const previous = this.confirmations.get(confirmationKey);
    if (previous && Date.now() - previous.at < 4000) return previous.pending;
    for (const [key, entry] of this.confirmations) if (Date.now() - entry.at > 30_000) this.confirmations.delete(key);
    if (this.confirmations.size >= 10_000) throw new PaymentError('RATE_LIMITED', 429);
    const tenantId = p.tenant_id;
    const pending = (async () => {
      const c = await this.credentials(tenantId, p.provider);
      const confirmation = await this.adapters[p.provider].getPaymentStatus(paymentHint || p.provider_payment_id!, c, this.input(order, p, email));
      assertConfirmation(p, confirmation);
      if (confirmation.paid) await this.store.confirm(p.id, confirmation);
    })();
    this.confirmations.set(confirmationKey, { at: Date.now(), pending });
    try { await pending; } catch(e) { this.confirmations.delete(confirmationKey); throw e; }
  }
  async status(userId: string, email: string, orderId: string) {
    const order = await this.store.order(userId, orderId);
    const p = await this.store.payment(orderId);
    if (p && (order.status === 'CANCELLED' || order.payment_status === 'REFUNDED')) return { ...paymentView(p, false)!, status: order.status === 'CANCELLED' ? 'cancelled' : 'refunded', brcode: null, checkoutUrl: null };
    if (p) await this.refresh(p, order, email);
    return paymentView(p ? await this.store.payment(orderId) : null, canManage(order.staffRole));
  }
  async manualConfirm(userId: string, orderId: string) {
    const order = await this.store.order(userId, orderId);
    // Manual confirmation marks money as received: OWNER/MANAGER only (never CASHIER or customer).
    if (!canManage(order.staffRole)) throw new PaymentError('FORBIDDEN', 403);
    const payment = await this.store.payment(orderId);
    if (!payment || !['manual_pix','infinitepay'].includes(payment.provider)) throw new PaymentError('MANUAL_CONFIRMATION_FORBIDDEN', 403);
    await this.store.confirm(payment.id, null, userId);
  }
  async webhook(provider: Provider, id: string, input: WebhookInput) {
    if (!['mercadopago','pagbank'].includes(provider)) throw new PaymentError('UNSIGNED_WEBHOOK', 401);
    if (provider === 'mercadopago' && !this.adapters.mercadopago.verifyWebhook(input)) throw new PaymentError('INVALID_SIGNATURE', 401);
    const { data: payment, error } = await this.store.db.from('order_payments').select('*').eq('id', id).eq('provider', provider).maybeSingle();
    if (error || !payment || payment.anonymized_at || !payment.order_id || !payment.tenant_id) throw new PaymentError('INVALID_WEBHOOK', 401);
    let signingCredentials: Credentials | undefined;
    if (provider === 'pagbank') {
      const cipher = await this.store.secret('webhook_get', undefined, undefined, payment.id);
      if (!cipher) throw new PaymentError('INVALID_SIGNATURE', 401);
      signingCredentials = unseal<Credentials>(cipher, encryptionKey(this.env.PAYMENTS_ENCRYPTION_KEY), `webhook:${payment.id}`);
    }
    if (!this.adapters[provider].verifyWebhook(input, signingCredentials)) throw new PaymentError('INVALID_SIGNATURE', 401);
    const { data: order } = await this.store.db.from('orders').select('id,tenant_id,total_amount,status,payment_status,tenants!inner(slug,status)').eq('id', payment.order_id).eq('tenant_id', payment.tenant_id).maybeSingle();
    if (!order) throw new PaymentError('INVALID_WEBHOOK', 401);
    // Signed notification IDs can locate the resource; only the API response proves its owner, reference and value.
    let hint: string | undefined;
    if (provider === 'mercadopago' && typeof input.query['data.id'] === 'string') hint = input.query['data.id'];
    if (provider === 'pagbank') {
      try { const body = JSON.parse(input.rawBody.toString('utf8')); if (typeof body.id === 'string' && /^(CHAR|ORDE)_[a-zA-Z0-9-]+$/.test(body.id)) hint = body.id; } catch { throw new PaymentError('INVALID_WEBHOOK', 401); }
    }
    await this.refresh(payment, order, '', hint, true);
  }
}
