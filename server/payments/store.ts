import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { resolveServerPublicConfig } from '../config/publicConfig';
import { chargeRecord, confirmationRecord } from './privacy';
import { Charge, Confirmation, PaymentError, Provider, Method } from './types';

export interface PaymentRow {
  id: string; order_id: string | null; tenant_id: string | null; anonymized_at?: string | null; provider: Provider; provider_payment_id?: string;
  method: Method; amount: number; status: string; raw_status?: string; paid_at?: string;
  brcode?: string; checkout_url?: string; expires_at?: string;
}
export class PaymentStore {
  constructor(readonly db: SupabaseClient) {}
  async rpc<T = any>(name: string, args: object): Promise<T> {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw new PaymentError('PAYMENT_STORAGE_ERROR', error.code === '42501' ? 403 : 409, 'Não foi possível concluir. Confira as configurações e os pagamentos pendentes.');
    return data as T;
  }
  async user(token: string) {
    const { data, error } = await this.db.auth.getUser(token);
    if (error || !data.user) throw new PaymentError('AUTH_REQUIRED', 401, 'Entre na sua conta para continuar.');
    return data.user;
  }
  async membership(userId: string, membershipId: string, cashier = false) {
    if (!/^[\da-f-]{36}$/i.test(membershipId)) throw new PaymentError('MEMBERSHIP_REQUIRED', 403);
    const { data, error } = await this.db.from('tenant_users').select('id,tenant_id,role_id,tenants!inner(status)')
      .eq('id', membershipId).eq('user_id', userId).eq('status', 'ACTIVE').eq('tenants.status', 'ACTIVE')
      .in('role_id', cashier ? ['OWNER', 'MANAGER', 'CASHIER'] : ['OWNER', 'MANAGER']).maybeSingle();
    if (error || !data) throw new PaymentError('FORBIDDEN', 403, 'Somente o proprietário ou gerente pode configurar os pagamentos.');
    return data;
  }
  async order(userId: string, id: string, includePayer = false) {
    const { data: row, error } = await this.db.from('orders').select('id,tenant_id,customer_id,total_amount,payment_method,payment_status,status,tenants!inner(slug,status)' + (includePayer ? ',customer_name,customer_email' : '')).eq('id', id).eq('tenants.status', 'ACTIVE').maybeSingle();
    const order = row as unknown as { id:string; tenant_id:string; customer_id:string; status:string; payment_status:string; total_amount:number; customer_name?:string; customer_email?:string; tenants:{slug:string;status:string} } | null;
    if (error || !order) throw new PaymentError('ORDER_NOT_FOUND', 404, 'Pedido indisponível.');
    const [customer, staff] = await Promise.all([
      this.db.from('customers').select('id').eq('id', order.customer_id).eq('tenant_id', order.tenant_id).eq('user_id', userId).maybeSingle(),
      this.db.from('tenant_users').select('id,role_id').eq('tenant_id', order.tenant_id).eq('user_id', userId).eq('status', 'ACTIVE').in('role_id', ['OWNER','MANAGER','CASHIER']).maybeSingle(),
    ]);
    if (!customer.data && !staff.data) throw new PaymentError('ORDER_NOT_FOUND', 404, 'Pedido indisponível.');
    return { ...order, staffRole: staff.data?.role_id as string | undefined };
  }
  async accounts(tenantId: string) {
    const { data, error } = await this.db.from('store_payment_accounts').select('provider,status,account_label,is_primary,accepts_pix,accepts_card,connected_at,connection_version').eq('tenant_id', tenantId);
    if (error) throw new PaymentError('PAYMENTS_UNAVAILABLE', 503, 'Pagamentos online em breve.');
    return data || [];
  }
  async publicAccounts(slug: string) {
    const { data, error } = await this.db.from('tenants').select('id').eq('slug', slug).eq('status', 'ACTIVE').maybeSingle();
    if (error || !data) throw new PaymentError('STORE_NOT_FOUND', 404);
    return (await this.accounts(data.id)).filter(a => a.status === 'connected');
  }
  async configure(userId: string, membership: string, provider: Provider, changes: object) {
    await this.rpc('configure_store_payment', { p_user: userId, p_membership: membership, p_provider: provider, p_changes: changes });
  }
  async secret(op: string, tenant?: string, provider?: Provider, key?: string, ciphertext?: string): Promise<string | null> {
    return this.rpc('payment_secret', { p_op: op, p_tenant: tenant ?? null, p_provider: provider ?? null, p_key: key ?? null, p_ciphertext: ciphertext ?? null });
  }
  async payment(orderId: string): Promise<PaymentRow | null> {
    const { data, error } = await this.db.from('order_payments').select('*').eq('order_id', orderId).maybeSingle();
    if (error) throw new PaymentError('PAYMENTS_UNAVAILABLE', 503);
    return data;
  }
  reserve(orderId: string, userId: string, provider: Provider, method: Method) {
    return this.rpc<{ payment: PaymentRow; claimed: boolean }>('reserve_order_payment', { p_order: orderId, p_user: userId, p_provider: provider, p_method: method });
  }
  saveCharge(id: string, charge: Charge) { return this.rpc('save_order_charge', { p_id: id, p_charge: chargeRecord(charge) }); }
  confirm(id: string, confirmation: Confirmation | null, userId?: string) {
    return this.rpc('confirm_order_payment', { p_id: id, p_confirmation: confirmation ? confirmationRecord(confirmation) : {}, p_manual_user: userId || null });
  }
  completeConnection(userId: string, membership: string, provider: Provider, ciphertext: string | null, version: number) {
    return this.rpc('complete_store_payment_connection', { p_user:userId, p_membership:membership, p_provider:provider, p_ciphertext:ciphertext, p_version:version });
  }
  async manualBrcode(orderId: string) { return this.rpc<string>('manual_order_payment_brcode', { p_order: orderId }); }
}
export function createPaymentStore(env: NodeJS.ProcessEnv): PaymentStore | null {
  const url = resolveServerPublicConfig(env).SUPABASE_URL;
  if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return new PaymentStore(createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }));
}
