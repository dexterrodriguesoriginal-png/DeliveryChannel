import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { kitchenClient } from '../lib/kitchen/kitchenClient';
import type { KitchenOrder } from '../lib/kitchen/kitchenBoard';

export interface KitchenSettings { enabled: boolean; has_pin: boolean; active_devices: number }
export interface KitchenDevice { id: string; name: string; created_at: string; last_seen_at: string | null; revoked_at: string | null }
export interface KitchenContext { mode: 'device' | 'staff'; tenant_id: string; store_name: string; device_name?: string; pin_required: boolean; locked: boolean }

async function call<T>(c: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/** 19/10: Tela da Cozinha. Painel (dono/gerente/equipe) usa o cliente normal; o tablet usa o kitchenClient anônimo. */
export const kitchenRepository = {
  // painel
  getSettings: (t: string) => call<KitchenSettings>(supabase, 'get_kitchen_settings', { p_tenant_id: t }),
  setSettings: (t: string, enabled: boolean, pin?: string | null, clearPin = false) =>
    call<KitchenSettings>(supabase, 'set_kitchen_settings', { p_tenant_id: t, p_enabled: enabled, p_pin: pin ?? null, p_clear_pin: clearPin }),
  createCode: (t: string, name?: string) => call<{ code: string; expires_at: string }>(supabase, 'create_kitchen_pairing_code', { p_tenant_id: t, p_device_name: name ?? null }),
  listDevices: (t: string) => call<KitchenDevice[]>(supabase, 'list_kitchen_devices', { p_tenant_id: t }),
  revokeDevice: (id: string) => call<{ revoked: boolean }>(supabase, 'revoke_kitchen_device', { p_device_id: id }),

  // tela (aparelho ou equipe)
  clientFor: (mode: 'device' | 'staff') => (mode === 'device' ? kitchenClient() : supabase),
  async ensureDeviceSession(): Promise<void> {
    const c = kitchenClient(); const { data } = await c.auth.getSession();
    if (!data.session) { const { error } = await c.auth.signInAnonymously(); if (error) throw error; }
  },
  async resetDeviceSession(): Promise<void> { try { await kitchenClient().auth.signOut({ scope: 'local' }); } catch { /* ok */ } },
  async hasDeviceSession(): Promise<boolean> { const { data } = await kitchenClient().auth.getSession(); return !!data.session; },
  redeem: (code: string, name: string) => call<{ device_id: string; tenant_id: string; store_name: string; pin_required: boolean }>(kitchenClient(), 'redeem_kitchen_pairing_code', { p_code: code, p_device_name: name, p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : null }),
  context: (c: SupabaseClient, t?: string | null) => call<KitchenContext>(c, 'kitchen_get_context', { p_tenant_id: t ?? null }),
  unlock: (pin: string) => call<{ unlocked_until: string }>(kitchenClient(), 'kitchen_unlock', { p_pin: pin }),
  lock: () => call<void>(kitchenClient(), 'kitchen_lock'),
  listOrders: (c: SupabaseClient, t?: string | null) => call<KitchenOrder[]>(c, 'kitchen_list_orders', { p_tenant_id: t ?? null }),
  setStatus: (c: SupabaseClient, orderId: string, to: 'PREPARING' | 'READY') => call<{ status: string; unchanged: boolean }>(c, 'kitchen_set_order_status', { p_order_id: orderId, p_to: to }),
  subscribe(c: SupabaseClient, tenantId: string, cb: () => void): () => void {
    const ch = c.channel(`kitchen-${tenantId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'kitchen_order_signals', filter: `tenant_id=eq.${tenantId}` }, () => cb())
      .subscribe();
    return () => { c.removeChannel(ch); };
  },
};
