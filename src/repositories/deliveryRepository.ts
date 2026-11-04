import { supabase } from '../lib/supabase';

export interface DeliveryDispute {
  id: string; order_id: string; tab_id: string; table_id: string;
  table_label: string; order_number: number; created_at: string; status: 'OPEN' | 'RESENT'; order_status: string;
}
export type DeliveryResolution = 'CONFIRMED_DELIVERED' | 'RESENT';

export const deliveryRepository = {
  async markDelivered(orderId: string): Promise<void> {
    const { error } = await supabase.rpc('waiter_mark_delivered', { p_order: orderId });
    if (error) throw new Error('Não foi possível registrar a entrega. Atualize os pedidos e tente novamente.');
  },
  async openDisputes(tenantId: string): Promise<DeliveryDispute[]> {
    const { data, error } = await supabase.rpc('list_open_delivery_disputes', { p_tenant: tenantId });
    if (error) throw new Error('Não foi possível carregar as entregas contestadas.');
    return Array.isArray(data) ? data.filter(row => row.status === 'OPEN' || (row.status === 'RESENT' && ['PREPARING', 'READY', 'OUT_FOR_DELIVERY'].includes(row.order_status))) : [];
  },
  async resolve(disputeId: string, resolution: DeliveryResolution): Promise<void> {
    const { error } = await supabase.rpc('resolve_delivery_dispute', { p_dispute: disputeId, p_resolution: resolution });
    if (error) throw new Error('Não foi possível resolver a entrega. Atualize a lista e tente novamente.');
  },
  observe(tenantId: string, refresh: () => void): () => void {
    const channel = supabase.channel(`delivery-disputes:${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_delivery_disputes', filter: `tenant_id=eq.${tenantId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  },
};
