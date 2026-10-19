/**
 * Fila de chegada da retirada (migration 20261019002100). Se o banco não tiver a migration,
 * `available()` fica false e a interface da fila é escondida (degradação segura).
 */
import { supabase } from '../lib/supabase';
import { isArrivalFeatureMissing, type ArrivalRow } from '../lib/pickup/arrival';

let feature: 'unknown' | 'on' | 'off' = 'unknown';
const listeners = new Set<() => void>();
function setFeature(v: 'on' | 'off') { if (feature !== v) { feature = v; listeners.forEach(l => l()); } }

export interface MyPickupStatus { code: string; arrivedAt: string | null; calledAt: string | null; handedOverAt?: string | null; closed?: boolean; position: number | null }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) { if (isArrivalFeatureMissing(error)) setFeature('off'); throw error; }
  setFeature('on');
  return data as T;
}

export const arrivalRepository = {
  isOn: () => feature === 'on',
  isOff: () => feature === 'off',
  onChange(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  async listOpen(tenantId: string): Promise<ArrivalRow[] | null> {
    const { data, error } = await supabase.from('pickup_arrivals')
      .select('order_id,pickup_code,arrived_at,called_at,closed_at').eq('tenant_id', tenantId).is('closed_at', null);
    if (error) { if (isArrivalFeatureMissing(error)) { setFeature('off'); return null; } throw error; }
    setFeature('on');
    return (data || []) as ArrivalRow[];
  },
  subscribe(tenantId: string, cb: () => void): () => void {
    const ch = supabase.channel(`arrivals-${tenantId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'pickup_arrivals', filter: `tenant_id=eq.${tenantId}` }, () => cb())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  },
  subscribeOrder(orderId: string, cb: () => void): () => void {
    const ch = supabase.channel(`arrival-${orderId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'pickup_arrivals', filter: `order_id=eq.${orderId}` }, () => cb())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  },
  getStoreQr: (tenantId: string) => rpc<{ token: string }>('get_store_arrival_qr', { p_tenant_id: tenantId }),
  rotateStoreQr: (tenantId: string) => rpc<{ token: string }>('rotate_store_arrival_qr', { p_tenant_id: tenantId }),
  checkIn: (token: string, orderId: string) => rpc<MyPickupStatus>('customer_check_in', { p_store_qr_token: token, p_order_id: orderId }),
  myStatus: (orderId: string) => rpc<MyPickupStatus | null>('get_my_pickup_status', { p_order_id: orderId }),
  call: (orderId: string) => rpc<{ success: boolean }>('call_pickup', { p_order_id: orderId }),
  async confirmHandover(orderId: string, code: string): Promise<{ success: boolean; attemptsLeft?: number }> {
    const r = await rpc<any>('confirm_handover', { p_order_id: orderId, p_code: code });
    return { success: Boolean(r?.success), attemptsLeft: r?.attemptsLeft };
  },
};
