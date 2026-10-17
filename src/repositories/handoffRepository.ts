/**
 * RPCs do despacho com códigos (migrations 1500–1700).
 * Os códigos nunca são lidos por SELECT: só por estas RPCs SECURITY DEFINER, que aplicam quem pode ver o quê.
 */
import { supabase } from '../lib/supabase';
import { handoffErrorMessage } from '../lib/orders/handoff';

export interface AvailableDriverOrder {
  id: string;
  orderNumber: number;
  tenantId: string;
  storeName: string;
  deliveryAddress: string;
  totalAmount: number;
  paymentMethod: string;
  createdAt: string;
  driverPayout: number;
}

export interface CodeAttemptResult { success: boolean; attemptsLeft?: number }
export interface PickupCodeInfo { code: string; confirmed: boolean; locked: boolean; attempts: number }

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(handoffErrorMessage(error));
  return data as T;
}

export const handoffRepository = {
  async listAvailable(): Promise<AvailableDriverOrder[]> {
    const rows = await call<any[]>('list_available_driver_orders');
    return (rows || []).map(r => ({ ...r, totalAmount: Number(r.totalAmount) || 0, driverPayout: Number(r.driverPayout) || 0 }));
  },
  accept: (orderId: string) => call('driver_accept_order', { p_order_id: orderId }),
  async confirmPickup(orderId: string, code: string): Promise<CodeAttemptResult> {
    const r = await call<any>('confirm_order_pickup', { p_order_id: orderId, p_code: code });
    return { success: Boolean(r?.success), attemptsLeft: r?.attemptsLeft };
  },
  async confirmDelivery(orderId: string, code: string): Promise<CodeAttemptResult> {
    const r = await call<any>('confirm_order_delivery', { p_order_id: orderId, p_code: code });
    return { success: Boolean(r?.success), attemptsLeft: r?.attemptsLeft };
  },
  getPickupCode: (orderId: string) => call<PickupCodeInfo | null>('get_order_pickup_code', { p_order_id: orderId }),
  resetPickupCode: (orderId: string) => call<PickupCodeInfo | null>('reset_order_pickup_code', { p_order_id: orderId }),
  async getMyDeliveryCode(orderId: string): Promise<string | null> {
    const r = await call<{ code?: string } | null>('get_my_order_delivery_code', { p_order_id: orderId });
    return r?.code ?? null;
  },
};
