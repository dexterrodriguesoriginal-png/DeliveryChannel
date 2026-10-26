import { isOrderVisibleToStaff } from '../lib/orders/onlinePaymentGate';
import { supabase } from '../lib/supabase';
export type DispatchMode = 'AUTO_QUEUE' | 'OWNER_PICKS';
export interface QueueDriver { id: string; user_id: string; name: string; last_ride: string | null }
export interface OwnerNotification { id: string; tenant_id: string; kind: 'ORDER_NEW' | 'DRIVER_JOIN_REQUEST' | 'ORDER_MESSAGE'; ref_id: string; title: string; created_at: string; read_at: string | null }
export interface OrderMessage { id: string; tenant_id: string; order_id: string; sender_role: 'DRIVER' | 'STORE'; body: string; created_at: string }
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message.includes('RATE_LIMITED') ? 'Aguarde um minuto e tente de novo.' : 'Não foi possível concluir. Tente de novo.');
  return data as T;
}
export const dispatchChatRepository = {
  queue: (tenantId: string) => rpc<{ mode: DispatchMode; timeoutSeconds?: number; drivers: QueueDriver[] }>('get_dispatch_queue', { p_tenant_id: tenantId }),
  setMode: (tenantId: string, mode: DispatchMode) => rpc<void>('set_dispatch_mode', { p_tenant_id: tenantId, p_mode: mode }),
  async visibleNotifications(tenantId: string, rows: OwnerNotification[]): Promise<OwnerNotification[]> {
    const orderIds = [...new Set(rows.filter(n => n.kind !== 'DRIVER_JOIN_REQUEST').map(n => n.ref_id))];
    if (!orderIds.length) return rows;
    const { data, error } = await supabase.from('orders').select('id,awaiting_online_payment').eq('tenant_id', tenantId).in('id', orderIds);
    if (error) throw new Error('Não foi possível conferir as notificações.');
    const visible = new Set((data || []).filter(isOrderVisibleToStaff).map(o => o.id));
    return rows.filter(n => n.kind === 'DRIVER_JOIN_REQUEST' || visible.has(n.ref_id));
  },
  async notifications(tenantId: string): Promise<OwnerNotification[]> {
    const { data, error } = await supabase.from('owner_notifications').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(100);
    if (error) throw new Error('Não foi possível carregar as notificações.');
    return dispatchChatRepository.visibleNotifications(tenantId, data || []);
  },
  async read(tenantId: string, id: string): Promise<void> {
    const { error } = await supabase.from('owner_notifications').update({ read_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id);
    if (error) throw new Error('Não foi possível marcar como lida.');
  },
  async messages(tenantId: string, orderId: string): Promise<OrderMessage[]> {
    const { data, error } = await supabase.from('order_messages').select('id,tenant_id,order_id,sender_role,body,created_at').eq('tenant_id', tenantId).eq('order_id', orderId).order('created_at', { ascending: false }).limit(200);
    if (error) throw new Error('Não foi possível carregar a conversa.');
    return (data || []).reverse();
  },
  send: (orderId: string, body: string) => rpc<string>('send_order_message', { p_order_id: orderId, p_body: body }),
};
// resync
