import { isValidReceiptEmail } from '../../src/lib/receiptEmail';
import { receiptProvider, sendReceipt } from './provider';
import { ReceiptError, type ReceiptProvider, type ReceiptResult, type ReceiptStore } from './types';

export class ReceiptService {
  constructor(readonly store: ReceiptStore, private readonly provider: ReceiptProvider | null) {}
  static configured(store: ReceiptStore, env: NodeJS.ProcessEnv) { return new ReceiptService(store, receiptProvider(env)); }
  async send(userId: string, tabId: string, overrideEmail?: string): Promise<ReceiptResult> {
    if (overrideEmail !== undefined && !isValidReceiptEmail(overrideEmail)) throw new ReceiptError('INVALID_EMAIL', 400, 'Informe um e-mail válido.');
    if (!this.provider) {
      await this.store.authorize(tabId, userId);
      console.warn('[receipts] EMAIL_PROVIDER_NOT_CONFIGURED: RESEND_API_KEY or RECEIPT_FROM missing');
      return { sent: false, reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' };
    }
    // Reservation locks the account and shares its quota across all recipient addresses.
    const receipt = overrideEmail ? await this.store.reserve(tabId, userId, overrideEmail) : await this.store.reserve(tabId, userId);
    try {
      await sendReceipt(this.provider, receipt);
    } catch {
      await this.store.finish(receipt.attempt_id, false, 'PROVIDER_ERROR');
      throw new ReceiptError('RECEIPT_PROVIDER_ERROR', 502, 'Não foi possível enviar o comprovante. Tente novamente em instantes.');
    }
    await this.store.finish(receipt.attempt_id, true);
    return { sent: true };
  }
}
