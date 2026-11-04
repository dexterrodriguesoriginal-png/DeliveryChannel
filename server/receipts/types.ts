/** Server-only projection. Never return this payload to the browser or log it. */
export interface TabReceipt {
  attempt_id: string;
  recipient_email: string;
  store_name: string;
  table_label: string;
  items: Array<{ name: string; quantity: number; unit_price: number; total_price: number }>;
  service_fee_cents: number;
  total_cents: number;
  method: 'PIX';
  paid_at: string;
  charge_id: string;
}

export type ReceiptFailure = 'EMAIL_PROVIDER_NOT_CONFIGURED' | 'PROVIDER_ERROR';
export type ReceiptResult = { sent: true } | { sent: false; reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' };

export class ReceiptError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}

export interface ReceiptProvider {
  send(receipt: TabReceipt): Promise<void>;
}

export interface ReceiptStore {
  user(token: string): Promise<{ id: string }>;
  reserve(tabId: string, userId: string): Promise<TabReceipt>;
  finish(attemptId: string, sent: boolean, reason?: ReceiptFailure): Promise<void>;
}
