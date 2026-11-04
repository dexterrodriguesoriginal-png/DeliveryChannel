import type { SupabaseClient } from '@supabase/supabase-js';
import { createPaymentStore } from '../payments/store';
import { ReceiptError, type ReceiptFailure, type ReceiptStore, type TabReceipt } from './types';

/** Only map messages owned by our RPCs. Database exceptions can contain private values. */
export function receiptStorageError(error: { code?: string; message?: string }) {
  if (error.code === '42501' || error.message === 'Acesso negado.') {
    return new ReceiptError('FORBIDDEN', 403, 'Você não tem permissão para enviar este comprovante.');
  }
  if (error.message === 'Muitos envios de comprovante. Aguarde.') {
    return new ReceiptError('RATE_LIMITED', 429, 'Limite de três envios por comanda em dez minutos. Aguarde para reenviar.');
  }
  if (error.message === 'Cliente sem e-mail para comprovante.') {
    return new ReceiptError('RECEIPT_EMAIL_MISSING', 409, 'O cliente não tem e-mail cadastrado para receber o comprovante.');
  }
  if (error.message?.includes('INVALID_EMAIL')) {
    return new ReceiptError('INVALID_EMAIL', 400, 'Informe um e-mail válido.');
  }
  return new ReceiptError('RECEIPT_UNAVAILABLE', 409, 'O comprovante não está disponível. Atualize a conta e tente novamente.');
}

export class SupabaseReceiptStore implements ReceiptStore {
  constructor(private readonly db: SupabaseClient) {}
  async user(token: string) {
    const { data, error } = await this.db.auth.getUser(token);
    if (error || !data.user) throw new ReceiptError('AUTH_REQUIRED', 401, 'Entre na sua conta para continuar.');
    return { id: data.user.id };
  }
  async authorize(tabId: string, userId: string) {
    const { error } = await this.db.rpc('authorize_tab_receipt', { p_tab: tabId, p_user: userId });
    if (error) throw receiptStorageError(error);
  }
  async reserve(tabId: string, userId: string, overrideEmail?: string) {
    const args = overrideEmail ? { p_tab: tabId, p_user: userId, p_override_email: overrideEmail } : { p_tab: tabId, p_user: userId };
    const { data, error } = await this.db.rpc('reserve_tab_receipt', args);
    if (error) throw receiptStorageError(error);
    return data as TabReceipt;
  }
  async finish(attemptId: string, sent: boolean, reason?: ReceiptFailure) {
    const { error } = await this.db.rpc('finish_tab_receipt', { p_attempt: attemptId, p_sent: sent, p_reason: reason || null });
    if (error) throw receiptStorageError(error);
  }
}

export function createReceiptStore(env: NodeJS.ProcessEnv): ReceiptStore | null {
  const paymentStore = createPaymentStore(env);
  return paymentStore ? new SupabaseReceiptStore(paymentStore.db) : null;
}
