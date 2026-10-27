import { chargeRecord, confirmationRecord } from './privacy';
import { PaymentError, Confirmation } from './types';
import type { PaymentService } from './service';

/** Row of public.tab_pix_charges as returned by the service-role RPCs (lease and creator are stripped in SQL). */
export interface TabChargeRow {
  id: string; tenant_id: string; tab_id: string; provider: 'mercadopago'; provider_payment_id?: string | null;
  amount_cents: number; status: 'creating' | 'pending' | 'paid' | 'expired' | 'cancelled' | 'failed';
  raw_status?: string | null; brcode?: string | null; expires_at?: string | null; paid_at?: string | null;
  needs_review: boolean; review_reason?: string | null;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TERMINAL = new Set(['rejected', 'cancelled', 'canceled', 'declined', 'expired']);
export const tabReference = (tabId: string) => `tab:${tabId}`;

/** The browser only ever sees this projection: no tenant, no provider ids, and the code only while it is payable. */
export function tabPixView(c: TabChargeRow | null, tabStatus?: string) {
  if (!c) return null;
  const payable = c.status === 'pending' && (!c.expires_at || Date.parse(c.expires_at) > Date.now());
  return { id: c.id, tabId: c.tab_id, amountCents: c.amount_cents, status: c.status,
    brcode: payable ? c.brcode || null : null, expiresAt: c.expires_at || null,
    needsReview: c.needs_review, reviewReason: c.needs_review ? c.review_reason || null : null,
    tabClosed: tabStatus ? tabStatus === 'CLOSED' : c.status === 'paid' && !c.needs_review };
}

/** A payment is only accepted when the provider API itself says so and every field matches the server-side charge. */
export function assertTabConfirmation(c: TabChargeRow, k: Confirmation) {
  if (!k.paid) return;
  if (!c.provider_payment_id || k.providerPaymentId !== c.provider_payment_id || k.orderId !== tabReference(c.tab_id)
      || k.currency !== 'BRL' || !Number.isSafeInteger(k.amountCents) || k.amountCents !== c.amount_cents) {
    throw new PaymentError('PAYMENT_MISMATCH', 409, 'O pagamento recebido não corresponde à cobrança da conta. Confira no Mercado Pago.');
  }
}

export class TabPixService {
  private confirmations = new Map<string, { at: number; pending: Promise<void> }>();
  constructor(private readonly payments: PaymentService) {}
  private get store() { return this.payments.store; }
  private staff<T>(op: Promise<T>): Promise<T> {
    // "Acesso negado." is the SQL staff check; give it a tab-specific message instead of the settings one.
    return op.catch(e => { if (e instanceof PaymentError && e.code === 'FORBIDDEN') throw new PaymentError('FORBIDDEN', 403, 'Você não tem permissão para cobrar esta conta.'); throw e; });
  }

  async create(userId: string, email: string, tabId: string) {
    if (!UUID.test(tabId)) throw new PaymentError('INVALID_TAB');
    if (!this.payments.available('mercadopago')) throw new PaymentError('PAYMENTS_UNAVAILABLE', 503, 'O PIX do Mercado Pago ainda não está disponível.');
    const reserved = await this.staff(this.store.reserveTabPix(tabId, userId));
    const charge = reserved.charge;
    const fail = async () => { if (reserved.claimed) await this.store.failTabCharge(charge.id).catch(() => {}); };
    const account = (await this.store.accounts(charge.tenant_id)).find((a: any) => a.provider === 'mercadopago' && a.status === 'connected' && a.accepts_pix);
    if (!account) { await fail(); throw new PaymentError('ACCOUNT_NOT_CONNECTED', 409, 'Conecte o Mercado Pago da loja (com PIX ativado) para gerar o QR da conta.'); }
    if (!reserved.claimed) return tabPixView(charge);
    if (!email) { await fail(); throw new PaymentError('EMAIL_REQUIRED', 400, 'Seu usuário precisa de um e-mail para gerar o PIX.'); }
    let created;
    try {
      const credentials = await this.payments.credentials(charge.tenant_id, 'mercadopago');
      created = await this.payments.adapters.mercadopago.createPixCharge({
        orderId: tabReference(tabId), amountCents: charge.amount_cents, method: 'pix', idempotencyKey: charge.id, email, name: '',
        webhookUrl: `${this.payments.origin}/api/payments/tab-webhooks/mercadopago/${charge.id}`,
        returnUrl: `${this.payments.origin}/app/${encodeURIComponent(reserved.slug)}`,
      }, credentials);
    } catch (e) { await fail(); throw e; }
    // If saving fails the 45 s lease expires and the next call re-claims the same row (same idempotency key at the provider).
    await this.store.saveTabCharge(charge.id, created);
    return tabPixView(await this.store.tabChargeById(charge.id));
  }

  async status(userId: string, tabId: string) {
    if (!UUID.test(tabId)) throw new PaymentError('INVALID_TAB');
    const found = await this.staff(this.store.tabCharge(tabId, userId));
    if (!found) return null;
    if (found.charge.status === 'pending' && found.charge.provider_payment_id) {
      await this.refresh(found.charge);
      const again = await this.staff(this.store.tabCharge(tabId, userId));
      if (again) return tabPixView(again.charge, again.tab_status);
    }
    return tabPixView(found.charge, found.tab_status);
  }

  async cancel(userId: string, tabId: string) {
    if (!UUID.test(tabId)) throw new PaymentError('INVALID_TAB');
    await this.staff(this.store.cancelTabCharge(tabId, userId));
  }

  /** Provider API is always asked; coalesces polling + webhook retries; SQL confirmation is idempotent. */
  async refresh(c: TabChargeRow, hint?: string, webhook = false) {
    if (!c.provider_payment_id || c.status === 'paid') return;
    const key = c.id + (webhook ? ':webhook:' + (hint || '') : '');
    const previous = this.confirmations.get(key);
    if (previous && Date.now() - previous.at < 4000) return previous.pending;
    for (const [k, v] of this.confirmations) if (Date.now() - v.at > 30_000) this.confirmations.delete(k);
    if (this.confirmations.size >= 10_000) throw new PaymentError('RATE_LIMITED', 429);
    const pending = (async () => {
      const credentials = await this.payments.credentials(c.tenant_id, 'mercadopago');
      const confirmation = await this.payments.adapters.mercadopago.getPaymentStatus(hint || c.provider_payment_id!, credentials);
      assertTabConfirmation(c, confirmation);
      // Only terminal states are written: a still-pending status never touches the database.
      if (confirmation.paid || TERMINAL.has(confirmation.rawStatus)) await this.store.confirmTab(c.id, confirmation);
    })();
    this.confirmations.set(key, { at: Date.now(), pending });
    try { await pending; } catch (e) { this.confirmations.delete(key); throw e; }
  }

  async webhook(id: string, input: Parameters<PaymentService['webhook']>[2]) {
    if (!UUID.test(id)) throw new PaymentError('INVALID_WEBHOOK', 401);
    if (!this.payments.adapters.mercadopago.verifyWebhook(input)) throw new PaymentError('INVALID_SIGNATURE', 401);
    const charge = await this.store.tabChargeById(id);
    if (!charge) throw new PaymentError('INVALID_WEBHOOK', 401);
    const hint = typeof input.query['data.id'] === 'string' ? input.query['data.id'] : undefined;
    await this.refresh(charge, hint, true);
  }
}
export { chargeRecord, confirmationRecord };
