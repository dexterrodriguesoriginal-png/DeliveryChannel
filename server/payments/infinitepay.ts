import { assertNoSplit, ChargeInput, Credentials, PaymentProvider, PaymentError } from './types';
import { checkoutUrl, jsonHeaders, providerRequest, Transport } from './http';
export class InfinitePay implements PaymentProvider {
  constructor(private fetcher: Transport = fetch) {}
  async connect(i: { infiniteTag?: string }): Promise<Credentials> {
    const infiniteTag = i.infiniteTag?.replace(/^\$/, '').trim();
    if (!infiniteTag || !/^[a-zA-Z0-9_-]{2,64}$/.test(infiniteTag)) throw new PaymentError('INVALID_TAG', 400, 'Informe uma InfiniteTag válida.');
    return { infiniteTag };
  }
  async disconnect() {}
  async createPixCharge(i: ChargeInput, c: Credentials) { return this.createCardCheckout(i, c); }
  async createCardCheckout(i: ChargeInput, c: Credentials) {
    assertNoSplit(i);
    const r = await providerRequest(this.fetcher, 'https://api.checkout.infinitepay.io/links', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ handle: c.infiniteTag, order_nsu: i.orderId,
      items: [{ quantity: 1, price: i.amountCents, description: 'Pedido na loja' }], redirect_url: i.returnUrl }) });
    // Public documentation does not specify signed webhooks or authenticated merchant confirmation.
    // Keep this flow manual; a redirect, unsigned notification, or public lookup never marks PAID.
    return { providerPaymentId: i.orderId, checkoutUrl: checkoutUrl(r.url, ['infinitepay.io']), manualConfirmation: true };
  }
  async getPaymentStatus(id: string) {
    return { providerPaymentId: id, orderId: id, amountCents: 0, currency: 'BRL', paid: false, rawStatus: 'awaiting_confirmation' };
  }
  verifyWebhook() { return false; }
}
