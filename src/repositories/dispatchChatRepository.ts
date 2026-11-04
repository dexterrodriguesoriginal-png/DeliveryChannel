import { isOrderVisibleToStaff } from '../lib/orders/onlinePaymentGate';
import { supabase } from '../lib/supabase';
import type { OrderBrief } from '../lib/notifications/notificationView';
export type DispatchMode = 'AUTO_QUEUE' | 'OWNER_PICKS';
export interface QueueDriver { id: string; user_id: string; name: string; last_ride: string | null }
export interface OwnerNotification { id: string; tenant_id: string; kind: 'ORDER_NEW' | 'DRIVER_JOIN_REQUEST' | 'ORDER_MESSAGE' | 'TAB_REOPENED' | 'ORDER_DELIVERY_DISPUTE'; ref_id: string; title: string; created_at: string; read_at: string | null; /** Destino de mesa derivado do pedido/comanda autorizado, nunca do INSERT realtime. */ tableTarget?: string }
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
    // Realtime is untrusted input. Re-check the tenant before making any lookup,
    // and derive table targets from authorized rows rather than event properties.
    const scoped = rows.filter(n => n.tenant_id === tenantId).map(({ tableTarget: _ignored, ...n }) => n);
    const orderIds = [...new Set(scoped.filter(n => ['ORDER_NEW', 'ORDER_MESSAGE', 'ORDER_DELIVERY_DISPUTE'].includes(n.kind)).map(n => n.ref_id))];
    const tabIds = [...new Set(scoped.filter(n => n.kind === 'TAB_REOPENED').map(n => n.ref_id))];
    const [orders, tabs] = await Promise.all([
      orderIds.length ? supabase.from('orders').select('id,tenant_id,awaiting_online_payment').eq('tenant_id', tenantId).in('id', orderIds) : Promise.resolve({ data: [], error: null }),
      tabIds.length ? supabase.from('dining_tabs').select('id,tenant_id,table_id').eq('tenant_id', tenantId).in('id', tabIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (orders.error || tabs.error) throw new Error('Não foi possível conferir as notificações.');
    const visible = new Set((orders.data || []).filter(o => o.tenant_id === tenantId && isOrderVisibleToStaff(o)).map(o => o.id));
    const tableByTab = new Map((tabs.data || []).filter(t => t.tenant_id === tenantId && typeof t.table_id === 'string').map(t => [t.id, t.table_id]));
    return scoped.flatMap(n => {
      if (n.kind === 'TAB_REOPENED') {
        const tableTarget = tableByTab.get(n.ref_id);
        return tableTarget ? [{ ...n, tableTarget }] : [];
      }
      return n.kind === 'DRIVER_JOIN_REQUEST' || ((['ORDER_NEW', 'ORDER_MESSAGE', 'ORDER_DELIVERY_DISPUTE'].includes(n.kind)) && visible.has(n.ref_id)) ? [n] : [];
    });
  },
  async notifications(tenantId: string): Promise<OwnerNotification[]> {
    const { data, error } = await supabase.from('owner_notifications').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(100);
    if (error) throw new Error('Não foi possível carregar as notificações.');
    return dispatchChatRepository.visibleNotifications(tenantId, data || []);
  },
  /** Dados curtos dos pedidos citados nas notificações (nº, cliente, total) para a linha de detalhe. Só leitura. */
  async orderBriefs(tenantId: string, orderIds: string[]): Promise<Record<string, OrderBrief>> {
    if (!orderIds.length) return {};
    const { data, error } = await supabase.from('orders').select('id,order_number,customer_name,total_amount,status,fulfillment_type,tab_id').eq('tenant_id', tenantId).in('id', orderIds.slice(0, 100));
    if (error) return {};
    return Object.fromEntries((data || []).map((o: any) => [o.id, { orderNumber: o.order_number ?? null, customerName: o.customer_name ?? null, total: o.total_amount == null ? null : Number(o.total_amount), status: o.status, fulfillmentType: o.fulfillment_type, tabId: o.tab_id }]));
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
