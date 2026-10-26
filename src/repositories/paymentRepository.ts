import { supabase } from '../lib/supabase';
export type OnlineProvider = 'mercadopago' | 'pagbank' | 'infinitepay' | 'manual_pix';
export interface OnlineChoice { provider: OnlineProvider; method: 'pix' | 'card'; }
export interface PaymentAccount {
  provider: OnlineProvider; status?: string; account_label: string; is_primary: boolean;
  accepts_pix: boolean; accepts_card: boolean; connected_at?: string;
}
export interface OnlinePayment {
  id: string; orderId: string; provider: OnlineProvider; method: 'pix' | 'card'; amount: number;
  status: string; brcode: string | null; checkoutUrl: string | null; expiresAt: string | null;
  manualConfirmation: boolean; canConfirm: boolean;
}
export const PROVIDER_LABELS: Record<OnlineProvider, string> = {
  mercadopago: 'Mercado Pago', pagbank: 'PagBank', infinitepay: 'InfinitePay', manual_pix: 'Chave PIX (manual)',
};
async function request<T>(path: string, body?: unknown, membership?: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const response = await fetch('/api/payments' + path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'same-origin',
    headers: { ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(membership ? { 'X-Membership-Id': membership } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let result: any;
  try { result = await response.json(); } catch { throw new Error('Pagamentos online em breve.'); }
  if (!response.ok) throw new Error(result.error || 'Não foi possível carregar o pagamento.');
  return result as T;
}
async function membershipFor(tenantId: string) {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('Entre na sua conta para configurar pagamentos.');
  const { data, error } = await supabase.from('tenant_users').select('id').eq('tenant_id', tenantId).eq('user_id', user.user.id).eq('status','ACTIVE').maybeSingle();
  if (error || !data?.id) throw new Error('Você não tem permissão para configurar pagamentos nesta loja.');
  // Only a membership selector is sent. Express revalidates it and derives tenant_id itself.
  return data.id as string;
}
export interface PaymentToConfirm {
  order_number: number; amount: number; method: string; created_at: string; customer_first_name: string;
}
export const paymentRepository = {
  async toConfirm(tenantId: string): Promise<PaymentToConfirm[]> {
    const { data, error } = await supabase.rpc('list_payments_to_confirm', { p_tenant: tenantId });
    if (error) throw new Error('Não foi possível carregar os pagamentos para conferir.');
    return data || [];
  },
  async confirmPending(tenantId: string, orderNumber: number): Promise<void> {
    const { error } = await supabase.rpc('confirm_pending_online_payment', { p_tenant: tenantId, p_order_number: orderNumber });
    if (error) throw new Error('Não foi possível confirmar. Confira o recebimento e tente de novo.');
  },
  options: (slug: string) => request<{ accounts: PaymentAccount[] }>('/options/' + encodeURIComponent(slug)),
  async accounts(tenantId: string) { return request<{ accounts: PaymentAccount[]; availability: Record<OnlineProvider, boolean> }>('/accounts', undefined, await membershipFor(tenantId)); },
  async connect(tenantId: string, provider: OnlineProvider, infiniteTag?: string) { return request<{ url?: string }>(`/accounts/${provider}/connect`, { infiniteTag }, await membershipFor(tenantId)); },
  async configure(tenantId: string, provider: OnlineProvider, body: object) { return request(`/accounts/${provider}`, body, await membershipFor(tenantId)); },
  create: (id: string, choice: OnlineChoice, taxId?: string) => request<{ payment: OnlinePayment | null }>(`/orders/${encodeURIComponent(id)}`, { ...choice, taxId }),
  status: (id: string) => request<{ payment: OnlinePayment | null }>(`/orders/${encodeURIComponent(id)}`),
  confirm: (id: string) => request(`/orders/${encodeURIComponent(id)}/confirm`, {}),
};
