import { supabase } from '../lib/supabase';

export interface TabReceiptTarget { exists: boolean; maskedEmail: string | null }
export type TabReceiptResult = { sent: true } | { sent: false; reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' };

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@.]+$/;
export function isValidReceiptEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && VALID_EMAIL.test(trimmed);
}

export const tabReceiptRepository = {
  async target(tabId: string): Promise<TabReceiptTarget> {
    const { data, error } = await supabase.rpc('tab_receipt_target', { p_tab: tabId });
    if (error) throw new Error('Não foi possível consultar o destinatário do comprovante.');
    const masked = typeof data?.email_masked === 'string' && data.email_masked.includes('*') ? data.email_masked : null;
    return { exists: data?.exists === true, maskedEmail: masked };
  },
  async send(tabId: string, overrideEmail?: string): Promise<TabReceiptResult> {
    const trimmedOverride = overrideEmail?.trim();
    if (trimmedOverride !== undefined && trimmedOverride !== '' && !isValidReceiptEmail(trimmedOverride)) {
      throw new Error('Informe um e-mail válido.');
    }
    const { data } = await supabase.auth.getSession();
    const response = await fetch(`/api/receipts/tabs/${encodeURIComponent(tabId)}`, {
      method: 'POST', cache: 'no-store', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
      body: trimmedOverride ? JSON.stringify({ overrideEmail: trimmedOverride }) : '{}',
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 429) throw new Error('Limite de envios atingido. Aguarde 10 minutos para tentar novamente.');
      if (result?.code === 'INVALID_EMAIL') throw new Error('Informe um e-mail válido.');
      if (result?.code === 'RECEIPT_EMAIL_MISSING') throw new Error('O cliente não informou e-mail para o comprovante.');
      throw new Error('Não foi possível enviar o comprovante. Tente novamente em instantes.');
    }
    if (result?.sent === true) return { sent: true };
    if (result?.reason === 'EMAIL_PROVIDER_NOT_CONFIGURED') return { sent: false, reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' };
    throw new Error('Não foi possível enviar o comprovante. Tente novamente em instantes.');
  },
};
