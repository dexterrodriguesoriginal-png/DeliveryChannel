import { supabase } from '../lib/supabase';

export interface DeliveryDispute {
  id: string; order_id: string; tab_id: string; table_id: string;
  table_label: string; order_number: number; created_at: string; status: 'OPEN' | 'RESENT'; order_status: string;
}
export type DeliveryResolution = 'CONFIRMED_DELIVERED' | 'RESENT';

export const deliveryRepository = {
  async markDelivered(orderId: string, code?: string): Promise<void> {
    const args = code === undefined ? { p_order: orderId } : { p_order: orderId, p_code: code.trim() };
    const { data, error } = await supabase.rpc('waiter_mark_delivered', args);
    if (error) {
      const msg = String(error.message || '');
      if (msg.includes('DELIVERY_CODE_REQUIRED')) {
        throw Object.assign(new Error('Informe o código de 4 dígitos do cliente para confirmar a entrega.'), { code: 'DELIVERY_CODE_REQUIRED' });
      }
      if (msg.includes('DELIVERY_CODE_LOCKED')) {
        throw Object.assign(new Error('Código bloqueado após 5 tentativas incorretas.'), { code: 'DELIVERY_CODE_LOCKED' });
      }
      throw new Error('Não foi possível registrar a entrega. Atualize os pedidos e tente novamente.');
    }
    if (data && typeof data === 'object' && (data as { success?: boolean }).success === false) {
      const attemptsLeft = (data as { attempts_left?: number }).attempts_left ?? 0;
      throw Object.assign(
        new Error(`Código incorreto. Tentativas restantes: ${attemptsLeft}.`),
        { code: 'DELIVERY_CODE_INVALID', attemptsLeft },
      );
    }
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
