export const PROVIDERS = ['mercadopago', 'pagbank', 'infinitepay', 'manual_pix'] as const;
export type Provider = typeof PROVIDERS[number];
export type Method = 'pix' | 'card';
export type PaymentState = 'creating' | 'pending' | 'awaiting_confirmation' | 'paid' | 'failed' | 'expired';
export interface Credentials {
  accessToken?: string; refreshToken?: string; expiresAt?: number; accountId?: string;
  infiniteTag?: string;
}
export interface ChargeInput {
  orderId: string; amountCents: number; method: Method; idempotencyKey: string;
  email: string; name: string; taxId?: string; webhookUrl: string; returnUrl: string;
  applicationFee?: number; // Reserved for future split. Rejected while disabled.
}
export interface Charge {
  providerPaymentId: string; brcode?: string; checkoutUrl?: string; expiresAt?: string;
  manualConfirmation: boolean;
}
export interface Confirmation {
  providerPaymentId: string; orderId: string; amountCents: number; currency: string;
  paid: boolean; rawStatus: string;
}
export interface WebhookInput {
  headers: Record<string, string | undefined>; query: Record<string, unknown>; rawBody: Buffer;
  now?: number;
}
export interface PaymentProvider {
  createPixCharge(input: ChargeInput, credentials: Credentials): Promise<Charge>;
  createCardCheckout(input: ChargeInput, credentials: Credentials): Promise<Charge>;
  getPaymentStatus(id: string, credentials: Credentials, input?: ChargeInput): Promise<Confirmation>;
  verifyWebhook(input: WebhookInput, credentials?: Credentials): boolean;
  connect(input: { code?: string; verifier?: string; redirectUri: string; infiniteTag?: string }): Promise<Credentials>;
  disconnect(credentials: Credentials): Promise<void>;
}
export class PaymentError extends Error {
  constructor(public code: string, public status = 400, message = 'Não foi possível processar o pagamento. Tente novamente.') { super(message); }
}
export function providerName(value: unknown): Provider {
  if (!PROVIDERS.includes(value as Provider)) throw new PaymentError('INVALID_PROVIDER');
  return value as Provider;
}
export function assertNoSplit(input: ChargeInput) {
  if (input.applicationFee != null && input.applicationFee !== 0) throw new PaymentError('SPLIT_DISABLED');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new PaymentError('INVALID_AMOUNT');
}
