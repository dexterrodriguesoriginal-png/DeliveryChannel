import type { Charge, Confirmation } from './types';
import { PaymentError } from './types';

const statuses = new Set(['approved','pending','in_process','authorized','in_mediation','rejected','cancelled','refunded','charged_back','paid','in_analysis','declined','canceled','waiting','expired','awaiting_confirmation','manual_confirmed','unknown']);
export function paymentStatus(value: unknown): string {
  return typeof value === 'string' && statuses.has(value.toLowerCase()) ? value.toLowerCase() : 'unknown';
}
/** Explicit projections: provider responses/webhooks/card details never cross the persistence boundary. */
export function confirmationRecord(value: Confirmation) {
  return { providerPaymentId: technicalId(value.providerPaymentId), orderId: technicalId(value.orderId),
    amountCents: value.amountCents, currency: value.currency === 'BRL' ? 'BRL' : '', paid: value.paid === true,
    rawStatus: paymentStatus(value.rawStatus) };
}
function technicalId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_:-]{1,160}$/.test(value)) throw new PaymentError('INVALID_PROVIDER_ID',502);
  return value;
}
export function chargeRecord(value: Charge) {
  return { providerPaymentId: technicalId(value.providerPaymentId), brcode: value.brcode,
    checkoutUrl: value.checkoutUrl, expiresAt: value.expiresAt, manualConfirmation: value.manualConfirmation === true };
}
export function hasCardDetails(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => /^(card|cardnumber|card_number|number|pan|cvv|cvc|security_code|securitycode|expiration_month|expiration_year|expiry|cardholder)$/i.test(key)
    || hasCardDetails(item));
}
export type PaymentEvent = 'retention_completed' | 'retention_failed' | 'revocation_failed';
/** No request, exception, URL, identity, payload or arbitrary text can be attached. */
export function paymentLog(event: PaymentEvent, count?: number) {
  const allowed = ['retention_completed','retention_failed','revocation_failed'];
  if (!allowed.includes(event)) return;
  console.info(JSON.stringify({ scope:'payments', event, ...(Number.isSafeInteger(count) && count! >= 0 ? { count } : {}) }));
}

export function isRuntimeArtifactPath(path: string): boolean {
  try { return /(?:^|\/)(?:server|payment-retention|dispatch-retention)\.cjs(?:\.map)?$/i.test(decodeURIComponent(path)); }
  catch { return true; }
}
