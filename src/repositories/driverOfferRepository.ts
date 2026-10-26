import { supabase } from '../lib/supabase';
export type OfferStatus = 'OFFERED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';
export interface DriverOffer {
  id: string; tenant_id: string; order_id: string; driver_user_id: string; status: OfferStatus;
  created_at: string; expires_at: string; responded_at: string | null;
}
export interface MyDriverOffer {
  id: string; tenant_id: string; order_id: string; order_number: number; store_name: string;
  neighborhood: string; delivery_fee: number; expires_at: string;
}
export async function offerRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  // Erros de negócio retornados como dados permitem persistir a expiração na mesma transação.
  if (data?.success === false) throw new Error(data.error);
  return data as T;
}
export const driverOfferRepository = {
  offer: (orderId: string, driverUserId: string | null) => offerRpc('offer_order_to_driver', { p_order_id: orderId, p_driver_user_id: driverUserId }),
  respond: (offerId: string, accept: boolean) => offerRpc('driver_respond_offer', { p_offer_id: offerId, p_accept: accept }),
  cancel: (offerId: string) => offerRpc('cancel_driver_offer', { p_offer_id: offerId }),
  mine: () => offerRpc<MyDriverOffer[]>('get_my_driver_offers'),
  expire: () => offerRpc<number>('expire_driver_offers'),
  setTimeout: (tenantId: string, seconds: number) => offerRpc<void>('set_driver_offer_timeout', { p_tenant_id: tenantId, p_seconds: seconds }),
  async forOrders(tenantId: string, orderIds: string[]): Promise<DriverOffer[]> {
    const rows: DriverOffer[] = [];
    for (let start = 0; start < orderIds.length; start += 100) {
      const { data, error } = await supabase.from('order_driver_offers').select('*').eq('tenant_id', tenantId)
        .in('order_id', orderIds.slice(start, start + 100)).order('created_at', { ascending: false });
      if (error) throw error;
      rows.push(...(data || []));
    }
    return rows;
  },
  subscribeDriver(driverId: string, refresh: () => void) {
    const channel = supabase.channel(`driver-offers:${driverId}`).on('postgres_changes',
      { event: '*', schema: 'public', table: 'order_driver_offers', filter: `driver_user_id=eq.${driverId}` }, refresh).subscribe();
    return () => { void supabase.removeChannel(channel); };
  },
  subscribeTenant(tenantId: string, refresh: () => void) {
    const channel = supabase.channel(`store-offers:${tenantId}`).on('postgres_changes',
      { event: '*', schema: 'public', table: 'order_driver_offers', filter: `tenant_id=eq.${tenantId}` }, refresh).subscribe();
    return () => { void supabase.removeChannel(channel); };
  },
};
// resync
