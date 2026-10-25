import { assertNoSplit, ChargeInput, Credentials, PaymentError, PaymentProvider } from './types';
/** Uses the existing audited SQL _pix_brcode helper (EMV TLV + CRC16 + txid). */
export class ManualPix implements PaymentProvider {
  constructor(private generate: (input: ChargeInput) => Promise<string>) {}
  async connect(): Promise<Credentials> { return {}; }
  async disconnect() {}
  async createPixCharge(i: ChargeInput) {
    assertNoSplit(i);
    return { providerPaymentId: i.orderId, brcode: await this.generate(i), manualConfirmation: true };
  }
  async createCardCheckout(): Promise<never> { throw new PaymentError('CARD_UNAVAILABLE'); }
  async getPaymentStatus(id: string) { return { providerPaymentId: id, orderId: id, amountCents: 0, currency: 'BRL', paid: false, rawStatus: 'awaiting_confirmation' }; }
  verifyWebhook() { return false; }
}
